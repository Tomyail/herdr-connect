// Command protocol-conformance exposes the public protocol package as a
// JSON-in/JSON-out process for cross-language conformance tests.
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/Tomyail/herdr-connect/protocol"
)

type request struct {
	Operation                     string                    `json:"operation"`
	Header                        conformanceHeader         `json:"header"`
	Plaintext                     string                    `json:"plaintext"`
	Envelope                      protocol.Envelope         `json:"envelope"`
	RecipientEncryptionPublicKey  string                    `json:"recipient_encryption_public_key"`
	RecipientEncryptionPrivateKey string                    `json:"recipient_encryption_private_key"`
	SenderSigningPrivateKey       string                    `json:"sender_signing_private_key"`
	SenderSigningPublicKey        string                    `json:"sender_signing_public_key"`
	ExpectedInstallationID        string                    `json:"expected_installation_id"`
	ExpectedSenderID              string                    `json:"expected_sender_id"`
	ExpectedRecipientID           string                    `json:"expected_recipient_id"`
	ExpectedPairingID             string                    `json:"expected_pairing_id"`
	ExpectedPairingSecret         string                    `json:"expected_pairing_secret"`
	NowMS                         int64                     `json:"now_ms"`
	EphemeralKeyMaterial          string                    `json:"ephemeral_key_material"`
	PairingBinding                conformancePairingBinding `json:"pairing_binding"`
	InstallationSigningPrivateKey string                    `json:"installation_signing_private_key"`
	InstallationSigningPublicKey  string                    `json:"installation_signing_public_key"`
	PairingChallengeSignature     string                    `json:"pairing_challenge_signature"`
}

type conformancePairingBinding struct {
	PairingID                       string `json:"pairing_id"`
	PairingSecret                   string `json:"pairing_secret"`
	Challenge                       string `json:"challenge"`
	DeviceSigningPublicKey          string `json:"device_signing_public_key"`
	DeviceEncryptionPublicKey       string `json:"device_encryption_public_key"`
	InstallationSigningPublicKey    string `json:"installation_signing_public_key"`
	InstallationEncryptionPublicKey string `json:"installation_encryption_public_key"`
	Decision                        string `json:"decision"`
}

func (b conformancePairingBinding) protocolBinding() protocol.PairingChallengeBinding {
	return protocol.PairingChallengeBinding{PairingID: b.PairingID, PairingSecret: decode("pairing secret", b.PairingSecret), Challenge: decode("pairing challenge", b.Challenge), DeviceSigningPublicKey: decode("device signing public key", b.DeviceSigningPublicKey), DeviceEncryptionPublicKey: decode("device encryption public key", b.DeviceEncryptionPublicKey), InstallationSigningPublicKey: decode("installation signing public key", b.InstallationSigningPublicKey), InstallationEncryptionPublicKey: decode("installation encryption public key", b.InstallationEncryptionPublicKey), Decision: b.Decision}
}

type conformanceHeader struct {
	MessageType              protocol.MessageType `json:"message_type"`
	InstallationID           string               `json:"installation_id"`
	SenderID                 string               `json:"sender_id"`
	SenderSigningKeyID       string               `json:"sender_signing_key_id"`
	RecipientID              string               `json:"recipient_id"`
	RecipientEncryptionKeyID string               `json:"recipient_encryption_key_id"`
	MessageID                string               `json:"message_id"`
	EventID                  string               `json:"event_id"`
	EventSeq                 uint64               `json:"event_seq"`
	ThroughEventSeq          uint64               `json:"through_event_seq"`
	CommandID                string               `json:"command_id"`
	RequestID                string               `json:"request_id"`
	AckSeq                   uint64               `json:"ack_seq"`
	CreatedAtMS              int64                `json:"created_at_ms"`
	ExpiresAtMS              int64                `json:"expires_at_ms"`
}

type conformanceIdentity struct {
	EncryptionPublicKey  string `json:"encryption_public_key"`
	EncryptionPrivateKey string `json:"encryption_private_key"`
	SigningPublicKey     string `json:"signing_public_key"`
	SigningPrivateKey    string `json:"signing_private_key"`
}

type allowReplayGuard struct{}

func (allowReplayGuard) MarkIfNew(string, time.Time) (bool, error) {
	return true, nil
}

type memoryReplayGuard struct{ seen bool }

func (g *memoryReplayGuard) MarkIfNew(string, time.Time) (bool, error) {
	if g.seen {
		return false, nil
	}
	g.seen = true
	return true, nil
}

type memoryPairingGuard struct{ accepted bool }

func (g *memoryPairingGuard) AcceptIfNew(string, time.Time, protocol.PairingCandidate) (bool, error) {
	if g.accepted {
		return false, nil
	}
	g.accepted = true
	return true, nil
}

