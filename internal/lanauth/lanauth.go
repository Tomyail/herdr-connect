// Package lanauth 实现 LAN 传输安全的身份与配对逻辑（issue #21）：
// daemon 自签 TLS 证书（Installation 身份 = 证书指纹）、一次性配对 secret、
// 配对设备的 bearer token 签发与校验。持久化统一走 internal/store，
// 本包不依赖 net/http，路由与错误映射留给 internal/demolan。
package lanauth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base32"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Tomyail/herdr-connect/internal/store"
)

const (
	CertFileName     = "lan-cert.pem"
	KeyFileName      = "lan-key.pem"
	PairingSecretTTL = 5 * time.Minute

	certCommonName    = "Herdr Connect LAN"
	certValidityYears = 10

	// 首次生成证书时另一进程等待胜者写完文件的时限。
	concurrentCreateWait = 2 * time.Second
)

// Certificate 是 daemon 的自签 TLS 身份。证书与私钥同生命周期、不轮换；
// 文件丢失后下次启动自动重新生成，等价于强制所有已配对设备重新配对。
type Certificate struct {
	TLS         tls.Certificate
	Fingerprint [32]byte // leaf 证书 DER 的 SHA-256
}

func (c Certificate) FingerprintBase64() string {
	return base64.RawURLEncoding.EncodeToString(c.Fingerprint[:])
}

// LoadOrCreateCertificate 从 dir 加载证书与私钥，不存在则生成。
// daemon 与 pair 命令可能并发首次调用：以 O_CREATE|O_EXCL 创建私钥文件作为
// 生成权竞争，败者等待胜者写完后读取，保证两个进程得到同一份身份。
func LoadOrCreateCertificate(dir string) (Certificate, error) {
	certPath := filepath.Join(dir, CertFileName)
	keyPath := filepath.Join(dir, KeyFileName)

	cert, err := loadCertificate(certPath, keyPath)
	if err == nil {
		return cert, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return Certificate{}, err
	}

	if err := os.MkdirAll(dir, 0o700); err != nil {
		return Certificate{}, fmt.Errorf("create certificate directory: %w", err)
	}
	certPEM, keyPEM, err := generateSelfSigned()
	if err != nil {
		return Certificate{}, err
	}

	keyFile, err := os.OpenFile(keyPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if errors.Is(err, os.ErrExist) {
		return waitForCertificate(certPath, keyPath)
	}
	if err != nil {
		return Certificate{}, fmt.Errorf("create private key file: %w", err)
	}
	if _, err := keyFile.Write(keyPEM); err != nil {
		_ = keyFile.Close()
		return Certificate{}, fmt.Errorf("write private key: %w", err)
	}
	if err := keyFile.Close(); err != nil {
		return Certificate{}, fmt.Errorf("close private key file: %w", err)
	}
	if err := secureKeyFile(keyPath); err != nil {
		return Certificate{}, err
	}
	if err := writeFileAtomic(certPath, certPEM, 0o644); err != nil {
		return Certificate{}, err
	}
	return loadCertificate(certPath, keyPath)
}

func loadCertificate(certPath, keyPath string) (Certificate, error) {
	certPEM, err := os.ReadFile(certPath)
	if err != nil {
		return Certificate{}, fmt.Errorf("read certificate: %w", err)
	}
	keyPEM, err := os.ReadFile(keyPath)
	if err != nil {
		return Certificate{}, fmt.Errorf("read private key: %w", err)
	}
	pair, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return Certificate{}, fmt.Errorf("parse certificate key pair: %w", err)
	}
	return Certificate{TLS: pair, Fingerprint: sha256.Sum256(pair.Certificate[0])}, nil
}

// waitForCertificate 处理并发首次生成的败者路径：胜者已抢到私钥文件，
// 等待它把证书也写完。超时通常意味着上次生成中途崩溃留下了孤儿私钥。
func waitForCertificate(certPath, keyPath string) (Certificate, error) {
	deadline := time.Now().Add(concurrentCreateWait)
	for {
		cert, err := loadCertificate(certPath, keyPath)
		if err == nil {
			return cert, nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return Certificate{}, err
		}
		if time.Now().After(deadline) {
			return Certificate{}, fmt.Errorf("certificate files are incomplete; delete %s and %s to regenerate the LAN identity (all devices must pair again)", certPath, keyPath)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func generateSelfSigned() (certPEM, keyPEM []byte, err error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, fmt.Errorf("generate private key: %w", err)
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, nil, fmt.Errorf("generate certificate serial: %w", err)
	}
	now := time.Now()
	template := x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: certCommonName},
		NotBefore:             now.Add(-time.Hour),
		NotAfter:              now.AddDate(certValidityYears, 0, 0),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		return nil, nil, fmt.Errorf("create self-signed certificate: %w", err)
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, nil, fmt.Errorf("encode private key: %w", err)
	}
	certPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM = pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})
	return certPEM, keyPEM, nil
}

