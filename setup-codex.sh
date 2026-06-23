#!/usr/bin/env bash
set -euo pipefail

# Codex config setup script.
# Symlinks repo-managed instructions, generated agents, and skills into Codex homes.

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CODEX_DIR="${CODEX_HOME:-$HOME/.codex}"
CODEX_AGENTS_DIR="$CODEX_DIR/agents"
CODEX_SKILLS_DIR="$CODEX_DIR/skills"
LEGACY_SHARED_SKILLS_DIR="$HOME/.agents/skills"
CODEX_BACKUP_DIR="$CODEX_DIR/backups/setup-codex"

backup_timestamp() {
  date +%Y%m%d%H%M%S
}

link_item() {
  local src="$1"
  local dest="$2"
  local label="$3"
  local backup_dir="$4"

  if [ ! -e "$src" ]; then
    echo "SKIP  $label (not in repo)"
    return
  fi

  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    mkdir -p "$backup_dir"
    local backup
    backup="$backup_dir/$(basename "$dest").bak.$(backup_timestamp)"
    echo "BACKUP $dest -> $backup"
    mv "$dest" "$backup"
  fi

  if [ -L "$dest" ]; then
    local current
    current="$(readlink "$dest")"
    if [ "$current" = "$src" ]; then
      echo "OK     $label (already linked)"
      return
    fi
    rm "$dest"
  fi

  ln -s "$src" "$dest"
  echo "LINK   $dest -> $src"
}

mkdir -p "$CODEX_DIR" "$CODEX_AGENTS_DIR" "$CODEX_SKILLS_DIR" "$LEGACY_SHARED_SKILLS_DIR"

link_item "$REPO_DIR/AGENTS.md" "$CODEX_DIR/AGENTS.md" "AGENTS.md" "$CODEX_BACKUP_DIR"

if [ -d "$REPO_DIR/codex/agents" ]; then
  for src in "$REPO_DIR"/codex/agents/*.toml; do
    [ -e "$src" ] || continue
    name="$(basename "$src")"
    link_item "$src" "$CODEX_AGENTS_DIR/$name" "codex agent $name" "$CODEX_BACKUP_DIR/agents"
  done
fi

SKILLS_SOURCE_DIR="$REPO_DIR/codex/skills"
if [ ! -d "$SKILLS_SOURCE_DIR" ]; then
  SKILLS_SOURCE_DIR="$REPO_DIR/skills"
fi

if [ -d "$SKILLS_SOURCE_DIR" ]; then
  for src in "$SKILLS_SOURCE_DIR"/*; do
    [ -d "$src" ] || continue
    [ -f "$src/SKILL.md" ] || continue
    name="$(basename "$src")"
    legacy_dest="$LEGACY_SHARED_SKILLS_DIR/$name"
    if [ -L "$legacy_dest" ]; then
      current="$(readlink "$legacy_dest")"
      if [ "$current" = "$REPO_DIR/codex/skills/$name" ] || \
        [ "$current" = "$REPO_DIR/skills/$name" ]; then
        rm "$legacy_dest"
        echo "UNLINK $legacy_dest (migrated to Codex-only skill discovery)"
      fi
    fi
    link_item "$src" "$CODEX_SKILLS_DIR/$name" "skill $name" "$CODEX_BACKUP_DIR/skills"
  done
fi

echo ""
echo "Done. Codex instructions, agents, and skills are symlinked from $REPO_DIR"
echo "Note: ~/.codex/config.toml is intentionally left untouched."
