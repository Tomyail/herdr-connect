package protocol_test

import (
	"bytes"
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"github.com/Tomyail/herdr-connect/protocol"
)

type memoryReplayGuard struct {
	seen map[string]struct{}
}

type memoryPairingGuard struct{ accepted bool }

func (g *memoryPairingGuard) AcceptIfNew(string, time.Time, protocol.PairingCandidate) (bool, error) {
	if g.accepted {
		return false, nil
	}
	g.accepted = true
	return true, nil
}

func (g *memoryReplayGuard) MarkIfNew(messageID string, _ time.Time) (bool, error) {
	if _, ok := g.seen[messageID]; ok {
		return false, nil
	}
	g.seen[messageID] = struct{}{}
	return true, nil
}

func TestSealOpenRoundTrip(t *testing.T) {
	sender, err := protocol.GenerateIdentity()
	if err != nil {
		t.Fatalf("generate sender identity: %v", err)
	}
	recipient, err := protocol.GenerateIdentity()
	if err != nil {
		t.Fatalf("generate recipient identity: %v", err)
	}

	createdAt := time.Date(2026, time.July, 15, 3, 0, 0, 0, time.UTC)
	header := protocol.Header{
		MessageType:              protocol.MessageTypeLifecycleEvent,
		InstallationID:           "ins_01jz7example",
		SenderID:                 "installation_primary",
		SenderSigningKeyID:       "sign_installation_1",
		RecipientID:              "device_iphone",
		RecipientEncryptionKeyID: "enc_device_1",
		MessageID:                "msg_01jz7example",
		EventID:                  "evt_01jz7example",
		EventSeq:                 42,
		CreatedAt:                createdAt,
		ExpiresAt:                createdAt.Add(24 * time.Hour),
	}
	payload := []byte(`{"agent_id":"agent_1","interaction_state":"blocked"}`)

	envelope, err := protocol.Seal(protocol.SealRequest{
		Header:                       header,
		Plaintext:                    payload,
		RecipientEncryptionPublicKey: recipient.EncryptionPublicKey,
		SenderSigningPrivateKey:      sender.SigningPrivateKey,
	})
	if err != nil {
		t.Fatalf("seal: %v", err)
	}

	opened, err := protocol.Open(protocol.OpenRequest{
		Envelope:                      envelope,
		RecipientEncryptionPrivateKey: recipient.EncryptionPrivateKey,
		SenderSigningPublicKey:        sender.SigningPublicKey,
		ExpectedInstallationID:        header.InstallationID,
		ExpectedSenderID:              header.SenderID,
		ExpectedRecipientID:           header.RecipientID,
		Now:                           createdAt.Add(time.Minute),
		ReplayGuard:                   &memoryReplayGuard{seen: map[string]struct{}{}},
	})
	if err != nil {
		t.Fatalf("open: %v", err)
	}

	if !bytes.Equal(opened.Plaintext, payload) {
		t.Fatalf("plaintext mismatch: got %q want %q", opened.Plaintext, payload)
	}
	if opened.Header.EventID != header.EventID || opened.Header.EventSeq != header.EventSeq {
		t.Fatalf("logical event identity changed: got %s/%d", opened.Header.EventID, opened.Header.EventSeq)
	}
}

