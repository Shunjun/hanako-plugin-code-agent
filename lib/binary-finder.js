/**
 * plugins/code-agent/lib/binary-finder.js
 *
 * Auto-scans known paths for CLI tool binaries (claude, codex).
 * In production Electron apps, PATH is minimal and doesn't include
 * nvm/fnm/volta/brew directories, so we scan them explicitly.
 */
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir, platform } from "node:os";

const home = homedir();
const isMac = platform() === "darwin";
const isLinux = platform() === "linux";

/** Cache: toolId → resolved absolute path | null */
const cache = new Map();

/**
 * Resolve a CLI tool binary to its absolute path.
 * Returns null if not found.
 */
export function findBinary(toolId) {
  if (cache.has(toolId)) return cache.get(toolId);

  const candidates = toolId === "codex" ? codexCandidates() : claudeCandidates();

  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        cache.set(toolId, p);
        return p;
      }
    } catch {
      // existsSync can throw on permission errors, skip
    }
  }

  cache.set(toolId, null);
  return null;
}

/**
 * Clear the cache (e.g. after user installs the tool).
 */
export function resetCache() {
  cache.clear();
}

function claudeCandidates() {
  const bins = [];
  if (isMac || isLinux) {
    // nvm: scan all installed node versions
    bins.push(...globJoin(home, ".nvm/versions/node", "*/bin/claude"));
    // fnm
    bins.push(...globJoin(home, ".local/share/fnm/node-versions", "*/installation/bin/claude"));
    // volta
    bins.push(join(home, ".volta/bin/claude"));
    // bun
    bins.push(join(home, ".bun/bin/claude"));
    // Homebrew Apple Silicon
    bins.push("/opt/homebrew/bin/claude");
    // Homebrew Intel
    bins.push("/usr/local/bin/claude");
    // npx fallback
    bins.push(join(home, ".npm-global/bin/claude"));
  }
  // System-wide
  bins.push("/usr/bin/claude");
  bins.push("/usr/local/bin/claude");
  return bins;
}

function codexCandidates() {
  const bins = [];
  if (isMac || isLinux) {
    bins.push(...globJoin(home, ".nvm/versions/node", "*/bin/codex"));
    bins.push(...globJoin(home, ".local/share/fnm/node-versions", "*/installation/bin/codex"));
    bins.push(join(home, ".volta/bin/codex"));
    bins.push(join(home, ".bun/bin/codex"));
    bins.push("/opt/homebrew/bin/codex");
    bins.push("/usr/local/bin/codex");
    bins.push(join(home, ".npm-global/bin/codex"));
  }
  bins.push("/usr/bin/codex");
  bins.push("/usr/local/bin/codex");
  return bins;
}

/**
 * Expand a glob-like pattern: /foo/*/bar → list of /foo/<each>/bar
 */
function globJoin(base, middle, suffix) {
  const dir = join(base, middle);
  const prefix = dir.split("*")[0]; // e.g. "/Users/x/.nvm/versions/node/"
  const suffixPart = dir.split("*")[1] || ""; // e.g. "/bin/claude"
  const fullSuffix = suffix; // e.g. "*/bin/claude" → we already have the * part

  try {
    const parentDir = resolve(prefix);
    if (!existsSync(parentDir)) return [];
    const entries = readdirSync(parentDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => join(parentDir, e.name, suffixPart, suffix));
  } catch {
    return [];
  }
}
