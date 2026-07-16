// Package protocol implements the Herdr Connect wire protocol.
package protocol

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"time"
	"unicode/utf8"

	"github.com/cloudflare/circl/hpke"
)

const (
	Version     = 1
	CipherSuite = "HPKE-X25519-HKDF-SHA256-CHACHA20POLY1305+Ed25519"

	MaxPlaintextSize       = 256 * 1024
	maxProtectedHeaderSize = 4096
	maxSafeInteger         = uint64(1<<53 - 1)
)

var (
	hpkeSuite       = hpke.NewSuite(hpke.KEM_X25519_HKDF_SHA256, hpke.KDF_HKDF_SHA256, hpke.AEAD_ChaCha20Poly1305)
	hpkeInfo        = []byte("Herdr Connect Protocol v1 HPKE\x00")
	signatureDomain = []byte("Herdr Connect Protocol v1 signature\x00")
)

type MessageType string

const (
	MessageTypeSessionHello    MessageType = "session_hello"
	MessageTypePairingRequest  MessageType = "pairing_request"
	MessageTypePairingDecision MessageType = "pairing_decision"
	MessageTypeLifecycleEvent  MessageType = "lifecycle_event"
	MessageTypeStateSnapshot   MessageType = "state_snapshot"
	MessageTypeOutputRequest   MessageType = "output_request"
	MessageTypeOutputSnapshot  MessageType = "output_snapshot"
	MessageTypeRemoteCommand   MessageType = "remote_command"
	MessageTypeCommandResult   MessageType = "command_result"
	MessageTypeAck             MessageType = "ack"
	MessageTypeError           MessageType = "error"
)

type ErrorCode string

const (
	ErrorCodeReplay                 ErrorCode = "replay"
	ErrorCodeTTLExceeded            ErrorCode = "ttl_exceeded"
	ErrorCodeAuthenticationFailed   ErrorCode = "authentication_failed"
	ErrorCodeUnsupportedVersion     ErrorCode = "unsupported_version"
	ErrorCodeUnsupportedSuite       ErrorCode = "unsupported_suite"
	ErrorCodeExpired                ErrorCode = "expired"
	ErrorCodeUnsupportedMessageType ErrorCode = "unsupported_message_type"
	ErrorCodeInvalidEnvelope        ErrorCode = "invalid_envelope"
	ErrorCodeInvalidHeader          ErrorCode = "invalid_header"
	ErrorCodeInvalidKey             ErrorCode = "invalid_key"
	ErrorCodeWrongRoute             ErrorCode = "wrong_route"
	ErrorCodeCreatedInFuture        ErrorCode = "created_in_future"
	ErrorCodeReplayStoreFailed      ErrorCode = "replay_store_failed"
	ErrorCodeMessageTooLarge        ErrorCode = "message_too_large"
)

type ProtocolError struct {
	Code  ErrorCode
	Cause error
}

func (e *ProtocolError) Error() string {
	return fmt.Sprintf("%s: %v", e.Code, e.Cause)
}

func (e *ProtocolError) Unwrap() error {
	return e.Cause
}

func ErrorCodeOf(err error) ErrorCode {
	var protocolError *ProtocolError
	if errors.As(err, &protocolError) {
		return protocolError.Code
	}
	return ""
}

type Header struct {
	Version                  int
	Suite                    string
	MessageType              MessageType
	InstallationID           string
	SenderID                 string
	SenderSigningKeyID       string
	SenderSigningPublicKey   []byte
	RecipientID              string
	RecipientEncryptionKeyID string
	MessageID                string
	EventID                  string
	EventSeq                 uint64
	ThroughEventSeq          uint64
	CommandID                string
	RequestID                string
	AckSeq                   uint64
	CreatedAt                time.Time
	ExpiresAt                time.Time
}

type Envelope struct {
	Protected  string `json:"protected"`
	Ciphertext string `json:"ciphertext"`
	Signature  string `json:"signature"`
}