func TestOpenRejectsReplayWithStableCode(t *testing.T) {
	sender, err := protocol.GenerateIdentity()
	if err != nil {
		t.Fatalf("generate sender identity: %v", err)
	}
	recipient, err := protocol.GenerateIdentity()
	if err != nil {
		t.Fatalf("generate recipient identity: %v", err)
	}

	createdAt := time.Date(2026, time.July, 15, 3, 0, 0, 0, time.UTC)
	header := protocol.Header{
		MessageType:              protocol.MessageTypeLifecycleEvent,
		InstallationID:           "ins_replay",
		SenderID:                 "installation_primary",
		SenderSigningKeyID:       "sign_installation_1",
		RecipientID:              "device_iphone",
		RecipientEncryptionKeyID: "enc_device_1",
		MessageID:                "msg_replay",
		EventID:                  "evt_replay",
		EventSeq:                 1,
		CreatedAt:                createdAt,
		ExpiresAt:                createdAt.Add(time.Hour),
	}
	envelope, err := protocol.Seal(protocol.SealRequest{
		Header:                       header,
		Plaintext:                    []byte("event"),
		RecipientEncryptionPublicKey: recipient.EncryptionPublicKey,
		SenderSigningPrivateKey:      sender.SigningPrivateKey,
	})
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	guard := &memoryReplayGuard{seen: map[string]struct{}{}}
	request := protocol.OpenRequest{
		Envelope:                      envelope,
		RecipientEncryptionPrivateKey: recipient.EncryptionPrivateKey,
		SenderSigningPublicKey:        sender.SigningPublicKey,
		ExpectedInstallationID:        header.InstallationID,
		ExpectedSenderID:              header.SenderID,
		ExpectedRecipientID:           header.RecipientID,
		Now:                           createdAt.Add(time.Minute),
		ReplayGuard:                   guard,
	}
	if _, err := protocol.Open(request); err != nil {
		t.Fatalf("first open: %v", err)
	}

	_, err = protocol.Open(request)
	if got := protocol.ErrorCodeOf(err); got != protocol.ErrorCodeReplay {
		t.Fatalf("error code: got %q want %q (error: %v)", got, protocol.ErrorCodeReplay, err)
	}
}

func TestSealRejectsRemoteCommandLongerThanThirtySeconds(t *testing.T) {
	createdAt := time.Date(2026, time.July, 15, 3, 0, 0, 0, time.UTC)
	_, err := protocol.Seal(protocol.SealRequest{
		Header: protocol.Header{
			MessageType:              protocol.MessageTypeRemoteCommand,
			InstallationID:           "ins_command",
			SenderID:                 "device_iphone",
			SenderSigningKeyID:       "sign_device_1",
			RecipientID:              "installation_primary",
			RecipientEncryptionKeyID: "enc_installation_1",
			MessageID:                "msg_command",
			CommandID:                "cmd_01jz7example",
			CreatedAt:                createdAt,
			ExpiresAt:                createdAt.Add(31 * time.Second),
		},
	})
	if got := protocol.ErrorCodeOf(err); got != protocol.ErrorCodeTTLExceeded {
		t.Fatalf("error code: got %q want %q (error: %v)", got, protocol.ErrorCodeTTLExceeded, err)
	}
}

func TestOpenRejectsTamperedCiphertextWithoutAnOracle(t *testing.T) {
	sender, err := protocol.GenerateIdentity()
	if err != nil {
		t.Fatalf("generate sender identity: %v", err)
	}
	recipient, err := protocol.GenerateIdentity()
	if err != nil {
		t.Fatalf("generate recipient identity: %v", err)
	}
	createdAt := time.Date(2026, time.July, 15, 3, 0, 0, 0, time.UTC)
	header := protocol.Header{
		MessageType:              protocol.MessageTypeLifecycleEvent,
		InstallationID:           "ins_tamper",
		SenderID:                 "installation_primary",
		SenderSigningKeyID:       "sign_installation_1",
		RecipientID:              "device_iphone",
		RecipientEncryptionKeyID: "enc_device_1",
		MessageID:                "msg_tamper",
		EventID:                  "evt_tamper",
		EventSeq:                 2,
		CreatedAt:                createdAt,
		ExpiresAt:                createdAt.Add(time.Hour),
	}
	envelope, err := protocol.Seal(protocol.SealRequest{
		Header:                       header,
		Plaintext:                    []byte("event"),
		RecipientEncryptionPublicKey: recipient.EncryptionPublicKey,
		SenderSigningPrivateKey:      sender.SigningPrivateKey,
	})
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	if envelope.Ciphertext[0] == 'A' {
		envelope.Ciphertext = "B" + envelope.Ciphertext[1:]
	} else {
		envelope.Ciphertext = "A" + envelope.Ciphertext[1:]
	}

	_, err = protocol.Open(protocol.OpenRequest{
		Envelope:                      envelope,
		RecipientEncryptionPrivateKey: recipient.EncryptionPrivateKey,
		SenderSigningPublicKey:        sender.SigningPublicKey,
		ExpectedInstallationID:        header.InstallationID,
		ExpectedSenderID:              header.SenderID,
		ExpectedRecipientID:           header.RecipientID,
		Now:                           createdAt.Add(time.Minute),
		ReplayGuard:                   &memoryReplayGuard{seen: map[string]struct{}{}},
	})
	if got := protocol.ErrorCodeOf(err); got != protocol.ErrorCodeAuthenticationFailed {
		t.Fatalf("error code: got %q want %q (error: %v)", got, protocol.ErrorCodeAuthenticationFailed, err)
	}
}

