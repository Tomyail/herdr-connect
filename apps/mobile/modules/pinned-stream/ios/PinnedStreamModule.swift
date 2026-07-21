// PinnedStreamModule.swift
//
// iOS-only Expo module that opens a long-lived HTTPS Server-Sent Events stream
// pinned to a self-signed certificate fingerprint. Companion to PinnedFetch
// (one-shot request); both share PinnedTrustEvaluator for the trust decision.
//
// The native layer is intentionally dumb about protocol semantics:
//   - On TLS challenge, delegate to PinnedTrustEvaluator (same trust model as
//     PinnedFetch — fingerprint IS the trust decision, no CA-chain eval).
//   - On stream data, accumulate bytes, split on "\n\n" (SSE frame boundary),
//     extract the `data:` line of each frame, and forward the raw string to JS
//     via sendEvent("onEvent", ...). No JSON decoding here — protocol parsing
//     (cursor/online validation) lives in TS, matching network.ts style.
//   - On task completion, classify the error (fingerprint_mismatch /
//     tls_handshake_failed / timeout / network_error) or emit onClose for a
//     clean EOF.
//
// One module instance supports at most one active stream; a second startStream
// call closes the previous stream first (race-free via a serial queue).

import ExpoModulesCore
import Foundation
import PinnedFetch

/// Options mirroring the JS-side `StartStreamArgs`. All fields required.
@Record
struct StartStreamArgs {
  var url: String = ""
  var fingerprintBase64Url: String = ""
  var token: String = ""
}

public final class PinnedStreamModule: Module {
  /// Mutations of `activeStream` (start / stop / replace) are serialized on this
  /// queue so concurrent startStream calls replace the previous stream cleanly.
  private let controlQueue = DispatchQueue(label: "PinnedStreamModule.control")
  /// Holds the currently-active stream. Touched only on `controlQueue`.
  private var activeStream: ActiveStream?

  public func definition() -> ModuleDefinition {
    Name("PinnedStreamModule")

    // Event channels. JS subscribes via the EventEmitter proxy returned by
    // requireNativeModule; we emit onto these names.
    Events("onEvent", "onError", "onClose")

    Function("startStream") { (args: StartStreamArgs) -> Bool in
      // Validate the URL up front so a malformed input yields onError immediately
      // rather than a URLSession-level failure.
      guard let requestUrl = URL(string: args.url) else {
        self.emitError(code: "invalid_url", message: "URL could not be parsed: \(args.url)")
        return false
      }
      guard let scheme = requestUrl.scheme?.lowercased(), scheme == "https" else {
        self.emitError(code: "invalid_url", message: "startStream requires an https URL: \(args.url)")
        return false
      }

      let expectedFingerprint: Data
      do {
        expectedFingerprint = try PinnedTrustEvaluator.decodeFingerprintBase64Url(args.fingerprintBase64Url)
      } catch {
        self.emitError(code: "invalid_url", message: "fingerprint is not valid base64url: \(args.fingerprintBase64Url)")
        return false
      }

      var request = URLRequest(url: requestUrl)
      request.httpMethod = "GET"
      request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
      request.setValue("Bearer \(args.token)", forHTTPHeaderField: "Authorization")
      request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
      // Deliberately do NOT set request.timeoutInterval: for a URLSession data
      // task, URLSessionConfiguration.timeoutIntervalForRequest (set below to
      // the keepalive-driven 30s) is authoritative — a request-level interval
      // smaller than the configuration's is ignored, and setting one larger has
      // no effect on a data task. Leaving it at the default avoids the
      // ambiguous `0` (which Apple docs define as "use system default", not
      // "no timeout") and lets the configuration be the single source of truth.

      let configuration = URLSessionConfiguration.ephemeral
      // Heartbeat-driven liveness: daemon sends a keepalive every 15s, so 30s
      // without any bytes means the connection is effectively dead. Two missed
      // keepalives trigger URLSession with `.timedOut`.
      configuration.timeoutIntervalForRequest = 30
      // The stream is long-lived; do not cap total resource duration at the
      // default (~7 days). 24h is effectively "no cap" for our use case.
      configuration.timeoutIntervalForResource = 24 * 60 * 60
      // We perform custom server-trust evaluation; the delegate is authoritative.
      configuration.urlCredentialStorage = nil

      let delegate = PinnedStreamSessionDelegate(expectedFingerprint: expectedFingerprint) { [weak self] event in
        self?.sendEvent("onEvent", ["data": event])
      } onError: { [weak self] code, message in
        self?.emitError(code: code, message: message)
      } onClose: { [weak self] in
        self?.sendEvent("onClose", [:])
      }

      let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
      let task = session.dataTask(with: request)
      let stream = ActiveStream(session: session, task: task)

      // Replace any active stream: cancel the old task + invalidate the old
      // session (silently — its onClose/onError should NOT fire for an explicit
      // local stop; only for organic completion). The replacement path keeps a
      // quietClose flag so the old delegate suppresses its events.
      self.controlQueue.sync {
        let previous = self.activeStream
        previous?.quietClose()
        self.activeStream = stream
      }

      task.resume()
      return true
    }

    Function("stopStream") { () -> Bool in
      self.controlQueue.sync {
        let previous = self.activeStream
        self.activeStream = nil
        previous?.quietClose()
      }
      return true
    }
  }