type Identity struct {
	EncryptionPublicKey  []byte
	EncryptionPrivateKey []byte
	SigningPublicKey     []byte
	SigningPrivateKey    []byte
}

type SealRequest struct {
	Header                       Header
	Plaintext                    []byte
	RecipientEncryptionPublicKey []byte
	SenderSigningPrivateKey      []byte
	Random                       io.Reader
}

type ReplayGuard interface {
	MarkIfNew(messageID string, expiresAt time.Time) (bool, error)
}

type PairingGuard interface {
	AcceptIfNew(messageID string, expiresAt time.Time, candidate PairingCandidate) (bool, error)
}

type OpenRequest struct {
	Envelope                      Envelope
	RecipientEncryptionPrivateKey []byte
	SenderSigningPublicKey        []byte
	ExpectedInstallationID        string
	ExpectedSenderID              string
	ExpectedRecipientID           string
	Now                           time.Time
	ReplayGuard                   ReplayGuard
	ExpectedPairingID             string
	ExpectedPairingSecret         []byte
	PairingGuard                  PairingGuard
}

type OpenedMessage struct {
	Header           Header
	Plaintext        []byte
	PairingCandidate *PairingCandidate
}

type PairingCandidate struct {
	PairingID                 string
	DeviceName                string
	DeviceSigningPublicKey    []byte
	DeviceEncryptionPublicKey []byte
	Challenge                 []byte
}

type pairingRequestPayload struct {
	PairingID                 string `json:"pairing_id"`
	PairingSecret             string `json:"pairing_secret"`
	DeviceName                string `json:"device_name"`
	DeviceSigningPublicKey    string `json:"device_signing_public_key"`
	DeviceEncryptionPublicKey string `json:"device_encryption_public_key"`
	Challenge                 string `json:"challenge"`
}

type PairingChallengeBinding struct {
	PairingID                       string
	PairingSecret                   []byte
	Challenge                       []byte
	DeviceSigningPublicKey          []byte
	DeviceEncryptionPublicKey       []byte
	InstallationSigningPublicKey    []byte
	InstallationEncryptionPublicKey []byte
	Decision                        string
}

type protectedHeader struct {
	Version                  int         `json:"v"`
	Suite                    string      `json:"suite"`
	MessageType              MessageType `json:"message_type"`
	InstallationID           string      `json:"installation_id"`
	SenderID                 string      `json:"sender_id"`
	SenderSigningKeyID       string      `json:"sender_signing_key_id"`
	SenderSigningPublicKey   string      `json:"sender_signing_public_key"`
	RecipientID              string      `json:"recipient_id"`
	RecipientEncryptionKeyID string      `json:"recipient_encryption_key_id"`
	MessageID                string      `json:"message_id"`
	EventID                  string      `json:"event_id"`
	EventSeq                 uint64      `json:"event_seq"`
	ThroughEventSeq          uint64      `json:"through_event_seq"`
	CommandID                string      `json:"command_id"`
	RequestID                string      `json:"request_id"`
	AckSeq                   uint64      `json:"ack_seq"`
	CreatedAtMS              int64       `json:"created_at_ms"`
	ExpiresAtMS              int64       `json:"expires_at_ms"`
	EncapsulatedKey          string      `json:"enc"`
}

var identifierPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)

func GenerateIdentity() (Identity, error) {
	publicEncryptionKey, privateEncryptionKey, err := hpke.KEM_X25519_HKDF_SHA256.Scheme().GenerateKeyPair()
	if err != nil {
		return Identity{}, fmt.Errorf("generate encryption key: %w", err)
	}
	publicEncryptionBytes, err := publicEncryptionKey.MarshalBinary()
	if err != nil {
		return Identity{}, fmt.Errorf("marshal encryption public key: %w", err)
	}
	privateEncryptionBytes, err := privateEncryptionKey.MarshalBinary()
	if err != nil {
		return Identity{}, fmt.Errorf("marshal encryption private key: %w", err)
	}
	publicSigningKey, privateSigningKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return Identity{}, fmt.Errorf("generate signing key: %w", err)
	}

	return Identity{
		EncryptionPublicKey:  publicEncryptionBytes,
		EncryptionPrivateKey: privateEncryptionBytes,
		SigningPublicKey:     bytes.Clone(publicSigningKey),
		SigningPrivateKey:    bytes.Clone(privateSigningKey.Seed()),
	}, nil
}

