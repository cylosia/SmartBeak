#!/usr/bin/env bash
set -euo pipefail

UV_VERSION="0.6.2"

TMPDIR="${TMPDIR:-/tmp}"
INSTALLER="${TMPDIR}/uv-install-${UV_VERSION}.sh"

download_installer() {
  local url="https://astral.sh/uv/${UV_VERSION}/install.sh"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$INSTALLER"
    return
  fi

  if command -v wget >/dev/null 2>&1; then
    wget -qO "$INSTALLER" "$url"
    return
  fi

  echo "Error: curl or wget is required to install uv." >&2
  exit 1
}

install_uv() {
  download_installer
  sh "$INSTALLER"
  rm -f "$INSTALLER"
}

if ! command -v uv >/dev/null 2>&1; then
  install_uv
fi

UV_BIN="uv"

if ! command -v "$UV_BIN" >/dev/null 2>&1; then
  echo "Error: uv not found after installation." >&2
  exit 1
fi

"$UV_BIN" tool install --python 3.13 kimi-cli
