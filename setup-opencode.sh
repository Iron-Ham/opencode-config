#!/usr/bin/env bash
set -euo pipefail

# OpenCode config setup script.
# Links repo-managed rules, agents, and commands while merging mutable config.

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
OPENCODE_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
OPENCODE_AGENTS_DIR="$OPENCODE_DIR/agents"
OPENCODE_COMMANDS_DIR="$OPENCODE_DIR/commands"
OPENCODE_SKILLS_DIR="$OPENCODE_DIR/skills"
OPENCODE_BACKUP_DIR="$OPENCODE_DIR/backups/setup-opencode"
LEGACY_SHARED_SKILLS_DIR="$HOME/.agents/skills"

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

for command in python3 bun opencode; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "ERROR  $command is required for OpenCode setup" >&2
    exit 1
  fi
done

if ! command -v notion >/dev/null 2>&1 && ! {
  [ -e "$OPENCODE_DIR/plugins/advisor.ts" ] && \
    [ -e "$OPENCODE_DIR/skills/mobile-review-pr/SKILL.md" ] && \
    [ -e "$OPENCODE_DIR/skills/mobile-ios-tma-module/SKILL.md" ] && \
    [ -e "$OPENCODE_DIR/skills/honeycomb/SKILL.md" ] && \
    [ -e "$OPENCODE_DIR/skills/tuist-generated-projects/SKILL.md" ];
}; then
  echo "ERROR  Notion OpenCode plugins are missing and the notion CLI is unavailable" >&2
  exit 1
fi

python3 "$REPO_DIR/scripts/generate-opencode-agents.py" --check
bun "$REPO_DIR/scripts/merge-opencode-config.mjs" "$REPO_DIR" "$OPENCODE_DIR" --check
bun "$REPO_DIR/scripts/normalize-opencode-notion-assets.mjs" \
  "$OPENCODE_DIR" --check-refresh

preflight_dir="$(mktemp -d "${TMPDIR:-/tmp}/opencode-config-preflight.XXXXXX")"
trap 'rm -R "$preflight_dir"' EXIT
mkdir -p "$preflight_dir/plugins" "$preflight_dir/agents" "$preflight_dir/commands"
for relative_path in \
  opencode.json \
  opencode.jsonc \
  tui.json \
  package.json \
  plugins/advisor.config.local.json; do
  if [ -f "$OPENCODE_DIR/$relative_path" ]; then
    cp "$OPENCODE_DIR/$relative_path" "$preflight_dir/$relative_path"
  fi
done
cp -R "$REPO_DIR/opencode/agents/." "$preflight_dir/agents/"
cp -R "$REPO_DIR/opencode/commands/." "$preflight_dir/commands/"
bun "$REPO_DIR/scripts/merge-opencode-config.mjs" "$REPO_DIR" "$preflight_dir" >/dev/null
bun "$REPO_DIR/scripts/validate-opencode-agents.mjs" "$REPO_DIR" "$preflight_dir"
rm -R "$preflight_dir"
trap - EXIT

plugin_sdk_required="$(bun -e 'const file = await Bun.file(process.argv[1]).json(); process.stdout.write(file.dependencies["@opencode-ai/plugin"]);' "$REPO_DIR/opencode/package.defaults.json")"
plugin_sdk_installed=""
if [ -f "$OPENCODE_DIR/node_modules/@opencode-ai/plugin/package.json" ]; then
  plugin_sdk_installed="$(bun -e 'const file = await Bun.file(process.argv[1]).json(); process.stdout.write(file.version);' "$OPENCODE_DIR/node_modules/@opencode-ai/plugin/package.json")"
fi
if [ "$plugin_sdk_installed" != "$plugin_sdk_required" ] && ! command -v npm >/dev/null 2>&1; then
  echo "ERROR  OpenCode plugin SDK $plugin_sdk_required needs installation and npm is unavailable" >&2
  exit 1
fi

mkdir -p "$OPENCODE_DIR" "$OPENCODE_AGENTS_DIR" "$OPENCODE_COMMANDS_DIR" "$OPENCODE_SKILLS_DIR" "$LEGACY_SHARED_SKILLS_DIR"
chmod 700 "$OPENCODE_DIR"

link_item "$REPO_DIR/AGENTS.md" "$OPENCODE_DIR/AGENTS.md" "AGENTS.md"

