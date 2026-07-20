#!/usr/bin/env bash
set -euo pipefail

# OpenCode config setup script.
# Links repo-managed rules, agents, and commands while merging mutable config.

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
OPENCODE_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
RETIRED_OPENCODE_AGENT_NAMES=(
  backend_architect
  evidence_collector
  frontend_developer
  git_workflow_master
  sol_reviewer
  technical_writer
)
RETIRED_OPENCODE_COMMAND_NAMES=(
  luna
  sol
  sonnet
  terra
)
preflight_dir=""
transaction_snapshot_dir=""
transaction_active=false
transaction_committed=false
notion_cli_enabled=true

for arg in "$@"; do
  case "$arg" in
    --skip-notion-cli)
      notion_cli_enabled=false
      ;;
    *)
      echo "Usage: $0 [--skip-notion-cli]" >&2
      exit 2
      ;;
  esac
done

for command in python3 bun opencode; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "ERROR  $command is required for OpenCode setup" >&2
    exit 1
  fi
done

normalize_path() {
  python3 -c 'import os, sys; print(os.path.realpath(os.path.abspath(os.path.expanduser(sys.argv[1]))))' "$1"
}

normalized_home="$(normalize_path "$HOME")"
OPENCODE_DIR="$(normalize_path "$OPENCODE_DIR")"
TRANSACTION_TMP_ROOT="$(normalize_path "${OPENCODE_SETUP_TMPDIR:-${TMPDIR:-/tmp}}")"

assert_safe_tree() {
  local tree="$1"
  local label="$2"
  if [ -z "$tree" ] || [ "$tree" = "/" ] || [ "$tree" = "$normalized_home" ]; then
    echo "ERROR  unsafe $label path: $tree" >&2
    exit 1
  fi
}

assert_safe_tree "$OPENCODE_DIR" "OpenCode configuration"
if [ "$TRANSACTION_TMP_ROOT" = "$OPENCODE_DIR" ] || \
  [[ "$TRANSACTION_TMP_ROOT/" == "$OPENCODE_DIR/"* ]]; then
  echo "ERROR  OpenCode setup temporary storage must be outside active configuration trees" >&2
  exit 1
fi

OPENCODE_AGENTS_DIR="$OPENCODE_DIR/agents"
OPENCODE_COMMANDS_DIR="$OPENCODE_DIR/commands"
OPENCODE_PLUGINS_DIR="$OPENCODE_DIR/plugins"
OPENCODE_TUI_DIR="$OPENCODE_DIR/tui"
OPENCODE_SKILLS_DIR="$OPENCODE_DIR/skills"
OPENCODE_BACKUP_DIR="$OPENCODE_DIR/backups/setup-opencode"

tree_exists() {
  [ -e "$1" ] || [ -L "$1" ]
}

snapshot_tree() {
  local tree="$1"
  local name="$2"

  if tree_exists "$tree"; then
    printf 'present\n' > "$transaction_snapshot_dir/$name.state"
    if ! cp -c -a "$tree" "$transaction_snapshot_dir/$name" 2>/dev/null; then
      cp -a "$tree" "$transaction_snapshot_dir/$name"
    fi
  else
    printf 'absent\n' > "$transaction_snapshot_dir/$name.state"
  fi
}

restore_tree() {
  local tree="$1"
  local name="$2"
  local state
  state="$(<"$transaction_snapshot_dir/$name.state")"

  rm -rf "$tree"
  if [ "$state" = "present" ]; then
    mkdir -p "$(dirname "$tree")"
    cp -a "$transaction_snapshot_dir/$name" "$tree"
  fi
}

begin_transaction() {
  transaction_snapshot_dir="$(mktemp -d "$TRANSACTION_TMP_ROOT/opencode-config-transaction.XXXXXX")"
  chmod 700 "$transaction_snapshot_dir"
  snapshot_tree "$OPENCODE_DIR" opencode
  transaction_active=true
}

commit_transaction() {
  local snapshot="$transaction_snapshot_dir"
  if ! rm -rf "$snapshot"; then
    echo "WARN   validated OpenCode setup left transaction snapshot at $snapshot" >&2
  fi
  transaction_snapshot_dir=""
  transaction_committed=true
  transaction_active=false
}