func TestOpenRejectsUnsupportedVersionBeforeCrypto(t *testing.T) {
	sender, err := protocol.GenerateIdentity()
	if err != nil {
		t.Fatalf("generate sender identity: %v", err)
	}
	recipient, err := protocol.GenerateIdentity()
	if err != nil {
		t.Fatalf("generate recipient identity: %v", err)
	}
	createdAt := time.Date(2026, time.July, 15, 3, 0, 0, 0, time.UTC)
	header := protocol.Header{
		MessageType:              protocol.MessageTypeLifecycleEvent,
		InstallationID:           "ins_version",
		SenderID:                 "installation_primary",
		SenderSigningKeyID:       "sign_installation_1",
		RecipientID:              "device_iphone",
		RecipientEncryptionKeyID: "enc_device_1",
		MessageID:                "msg_version",
		EventID:                  "evt_version",
		EventSeq:                 3,
		CreatedAt:                createdAt,
		ExpiresAt:                createdAt.Add(time.Hour),
	}
	envelope, err := protocol.Seal(protocol.SealRequest{
		Header:                       header,
		Plaintext:                    []byte("event"),
		RecipientEncryptionPublicKey: recipient.EncryptionPublicKey,
		SenderSigningPrivateKey:      sender.SigningPrivateKey,
	})
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	protectedBytes, err := base64.RawURLEncoding.Strict().DecodeString(envelope.Protected)
	if err != nil {
		t.Fatalf("decode protected header: %v", err)
	}
	protectedBytes = []byte(strings.Replace(string(protectedBytes), `"v":1`, `"v":2`, 1))
	envelope.Protected = base64.RawURLEncoding.EncodeToString(protectedBytes)

	_, err = protocol.Open(protocol.OpenRequest{
		Envelope:                      envelope,
		RecipientEncryptionPrivateKey: recipient.EncryptionPrivateKey,
		SenderSigningPublicKey:        sender.SigningPublicKey,
		ExpectedInstallationID:        header.InstallationID,
		ExpectedSenderID:              header.SenderID,
		ExpectedRecipientID:           header.RecipientID,
		Now:                           createdAt.Add(time.Minute),
		ReplayGuard:                   &memoryReplayGuard{seen: map[string]struct{}{}},
	})
	if got := protocol.ErrorCodeOf(err); got != protocol.ErrorCodeUnsupportedVersion {
		t.Fatalf("error code: got %q want %q (error: %v)", got, protocol.ErrorCodeUnsupportedVersion, err)
	}
}