func ValidatePairingCandidate(plaintext, embeddedSigningKey []byte, expectedPairingID string, expectedSecret []byte) (PairingCandidate, error) {
	if len(expectedSecret) != 32 {
		return PairingCandidate{}, protocolError(ErrorCodeInvalidKey, errors.New("expected pairing secret must be 32 bytes"))
	}
	var payload pairingRequestPayload
	decoder := json.NewDecoder(bytes.NewReader(plaintext))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		return PairingCandidate{}, protocolError(ErrorCodeInvalidEnvelope, fmt.Errorf("decode pairing request: %w", err))
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return PairingCandidate{}, protocolError(ErrorCodeInvalidEnvelope, errors.New("pairing request has trailing JSON"))
	}
	secret, err := decodePairingField("pairing secret", payload.PairingSecret)
	if err != nil {
		return PairingCandidate{}, err
	}
	challenge, err := decodePairingField("pairing challenge", payload.Challenge)
	if err != nil {
		return PairingCandidate{}, err
	}
	deviceSigningKey, err := decodePairingField("device signing public key", payload.DeviceSigningPublicKey)
	if err != nil {
		return PairingCandidate{}, err
	}
	deviceEncryptionKey, err := decodePairingField("device encryption public key", payload.DeviceEncryptionPublicKey)
	if err != nil {
		return PairingCandidate{}, err
	}
	if !identifierPattern.MatchString(payload.PairingID) || payload.PairingID != expectedPairingID || subtle.ConstantTimeCompare(secret, expectedSecret) != 1 || subtle.ConstantTimeCompare(deviceSigningKey, embeddedSigningKey) != 1 {
		return PairingCandidate{}, authenticationFailed(errors.New("pairing credential mismatch"))
	}
	if !utf8.ValidString(payload.DeviceName) || utf8.RuneCountInString(payload.DeviceName) < 1 || utf8.RuneCountInString(payload.DeviceName) > 128 {
		return PairingCandidate{}, protocolError(ErrorCodeInvalidEnvelope, errors.New("invalid device name"))
	}
	return PairingCandidate{PairingID: payload.PairingID, DeviceName: payload.DeviceName, DeviceSigningPublicKey: deviceSigningKey, DeviceEncryptionPublicKey: deviceEncryptionKey, Challenge: challenge}, nil
}

func PairingChallengeTranscript(binding PairingChallengeBinding) ([]byte, error) {
	if !identifierPattern.MatchString(binding.PairingID) || (binding.Decision != "accepted" && binding.Decision != "rejected") {
		return nil, protocolError(ErrorCodeInvalidHeader, errors.New("invalid pairing challenge identity or decision"))
	}
	for _, value := range [][]byte{binding.PairingSecret, binding.Challenge, binding.DeviceSigningPublicKey, binding.DeviceEncryptionPublicKey, binding.InstallationSigningPublicKey, binding.InstallationEncryptionPublicKey} {
		if len(value) != 32 {
			return nil, protocolError(ErrorCodeInvalidKey, errors.New("pairing challenge key material must be 32 bytes"))
		}
	}
	transcript := bytes.Clone([]byte("Herdr Connect Protocol v1 pairing challenge\x00"))
	for _, field := range [][]byte{[]byte(binding.PairingID), binding.PairingSecret, binding.Challenge, binding.DeviceSigningPublicKey, binding.DeviceEncryptionPublicKey, binding.InstallationSigningPublicKey, binding.InstallationEncryptionPublicKey, []byte(binding.Decision)} {
		var length [4]byte
		binary.BigEndian.PutUint32(length[:], uint32(len(field)))
		transcript = append(transcript, length[:]...)
		transcript = append(transcript, field...)
	}
	return transcript, nil
}

