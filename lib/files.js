import fs from "node:fs/promises";
import path from "node:path";
import ignore from "ignore";
import { slash, hash, redact } from "./storage.js";

const excluded = new Set([
  ".git",
  ".graphora",
  "graphify-out",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "out",
  "target",
  "generated",
  ".generated",
  ".output",
  "coverage",
  ".next",
  ".nuxt",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
  ".idea",
  ".DS_Store",
  "test-results",
  ".terraform",
]);
const sensitive =
  /(^\.env(?:\.|$)|\.(?:pem|key|p12|pfx|keystore)$|^(?:credentials|secrets?)(?:\.|$)|^id_(?:rsa|ed25519)|\.sqlite(?:3)?$|\.db$)/i;
const lockfile =
  /^(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|uv\.lock|poetry\.lock|Cargo\.lock)$/;
const generatedFile =
  /(?:\.min|\.bundle|\.generated|\.g|\.designer)\.(?:js|mjs|cjs|css|ts|tsx|cs)$|(?:^|[._-])(?:chunk|vendor)[._-][a-f0-9]{6,}\.(?:js|css)$|\.pb\.(?:go|py|ts|js)$|_generated\.go$/i;
const textExtensions = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".c",
  ".h",
  ".cpp",
  ".cs",
  ".rb",
  ".php",
  ".swift",
  ".vue",
  ".svelte",
  ".md",
  ".mdx",
  ".txt",
  ".rst",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".html",
  ".css",
  ".scss",
  ".sql",
  ".sh",
  ".graphql",
  ".gql",
  ".proto",
  ".tf",
]);
export const isExcluded = (name) =>
  excluded.has(name) || sensitive.test(name) || lockfile.test(name);
export async function collectFiles(
  root,
  { maxFiles = 10000, maxBytes = 1024 * 1024 } = {},
) {
  const files = [],
    skipped = {
      ignored: 0,
      sensitive: 0,
      oversized: 0,
      binary: 0,
      generated: 0,
      unreadable: 0,
      limit: 0,
      symlink: 0,
    };
  async function walk(directory, inherited = []) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      skipped.unreadable++;
      return;
    }
    const rules = [...inherited];
    for (const filename of [".gitignore", ".graphoraignore"]) {
      try {
        rules.push({
          base: directory,
          matcher: ignore().add(
            await fs.readFile(path.join(directory, filename), "utf8"),
          ),
        });
      } catch (error) {
        if (error.code !== "ENOENT") skipped.unreadable++;
      }
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) {
        skipped.symlink++;
        continue;
      }
      if (sensitive.test(entry.name)) {
        skipped.sensitive++;
        continue;
      }
      if (excluded.has(entry.name) || lockfile.test(entry.name)) {
        skipped.ignored++;
        continue;
      }
      if (entry.isFile() && generatedFile.test(entry.name)) {
        skipped.generated++;
        continue;
      }
      const absolute = path.join(directory, entry.name),
        relative = slash(path.relative(root, absolute));
      if (
        rules.some(({ base, matcher }) =>
          matcher.ignores(
            slash(path.relative(base, absolute)) +
              (entry.isDirectory() ? "/" : ""),
          ),
        )
      ) {
        skipped.ignored++;
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolute, rules);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= maxFiles) {
        skipped.limit++;
        continue;
      }
      if (
        !textExtensions.has(path.extname(entry.name).toLowerCase()) &&
        !["Dockerfile", "Makefile", "LICENSE", "Justfile"].includes(entry.name)
      ) {
        skipped.binary++;
        continue;
      }
      try {
        const stat = await fs.stat(absolute);
        if (stat.size > maxBytes) {
          skipped.oversized++;
          continue;
        }
        const raw = await fs.readFile(absolute, "utf8");
        if (raw.includes("\0")) {
          skipped.binary++;
          continue;
        }
        const text = redact(raw);
        files.push({
          path: relative,
          text,
          hash: hash(raw),
          bytes: stat.size,
          lines: text.split("\n").length,
          mtime: stat.mtime.toISOString(),
        });
      } catch {
        skipped.unreadable++;
      }
    }
  }
  await walk(root);
  return { files, skipped };
}