  // MARK: - Helpers

  private func emitError(code: String, message: String) {
    sendEvent("onError", ["code": code, "message": message])
  }
}

/// Owns one URLSession + its data task. `quietClose()` tears it down without
/// emitting onClose/onError (used for local stop / replacement).
private final class ActiveStream {
  let session: URLSession
  let task: URLSessionDataTask

  init(session: URLSession, task: URLSessionDataTask) {
    self.session = session
    self.task = task
  }

  /// Tear down silently: detach the delegate so its didCompleteWithError will
  /// suppress events, then cancel the task and invalidate the session.
  func quietClose() {
    (session.delegate as? PinnedStreamSessionDelegate)?.suppressEvents = true
    task.cancel()
    session.invalidateAndCancel()
  }
}

/// URLSessionDataDelegate for the SSE stream.
private final class PinnedStreamSessionDelegate: NSObject, URLSessionDataDelegate {
  let expectedFingerprint: Data
  let onEvent: (String) -> Void
  let onError: (String, String) -> Void
  let onClose: () -> Void

  /// Set to true when the stream is being torn down locally (stopStream /
  /// replacement); didCompleteWithError checks this to suppress the otherwise-
  /// noisy `.cancelled` error.
  var suppressEvents = false

  /// Flipped only when this delegate rejected a server-trust challenge due to a
  /// fingerprint mismatch. Authoritative for error classification.
  private var fingerprintMismatched = false

  /// Buffer of un-framed bytes. SSE frames are terminated by a blank line
  /// ("\n\n"); bytes after the last terminator are held here until the next chunk.
  private var buffer = Data()
  /// Line buffer for joining multi-line `data:` fields within a single frame
  /// (SSE spec: multiple data lines are joined with "\n"). The daemon currently
  /// emits a single data line per frame, but we implement the spec to be robust.
  private var frameDataLines: [String] = []

  init(
    expectedFingerprint: Data,
    onEvent: @escaping (String) -> Void,
    onError: @escaping (String, String) -> Void,
    onClose: @escaping () -> Void
  ) {
    self.expectedFingerprint = expectedFingerprint
    self.onEvent = onEvent
    self.onError = onError
    self.onClose = onClose
    super.init()
  }

