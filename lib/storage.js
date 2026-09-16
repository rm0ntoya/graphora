import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";

export const VERSION = "0.1.0";
export const home = () =>
  process.env.GRAPHORA_HOME || path.join(os.homedir(), ".graphora");
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const id = (...parts) => hash(parts.join("\0")).slice(0, 20);
export const slash = (value) => value.split(path.sep).join("/");
export const output = (root) => path.join(root, ".graphora");
export async function readJSON(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}
export async function atomicWrite(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, value, { mode: 0o600 });
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}
export const writeJSON = (file, value) =>
  atomicWrite(file, JSON.stringify(value, null, 2) + "\n");
export async function canonical(root) {
  return fs.realpath(path.resolve(root));
}
export async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
export function within(root, file) {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
export function redact(text) {
  return String(text)
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      "[REDACTED PRIVATE KEY]",
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g,
      "[REDACTED TOKEN]",
    )
    .replace(
      /((?:api[_-]?key|secret|password|access[_-]?token|authorization)\s*[:=]\s*)["']?[^\s"',;]{8,}["']?/gi,
      "$1[REDACTED]",
    );
}
export async function withLock(root, callback) {
  const lock = path.join(output(root), "write.lock");
  await fs.mkdir(output(root), { recursive: true });
  let acquired = false;
  for (let i = 0; i < 120; i++) {
    try {
      await fs.mkdir(lock);
      acquired = true;
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const stat = await fs.stat(lock).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 10 * 60_000)
        await fs.rm(lock, { recursive: true, force: true });
      else await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!acquired)
    throw new Error(
      "Outra analise esta em andamento. Tente novamente em instantes.",
    );
  try {
    return await callback();
  } finally {
    await fs.rm(lock, { recursive: true, force: true });
  }
}
