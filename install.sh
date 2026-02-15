#!/usr/bin/env bash
# Installs the `uv` Python package manager and then installs `kimi-cli`,
# a developer tool used for content generation workflows.
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

verify_installer() {
  # Verify the downloaded installer has not been tampered with.
  # Update this hash when bumping UV_VERSION.
  # Generate with: curl -fsSL "https://astral.sh/uv/${UV_VERSION}/install.sh" | sha256sum
  local expected_sha="VERIFY_AND_SET_HASH_WHEN_BUMPING_UV_VERSION"

  if command -v sha256sum >/dev/null 2>&1; then
    local actual_sha
    actual_sha=$(sha256sum "$INSTALLER" | awk '{print $1}')
    if [ "$expected_sha" = "VERIFY_AND_SET_HASH_WHEN_BUMPING_UV_VERSION" ]; then
      echo "Error: installer checksum not pinned — set expected_sha in install.sh" >&2
      echo "Generate it with: curl -fsSL \"https://astral.sh/uv/${UV_VERSION}/install.sh\" | sha256sum" >&2
      rm -f "$INSTALLER"
      exit 1
    elif [ "$actual_sha" != "$expected_sha" ]; then
      echo "Error: installer checksum mismatch (expected ${expected_sha}, got ${actual_sha})" >&2
      rm -f "$INSTALLER"
      exit 1
    fi
  else
    echo "Error: sha256sum is required for installer integrity verification." >&2
    rm -f "$INSTALLER"
    exit 1
  fi
}

install_uv() {
  download_installer
  verify_installer
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
