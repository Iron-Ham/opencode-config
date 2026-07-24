#!/usr/bin/env bash
set -euo pipefail

# Install the repo-managed OMP profile without replacing unrelated user settings.

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
OMP_BUN_VERSION="1.3.14"
OMP_VERSION="17.1.2"
MISE_BIN="${OMP_MISE_BIN:-$(type -P mise || true)}"
omp_agent_dir_explicit=false
if [ -n "${OMP_AGENT_DIR+x}" ] || [ -n "${PI_CODING_AGENT_DIR+x}" ]; then
  omp_agent_dir_explicit=true
fi
OMP_AGENT_DIR="${OMP_AGENT_DIR:-${PI_CODING_AGENT_DIR:-$HOME/.omp/agent}}"
CONFIG_PATH="${OMP_CONFIG_PATH:-}"
backup_path=""
original_exists=false
transaction_failed=true

if [ ! -x "$MISE_BIN" ]; then
  echo "ERROR  mise is required for OMP setup" >&2
  exit 1
fi

run_omp() {
  "$MISE_BIN" exec "bun@$OMP_BUN_VERSION" -- omp "$@"
}

run_bun() {
  "$MISE_BIN" exec "bun@$OMP_BUN_VERSION" -- bun "$@"
}

ensure_omp() {
  if [ "$(run_omp --version 2>/dev/null || true)" = "omp/$OMP_VERSION" ]; then
    return
  fi

  echo "Installing @oh-my-pi/pi-coding-agent@$OMP_VERSION with Bun $OMP_BUN_VERSION"
  "$MISE_BIN" exec "bun@$OMP_BUN_VERSION" -- bun install --global "@oh-my-pi/pi-coding-agent@$OMP_VERSION"
  if [ "$(run_omp --version 2>/dev/null || true)" != "omp/$OMP_VERSION" ]; then
    echo "ERROR  OMP $OMP_VERSION was not installed" >&2
    exit 1
  fi
}

ensure_omp

if [ -z "$CONFIG_PATH" ] && [ "$omp_agent_dir_explicit" = false ]; then
  discovered_path="$(run_omp config path 2>/dev/null || true)"
  if [[ "$discovered_path" == /* || "$discovered_path" == ~/* ]] &&
    [[ "$discovered_path" != *$'\n'* ]]; then
    discovered_path="${discovered_path/#\~/$HOME}"
    if [ -d "$discovered_path" ]; then
      OMP_AGENT_DIR="$discovered_path"
    else
      CONFIG_PATH="$discovered_path"
      OMP_AGENT_DIR="$(dirname "$CONFIG_PATH")"
    fi
  fi
fi

if [ -z "$CONFIG_PATH" ]; then
  if [ -f "$OMP_AGENT_DIR/config.yml" ]; then
    CONFIG_PATH="$OMP_AGENT_DIR/config.yml"
  elif [ -f "$OMP_AGENT_DIR/config.yaml" ]; then
    CONFIG_PATH="$OMP_AGENT_DIR/config.yaml"
  else
    CONFIG_PATH="$OMP_AGENT_DIR/config.yml"
  fi
fi

case "$CONFIG_PATH" in
  /*) ;;
  *)
    echo "ERROR  OMP config path must be absolute: $CONFIG_PATH" >&2
    exit 1
    ;;
esac

if [ -L "$CONFIG_PATH" ]; then
  echo "ERROR  refusing to replace symlinked OMP config: $CONFIG_PATH" >&2
  exit 1
fi

config_dir="$(dirname "$CONFIG_PATH")"
backup_dir="$config_dir/backups/setup-omp"
if [ ! -d "$config_dir" ]; then
  mkdir -m 700 -p "$config_dir"
fi
if [ ! -d "$backup_dir" ]; then
  mkdir -m 700 -p "$backup_dir"
fi

if [ -e "$CONFIG_PATH" ]; then
  original_exists=true
  backup_path="$backup_dir/$(basename "$CONFIG_PATH").bak.$(date +%Y%m%d%H%M%S)"
  cp -p "$CONFIG_PATH" "$backup_path"
  chmod 600 "$backup_path"
fi

restore_on_failure() {
  local status="$?"
  trap - EXIT
  if [ "$transaction_failed" = true ]; then
    if [ "$original_exists" = true ]; then
      cp -p "$backup_path" "$CONFIG_PATH"
      chmod 600 "$CONFIG_PATH"
    else
      rm -f "$CONFIG_PATH"
    fi
    echo "ROLLBACK OMP setup failed; previous configuration restored" >&2
  fi
  exit "$status"
}
trap restore_on_failure EXIT

run_bun "$REPO_DIR/scripts/merge-omp-config.mjs" \
  "$REPO_DIR/omp/omp.defaults.yml" \
  "$CONFIG_PATH"

PI_CODING_AGENT_DIR="$config_dir" run_omp config get modelRoles >/dev/null

transaction_failed=false
echo "OK     OMP profile installed at $CONFIG_PATH"
echo "       Unmanaged OMP settings were preserved; no credentials were read or written."
