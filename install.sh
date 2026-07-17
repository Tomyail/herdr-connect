#!/bin/sh

set -eu

DEFAULT_VERSION="v0.1.0-preview.2"
DEFAULT_REPOSITORY="Tomyail/herdr-connect"

say() {
  printf '%s\n' "$*"
}

fail() {
  printf 'herdr-connect installer: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

normalize_os() {
  case "$1" in
    Darwin | darwin) printf '%s\n' "darwin" ;;
    Linux | linux) printf '%s\n' "linux" ;;
    *) fail "unsupported operating system: $1 (Windows users should download the release zip)" ;;
  esac
}

normalize_arch() {
  case "$1" in
    arm64 | aarch64) printf '%s\n' "arm64" ;;
    x86_64 | amd64) printf '%s\n' "amd64" ;;
    *) fail "unsupported CPU architecture: $1" ;;
  esac
}

checksum_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    fail "sha256sum or shasum is required to verify the download"
  fi
}

version="${HERDR_CONNECT_VERSION:-$DEFAULT_VERSION}"
case "$version" in
  v*) ;;
  *) version="v$version" ;;
esac

repository="${HERDR_CONNECT_REPOSITORY:-$DEFAULT_REPOSITORY}"
install_dir="${HERDR_CONNECT_INSTALL_DIR:-${HOME:?HOME is required}/.local/bin}"
os="$(normalize_os "${HERDR_CONNECT_OS:-$(uname -s)}")"
arch="$(normalize_arch "${HERDR_CONNECT_ARCH:-$(uname -m)}")"
release_version="${version#v}"
archive_name="herdr-connect_${release_version}_${os}_${arch}"
asset_name="${archive_name}.tar.gz"
release_base_url="${HERDR_CONNECT_DOWNLOAD_BASE_URL:-https://github.com/${repository}/releases/download/${version}}"

require_command curl
require_command tar
require_command awk
require_command mktemp

temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/herdr-connect-install.XXXXXX")"
cleanup() {
  rm -rf "$temp_dir"
}
trap cleanup EXIT HUP INT TERM

say "Downloading Herdr Connect ${version} for ${os}/${arch}..."
curl -fsSL --retry 3 --proto '=https' --tlsv1.2 \
  -o "$temp_dir/$asset_name" "$release_base_url/$asset_name"
curl -fsSL --retry 3 --proto '=https' --tlsv1.2 \
  -o "$temp_dir/SHA256SUMS" "$release_base_url/SHA256SUMS"

expected_checksum="$(awk -v asset="$asset_name" '$2 == asset || $2 == "./" asset { print $1; exit }' "$temp_dir/SHA256SUMS")"
case "$expected_checksum" in
  "" | *[!0-9a-fA-F]*) fail "release checksum not found for $asset_name" ;;
esac
[ "${#expected_checksum}" -eq 64 ] || fail "invalid release checksum for $asset_name"

actual_checksum="$(checksum_file "$temp_dir/$asset_name")"
[ "$actual_checksum" = "$expected_checksum" ] || fail "checksum verification failed for $asset_name"

tar -xzf "$temp_dir/$asset_name" -C "$temp_dir"
binary_path="$temp_dir/$archive_name/herdr-connect"
[ -f "$binary_path" ] || fail "downloaded archive does not contain herdr-connect"

mkdir -p "$install_dir"
if command -v install >/dev/null 2>&1; then
  install -m 0755 "$binary_path" "$install_dir/herdr-connect"
else
  cp "$binary_path" "$install_dir/herdr-connect"
  chmod 0755 "$install_dir/herdr-connect"
fi

say "Installed Herdr Connect ${version} to $install_dir/herdr-connect"
case ":${PATH:-}:" in
  *":$install_dir:"*) ;;
  *) say "Add $install_dir to PATH, or run the binary by its full path." ;;
esac
say ""
say "Next:"
say "  1. Check readiness:"
say "     $install_dir/herdr-connect doctor"
say "  2. Install and start the background service:"
say "     $install_dir/herdr-connect service install"
say "  3. Check service health:"
say "     $install_dir/herdr-connect service status"

service_config="${HERDR_CONNECT_SERVICE_CONFIG:-}"
if [ -z "$service_config" ]; then
  case "$os" in
    darwin) service_config="${HOME:?HOME is required}/Library/LaunchAgents/com.tomyail.herdr-connect.plist" ;;
    linux) service_config="${HOME:?HOME is required}/.config/systemd/user/herdr-connect.service" ;;
  esac
fi
if [ -f "$service_config" ]; then
  say ""
  say "An existing service was detected. Restart it to use the new binary:"
  say "  $install_dir/herdr-connect service restart"
fi
