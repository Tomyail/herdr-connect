#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
MOBILE_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
REPO_DIR="$(CDPATH= cd -- "${MOBILE_DIR}/../.." && pwd)"
ANDROID_DIR="${MOBILE_DIR}/android"
SIGNING_SCRIPT="${SCRIPT_DIR}/android-release-signing.gradle"
DIST_DIR="${ANDROID_DIST_DIR:-${REPO_DIR}/dist/android}"
ARTIFACT_BASENAME="${ANDROID_ARTIFACT_BASENAME:-herdr-connect-android}"

fail() {
  printf '错误：%s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "缺少命令：$1"
}

require_environment() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    fail "缺少环境变量：${name}"
  fi
}

normalize_sha256() {
  printf '%s' "$1" | tr '[:lower:]' '[:upper:]' | tr -d ':[:space:]'
}

find_apksigner() {
  if command -v apksigner >/dev/null 2>&1; then
    command -v apksigner
    return
  fi

  local sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
  [[ -n "${sdk_root}" ]] || return 1
  find "${sdk_root}/build-tools" -type f -name apksigner 2>/dev/null | sort | tail -n 1
}

require_command pnpm
require_command java
require_command keytool
require_command openssl
require_command jarsigner
require_command git

require_environment ANDROID_KEYSTORE_PATH
require_environment ANDROID_KEYSTORE_PASSWORD
require_environment ANDROID_KEY_ALIAS
require_environment ANDROID_KEY_PASSWORD
require_environment ANDROID_SIGNING_CERT_SHA256

[[ -f "${ANDROID_KEYSTORE_PATH}" ]] || fail "ANDROID_KEYSTORE_PATH 指向的文件不存在"
[[ -s "${ANDROID_KEYSTORE_PATH}" ]] || fail "release keystore 为空文件"
[[ -f "${SIGNING_SCRIPT}" ]] || fail "缺少签名配置：${SIGNING_SCRIPT}"
[[ "${ARTIFACT_BASENAME}" =~ ^[A-Za-z0-9._-]+$ ]] || fail "ANDROID_ARTIFACT_BASENAME 只能包含字母、数字、点、下划线和连字符"

case "${ANDROID_KEYSTORE_PATH}" in
  "${REPO_DIR}"/*)
    keystore_relative_path="${ANDROID_KEYSTORE_PATH#"${REPO_DIR}"/}"
    if git -C "${REPO_DIR}" ls-files --error-unmatch -- "${keystore_relative_path}" >/dev/null 2>&1; then
      fail "release keystore 已被 Git 跟踪，拒绝继续构建"
    fi
    ;;
esac

export LC_ALL=C
certificate_pem="$({
  keytool -exportcert \
    -rfc \
    -keystore "${ANDROID_KEYSTORE_PATH}" \
    -alias "${ANDROID_KEY_ALIAS}" \
    -storepass:env ANDROID_KEYSTORE_PASSWORD
} 2>/dev/null)" || fail "无法从 keystore 读取指定 alias，请检查签名配置"

actual_certificate_sha256="$(
  printf '%s\n' "${certificate_pem}" |
    openssl x509 -noout -fingerprint -sha256 |
    sed 's/^.*=//'
)"
expected_certificate_sha256="$(normalize_sha256 "${ANDROID_SIGNING_CERT_SHA256}")"
actual_certificate_sha256="$(normalize_sha256 "${actual_certificate_sha256}")"

[[ -n "${actual_certificate_sha256}" ]] || fail "无法计算 release 证书 SHA-256 指纹"
[[ "${actual_certificate_sha256}" == "${expected_certificate_sha256}" ]] || fail "release 证书指纹与 ANDROID_SIGNING_CERT_SHA256 不一致"

printf '正在生成 Android 原生工程……\n'
(
  cd "${MOBILE_DIR}"
  pnpm exec expo prebuild --platform android --clean --no-install
)

APP_BUILD_GRADLE="${ANDROID_DIR}/app/build.gradle"
[[ -f "${APP_BUILD_GRADLE}" ]] || fail "Expo prebuild 未生成 android/app/build.gradle"
[[ -x "${ANDROID_DIR}/gradlew" ]] || chmod +x "${ANDROID_DIR}/gradlew"

SIGNING_MARKER='Herdr Connect release signing'
if ! grep -Fq "${SIGNING_MARKER}" "${APP_BUILD_GRADLE}"; then
  printf '\n// %s\napply from: file("${rootDir}/../scripts/android-release-signing.gradle")\n' \
    "${SIGNING_MARKER}" >>"${APP_BUILD_GRADLE}"
fi

printf '正在构建签名 APK 和 AAB……\n'
(
  cd "${ANDROID_DIR}"
  ./gradlew --no-daemon --stacktrace :app:assembleRelease :app:bundleRelease
)

APK_PATH="$(find "${ANDROID_DIR}/app/build/outputs/apk/release" -maxdepth 1 -type f -name '*.apk' ! -name '*unsigned*' -print -quit)"
AAB_PATH="$(find "${ANDROID_DIR}/app/build/outputs/bundle/release" -maxdepth 1 -type f -name '*.aab' -print -quit)"
[[ -n "${APK_PATH}" && -s "${APK_PATH}" ]] || fail "没有找到已签名 release APK"
[[ -n "${AAB_PATH}" && -s "${AAB_PATH}" ]] || fail "没有找到 release AAB"

APKSIGNER="$(find_apksigner)" || fail "找不到 apksigner；请安装 Android SDK Build Tools"
apk_verification="$(${APKSIGNER} verify --verbose --print-certs "${APK_PATH}")" || fail "APK 签名验证失败"
printf '%s\n' "${apk_verification}" | grep -qi 'Android Debug' && fail "APK 使用了 Android Debug 证书，拒绝发布"

apk_certificate_sha256="$(
  printf '%s\n' "${apk_verification}" |
    sed -n 's/^Signer #1 certificate SHA-256 digest: //p' |
    head -n 1
)"
apk_certificate_sha256="$(normalize_sha256 "${apk_certificate_sha256}")"
[[ "${apk_certificate_sha256}" == "${expected_certificate_sha256}" ]] || fail "APK 实际签名证书与期望指纹不一致"

jarsigner -verify -strict "${AAB_PATH}" >/dev/null 2>&1 || fail "AAB 签名验证失败"

rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"
APK_OUTPUT="${DIST_DIR}/${ARTIFACT_BASENAME}.apk"
AAB_OUTPUT="${DIST_DIR}/${ARTIFACT_BASENAME}.aab"
cp "${APK_PATH}" "${APK_OUTPUT}"
cp "${AAB_PATH}" "${AAB_OUTPUT}"

if command -v sha256sum >/dev/null 2>&1; then
  (
    cd "${DIST_DIR}"
    sha256sum "$(basename "${APK_OUTPUT}")" "$(basename "${AAB_OUTPUT}")" >SHA256SUMS
  )
else
  (
    cd "${DIST_DIR}"
    shasum -a 256 "$(basename "${APK_OUTPUT}")" "$(basename "${AAB_OUTPUT}")" >SHA256SUMS
  )
fi

printf 'Android release 产物已生成：\n'
printf '  %s\n' "${APK_OUTPUT}" "${AAB_OUTPUT}" "${DIST_DIR}/SHA256SUMS"
