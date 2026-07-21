// PinnedTrustEvaluator.swift
//
// Shared fingerprint-pinning trust evaluation for iOS Expo modules.
//
// #21 阶段6 first shipped this logic inside PinnedFetchModule.swift for the
// one-shot `pinnedFetch` call. #25 阶段2 adds a second module (pinned-stream)
// that needs the EXACT same trust decision for a long-lived URLSession stream.
// Rather than duplicate the security-sensitive constant-time comparison, the
// helpers now live here as a single source of truth; both modules depend on the
// `PinnedFetch` pod (which exports this enum via `public` access).
//
// Trust model (see docs/security/lan-tls-pairing.md): the LAN daemon presents a
// self-signed ECDSA P-256 certificate; clients pin the SHA-256 of its leaf DER
// and do NOT perform standard CA-chain or hostname validation. The fingerprint
// IS the trust decision.

import CryptoKit
import Foundation

/// Stateless trust evaluator for pinned-fingerprint TLS validation.
///
/// All methods are `static`/`public` so other Expo module pods can call them
/// without instantiation.
public enum PinnedTrustEvaluator {
  /// Outcome of evaluating a server-trust challenge against an expected
  /// fingerprint. Carries enough information for the caller to both pick the
  /// `URLSession.AuthChallengeDisposition` and flag a fingerprint mismatch for
  /// downstream error classification (distinguishing `fingerprint_mismatch`
  /// from `tls_handshake_failed`).
  public enum Evaluation {
    /// Leaf fingerprint matched; the caller should `.useCredential` with the
    /// server trust.
    case trusted(URLCredential)
    /// Leaf fingerprint did NOT match the expected value; the caller should
    /// `.cancelAuthenticationChallenge` and remember that the failure was a
    /// pinning decision (authoritative for error classification).
    case mismatch
    /// No leaf certificate / no server trust available to evaluate; the caller
    /// should `.cancelAuthenticationChallenge` and let URLSession surface the
    /// transport-level error.
    case unavailable
  }

  /// base64url-decode (no padding) the expected fingerprint. `Base64` on this
  /// platform accepts URL-alphabet only when configured explicitly.
  public static func decodeFingerprintBase64Url(_ value: String) throws -> Data {
    // Convert URL-safe alphabet to standard, then pad to a multiple of 4.
    var standard = value
      .replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    while standard.count % 4 != 0 {
      standard.append("=")
    }
    guard let data = Data(base64Encoded: standard) else {
      throw NSError(
        domain: "PinnedFetch", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "invalid base64url fingerprint"]
      )
    }
    return data
  }

  /// SHA-256 of the leaf certificate DER, matching the daemon's fingerprint
  /// computation (crypto/sha256 of x509 leaf DER).
  public static func leafFingerprint(of trust: SecTrust) -> Data? {
    guard let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
          let leaf = chain.first else {
      return nil
    }
    let der = SecCertificateCopyData(leaf) as Data
    return Data(SHA256.hash(data: der))
  }

  /// Constant-time comparison so a mismatching fingerprint never leaks how many
  /// leading bytes matched.
  public static func constantTimeEqual(_ left: Data, _ right: Data) -> Bool {
    guard left.count == right.count else {
      return false
    }
    var diff: UInt8 = 0
    for index in 0..<left.count {
      diff |= left[index] ^ right[index]
    }
    return diff == 0
  }

  /// Evaluate a server-trust challenge against the expected fingerprint.
  ///
  /// Performs NO standard CA-chain evaluation; the fingerprint is the entire
  /// trust decision. The caller maps the returned `Evaluation` to both the
  /// `URLSession.AuthChallengeDisposition` and (for the mismatch case) its own
  /// error classification.
  public static func evaluate(
    challenge: URLAuthenticationChallenge,
    expectedFingerprint: Data
  ) -> Evaluation {
    guard let serverTrust = challenge.protectionSpace.serverTrust,
          let observed = leafFingerprint(of: serverTrust) else {
      return .unavailable
    }
    if constantTimeEqual(observed, expectedFingerprint) {
      return .trusted(URLCredential(trust: serverTrust))
    }
    return .mismatch
  }
}
