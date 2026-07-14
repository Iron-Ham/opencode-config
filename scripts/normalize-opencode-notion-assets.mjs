#!/usr/bin/env bun

import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const arguments_ = process.argv.slice(2);
const prepareRefresh = arguments_.includes("--prepare-refresh");
const checkRefresh = arguments_.includes("--check-refresh");
const restoreRefresh = arguments_.includes("--restore-refresh");
const commitRefresh = arguments_.includes("--commit-refresh");
const configDir = path.resolve(
  arguments_.find((argument) => !argument.startsWith("--")) ??
    path.join(os.homedir(), ".config", "opencode"),
);
const managedDir = path.join(configDir, ".managed", "claude-config");
const manifestPath = path.join(managedDir, "notion-assets.json");
const pendingDir = path.join(managedDir, "refresh-pending");
const pendingManifestPath = path.join(pendingDir, "manifest.json");

const assets = [
  {
    relativePath: "commands/mobile-on-call/init.md",
    refreshBeforeInstall: true,
    replacements: [
      ["mcp__notion-dev-rw__", "notion-dev_"],
      [
        "claude mcp add notion-dev-rw --type http --url https://mcp-dev.notion.com/mcp -s user",
        "opencode mcp auth notion-dev",
      ],
      ["Offer to add it automatically by running:", "Offer to authenticate it by running:"],
      [
        "This installs the read/write Notion MCP at the user level (persists across worktrees).",
        "The read/write Notion MCP is installed at the user level; this authorizes the current OpenCode profile.",
      ],
      ["After adding, re-run the check", "After authenticating, re-run the check"],
    ],
  },
  {
    relativePath: "commands/mobile-on-call/triage.md",
    refreshBeforeInstall: true,
    replacements: [["mcp__notion-dev-rw__", "notion-dev_"]],
  },
  {
    relativePath: "skills/mobile-design-review/SKILL.md",
    replacements: [
      [
        "2. **Reference (if Figma URL)** — before any `mcp__plugin_figma_figma__*` call:\n   1. Verify the Figma MCP is installed: `claude mcp list 2>/dev/null | grep -i figma`. If no match, install it: `claude mcp add figma-mcp --transport sse https://mcp.figma.com/sse`. Tell the user the MCP was just installed and that they may need to restart the Claude Code session for the tools to register; if so, pause and ask them to restart before proceeding.\n   2. Load the `figma:figma-use` skill — it is a MANDATORY prerequisite for every `use_figma` call.\n   3. Call `get_design_context` and `get_variable_defs` on the target node to extract spec values.",
        "2. **Reference (if Figma URL)** — before using the Figma MCP tools:\n   1. Verify the Figma MCP is installed: `opencode mcp list 2>/dev/null | grep -i figma`. If no match, install it: `opencode mcp add figma-mcp --url https://mcp.figma.com/sse`.\n   2. If the server reports that authentication is required, run `opencode mcp auth figma-mcp`. Restart the OpenCode session if the tools were installed or authenticated during this workflow, then continue.\n   3. Call `get_design_context` and `get_variable_defs` on the target node to extract spec values.",
      ],
      [
        "after loading `figma:figma-use`, pull `get_design_context` + `get_variable_defs`",
        "using the connected Figma MCP, pull `get_design_context` + `get_variable_defs`",
      ],
      [
        "after loading `figma:figma-use`, also pull `get_design_context` + `get_variable_defs`",
        "using the connected Figma MCP, also pull `get_design_context` + `get_variable_defs`",
      ],
      [
        "- **Figma MCP** when using a Figma URL. If not installed, the workflow's first step installs it via `claude mcp add figma-mcp --transport sse https://mcp.figma.com/sse`. The `figma:figma-use` skill handles auth and the mandatory prerequisite step.",
        "- **Figma MCP** when using a Figma URL. If not installed, the workflow's first step installs it via `opencode mcp add figma-mcp --url https://mcp.figma.com/sse`. Authenticate with `opencode mcp auth figma-mcp` if the server requires it.",
      ],
    ],
  },
];

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function readManifest() {
  if (!fs.existsSync(manifestPath)) return { schema: 1, assets: {} };
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function writeManifest(manifest) {
  fs.mkdirSync(managedDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(managedDir, 0o700);
  const temporaryPath = `${manifestPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, manifestPath);
    fs.chmodSync(manifestPath, 0o600);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function prepareAssetsForRefresh() {
  if (fs.existsSync(pendingManifestPath)) {
    restorePreparedAssets();
  } else if (fs.existsSync(pendingDir)) {
    throw new Error(`Incomplete OpenCode refresh backup requires inspection: ${pendingDir}`);
  }
  const manifest = readManifest();
  const stagingDir = `${pendingDir}.${process.pid}.stage`;
  fs.rmSync(stagingDir, { recursive: true, force: true });
  try {
  const recoveryRoot = path.join(
    managedDir,
    "recovery",
    new Date().toISOString().replace(/[-:.TZ]/g, ""),
  );
  const pending = { schema: 1, assets: {} };
  const toRemove = [];
  for (const asset of assets) {
    const filePath = path.join(configDir, asset.relativePath);
    const metadata = fs.lstatSync(filePath, { throwIfNoEntry: false });
    if (!metadata || metadata.isSymbolicLink()) continue;
    if (!metadata.isFile()) {
      throw new Error(`Managed Notion OpenCode asset is not a file: ${filePath}`);
    }

    const actualHash = sha256(fs.readFileSync(filePath));
    const expectedHash = manifest.assets?.[asset.relativePath]?.sha256;
    if (actualHash !== expectedHash) {
      if (checkRefresh) {
        console.log(`BACKUP ${asset.relativePath} (content differs from the managed copy)`);
        continue;
      }
      const recoveryPath = path.join(recoveryRoot, asset.relativePath);
      fs.mkdirSync(path.dirname(recoveryPath), { recursive: true, mode: 0o700 });
      fs.copyFileSync(filePath, recoveryPath);
      fs.chmodSync(recoveryPath, 0o600);
      console.log(`BACKUP ${filePath} -> ${recoveryPath}`);
    }
    if (checkRefresh) {
      if (asset.refreshBeforeInstall) {
        console.log(`READY  ${asset.relativePath}`);
      }
      continue;
    }

    const backupPath = path.join(stagingDir, "files", asset.relativePath);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true, mode: 0o700 });
    fs.copyFileSync(filePath, backupPath);
    fs.chmodSync(backupPath, 0o600);
    pending.assets[asset.relativePath] = {
      mode: metadata.mode & 0o777,
    };
    if (asset.refreshBeforeInstall) {
      toRemove.push({ filePath, relativePath: asset.relativePath });
    }
  }

  if (checkRefresh) return;
  fs.mkdirSync(stagingDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(stagingDir, "manifest.json"), `${JSON.stringify(pending, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(stagingDir, pendingDir);
  for (const { filePath, relativePath } of toRemove) {
    fs.unlinkSync(filePath);
    console.log(`REMOVE ${relativePath} (prepare plugin refresh)`);
  }
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

function restorePreparedAssets() {
  if (!fs.existsSync(pendingManifestPath)) return;
  const pending = JSON.parse(fs.readFileSync(pendingManifestPath, "utf8"));
  for (const [relativePath, metadata] of Object.entries(pending.assets ?? {})) {
    const backupPath = path.join(pendingDir, "files", relativePath);
    const filePath = path.join(configDir, relativePath);
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Cannot restore missing OpenCode asset backup: ${backupPath}`);
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.restore`;
    try {
      fs.copyFileSync(backupPath, temporaryPath);
      fs.chmodSync(temporaryPath, metadata.mode ?? 0o600);
      fs.renameSync(temporaryPath, filePath);
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
    console.log(`RESTORE ${relativePath}`);
  }
  fs.rmSync(pendingDir, { recursive: true, force: true });
}

function commitPreparedAssets() {
  if (fs.existsSync(pendingDir)) {
    fs.rmSync(pendingDir, { recursive: true, force: true });
    console.log("COMMIT Notion OpenCode asset refresh");
  }
}

function normalizeAssets() {
  const previousManifest = readManifest();
  const refreshInProgress = fs.existsSync(pendingManifestPath);
  const recoveryRoot = path.join(
    managedDir,
    "recovery",
    new Date().toISOString().replace(/[-:.TZ]/g, ""),
  );
  const manifest = { schema: 1, assets: {} };
  for (const asset of assets) {
    const filePath = path.join(configDir, asset.relativePath);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Required Notion OpenCode asset is missing: ${filePath}`);
    }

    const original = fs.readFileSync(filePath, "utf8");
    const fileMetadata = fs.lstatSync(filePath);
    const fileMode = fs.statSync(filePath).mode & 0o777;
    const expectedHash = previousManifest.assets?.[asset.relativePath]?.sha256;
    if (
      !refreshInProgress &&
      !fileMetadata.isSymbolicLink() &&
      expectedHash &&
      sha256(original) !== expectedHash
    ) {
      const recoveryPath = path.join(recoveryRoot, asset.relativePath);
      fs.mkdirSync(path.dirname(recoveryPath), { recursive: true, mode: 0o700 });
      fs.copyFileSync(filePath, recoveryPath);
      fs.chmodSync(recoveryPath, 0o600);
      console.log(`BACKUP ${filePath} -> ${recoveryPath}`);
    }
    let normalized = original;
    for (const [source, replacement] of asset.replacements) {
      if (!normalized.includes(source) && !normalized.includes(replacement)) {
        throw new Error(
          `Cannot normalize ${filePath}: expected ${JSON.stringify(source)}`,
        );
      }
      normalized = normalized.replaceAll(source, replacement);
    }

    if (normalized === original && !fileMetadata.isSymbolicLink()) {
      console.log(`OK     ${asset.relativePath}`);
    } else {
      const temporaryPath = path.join(
        path.dirname(filePath),
        `.${path.basename(filePath)}.${process.pid}.tmp`,
      );
      try {
        fs.writeFileSync(temporaryPath, normalized, { mode: fileMode });
        fs.renameSync(temporaryPath, filePath);
      } finally {
        fs.rmSync(temporaryPath, { force: true });
      }
      console.log(
        `${fileMetadata.isSymbolicLink() ? "COPY" : "WRITE"}  ${asset.relativePath}`,
      );
    }

    manifest.assets[asset.relativePath] = { sha256: sha256(normalized) };
  }
  writeManifest(manifest);
}

if (restoreRefresh) {
  restorePreparedAssets();
} else if (commitRefresh) {
  commitPreparedAssets();
} else if (prepareRefresh || checkRefresh) {
  prepareAssetsForRefresh();
} else {
  normalizeAssets();
}
