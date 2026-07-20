package demolan

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/Tomyail/herdr-connect/internal/lanauth"
	"github.com/Tomyail/herdr-connect/internal/store"
)

const (
	PairPath          = "/v1/pair"
	maxPairingBody    = 4096
	maxDeviceNameSize = 100
)

type PairRequest struct {
	DeviceName string `json:"device_name"`
	Secret     string `json:"secret"`
}

type PairResponse struct {
	DemoVersion int    `json:"demo_version"`
	DeviceID    string `json:"device_id"`
	Token       string `json:"token"`
	DeviceName  string `json:"device_name"`
	Fingerprint string `json:"fingerprint"`
}

// secureHandler 是 TLS 监听器背后的组合层：/v1/pair 免 bearer（凭一次性 secret），
// 其余全部端点要求已配对设备的 bearer token。现有 agents handler 保持不变。
func secureHandler(agents http.Handler, database *store.Store, cert lanauth.Certificate) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path == PairPath {
			setCommonHeaders(response)
			handlePair(response, request, database, cert)
			return
		}
		deviceID, ok, err := authenticateRequest(request, database)
		if err != nil {
			setCommonHeaders(response)
			writeError(response, http.StatusInternalServerError, "auth_failed", "authentication check failed")
			return
		}
		if !ok {
			// 失败原因（缺失/未知/已撤销）统一 401，不区分，避免形成探测 oracle。
			setCommonHeaders(response)
			writeError(response, http.StatusUnauthorized, "unauthorized", "missing, unknown, or revoked bearer token")
			return
		}
		_ = deviceID
		agents.ServeHTTP(response, request)
	})
}

func handlePair(response http.ResponseWriter, request *http.Request, database *store.Store, cert lanauth.Certificate) {
	if request.Method != http.MethodPost {
		response.Header().Set("Allow", http.MethodPost)
		writeError(response, http.StatusMethodNotAllowed, "method_not_allowed", "pairing endpoint only accepts POST")
		return
	}
	request.Body = http.MaxBytesReader(response, request.Body, maxPairingBody)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	var pairRequest PairRequest
	if err := decoder.Decode(&pairRequest); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_pairing_request", "pairing request must be JSON with device_name and secret")
		return
	}
	name := strings.TrimSpace(pairRequest.DeviceName)
	if name == "" || len(name) > maxDeviceNameSize || strings.TrimSpace(pairRequest.Secret) == "" {
		writeError(response, http.StatusBadRequest, "invalid_pairing_request", "device_name must be 1 to 100 characters and secret must not be empty")
		return
	}
	device, ok, err := lanauth.CompletePairing(request.Context(), database, pairRequest.Secret, name)
	if err != nil {
		writeError(response, http.StatusInternalServerError, "pairing_failed", "pairing could not be completed")
		return
	}
	if !ok {
		// 不存在/过期/已使用统一同一错误码，避免向未认证调用方泄露 secret 状态。
		writeError(response, http.StatusBadRequest, "pairing_secret_invalid", "pairing secret is invalid, expired, or already used")
		return
	}
	writeJSON(response, http.StatusOK, PairResponse{
		DemoVersion: DemoVersion,
		DeviceID:    device.DeviceID,
		Token:       device.Token,
		DeviceName:  device.Name,
		Fingerprint: cert.FingerprintBase64(),
	})
}

func authenticateRequest(request *http.Request, database *store.Store) (string, bool, error) {
	token, found := strings.CutPrefix(request.Header.Get("Authorization"), "Bearer ")
	if !found {
		return "", false, nil
	}
	return lanauth.Authenticate(request.Context(), database, strings.TrimSpace(token))
}