func TestOpenRejectsMessageAtItsExactExpiry(t *testing.T) {
	sender, err := protocol.GenerateIdentity()
	if err != nil {
		t.Fatalf("generate sender identity: %v", err)
	}
	recipient, err := protocol.GenerateIdentity()
	if err != nil {
		t.Fatalf("generate recipient identity: %v", err)
	}
	createdAt := time.Date(2026, time.July, 15, 3, 0, 0, 0, time.UTC)
	header := protocol.Header{
		MessageType:              protocol.MessageTypeLifecycleEvent,
		InstallationID:           "ins_expiry",
		SenderID:                 "installation_primary",
		SenderSigningKeyID:       "sign_installation_1",
		RecipientID:              "device_iphone",
		RecipientEncryptionKeyID: "enc_device_1",
		MessageID:                "msg_expiry",
		EventID:                  "evt_expiry",
		EventSeq:                 4,
		CreatedAt:                createdAt,
		ExpiresAt:                createdAt.Add(time.Hour),
	}
	envelope, err := protocol.Seal(protocol.SealRequest{
		Header:                       header,
		Plaintext:                    []byte("event"),
		RecipientEncryptionPublicKey: recipient.EncryptionPublicKey,
		SenderSigningPrivateKey:      sender.SigningPrivateKey,
	})
	if err != nil {
		t.Fatalf("seal: %v", err)
	}

	_, err = protocol.Open(protocol.OpenRequest{
		Envelope:                      envelope,
		RecipientEncryptionPrivateKey: recipient.EncryptionPrivateKey,
		SenderSigningPublicKey:        sender.SigningPublicKey,
		ExpectedInstallationID:        header.InstallationID,
		ExpectedSenderID:              header.SenderID,
		ExpectedRecipientID:           header.RecipientID,
		Now:                           header.ExpiresAt,
		ReplayGuard:                   &memoryReplayGuard{seen: map[string]struct{}{}},
	})
	if got := protocol.ErrorCodeOf(err); got != protocol.ErrorCodeExpired {
		t.Fatalf("error code: got %q want %q (error: %v)", got, protocol.ErrorCodeExpired, err)
	}
}

func TestSealRejectsUnknownMessageTypeWithStableCode(t *testing.T) {
	createdAt := time.Date(2026, time.July, 15, 3, 0, 0, 0, time.UTC)
	_, err := protocol.Seal(protocol.SealRequest{Header: protocol.Header{
		MessageType: "future_message",
		CreatedAt:   createdAt,
		ExpiresAt:   createdAt.Add(time.Minute),
	}})
	if got := protocol.ErrorCodeOf(err); got != protocol.ErrorCodeUnsupportedMessageType {
		t.Fatalf("error code: got %q want %q (error: %v)", got, protocol.ErrorCodeUnsupportedMessageType, err)
	}
}

func TestSealRejectsPlaintextLargerThanProtocolLimit(t *testing.T) {
	createdAt := time.Date(2026, time.July, 15, 3, 0, 0, 0, time.UTC)
	_, err := protocol.Seal(protocol.SealRequest{
		Header: protocol.Header{
			MessageType:              protocol.MessageTypeLifecycleEvent,
			InstallationID:           "ins_size",
			SenderID:                 "installation_primary",
			SenderSigningKeyID:       "sign_installation_1",
			RecipientID:              "device_iphone",
			RecipientEncryptionKeyID: "enc_device_1",
			MessageID:                "msg_size",
			EventID:                  "evt_size",
			EventSeq:                 5,
			CreatedAt:                createdAt,
			ExpiresAt:                createdAt.Add(time.Hour),
		},
		Plaintext: make([]byte, protocol.MaxPlaintextSize+1),
	})
	if got := protocol.ErrorCodeOf(err); got != protocol.ErrorCodeMessageTooLarge {
		t.Fatalf("error code: got %q want %q (error: %v)", got, protocol.ErrorCodeMessageTooLarge, err)
	}
}