func main() {
	decoder := json.NewDecoder(os.Stdin)
	decoder.DisallowUnknownFields()
	var input request
	if err := decoder.Decode(&input); err != nil {
		fail(fmt.Errorf("decode request: %w", err))
	}

	switch input.Operation {
	case "generate_identity":
		identity, err := protocol.GenerateIdentity()
		if err != nil {
			fail(err)
		}
		write(map[string]any{"identity": encodeIdentity(identity)})
	case "seal":
		plaintext := decode("plaintext", input.Plaintext)
		recipientPublicKey := decode("recipient encryption public key", input.RecipientEncryptionPublicKey)
		senderPrivateKey := decode("sender signing private key", input.SenderSigningPrivateKey)
		sealRequest := protocol.SealRequest{
			Header:                       input.Header.protocolHeader(),
			Plaintext:                    plaintext,
			RecipientEncryptionPublicKey: recipientPublicKey,
			SenderSigningPrivateKey:      senderPrivateKey,
		}
		if input.EphemeralKeyMaterial != "" {
			sealRequest.Random = bytes.NewReader(decode("ephemeral key material", input.EphemeralKeyMaterial))
		}
		envelope, err := protocol.Seal(sealRequest)
		if err != nil {
			fail(err)
		}
		write(map[string]any{"envelope": envelope})
	case "sign_pairing_challenge":
		signature, err := protocol.SignPairingChallenge(input.PairingBinding.protocolBinding(), decode("Installation signing private key", input.InstallationSigningPrivateKey))
		if err != nil {
			fail(err)
		}
		write(map[string]any{"signature": base64.RawURLEncoding.EncodeToString(signature)})
	case "verify_pairing_challenge":
		if err := protocol.VerifyPairingChallenge(input.PairingBinding.protocolBinding(), decode("Installation signing public key", input.InstallationSigningPublicKey), decode("pairing challenge signature", input.PairingChallengeSignature)); err != nil {
			fail(err)
		}
		write(map[string]any{"valid": true})
	case "open", "open_replay":
		recipientPrivateKey := decode("recipient encryption private key", input.RecipientEncryptionPrivateKey)
		senderPublicKey := decode("sender signing public key", input.SenderSigningPublicKey)
		var replayGuard protocol.ReplayGuard = allowReplayGuard{}
		if input.Operation == "open_replay" {
			replayGuard = &memoryReplayGuard{}
		}
		pairingGuard := &memoryPairingGuard{}
		openRequest := protocol.OpenRequest{
			Envelope:                      input.Envelope,
			RecipientEncryptionPrivateKey: recipientPrivateKey,
			SenderSigningPublicKey:        senderPublicKey,
			ExpectedInstallationID:        input.ExpectedInstallationID,
			ExpectedSenderID:              input.ExpectedSenderID,
			ExpectedRecipientID:           input.ExpectedRecipientID,
			Now:                           time.UnixMilli(input.NowMS).UTC(),
			ReplayGuard:                   replayGuard,
			ExpectedPairingID:             input.ExpectedPairingID,
			ExpectedPairingSecret:         decode("expected pairing secret", input.ExpectedPairingSecret),
			PairingGuard:                  pairingGuard,
		}
		opened, err := protocol.Open(openRequest)
		if err != nil {
			fail(err)
		}
		if input.Operation == "open_replay" {
			_, replayErr := protocol.Open(openRequest)
			write(map[string]any{"error_code": protocol.ErrorCodeOf(replayErr)})
			break
		}
		write(map[string]any{
			"header":    headerFromProtocol(opened.Header),
			"plaintext": base64.RawURLEncoding.EncodeToString(opened.Plaintext),
		})
	default:
		fail(fmt.Errorf("unknown operation %q", input.Operation))
	}
}

func (h conformanceHeader) protocolHeader() protocol.Header {
	return protocol.Header{
		MessageType:              h.MessageType,
		InstallationID:           h.InstallationID,
		SenderID:                 h.SenderID,
		SenderSigningKeyID:       h.SenderSigningKeyID,
		RecipientID:              h.RecipientID,
		RecipientEncryptionKeyID: h.RecipientEncryptionKeyID,
		MessageID:                h.MessageID,
		EventID:                  h.EventID,
		EventSeq:                 h.EventSeq,
		ThroughEventSeq:          h.ThroughEventSeq,
		CommandID:                h.CommandID,
		RequestID:                h.RequestID,
		AckSeq:                   h.AckSeq,
		CreatedAt:                time.UnixMilli(h.CreatedAtMS).UTC(),
		ExpiresAt:                time.UnixMilli(h.ExpiresAtMS).UTC(),
	}
}

func headerFromProtocol(h protocol.Header) conformanceHeader {
	return conformanceHeader{
		MessageType:              h.MessageType,
		InstallationID:           h.InstallationID,
		SenderID:                 h.SenderID,
		SenderSigningKeyID:       h.SenderSigningKeyID,
		RecipientID:              h.RecipientID,
		RecipientEncryptionKeyID: h.RecipientEncryptionKeyID,
		MessageID:                h.MessageID,
		EventID:                  h.EventID,
		EventSeq:                 h.EventSeq,
		ThroughEventSeq:          h.ThroughEventSeq,
		CommandID:                h.CommandID,
		RequestID:                h.RequestID,
		AckSeq:                   h.AckSeq,
		CreatedAtMS:              h.CreatedAt.UnixMilli(),
		ExpiresAtMS:              h.ExpiresAt.UnixMilli(),
	}
}

func encodeIdentity(identity protocol.Identity) conformanceIdentity {
	return conformanceIdentity{
		EncryptionPublicKey:  base64.RawURLEncoding.EncodeToString(identity.EncryptionPublicKey),
		EncryptionPrivateKey: base64.RawURLEncoding.EncodeToString(identity.EncryptionPrivateKey),
		SigningPublicKey:     base64.RawURLEncoding.EncodeToString(identity.SigningPublicKey),
		SigningPrivateKey:    base64.RawURLEncoding.EncodeToString(identity.SigningPrivateKey),
	}
}

func decode(field, value string) []byte {
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(value)
	if err != nil {
		fail(fmt.Errorf("decode %s: %w", field, err))
	}
	return decoded
}

func write(value any) {
	if err := json.NewEncoder(os.Stdout).Encode(value); err != nil {
		fail(fmt.Errorf("encode response: %w", err))
	}
}

func fail(err error) {
	_ = json.NewEncoder(os.Stderr).Encode(map[string]any{
		"error_code": protocol.ErrorCodeOf(err),
		"message":    err.Error(),
	})
	os.Exit(1)
}