on_exit() {
  local status="$?"
  local rollback_status=0
  trap - EXIT
  set +e

  if [ "$transaction_active" = true ] && [ "$transaction_committed" != true ]; then
    echo "ROLLBACK OpenCode setup failed; restoring the previous configuration" >&2
    restore_tree "$OPENCODE_DIR" opencode || rollback_status=1
    if [ "$rollback_status" -ne 0 ]; then
      echo "ERROR  OpenCode setup rollback could not restore every active tree" >&2
      echo "KEEP   recovery snapshot at $transaction_snapshot_dir" >&2
      status=1
    fi
  fi

  if [ -n "$preflight_dir" ]; then
    rm -rf "$preflight_dir"
  fi
  if [ -n "$transaction_snapshot_dir" ] && [ "$rollback_status" -eq 0 ]; then
    rm -rf "$transaction_snapshot_dir"
  fi
  exit "$status"
}

trap on_exit EXIT

backup_timestamp() {
  date +%Y%m%d%H%M%S
}

backup_item() {
  local dest="$1"
  mkdir -p "$OPENCODE_BACKUP_DIR"
  local parent
  parent="$(basename "$(dirname "$dest")")"
  local backup
  backup="$OPENCODE_BACKUP_DIR/$parent-$(basename "$dest").bak.$(backup_timestamp)"
  echo "BACKUP $dest -> $backup"
  mv "$dest" "$backup"
}

link_item() {
  local src="$1"
  local dest="$2"
  local label="$3"

  if [ ! -e "$src" ]; then
    echo "SKIP   $label (not in repo)"
    return
  fi

  mkdir -p "$(dirname "$dest")"

  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    backup_item "$dest"
  fi

  if [ -L "$dest" ]; then
    local current
    current="$(readlink "$dest")"
    if [ "$current" = "$src" ]; then
      echo "OK     $label (already linked)"
      return
    fi
    backup_item "$dest"
  fi

  ln -s "$src" "$dest"
  echo "LINK   $dest -> $src"
}

copy_item() {
  local src="$1"
  local dest="$2"
  local label="$3"

  if [ ! -e "$src" ]; then
    echo "SKIP   $label (not in repo)"
    return
  fi

  mkdir -p "$(dirname "$dest")"

  if [ -d "$src" ]; then
    if [ -L "$dest" ] || { [ -e "$dest" ] && ! [ -d "$dest" ]; }; then
      backup_item "$dest"
    elif [ -d "$dest" ]; then
      if diff -qr "$src" "$dest" >/dev/null; then
        echo "OK     $label (already current)"
        return
      fi
      backup_item "$dest"
    fi
    cp -R "$src" "$dest"
    echo "COPY   $dest <- $src"
    return
  fi

  if [ -L "$dest" ] || { [ -e "$dest" ] && ! cmp -s "$src" "$dest"; }; then
    backup_item "$dest"
  elif [ -f "$dest" ]; then
    echo "OK     $label (already current)"
    return
  fi

  cp "$src" "$dest"
  echo "COPY   $dest <- $src"
}

retire_repo_agent_link() {
  local name="$1"
  local dest="$OPENCODE_AGENTS_DIR/$name.md"
  local retired_target="$REPO_DIR/opencode/agents/$name.md"

  if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$retired_target" ]; then
    rm "$dest"
    echo "UNLINK $dest (retired repo-managed agent)"
  fi
}

retire_repo_command_link() {
  local name="$1"
  local dest="$OPENCODE_COMMANDS_DIR/$name.md"
  local retired_target="$REPO_DIR/opencode/commands/$name.md"

  if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$retired_target" ]; then
    rm "$dest"
    echo "UNLINK $dest (retired repo-managed command)"
  fi
}

has_usable_notion_cli() {
  local notion_path
  notion_path="$(command -v notion 2>/dev/null || true)"
  [ -n "$notion_path" ] || return 1

  case "$notion_path" in
    */mise/shims/notion)
      return 1
      ;;
  esac

  [ -x "$notion_path" ]
}

notion_cli_available=false
if [ "$notion_cli_enabled" = true ] && has_usable_notion_cli; then
  notion_cli_available=true
fi