func writeFileAtomic(path string, data []byte, mode os.FileMode) error {
	temp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".tmp-*")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	tempPath := temp.Name()
	if _, err := temp.Write(data); err != nil {
		_ = temp.Close()
		_ = os.Remove(tempPath)
		return fmt.Errorf("write temp file: %w", err)
	}
	if err := temp.Chmod(mode); err != nil {
		_ = temp.Close()
		_ = os.Remove(tempPath)
		return fmt.Errorf("set temp file mode: %w", err)
	}
	if err := temp.Close(); err != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("close temp file: %w", err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("rename temp file: %w", err)
	}
	return nil
}

// IssuedDevice 是配对成功后签发的设备身份。Token 明文只在此处出现一次，
// 存储侧只保留其 SHA-256 哈希。
type IssuedDevice struct {
	DeviceID string
	Token    string
	Name     string
}

// NewPairingSecret 生成一次性配对 secret：明文只返回给调用方（渲染进 QR），
// 存储侧只保留哈希。TTL 固定 5 分钟（对齐 protocol v1 威胁模型的配对语义）。
func NewPairingSecret(ctx context.Context, db *store.Store) (plaintext string, expiresAt time.Time, err error) {
	secret, err := randomToken()
	if err != nil {
		return "", time.Time{}, err
	}
	now := time.Now()
	expiresAt = now.Add(PairingSecretTTL)
	if err := db.InsertPairingSecret(ctx, hashString(secret), now, expiresAt); err != nil {
		return "", time.Time{}, err
	}
	return secret, expiresAt, nil
}

// CompletePairing 校验并消费 secret，签发设备身份。secret 无效的所有原因
// （不存在/过期/已消费）统一返回 ok=false，不区分，避免形成 oracle。
func CompletePairing(ctx context.Context, db *store.Store, secretPlaintext, deviceName string) (IssuedDevice, bool, error) {
	name := strings.TrimSpace(deviceName)
	if name == "" {
		return IssuedDevice{}, false, fmt.Errorf("device name must not be empty")
	}
	deviceID, err := newDeviceID()
	if err != nil {
		return IssuedDevice{}, false, err
	}
	token, err := randomToken()
	if err != nil {
		return IssuedDevice{}, false, err
	}
	ok, err := db.CompletePairing(ctx, hashString(secretPlaintext), store.PairedDevice{
		DeviceID:  deviceID,
		Name:      name,
		TokenHash: hashString(token),
	}, time.Now())
	if err != nil || !ok {
		return IssuedDevice{}, false, err
	}
	return IssuedDevice{DeviceID: deviceID, Token: token, Name: name}, true, nil
}

// Authenticate 校验 bearer token 并更新设备活跃时间。失败原因
// （token 未知/已撤销/为空）统一返回 ok=false。
func Authenticate(ctx context.Context, db *store.Store, bearerToken string) (deviceID string, ok bool, err error) {
	if bearerToken == "" {
		return "", false, nil
	}
	device, found, err := db.FindPairedDeviceByTokenHash(ctx, hashString(bearerToken))
	if err != nil {
		return "", false, err
	}
	if !found || device.RevokedAtMs != nil {
		return "", false, nil
	}
	if err := db.TouchDeviceLastSeen(ctx, device.DeviceID, time.Now()); err != nil {
		return "", false, err
	}
	return device.DeviceID, true, nil
}

func RevokeDevice(ctx context.Context, db *store.Store, deviceID string) error {
	return db.RevokeDevice(ctx, deviceID, time.Now())
}

func hashString(value string) []byte {
	sum := sha256.Sum256([]byte(value))
	return sum[:]
}

func randomToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate random token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func newDeviceID() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate device ID: %w", err)
	}
	return "dev_" + base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw), nil
}