func TestOpenPairingRequestBootstrapsDeviceSigningKey(t *testing.T) {
	device, err := protocol.GenerateIdentity()
	if err != nil {
		t.Fatalf("generate device identity: %v", err)
	}
	installation, err := protocol.GenerateIdentity()
	if err != nil {
		t.Fatalf("generate installation identity: %v", err)
	}
	createdAt := time.Date(2026, time.July, 15, 3, 0, 0, 0, time.UTC)
	header := protocol.Header{
		MessageType:              protocol.MessageTypePairingRequest,
		InstallationID:           "ins_pairing",
		SenderID:                 "device_candidate",
		SenderSigningKeyID:       "sign_device_candidate",
		RecipientID:              "installation_primary",
		RecipientEncryptionKeyID: "enc_installation_1",
		MessageID:                "msg_pairing",
		CreatedAt:                createdAt,
		ExpiresAt:                createdAt.Add(5 * time.Minute),
	}
	envelope, err := protocol.Seal(protocol.SealRequest{
		Header:                       header,
		Plaintext:                    []byte(`{"pairing_id":"pair_1","pairing_secret":"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE","device_name":"Alice 的 iPhone","device_signing_public_key":"` + base64.RawURLEncoding.EncodeToString(device.SigningPublicKey) + `","device_encryption_public_key":"` + base64.RawURLEncoding.EncodeToString(device.EncryptionPublicKey) + `","challenge":"AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI"}`),
		RecipientEncryptionPublicKey: installation.EncryptionPublicKey,
		SenderSigningPrivateKey:      device.SigningPrivateKey,
	})
	if err != nil {
		t.Fatalf("seal pairing request: %v", err)
	}

	pairingGuard := &memoryPairingGuard{}
	baseRequest := protocol.OpenRequest{
		Envelope:                      envelope,
		RecipientEncryptionPrivateKey: installation.EncryptionPrivateKey,
		ExpectedInstallationID:        header.InstallationID,
		ExpectedSenderID:              header.SenderID,
		ExpectedRecipientID:           header.RecipientID,
		Now:                           createdAt.Add(time.Minute),
		ExpectedPairingID:             "pair_1",
		ExpectedPairingSecret:         bytes.Repeat([]byte{9}, 32),
		PairingGuard:                  pairingGuard,
	}
	if _, err := protocol.Open(baseRequest); protocol.ErrorCodeOf(err) != protocol.ErrorCodeAuthenticationFailed || pairingGuard.accepted {
		t.Fatalf("invalid secret must fail before atomic guard: %v", err)
	}
	baseRequest.ExpectedPairingSecret = bytes.Repeat([]byte{1}, 32)
	opened, err := protocol.Open(baseRequest)
	if err != nil {
		t.Fatalf("open pairing request without a pretrusted device key: %v", err)
	}
	if !bytes.Equal(opened.Header.SenderSigningPublicKey, device.SigningPublicKey) {
		t.Fatalf("bootstrapped signing key mismatch")
	}
}

func TestOpenRejectsShortSignatureWithAuthenticationError(t *testing.T) {
	sender, err := protocol.GenerateIdentity()
	if err != nil {
		t.Fatalf("generate sender identity: %v", err)
	}
	recipient, err := protocol.GenerateIdentity()
	if err != nil {
		t.Fatalf("generate recipient identity: %v", err)
	}
	createdAt := time.Date(2026, time.July, 15, 3, 0, 0, 0, time.UTC)
	header := protocol.Header{
		MessageType: protocol.MessageTypeLifecycleEvent, InstallationID: "ins_short_signature",
		SenderID: "installation_primary", SenderSigningKeyID: "sign_installation_1",
		RecipientID: "device_iphone", RecipientEncryptionKeyID: "enc_device_1",
		MessageID: "msg_short_signature", EventID: "evt_short_signature", EventSeq: 1,
		CreatedAt: createdAt, ExpiresAt: createdAt.Add(time.Hour),
	}
	envelope, err := protocol.Seal(protocol.SealRequest{Header: header, Plaintext: []byte("event"), RecipientEncryptionPublicKey: recipient.EncryptionPublicKey, SenderSigningPrivateKey: sender.SigningPrivateKey})
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	envelope.Signature = base64.RawURLEncoding.EncodeToString([]byte{1})
	_, err = protocol.Open(protocol.OpenRequest{Envelope: envelope, RecipientEncryptionPrivateKey: recipient.EncryptionPrivateKey, SenderSigningPublicKey: sender.SigningPublicKey, ExpectedInstallationID: header.InstallationID, ExpectedSenderID: header.SenderID, ExpectedRecipientID: header.RecipientID, Now: createdAt.Add(time.Minute), ReplayGuard: &memoryReplayGuard{seen: map[string]struct{}{}}})
	if got := protocol.ErrorCodeOf(err); got != protocol.ErrorCodeAuthenticationFailed {
		t.Fatalf("error code: got %q want %q (error: %v)", got, protocol.ErrorCodeAuthenticationFailed, err)
	}
}