advisor_enabled="$(
  OPENCODE_ROUTING_PATH="$OPENCODE_DIR/model-routing.config.local.json" bun -e '
    const fs = require("node:fs")
    const file = process.env.OPENCODE_ROUTING_PATH
    const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {}
    process.stdout.write(String(config.advisor_enabled ?? false))
  '
)"

if [ "$notion_cli_available" != true ] && ! {
  [ -e "$OPENCODE_DIR/skills/mobile-review-pr/SKILL.md" ] && \
    [ -e "$OPENCODE_DIR/skills/mobile-ios-tma-module/SKILL.md" ] && \
    [ -e "$OPENCODE_DIR/skills/honeycomb/SKILL.md" ] && \
    [ -e "$OPENCODE_DIR/skills/tuist-generated-projects/SKILL.md" ];
}; then
  echo "ERROR  Notion OpenCode plugins are missing and the notion CLI is unavailable" >&2
  exit 1
fi

python3 "$REPO_DIR/scripts/generate-opencode-agents.py" --check
bun "$REPO_DIR/scripts/test-opencode-workflow-plugin.mjs"
bun "$REPO_DIR/scripts/test-opencode-policy-resolver.mjs"
bun "$REPO_DIR/scripts/resolve-opencode-policy.mjs" \
  "$REPO_DIR" "$OPENCODE_DIR" --validate
bun "$REPO_DIR/scripts/merge-opencode-config.mjs" \
  "$REPO_DIR" "$OPENCODE_DIR" --check --validate-model-routing
bun "$REPO_DIR/scripts/normalize-opencode-notion-assets.mjs" \
  "$OPENCODE_DIR" --check-refresh

preflight_dir="$(mktemp -d "$TRANSACTION_TMP_ROOT/opencode-config-preflight.XXXXXX")"
mkdir -p "$preflight_dir/plugins" "$preflight_dir/agents" "$preflight_dir/commands" "$preflight_dir/tui"
for relative_path in \
  opencode.json \
  opencode.jsonc \
  tui.json \
  package.json \
  model-routing.config.local.json; do
  if [ -f "$OPENCODE_DIR/$relative_path" ]; then
    cp "$OPENCODE_DIR/$relative_path" "$preflight_dir/$relative_path"
  fi
done
cp -R "$REPO_DIR/opencode/agents/." "$preflight_dir/agents/"
cp -R "$REPO_DIR/opencode/commands/." "$preflight_dir/commands/"
cp -R "$REPO_DIR/opencode/plugins/." "$preflight_dir/plugins/"
cp -R "$REPO_DIR/opencode/tui/." "$preflight_dir/tui/"
if [ "$advisor_enabled" != "true" ]; then
  rm "$preflight_dir/commands/advise.md"
fi
bun "$REPO_DIR/scripts/merge-opencode-config.mjs" "$REPO_DIR" "$preflight_dir" >/dev/null
bun "$REPO_DIR/scripts/validate-opencode-agents.mjs" "$REPO_DIR" "$preflight_dir"
bun "$REPO_DIR/scripts/validate-opencode-install.mjs" "$REPO_DIR" "$preflight_dir"
rm -R "$preflight_dir"
preflight_dir=""

begin_transaction

bun "$REPO_DIR/scripts/normalize-opencode-notion-assets.mjs" \
  "$OPENCODE_DIR" --retire-obsolete

mkdir -p "$OPENCODE_DIR" "$OPENCODE_AGENTS_DIR" "$OPENCODE_COMMANDS_DIR" "$OPENCODE_PLUGINS_DIR" "$OPENCODE_TUI_DIR" "$OPENCODE_SKILLS_DIR"
chmod 700 "$OPENCODE_DIR"

link_item "$REPO_DIR/AGENTS.md" "$OPENCODE_DIR/AGENTS.md" "AGENTS.md"

for name in "${RETIRED_OPENCODE_AGENT_NAMES[@]}"; do
  retire_repo_agent_link "$name"
done

for name in "${RETIRED_OPENCODE_COMMAND_NAMES[@]}"; do
  retire_repo_command_link "$name"
done