for src in "$REPO_DIR"/opencode/agents/*.md; do
  [ -e "$src" ] || continue
  name="$(basename "$src")"
  link_item "$src" "$OPENCODE_AGENTS_DIR/$name" "OpenCode agent $name"
done

SKILLS_SOURCE_DIR="$REPO_DIR/skills"
if [ ! -d "$SKILLS_SOURCE_DIR" ]; then
  SKILLS_SOURCE_DIR="$REPO_DIR/codex/skills"
fi

for src in "$SKILLS_SOURCE_DIR"/*; do
  [ -d "$src" ] || continue
  [ -f "$src/SKILL.md" ] || continue
  name="$(basename "$src")"
  dest="$OPENCODE_SKILLS_DIR/$name"
  legacy_dest="$LEGACY_SHARED_SKILLS_DIR/$name"
  if [ -L "$legacy_dest" ]; then
    current="$(readlink "$legacy_dest")"
    if [ "$current" = "$REPO_DIR/skills/$name" ] || \
      [ "$current" = "$REPO_DIR/codex/skills/$name" ]; then
      rm "$legacy_dest"
      echo "UNLINK $legacy_dest (legacy repo-managed skill link)"
    fi
  fi
  claude_skill="$HOME/.claude/skills/$name/SKILL.md"
  if [ -f "$claude_skill" ]; then
    if [ -L "$dest" ]; then
      current="$(readlink "$dest")"
      if [ "$current" = "$REPO_DIR/skills/$name" ] || \
        [ "$current" = "$REPO_DIR/codex/skills/$name" ]; then
        rm "$dest"
        echo "UNLINK $dest (the same skill is available through ~/.claude/skills)"
      fi
    fi
    echo "OK     shared skill $name (discovered through ~/.claude/skills)"
    continue
  fi
  link_item "$src" "$dest" "shared skill $name"
done

if [ -d "$REPO_DIR/codex/skills" ]; then
  for src in "$REPO_DIR"/codex/skills/*; do
    [ -d "$src" ] || continue
    [ -f "$src/SKILL.md" ] || continue
    name="$(basename "$src")"
    [ -d "$REPO_DIR/skills/$name" ] && continue
    [ -f "$HOME/.claude/skills/$name/SKILL.md" ] && continue
    legacy_dest="$LEGACY_SHARED_SKILLS_DIR/$name"
    if [ -L "$legacy_dest" ] && [ "$(readlink "$legacy_dest")" = "$src" ]; then
      rm "$legacy_dest"
      echo "UNLINK $legacy_dest (migrated to OpenCode-only skill discovery)"
    fi
    link_item "$src" "$OPENCODE_SKILLS_DIR/$name" "OpenCode-only skill $name"
  done
fi

for src in "$REPO_DIR"/opencode/commands/*.md; do
  [ -e "$src" ] || continue
  name="$(basename "$src")"
  link_item "$src" "$OPENCODE_COMMANDS_DIR/$name" "OpenCode command $name"
done

if command -v notion >/dev/null 2>&1; then
  trap 'bun "$REPO_DIR/scripts/normalize-opencode-notion-assets.mjs" "$OPENCODE_DIR" --restore-refresh' EXIT
  bun "$REPO_DIR/scripts/normalize-opencode-notion-assets.mjs" \
    "$OPENCODE_DIR" --prepare-refresh
  notion ai plugins add --agent opencode --strict \
    advisor mobile mobile-ios observability tuist
  bun "$REPO_DIR/scripts/normalize-opencode-notion-assets.mjs" "$OPENCODE_DIR"
  bun "$REPO_DIR/scripts/normalize-opencode-notion-assets.mjs" \
    "$OPENCODE_DIR" --commit-refresh
  trap - EXIT
elif [ -e "$OPENCODE_DIR/plugins/advisor.ts" ] && \
  [ -e "$OPENCODE_DIR/skills/mobile-review-pr/SKILL.md" ] && \
  [ -e "$OPENCODE_DIR/skills/mobile-ios-tma-module/SKILL.md" ] && \
  [ -e "$OPENCODE_DIR/skills/honeycomb/SKILL.md" ] && \
  [ -e "$OPENCODE_DIR/skills/tuist-generated-projects/SKILL.md" ]; then
  echo "WARN   Notion OpenCode plugins could not be refreshed (the notion CLI is unavailable)" >&2
else
  echo "ERROR  Notion OpenCode plugins are missing and the notion CLI is unavailable" >&2
  exit 1
fi
if ! command -v notion >/dev/null 2>&1; then
  bun "$REPO_DIR/scripts/normalize-opencode-notion-assets.mjs" "$OPENCODE_DIR"
fi

bun "$REPO_DIR/scripts/merge-opencode-config.mjs" "$REPO_DIR" "$OPENCODE_DIR"

if [ "$plugin_sdk_installed" = "$plugin_sdk_required" ]; then
  echo "OK     OpenCode plugin SDK $plugin_sdk_required"
elif command -v npm >/dev/null 2>&1; then
  (
    cd "$OPENCODE_DIR"
    npm install --ignore-scripts --no-audit --no-fund
  )
else
  echo "ERROR  OpenCode plugin SDK $plugin_sdk_required is missing and npm is unavailable" >&2
  exit 1
fi

bun "$REPO_DIR/scripts/validate-opencode-agents.mjs" \
  "$REPO_DIR" "$OPENCODE_DIR" --with-plugins

echo ""
echo "Done. OpenCode rules, agents, commands, and managed defaults are installed."
echo "Unmanaged provider, MCP, plugin, agent, and permission entries were preserved."
echo "Repo-managed global skill duplicates were removed; project-local name collisions may still require alignment."
echo "Restart running OpenCode sessions to load configuration-time changes."