func TestSealRejectsInvalidMessageSpecificIdentifier(t *testing.T) {
	createdAt := time.Date(2026, time.July, 15, 3, 0, 0, 0, time.UTC)
	_, err := protocol.Seal(protocol.SealRequest{Header: protocol.Header{
		MessageType: protocol.MessageTypeLifecycleEvent, InstallationID: "ins_ids",
		SenderID: "installation_primary", SenderSigningKeyID: "sign_installation_1",
		RecipientID: "device_iphone", RecipientEncryptionKeyID: "enc_device_1",
		MessageID: "msg_ids", EventID: "invalid event id", EventSeq: 1,
		CreatedAt: createdAt, ExpiresAt: createdAt.Add(time.Hour),
	}})
	if got := protocol.ErrorCodeOf(err); got != protocol.ErrorCodeInvalidHeader {
		t.Fatalf("error code: got %q want %q (error: %v)", got, protocol.ErrorCodeInvalidHeader, err)
	}
}

func TestSealRejectsUnexpectedMessageSpecificField(t *testing.T) {
	createdAt := time.Date(2026, time.July, 15, 3, 0, 0, 0, time.UTC)
	_, err := protocol.Seal(protocol.SealRequest{Header: protocol.Header{
		MessageType: protocol.MessageTypeLifecycleEvent, InstallationID: "ins_fields",
		SenderID: "installation_primary", SenderSigningKeyID: "sign_installation_1",
		RecipientID: "device_iphone", RecipientEncryptionKeyID: "enc_device_1",
		MessageID: "msg_fields", EventID: "evt_fields", EventSeq: 1,
		RequestID: "request_not_allowed", CreatedAt: createdAt, ExpiresAt: createdAt.Add(time.Hour),
	}})
	if got := protocol.ErrorCodeOf(err); got != protocol.ErrorCodeInvalidHeader {
		t.Fatalf("error code: got %q want %q (error: %v)", got, protocol.ErrorCodeInvalidHeader, err)
	}
}

func TestPairingCandidateAndChallengeValidation(t *testing.T) {
	device, _ := protocol.GenerateIdentity()
	installation, _ := protocol.GenerateIdentity()
	secret := bytes.Repeat([]byte{1}, 32)
	challenge := bytes.Repeat([]byte{2}, 32)
	payload := []byte(`{"pairing_id":"pair_1","pairing_secret":"` + base64.RawURLEncoding.EncodeToString(secret) + `","device_name":"Alice 的 iPhone","device_signing_public_key":"` + base64.RawURLEncoding.EncodeToString(device.SigningPublicKey) + `","device_encryption_public_key":"` + base64.RawURLEncoding.EncodeToString(device.EncryptionPublicKey) + `","challenge":"` + base64.RawURLEncoding.EncodeToString(challenge) + `"}`)
	candidate, err := protocol.ValidatePairingCandidate(payload, device.SigningPublicKey, "pair_1", secret)
	if err != nil {
		t.Fatalf("validate pairing candidate: %v", err)
	}
	binding := protocol.PairingChallengeBinding{PairingID: candidate.PairingID, PairingSecret: secret, Challenge: candidate.Challenge, DeviceSigningPublicKey: candidate.DeviceSigningPublicKey, DeviceEncryptionPublicKey: candidate.DeviceEncryptionPublicKey, InstallationSigningPublicKey: installation.SigningPublicKey, InstallationEncryptionPublicKey: installation.EncryptionPublicKey, Decision: "accepted"}
	signature, err := protocol.SignPairingChallenge(binding, installation.SigningPrivateKey)
	if err != nil {
		t.Fatalf("sign pairing challenge: %v", err)
	}
	if err := protocol.VerifyPairingChallenge(binding, installation.SigningPublicKey, signature); err != nil {
		t.Fatalf("verify pairing challenge: %v", err)
	}
	badPayload := bytes.Replace(payload, []byte(base64.RawURLEncoding.EncodeToString(challenge)), []byte(base64.RawURLEncoding.EncodeToString([]byte{1})), 1)
	if _, err := protocol.ValidatePairingCandidate(badPayload, device.SigningPublicKey, "pair_1", secret); protocol.ErrorCodeOf(err) != protocol.ErrorCodeInvalidEnvelope {
		t.Fatalf("short challenge error: %v", err)
	}
}
