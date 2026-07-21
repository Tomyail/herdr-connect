// PinnedFetchModule.swift
//
// iOS-only Expo module that performs HTTPS requests pinned to a self-signed
// certificate fingerprint. See docs/security/lan-tls-pairing.md for the trust
// model: the LAN daemon presents a self-signed ECDSA P-256 certificate; devices
// pin the SHA-256 of its leaf DER and do NOT perform standard CA-chain or
// hostname validation.
//
// Key design decision — distinguishing `fingerprint_mismatch` from
// `tls_handshake_failed` (see urlSession(_:didReceive:completionHandler:) and
// mapError(_:fingerprintMismatched:)):
//
//   1. When the server-trust challenge fires, we compute the leaf certificate's
//      SHA-256 and constant-time compare it to the caller-supplied fingerprint.
//      On mismatch we call completionHandler(.cancelAuthenticationChallenge, nil)
//      AND flip a per-call `fingerprintMismatched` flag stored on the delegate.
//   2. Cancelling the challenge makes URLSession terminate the request; the
//      data-task completion handler then receives URLError(.cancelled).
//   3. In the error path we check `fingerprintMismatched` FIRST: if it is set,
//      the failure is unambiguously `fingerprint_mismatch` regardless of the
//      URLError code (`.cancelled` could in principle have other causes, so the
//      delegate flag is authoritative).
//   4. Only if `fingerprintMismatched` is false do we classify by URLError code:
//      `.timedOut` → `timeout`; the rest of the TLS/connection family
//      (`.secureConnectionFailed`, `.cannotConnectToHost`, `.cannotFindHost`,
//      `.serverCertificateUntrusted`, `.cancelled`, etc.) → `tls_handshake_failed`;
//      anything else → `network_error`.
//
// This keeps the two failure modes disjoint and resilient to URLSession reusing
// `.cancelled` for unrelated reasons.

import CryptoKit
import ExpoModulesCore
import Foundation

/// Options record mirroring `PinnedFetchOptions` in TypeScript. All fields are
/// optional; Expo treats a property with a default value as optional on the JS side.
@Record
struct PinnedFetchOptions {
  var method: String? = nil
  var headers: [String: String]? = nil
  var body: String? = nil
  var timeoutMs: Int? = nil
}

public final class PinnedFetchModule: Module {
  /// Default per-request timeout when the caller does not supply `timeoutMs`.
  /// Mirrors the value documented in the TypeScript types.
  private static let defaultTimeoutMs: Int = 10_000

  public func definition() -> ModuleDefinition {
    Name("PinnedFetchModule")

    AsyncFunction("pinnedFetch") { (url: String, fingerprintBase64Url: String, options: PinnedFetchOptions, promise: Promise) in
      // Validate the URL up front so a malformed input yields `invalid_url`
      // rather than a URLSession-level failure.
      guard let requestUrl = URL(string: url) else {
        promise.reject("invalid_url", "URL could not be parsed: \(url)")
        return
      }
      guard let scheme = requestUrl.scheme?.lowercased(), scheme == "https" else {
        promise.reject("invalid_url", "pinnedFetch requires an https URL: \(url)")
        return
      }

      // Decode the expected fingerprint once; a malformed value is a caller bug
      // and surfaces as `invalid_url` (it is part of addressing/trust, not transport).
      let expectedFingerprint: Data
      do {
        expectedFingerprint = try PinnedTrustEvaluator.decodeFingerprintBase64Url(fingerprintBase64Url)
      } catch {
        promise.reject("invalid_url", "fingerprint is not valid base64url: \(fingerprintBase64Url)")
        return
      }

      var request = URLRequest(url: requestUrl)
      request.httpMethod = options.method?.uppercased() ?? "GET"
      if let body = options.body {
        request.httpBody = Data(body.utf8)
      }
      if let headers = options.headers {
        for (key, value) in headers {
          request.setValue(value, forHTTPHeaderField: key)
        }
      }

      let timeoutMs = options.timeoutMs ?? Self.defaultTimeoutMs
      request.timeoutInterval = TimeInterval(timeoutMs) / 1000.0

      let delegate = PinnedFetchSessionDelegate(expectedFingerprint: expectedFingerprint)
      let configuration = URLSessionConfiguration.ephemeral
      configuration.timeoutIntervalForRequest = request.timeoutInterval
      configuration.timeoutIntervalForResource = request.timeoutInterval + 5
      // We perform custom server-trust evaluation; the delegate is the source of truth.
      let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)

      let task = session.dataTask(with: request) { data, response, error in
        // Release the session promptly once the task completes.
        session.invalidateAndCancel()

        if let error = error {
          let code = Self.mapError(error, fingerprintMismatched: delegate.fingerprintMismatched)
          promise.reject(code, Self.errorDescription(for: code, underlying: error))
          return
        }

        guard let httpResponse = response as? HTTPURLResponse else {
          promise.reject("network_error", "server returned a non-HTTP response")
          return
        }

        var headerMap: [String: String] = [:]
        for (key, value) in httpResponse.allHeaderFields {
          if let key = key as? String, let value = value as? String {
            headerMap[key] = value
          }
        }

        let bodyString: String
        if let data = data, !data.isEmpty {
          bodyString = String(data: data, encoding: .utf8) ?? Self.base64Body(data)
        } else {
          bodyString = ""
        }

        promise.resolve([
          "status": httpResponse.statusCode,
          "headers": headerMap,
          "body": bodyString,
        ])
      }
      task.resume()
    }
  }

  // MARK: - Error mapping

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
    // TLS / connection-layer failures that are NOT a fingerprint decision.
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
      return "request timed out"
    case "network_error":
      return "network error: \(error.localizedDescription)"
    default:
      return error.localizedDescription
    }
  }

  // MARK: - Fingerprint helpers

  // The trust-evaluation helpers (decode / leafFingerprint / constantTimeEqual
  // / evaluate) live in PinnedTrustEvaluator.swift, shared with pinned-stream.
  // `import` not needed: this file is part of the same `PinnedFetch` Swift module.

  private static func base64Body(_ data: Data) -> String {
    // Non-UTF-8 bodies are returned base64-encoded so the JS caller can decide
    // how to decode. This path is not expected for the LAN API (JSON only).
    "data:application/octet-stream;base64," + data.base64EncodedString()
  }
}

/// Per-request URLSession delegate holding the fingerprint to pin. One delegate
/// instance per call keeps concurrent calls with different fingerprints isolated.
private final class PinnedFetchSessionDelegate: NSObject, URLSessionDelegate {
  let expectedFingerprint: Data
  /// Flipped to true only when THIS delegate rejected a server-trust challenge
  /// due to a fingerprint mismatch. Read by the module after the task completes.
  var fingerprintMismatched = false

  init(expectedFingerprint: Data) {
    self.expectedFingerprint = expectedFingerprint
    super.init()
  }

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
      fingerprintMismatched = false
      completionHandler(.cancelAuthenticationChallenge, nil)
    }
  }
}