for src in "$REPO_DIR"/opencode/agents/*.md; do
  [ -e "$src" ] || continue
  name="$(basename "$src")"
  link_item "$src" "$OPENCODE_AGENTS_DIR/$name" "OpenCode agent $name"
done

for src in "$REPO_DIR"/skills/*; do
  [ -d "$src" ] || continue
  [ -f "$src/SKILL.md" ] || continue
  name="$(basename "$src")"
  dest="$OPENCODE_SKILLS_DIR/$name"
  link_item "$src" "$dest" "shared skill $name"
done

for dest in "$OPENCODE_SKILLS_DIR"/*; do
  [ -L "$dest" ] || continue
  current="$(readlink "$dest")"
  case "$current" in
    "$REPO_DIR"/codex/skills/*)
      backup_item "$dest"
      echo "RETIRE $dest (retired generated skill)"
      ;;
  esac
done

for src in "$REPO_DIR"/opencode/commands/*.md; do
  [ -e "$src" ] || continue
  name="$(basename "$src")"
  if [ "$name" = "advise.md" ] && [ "$advisor_enabled" != "true" ]; then
    dest="$OPENCODE_COMMANDS_DIR/$name"
    if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$src" ]; then
      rm "$dest"
      echo "UNLINK $dest (advisor lane disabled)"
    fi
    continue
  fi
  link_item "$src" "$OPENCODE_COMMANDS_DIR/$name" "OpenCode command $name"
done

for src in "$REPO_DIR"/opencode/plugins/*; do
  [ -e "$src" ] || continue
  name="$(basename "$src")"
  copy_item "$src" "$OPENCODE_PLUGINS_DIR/$name" "OpenCode plugin $name"
done

for src in "$REPO_DIR"/opencode/tui/*; do
  [ -e "$src" ] || continue
  name="$(basename "$src")"
  copy_item "$src" "$OPENCODE_TUI_DIR/$name" "OpenCode TUI support $name"
done

if [ "$notion_cli_available" = true ]; then
  bun "$REPO_DIR/scripts/normalize-opencode-notion-assets.mjs" \
    "$OPENCODE_DIR" --prepare-refresh
  notion ai plugins add --agent opencode --strict \
    mobile mobile-ios observability tuist
  bun "$REPO_DIR/scripts/normalize-opencode-notion-assets.mjs" "$OPENCODE_DIR"
elif [ -e "$OPENCODE_DIR/skills/mobile-review-pr/SKILL.md" ] && \
  [ -e "$OPENCODE_DIR/skills/mobile-ios-tma-module/SKILL.md" ] && \
  [ -e "$OPENCODE_DIR/skills/honeycomb/SKILL.md" ] && \
  [ -e "$OPENCODE_DIR/skills/tuist-generated-projects/SKILL.md" ]; then
  echo "WARN   Notion OpenCode plugins could not be refreshed (the notion CLI is unavailable)" >&2
else
  echo "ERROR  Notion OpenCode plugins are missing and the notion CLI is unavailable" >&2
  exit 1
fi
if [ "$notion_cli_available" != true ]; then
  bun "$REPO_DIR/scripts/normalize-opencode-notion-assets.mjs" "$OPENCODE_DIR"
fi
bun "$REPO_DIR/scripts/normalize-opencode-notion-assets.mjs" \
  "$OPENCODE_DIR" --retire-unsupported-agents

bun "$REPO_DIR/scripts/merge-opencode-config.mjs" \
  "$REPO_DIR" "$OPENCODE_DIR" --validate-model-routing

bun "$REPO_DIR/scripts/validate-opencode-agents.mjs" \
  "$REPO_DIR" "$OPENCODE_DIR"

bun "$REPO_DIR/scripts/validate-opencode-install.mjs" \
  "$REPO_DIR" "$OPENCODE_DIR" --require-installed-assets

if [ "$notion_cli_available" = true ]; then
  bun "$REPO_DIR/scripts/normalize-opencode-notion-assets.mjs" \
    "$OPENCODE_DIR" --commit-refresh
fi

commit_transaction

echo ""
echo "Done. OpenCode rules, agents, commands, plugins, and managed defaults are installed."
echo "Unmanaged provider, MCP, plugin, agent, and permission entries were preserved."
echo "Repo-managed global skills are linked directly; project-local name collisions may still require alignment."
echo "Restart running OpenCode sessions to load configuration-time changes."