func SignPairingChallenge(binding PairingChallengeBinding, installationSigningSeed []byte) ([]byte, error) {
	if len(installationSigningSeed) != ed25519.SeedSize {
		return nil, protocolError(ErrorCodeInvalidKey, errors.New("invalid Installation signing seed"))
	}
	transcript, err := PairingChallengeTranscript(binding)
	if err != nil {
		return nil, err
	}
	return ed25519.Sign(ed25519.NewKeyFromSeed(installationSigningSeed), transcript), nil
}

func VerifyPairingChallenge(binding PairingChallengeBinding, installationSigningPublicKey, signature []byte) error {
	transcript, err := PairingChallengeTranscript(binding)
	if err != nil {
		return err
	}
	if len(installationSigningPublicKey) != ed25519.PublicKeySize || len(signature) != ed25519.SignatureSize || !ed25519.Verify(installationSigningPublicKey, transcript, signature) {
		return authenticationFailed(errors.New("invalid pairing challenge signature"))
	}
	return nil
}

func decodePairingField(name, value string) ([]byte, error) {
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(value)
	if err != nil || len(decoded) != 32 {
		return nil, protocolError(ErrorCodeInvalidEnvelope, fmt.Errorf("%s must be 32-byte base64url", name))
	}
	return decoded, nil
}

func Seal(request SealRequest) (Envelope, error) {
	header := request.Header
	if header.Version == 0 {
		header.Version = Version
	}
	if header.Suite == "" {
		header.Suite = CipherSuite
	}
	if err := validateHeader(header); err != nil {
		return Envelope{}, err
	}
	if len(request.Plaintext) > MaxPlaintextSize {
		return Envelope{}, protocolError(ErrorCodeMessageTooLarge, errors.New("plaintext exceeds protocol limit"))
	}
	if len(request.SenderSigningPrivateKey) != ed25519.SeedSize {
		return Envelope{}, protocolError(ErrorCodeInvalidKey, errors.New("invalid Ed25519 private key"))
	}
	if header.MessageType == MessageTypePairingRequest {
		signingKey := ed25519.NewKeyFromSeed(request.SenderSigningPrivateKey)
		header.SenderSigningPublicKey = bytes.Clone(signingKey.Public().(ed25519.PublicKey))
	} else if len(header.SenderSigningPublicKey) != 0 {
		return Envelope{}, protocolError(ErrorCodeInvalidHeader, errors.New("embedded signing key is only valid for pairing requests"))
	}

	scheme := hpke.KEM_X25519_HKDF_SHA256.Scheme()
	recipientPublicKey, err := scheme.UnmarshalBinaryPublicKey(request.RecipientEncryptionPublicKey)
	if err != nil {
		return Envelope{}, protocolError(ErrorCodeInvalidKey, fmt.Errorf("invalid recipient encryption key: %w", err))
	}
	sender, err := hpkeSuite.NewSender(recipientPublicKey, hpkeInfo)
	if err != nil {
		return Envelope{}, fmt.Errorf("create HPKE sender: %w", err)
	}
	encapsulatedKey, sealer, err := sender.Setup(request.Random)
	if err != nil {
		return Envelope{}, fmt.Errorf("set up HPKE sender: %w", err)
	}

	wireHeader := headerToProtected(header, base64.RawURLEncoding.EncodeToString(encapsulatedKey))
	protectedBytes, err := json.Marshal(wireHeader)
	if err != nil {
		return Envelope{}, fmt.Errorf("encode protected header: %w", err)
	}
	if len(protectedBytes) > maxProtectedHeaderSize {
		return Envelope{}, protocolError(ErrorCodeMessageTooLarge, errors.New("protected header exceeds protocol limit"))
	}
	ciphertext, err := sealer.Seal(request.Plaintext, protectedBytes)
	if err != nil {
		return Envelope{}, fmt.Errorf("seal plaintext: %w", err)
	}
	signingKey := ed25519.NewKeyFromSeed(request.SenderSigningPrivateKey)
	signature := ed25519.Sign(signingKey, signatureInput(protectedBytes, ciphertext))

	return Envelope{
		Protected:  base64.RawURLEncoding.EncodeToString(protectedBytes),
		Ciphertext: base64.RawURLEncoding.EncodeToString(ciphertext),
		Signature:  base64.RawURLEncoding.EncodeToString(signature),
	}, nil
}