  // MARK: - Trust

  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    switch PinnedTrustEvaluator.evaluate(challenge: challenge, expectedFingerprint: expectedFingerprint) {
    case .trusted(let credential):
      completionHandler(.useCredential, credential)
    case .mismatch:
      fingerprintMismatched = true
      completionHandler(.cancelAuthenticationChallenge, nil)
    case .unavailable:
      completionHandler(.cancelAuthenticationChallenge, nil)
    }
  }

  // MARK: - Stream data → SSE frame parsing

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    buffer.append(data)
    // Repeatedly peel complete frames off the front of the buffer.
    while let frameEnd = frameBoundaryRange(in: buffer) {
      let frameBytes = buffer.subdata(in: 0..<frameEnd.lowerBound)
      buffer.removeSubrange(0..<frameEnd.upperBound)
      handleFrame(frameBytes)
    }
  }

  /// Find the next SSE frame terminator ("\n\n" or "\r\n\r\n") in `data`,
  /// returning the range of the terminator (so the caller can drop both the
  /// frame and the terminator). Returns nil if no complete frame is buffered.
  private func frameBoundaryRange(in data: Data) -> Range<Int>? {
    let lf: UInt8 = 0x0A
    let cr: UInt8 = 0x0D
    var i = 0
    while i < data.count - 1 {
      // Accept "\n\n" and (tolerantly) "\r\n\r\n".
      if data[i] == lf && data[i + 1] == lf {
        return i..<(i + 2)
      }
      if i + 3 < data.count,
         data[i] == cr, data[i + 1] == lf, data[i + 2] == cr, data[i + 3] == lf {
        return i..<(i + 4)
      }
      i += 1
    }
    return nil
  }

  /// Parse one SSE frame: collect `data:` lines (spec: join with "\n") and
  /// forward the joined payload via onEvent. Comment lines (": ...") and other
  /// fields (`event:`, `id:`, `retry:`) are not needed — the daemon emits
  /// `event: agents_changed` + a single `data:` line; the JS side keys off the
  /// data payload alone, so we forward data and ignore the rest.
  private func handleFrame(_ frameBytes: Data) {
    guard let text = String(data: frameBytes, encoding: .utf8) else {
      // Non-UTF-8 frame: drop silently (shouldn't happen for this protocol).
      return
    }
    var dataLines: [String] = []
    for rawLine in text.split(separator: "\n", omittingEmptySubsequences: false) {
      // Strip a trailing CR if the frame used CRLF.
      var line = String(rawLine)
      if line.hasSuffix("\r") { line.removeLast() }
      if line.hasPrefix(":") {
        // Comment line (keepalive uses this). Ignore.
        continue
      }
      if let payload = stripDataPrefix(from: line) {
        dataLines.append(payload)
      }
      // Other field names (event:/id:/retry:) are intentionally ignored.
    }
    if dataLines.isEmpty {
      return
    }
    onEvent(dataLines.joined(separator: "\n"))
  }

  /// Returns the payload of a `data:` field line (with one optional leading
  /// space removed), or nil if the line is not a data field. Matches the SSE
  /// spec: "data: <value>" or "data:<value>".
  private func stripDataPrefix(from line: String) -> String? {
    if line.hasPrefix("data:") {
      var rest = String(line.dropFirst("data:".count))
      if rest.hasPrefix(" ") { rest.removeFirst() }
      return rest
    }
    return nil
  }

  // MARK: - Completion

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    // Local teardown path: suppress all events. The caller already knows.
    if suppressEvents { return }

    guard let error = error else {
      // Clean server-side EOF: emit onClose.
      onClose()
      return
    }
    let code = Self.mapError(error, fingerprintMismatched: fingerprintMismatched)
    let message = Self.errorDescription(for: code, underlying: error)
    onError(code, message)
  }

  // MARK: - Error mapping

  // Mirrors PinnedFetchModule.mapError so the JS side sees the SAME code surface
  // for both modules (fingerprint_mismatch vs tls_handshake_failed vs timeout vs
  // network_error). The classification logic is deliberately duplicated text
  // rather than shared, because the URLError-code table is short and stable,
  // and sharing it across pods would require another abstraction layer with no
  // real safety benefit (the security-sensitive constant-time compare IS shared
  // — this is just error-code naming).
  private static func mapError(_ error: Error, fingerprintMismatched: Bool) -> String {
    if fingerprintMismatched {
      return "fingerprint_mismatch"
    }
    guard let urlError = error as? URLError else {
      return "network_error"
    }
    switch urlError.code {
    case .timedOut:
      return "timeout"
    case .secureConnectionFailed,
         .cannotConnectToHost,
         .cannotFindHost,
         .networkConnectionLost,
         .notConnectedToInternet,
         .serverCertificateUntrusted,
         .serverCertificateHasBadDate,
         .serverCertificateNotYetValid,
         .serverCertificateHasUnknownRoot,
         .clientCertificateRejected,
         .cancelled:
      return "tls_handshake_failed"
    default:
      return "network_error"
    }
  }

  private static func errorDescription(for code: String, underlying error: Error) -> String {
    switch code {
    case "fingerprint_mismatch":
      return "server certificate fingerprint does not match the pinned value"
    case "tls_handshake_failed":
      return "TLS handshake or connection failed: \(error.localizedDescription)"
    case "timeout":
      return "stream timed out (no data received within the keepalive window)"
    case "network_error":
      return "network error: \(error.localizedDescription)"
    default:
      return error.localizedDescription
    }
  }
}
