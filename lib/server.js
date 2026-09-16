import express from "express";
import chokidar from "chokidar";
import fs from "node:fs/promises";
import { watchFile, unwatchFile } from 'node:fs';
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { scanProject, recordMemory } from "./graph.js";
import { updateNetwork, registerProject } from "./network.js";
import { queryGraph } from "./query.js";
import {
  canonical,
  output,
  readJSON,
  writeJSON,
  exists,
  within,
  redact,
} from "./storage.js";
import { isExcluded } from "./files.js";

export const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export async function startServer(root, { port = 4545, watch = true } = {}) {
  root = await canonical(root);
  const assets = path.join(packageRoot, "dist", "dashboard");
  if (!(await exists(path.join(assets, "index.html"))))
    throw new Error("Compile o painel primeiro: npm run build");
  const dashboard = path.join(output(root), "dashboard");
  await fs.mkdir(dashboard, { recursive: true });
  await fs.cp(assets, dashboard, { recursive: true });
  const app = express(),
    clients = new Set(),
    session = randomUUID();
  let graph = await readJSON(path.join(output(root), "project", "graph.json"));
  let network = await readJSON(
    path.join(output(root), "network", "graph.json"),
  );
  let scanning = false,
    scanError = null,
    pending = false,
    queue = null,
    watcher,
    snapshotWatcher,
    server,
    url;
  const status = () => ({
    scanning,
    error: scanError,
    watching: watch,
    generatedAt: graph?.generatedAt,
    projectRoot: root,
    session,
  });
  const emit = (type) => {
    for (const client of clients)
      client.write(`event: ${type}\ndata: ${JSON.stringify(status())}\n\n`);
  };
  const refresh = async () => {
    if (queue) {
      pending = true;
      return queue;
    }
    queue = (async () => {
      do {
        pending = false;
        scanning = true;
        scanError = null;
        emit("status");
        try {
          graph = await scanProject(root);
          emit("graph");
          network = await updateNetwork(root, graph);
          if (watcher)
            watcher.add(network.projects.map((project) => project.root));
          emit("network");
        } catch (error) {
          scanError = error.message;
        } finally {
          scanning = false;
          emit("status");
        }
      } while (pending);
      return graph;
    })();
    try {
      return await queue;
    } finally {
      queue = null;
    }
  };
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host || ""))
      return res.status(403).json({ error: "Host local obrigatorio." });
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    });
    if (
      !["GET", "HEAD"].includes(req.method) &&
      (req.headers["x-graphora-client"] !== "local" ||
        (req.headers.origin && req.headers.origin !== url))
    )
      return res.status(403).json({ error: "Origem local obrigatoria." });
    next();
  });
  app.use(express.json({ limit: "48kb" }));
  app.get("/api/health", (req, res) =>
    res.json({ graphora: true, ...status() }),
  );
  app.get("/api/status", (req, res) => res.json(status()));
  app.get("/api/graph", (req, res) =>
    graph ? res.json(graph) : res.status(202).json({ pending: true }),
  );
  app.get("/api/network", (req, res) =>
    network ? res.json(network) : res.status(202).json({ pending: true }),
  );
  app.get("/api/history", async (req, res) =>
    res.json(
      await readJSON(path.join(output(root), "project", "history.json"), []),
    ),
  );
  app.get("/api/integrations", async (req, res) =>
    res.json(
      await readJSON(path.join(output(root), "integrations.json"), {
        installed: [],
        mcp: {
          command: process.execPath,
          args: [path.join(packageRoot, "bin", "graphora.js"), "mcp", root],
        },
      }),
    ),
  );
  app.get("/api/events", (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();
    res.write(`event: status\ndata: ${JSON.stringify(status())}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
  });
  app.post("/api/refresh", async (req, res) => {
    await refresh();
    if (scanError) res.status(500).json({ error: scanError });
    else res.json(status());
  });
  app.post("/api/query", (req, res) => {
    const source = req.body.scope === "network" ? network : graph;
    if (!source)
      return res.status(409).json({ error: "Analise em andamento." });
    const question = String(req.body.question || "").slice(0, 2000);
    res.json(queryGraph(source, question, req.body));
  });
  app.post("/api/memory", async (req, res) => {
    const memory = await recordMemory(root, req.body);
    await refresh();
    res.json(memory);
  });
  app.get("/api/source", async (req, res) => {
    const node = graph?.nodes.find((item) => item.id === req.query.node);
    if (!node || !graph.inventory.some((item) => item.path === node.path))
      return res.status(404).json({ error: "Fonte textual indisponivel." });
    const source = await canonical(path.join(root, node.path));
    if (!within(root, source))
      return res.status(403).json({ error: "Fonte fora do projeto." });
    const stat = await fs.stat(source);
    if (stat.size > 1024 * 1024)
      return res.status(413).json({ error: "Fonte excede o limite." });
    const lines = redact(await fs.readFile(source, "utf8")).split("\n");
    const from = Math.max(1, (node.line || 1) - 4),
      to = Math.min(lines.length, from + 79);
    res.json({
      path: node.path,
      from,
      to,
      text: lines.slice(from - 1, to).join("\n"),
    });
  });
  app.get("/api/export/:format", async (req, res) => {
    if (req.params.format === "json")
      return res
        .attachment("graphora-graph.json")
        .json(req.query.scope === "network" ? network : graph);
    if (req.params.format === "md")
      return res.download(
        path.join(output(root), "project", "PROJECT.md"),
        "PROJECT.md",
      );
    res.sendStatus(404);
  });
  app.use(express.static(dashboard));
  app.use((error, req, res, next) => {
    res.status(error.status || 400).json({ error: error.message });
  });
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      server = await new Promise((resolve, reject) => {
        const candidate = app.listen(port + attempt, "127.0.0.1", (error) =>
          error ? reject(error) : resolve(candidate),
        );
        candidate.on("error", reject);
      });
      break;
    } catch (error) {
      if (error.code !== "EADDRINUSE" || attempt === 29) throw error;
    }
  }
  url = `http://127.0.0.1:${server.address().port}`;
  await writeJSON(path.join(output(root), "runtime.json"), {
    url,
    pid: process.pid,
    projectRoot: root,
    session,
    startedAt: new Date().toISOString(),
  });
  await registerProject(root).catch((error) => {
    console.error(`Registro global indisponivel: ${error.message}`);
  });
  let debounce;
  if (watch) {
    watcher = chokidar.watch(root, {
      ignoreInitial: true,
      ignored: (item) =>
        path
          .relative(root, item)
          .split(path.sep)
          .some((part) => part && part !== ".." && isExcluded(part)),
      awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
    });
    watcher.on("all", () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => void refresh(), 700);
    });
    watcher.on("error", (error) => {
      scanError = error.message;
      emit("status");
    });
    const snapshots = [
      path.join(output(root), 'project', 'graph.json'),
      path.join(output(root), 'project', 'memory.json'),
      path.join(output(root), 'config.json'),
    ];
    // Snapshot files are atomically replaced, including before they first exist.
    for (const filename of snapshots) watchFile(filename, { interval: 500 }, async (current, previous) => {
      if (current.mtimeMs === previous.mtimeMs) return;
      if (path.basename(filename) === 'graph.json') {
        const updated = await readJSON(filename).catch(() => null);
        if (updated && updated.generatedAt !== graph?.generatedAt) { graph = updated; emit('graph'); }
      } else { clearTimeout(debounce); debounce = setTimeout(() => void refresh(), 700); }
    });
    snapshotWatcher = { close: () => { for (const filename of snapshots) unwatchFile(filename); } };
  }
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(": heartbeat\n\n");
  }, 20000);
  const close = async () => {
    clearTimeout(debounce);
    clearInterval(heartbeat);
    await watcher?.close();
    await snapshotWatcher?.close();
    for (const client of clients) client.end();
    await new Promise((resolve) => server.close(resolve));
    const runtime = await readJSON(path.join(output(root), "runtime.json"));
    if (runtime?.session === session)
      await fs.rm(path.join(output(root), "runtime.json"), { force: true });
  };
  app.post("/api/stop", (req, res) => {
    if (req.body.session !== session) return res.sendStatus(403);
    res.json({ stopped: true });
    setTimeout(() => void close().then(() => process.exit(0)), 50);
  });
  process.once("SIGTERM", () => void close().then(() => process.exit(0)));
  process.once("SIGINT", () => void close().then(() => process.exit(0)));
  console.log(`Graphora: ${url}`);
  void refresh();
  return { app, server, url, close, refresh };
}