func Open(request OpenRequest) (OpenedMessage, error) {
	protectedBytes, err := decodeBase64URL("protected header", request.Envelope.Protected)
	if err != nil {
		return OpenedMessage{}, err
	}
	if len(protectedBytes) > maxProtectedHeaderSize {
		return OpenedMessage{}, protocolError(ErrorCodeMessageTooLarge, errors.New("protected header exceeds protocol limit"))
	}
	var wireHeader protectedHeader
	decoder := json.NewDecoder(bytes.NewReader(protectedBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&wireHeader); err != nil {
		return OpenedMessage{}, protocolError(ErrorCodeInvalidEnvelope, fmt.Errorf("decode protected header: %w", err))
	}
	canonicalHeader, err := json.Marshal(wireHeader)
	if err != nil || !bytes.Equal(canonicalHeader, protectedBytes) {
		return OpenedMessage{}, protocolError(ErrorCodeInvalidEnvelope, errors.New("protected header is not canonical"))
	}
	header, err := protectedToHeader(wireHeader)
	if err != nil {
		return OpenedMessage{}, err
	}
	if err := validateHeader(header); err != nil {
		return OpenedMessage{}, err
	}
	if header.InstallationID != request.ExpectedInstallationID || header.SenderID != request.ExpectedSenderID || header.RecipientID != request.ExpectedRecipientID {
		return OpenedMessage{}, protocolError(ErrorCodeWrongRoute, errors.New("envelope identity does not match expected route"))
	}

	ciphertext, err := decodeBase64URL("ciphertext", request.Envelope.Ciphertext)
	if err != nil {
		return OpenedMessage{}, err
	}
	if len(ciphertext) > MaxPlaintextSize+16 {
		return OpenedMessage{}, protocolError(ErrorCodeMessageTooLarge, errors.New("ciphertext exceeds protocol limit"))
	}
	signature, err := decodeBase64URL("signature", request.Envelope.Signature)
	if err != nil {
		return OpenedMessage{}, err
	}
	senderSigningPublicKey := request.SenderSigningPublicKey
	if header.MessageType == MessageTypePairingRequest {
		if len(header.SenderSigningPublicKey) != ed25519.PublicKeySize {
			return OpenedMessage{}, protocolError(ErrorCodeInvalidHeader, errors.New("pairing request has no embedded signing key"))
		}
		if len(senderSigningPublicKey) != 0 && !bytes.Equal(senderSigningPublicKey, header.SenderSigningPublicKey) {
			return OpenedMessage{}, authenticationFailed(errors.New("pairing signing key mismatch"))
		}
		senderSigningPublicKey = header.SenderSigningPublicKey
	} else if len(header.SenderSigningPublicKey) != 0 {
		return OpenedMessage{}, protocolError(ErrorCodeInvalidHeader, errors.New("unexpected embedded signing key"))
	}
	if len(senderSigningPublicKey) != ed25519.PublicKeySize || len(signature) != ed25519.SignatureSize || !ed25519.Verify(senderSigningPublicKey, signatureInput(protectedBytes, ciphertext), signature) {
		return OpenedMessage{}, authenticationFailed(errors.New("sender authentication failed"))
	}
	if request.Now.Before(header.CreatedAt.Add(-2 * time.Minute)) {
		return OpenedMessage{}, protocolError(ErrorCodeCreatedInFuture, errors.New("message was created too far in the future"))
	}
	if !request.Now.Before(header.ExpiresAt) {
		return OpenedMessage{}, &ProtocolError{Code: ErrorCodeExpired, Cause: errors.New("message expired")}
	}

	scheme := hpke.KEM_X25519_HKDF_SHA256.Scheme()
	recipientPrivateKey, err := scheme.UnmarshalBinaryPrivateKey(request.RecipientEncryptionPrivateKey)
	if err != nil {
		return OpenedMessage{}, protocolError(ErrorCodeInvalidKey, fmt.Errorf("invalid recipient encryption key: %w", err))
	}
	encapsulatedKey, err := decodeBase64URL("encapsulated key", wireHeader.EncapsulatedKey)
	if err != nil {
		return OpenedMessage{}, err
	}
	recipient, err := hpkeSuite.NewReceiver(recipientPrivateKey, hpkeInfo)
	if err != nil {
		return OpenedMessage{}, fmt.Errorf("create HPKE recipient: %w", err)
	}
	opener, err := recipient.Setup(encapsulatedKey)
	if err != nil {
		return OpenedMessage{}, authenticationFailed(err)
	}
	plaintext, err := opener.Open(ciphertext, protectedBytes)
	if err != nil {
		return OpenedMessage{}, authenticationFailed(err)
	}
	var isNew bool
	if header.MessageType == MessageTypePairingRequest {
		candidate, validationErr := ValidatePairingCandidate(plaintext, header.SenderSigningPublicKey, request.ExpectedPairingID, request.ExpectedPairingSecret)
		if validationErr != nil {
			return OpenedMessage{}, validationErr
		}
		if request.PairingGuard == nil {
			return OpenedMessage{}, protocolError(ErrorCodeReplayStoreFailed, errors.New("pairing guard is required"))
		}
		isNew, err = request.PairingGuard.AcceptIfNew(header.MessageID, header.ExpiresAt, candidate)
		if err == nil && isNew {
			return OpenedMessage{Header: header, Plaintext: plaintext, PairingCandidate: &candidate}, nil
		}
	} else {
		if request.ReplayGuard == nil {
			return OpenedMessage{}, protocolError(ErrorCodeReplayStoreFailed, errors.New("replay guard is required"))
		}
		isNew, err = request.ReplayGuard.MarkIfNew(header.MessageID, header.ExpiresAt)
	}
	if err != nil {
		return OpenedMessage{}, protocolError(ErrorCodeReplayStoreFailed, fmt.Errorf("record replay state: %w", err))
	}
	if !isNew {
		return OpenedMessage{}, &ProtocolError{Code: ErrorCodeReplay, Cause: errors.New("message replayed")}
	}

	return OpenedMessage{Header: header, Plaintext: plaintext}, nil
}

func validateHeader(header Header) error {
	if header.Version != Version {
		return &ProtocolError{Code: ErrorCodeUnsupportedVersion, Cause: fmt.Errorf("unsupported protocol version %d", header.Version)}
	}
	if header.Suite != CipherSuite {
		return &ProtocolError{Code: ErrorCodeUnsupportedSuite, Cause: fmt.Errorf("unsupported cipher suite %q", header.Suite)}
	}
	maxTTL, ok := maxTTLByMessageType[header.MessageType]
	if !ok {
		return &ProtocolError{Code: ErrorCodeUnsupportedMessageType, Cause: fmt.Errorf("unsupported message type %q", header.MessageType)}
	}
	if header.InstallationID == "" || header.SenderID == "" || header.SenderSigningKeyID == "" || header.RecipientID == "" || header.RecipientEncryptionKeyID == "" || header.MessageID == "" {
		return protocolError(ErrorCodeInvalidHeader, errors.New("required header identity is missing"))
	}
	for _, identifier := range []string{header.InstallationID, header.SenderID, header.SenderSigningKeyID, header.RecipientID, header.RecipientEncryptionKeyID, header.MessageID} {
		if !identifierPattern.MatchString(identifier) {
			return protocolError(ErrorCodeInvalidHeader, fmt.Errorf("invalid identifier %q", identifier))
		}
	}
	if header.EventSeq > maxSafeInteger || header.ThroughEventSeq > maxSafeInteger || header.AckSeq > maxSafeInteger {
		return protocolError(ErrorCodeInvalidHeader, errors.New("sequence exceeds interoperable integer range"))
	}
	for _, identifier := range []string{header.EventID, header.CommandID, header.RequestID} {
		if identifier != "" && !identifierPattern.MatchString(identifier) {
			return protocolError(ErrorCodeInvalidHeader, fmt.Errorf("invalid message-specific identifier %q", identifier))
		}
	}
	switch header.MessageType {
	case MessageTypeLifecycleEvent:
		if !identifierPattern.MatchString(header.EventID) || header.EventSeq == 0 {
			return protocolError(ErrorCodeInvalidHeader, errors.New("lifecycle event identity is missing"))
		}
		if header.ThroughEventSeq != 0 || header.CommandID != "" || header.RequestID != "" || header.AckSeq != 0 {
			return protocolError(ErrorCodeInvalidHeader, errors.New("lifecycle event has unrelated fields"))
		}
	case MessageTypeStateSnapshot:
		if header.EventID != "" || header.EventSeq != 0 || header.CommandID != "" || header.RequestID != "" || header.AckSeq != 0 {
			return protocolError(ErrorCodeInvalidHeader, errors.New("state snapshot has unrelated fields"))
		}
	case MessageTypeRemoteCommand, MessageTypeCommandResult:
		if !identifierPattern.MatchString(header.CommandID) {
			return protocolError(ErrorCodeInvalidHeader, errors.New("remote command identity is missing"))
		}
		if header.EventID != "" || header.EventSeq != 0 || header.ThroughEventSeq != 0 || header.RequestID != "" || header.AckSeq != 0 {
			return protocolError(ErrorCodeInvalidHeader, errors.New("command message has unrelated fields"))
		}
	case MessageTypeOutputRequest, MessageTypeOutputSnapshot:
		if !identifierPattern.MatchString(header.RequestID) {
			return protocolError(ErrorCodeInvalidHeader, errors.New("output request identity is missing"))
		}
		if header.EventID != "" || header.EventSeq != 0 || header.ThroughEventSeq != 0 || header.CommandID != "" || header.AckSeq != 0 {
			return protocolError(ErrorCodeInvalidHeader, errors.New("output message has unrelated fields"))
		}
	case MessageTypeAck:
		if header.AckSeq == 0 {
			return protocolError(ErrorCodeInvalidHeader, errors.New("ack cursor is missing"))
		}
		if header.EventID != "" || header.EventSeq != 0 || header.ThroughEventSeq != 0 || header.CommandID != "" || header.RequestID != "" {
			return protocolError(ErrorCodeInvalidHeader, errors.New("ack has unrelated fields"))
		}
	default:
		if header.EventID != "" || header.EventSeq != 0 || header.ThroughEventSeq != 0 || header.CommandID != "" || header.RequestID != "" || header.AckSeq != 0 {
			return protocolError(ErrorCodeInvalidHeader, errors.New("message has unrelated fields"))
		}
	}
	if header.CreatedAt.IsZero() || !header.ExpiresAt.After(header.CreatedAt) {
		return protocolError(ErrorCodeInvalidHeader, errors.New("invalid message lifetime"))
	}
	if header.CreatedAt.UnixMilli() < 0 || header.ExpiresAt.UnixMilli() < 0 || uint64(header.CreatedAt.UnixMilli()) > maxSafeInteger || uint64(header.ExpiresAt.UnixMilli()) > maxSafeInteger {
		return protocolError(ErrorCodeInvalidHeader, errors.New("timestamp exceeds interoperable integer range"))
	}
	if header.ExpiresAt.Sub(header.CreatedAt) > maxTTL {
		return &ProtocolError{Code: ErrorCodeTTLExceeded, Cause: errors.New("message lifetime exceeds limit")}
	}
	return nil
}

var maxTTLByMessageType = map[MessageType]time.Duration{
	MessageTypeSessionHello:    30 * time.Second,
	MessageTypePairingRequest:  5 * time.Minute,
	MessageTypePairingDecision: 5 * time.Minute,
	MessageTypeLifecycleEvent:  24 * time.Hour,
	MessageTypeStateSnapshot:   5 * time.Minute,
	MessageTypeOutputRequest:   30 * time.Second,
	MessageTypeOutputSnapshot:  30 * time.Second,
	MessageTypeRemoteCommand:   30 * time.Second,
	MessageTypeCommandResult:   5 * time.Minute,
	MessageTypeAck:             5 * time.Minute,
	MessageTypeError:           5 * time.Minute,
}

func headerToProtected(header Header, encapsulatedKey string) protectedHeader {
	return protectedHeader{
		Version:                  header.Version,
		Suite:                    header.Suite,
		MessageType:              header.MessageType,
		InstallationID:           header.InstallationID,
		SenderID:                 header.SenderID,
		SenderSigningKeyID:       header.SenderSigningKeyID,
		SenderSigningPublicKey:   base64.RawURLEncoding.EncodeToString(header.SenderSigningPublicKey),
		RecipientID:              header.RecipientID,
		RecipientEncryptionKeyID: header.RecipientEncryptionKeyID,
		MessageID:                header.MessageID,
		EventID:                  header.EventID,
		EventSeq:                 header.EventSeq,
		ThroughEventSeq:          header.ThroughEventSeq,
		CommandID:                header.CommandID,
		RequestID:                header.RequestID,
		AckSeq:                   header.AckSeq,
		CreatedAtMS:              header.CreatedAt.UnixMilli(),
		ExpiresAtMS:              header.ExpiresAt.UnixMilli(),
		EncapsulatedKey:          encapsulatedKey,
	}
}

func protectedToHeader(header protectedHeader) (Header, error) {
	senderSigningPublicKey, err := decodeBase64URL("sender signing public key", header.SenderSigningPublicKey)
	if err != nil {
		return Header{}, err
	}
	return Header{
		Version:                  header.Version,
		Suite:                    header.Suite,
		MessageType:              header.MessageType,
		InstallationID:           header.InstallationID,
		SenderID:                 header.SenderID,
		SenderSigningKeyID:       header.SenderSigningKeyID,
		SenderSigningPublicKey:   senderSigningPublicKey,
		RecipientID:              header.RecipientID,
		RecipientEncryptionKeyID: header.RecipientEncryptionKeyID,
		MessageID:                header.MessageID,
		EventID:                  header.EventID,
		EventSeq:                 header.EventSeq,
		ThroughEventSeq:          header.ThroughEventSeq,
		CommandID:                header.CommandID,
		RequestID:                header.RequestID,
		AckSeq:                   header.AckSeq,
		CreatedAt:                time.UnixMilli(header.CreatedAtMS).UTC(),
		ExpiresAt:                time.UnixMilli(header.ExpiresAtMS).UTC(),
	}, nil
}

func signatureInput(protected, ciphertext []byte) []byte {
	input := make([]byte, 0, len(signatureDomain)+4+len(protected)+len(ciphertext))
	input = append(input, signatureDomain...)
	length := make([]byte, 4)
	binary.BigEndian.PutUint32(length, uint32(len(protected)))
	input = append(input, length...)
	input = append(input, protected...)
	input = append(input, ciphertext...)
	return input
}

func decodeBase64URL(field, value string) ([]byte, error) {
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(value)
	if err != nil {
		return nil, protocolError(ErrorCodeInvalidEnvelope, fmt.Errorf("decode %s: %w", field, err))
	}
	return decoded, nil
}

func authenticationFailed(cause error) error {
	return &ProtocolError{Code: ErrorCodeAuthenticationFailed, Cause: cause}
}

func protocolError(code ErrorCode, cause error) error {
	return &ProtocolError{Code: code, Cause: cause}
}
