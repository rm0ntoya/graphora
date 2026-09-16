#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { canonical, output, readJSON, writeJSON } from "../lib/storage.js";
import { scanProject, recordMemory } from "../lib/graph.js";
import { updateNetwork } from "../lib/network.js";
import { queryGraph } from "../lib/query.js";

const HELP = `Graphora - memoria local e observatorio 3D\n\n  graphora [projeto]                 Analisa, inicia watcher e abre painel\n  graphora scan [projeto]            Atualiza grafo e relatorio\n  graphora query "pergunta"           Recupera contexto com fontes\n  graphora serve [projeto]           Servidor em primeiro plano\n  graphora mcp [projeto]             Servidor MCP via stdio\n  graphora install [projeto]         Integra assistentes neste projeto\n  graphora install --global         Instala skills e launcher do usuario\n  graphora remember "titulo" --text "decisao" --kind decision\n  graphora status [projeto]          Consulta estado do painel\n  graphora stop [projeto]            Encerra painel e watcher\n\nOpcoes: --project PATH --budget 1800 --depth 1 --network --force\n        --no-open --no-watch --port 4545 --json --help\n`;
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    project: { type: "string" },
    budget: { type: "string" },
    depth: { type: "string" },
    port: { type: "string" },
    json: { type: "boolean" },
    global: { type: "boolean" },
    force: { type: "boolean" },
    network: { type: "boolean" },
    "no-open": { type: "boolean" },
    "no-watch": { type: "boolean" },
    kind: { type: "string" },
    text: { type: "string" },
    basis: { type: "string" },
    author: { type: "string" },
    source: { type: "string", multiple: true },
    node: { type: "string" },
  },
});
const known = [
  "scan",
  "query",
  "serve",
  "mcp",
  "install",
  "remember",
  "stop",
  "status",
];
const command = known.includes(positionals[0]) ? positionals[0] : "open";
const args = command === "open" ? positionals : positionals.slice(1);
const send = async (url, route, body) =>
  fetch(url + route, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Graphora-Client": "local",
    },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(300000),
  });
async function running(root) {
  const runtime = await readJSON(path.join(output(root), "runtime.json"));
  if (!runtime || !/^http:\/\/127\.0\.0\.1:\d+$/.test(runtime.url)) return null;
  try {
    const response = await fetch(runtime.url + "/api/health", {
      signal: AbortSignal.timeout(1500),
    });
    const data = await response.json();
    return data.graphora &&
      data.projectRoot === root &&
      data.session === runtime.session
      ? { ...runtime, ...data }
      : null;
  } catch {
    return null;
  }
}
function openBrowser(url) {
  const executable =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "rundll32"
        : "xdg-open";
  const child = spawn(
    executable,
    process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url],
    { detached: true, stdio: "ignore" },
  );
  child.on("error", (error) =>
    console.error(`Abra ${url} no navegador. ${error.message}`),
  );
  child.unref();
}
async function main() {
  if (values.help) {
    console.log(HELP);
    return;
  }
  const root = await canonical(
    values.project ||
      (["query", "remember"].includes(command) ? "." : args[0] || "."),
  );
  if (command === "mcp") {
    const { startMCP } = await import("../lib/mcp.js");
    await startMCP(root);
    return;
  }
  if (command === "install") {
    const { install } = await import("../lib/install.js");
    console.log(
      JSON.stringify(await install({ root, global: !!values.global }), null, 2),
    );
    return;
  }
  if (command === "serve") {
    const { startServer } = await import("../lib/server.js");
    await startServer(root, {
      port: Number(values.port) || 4545,
      watch: !values["no-watch"],
    });
    return;
  }
  if (command === "scan") {
    const graph = await scanProject(root, { force: !!values.force });
    if (values.network) await updateNetwork(root, graph);
    console.log(JSON.stringify(graph.stats, null, 2));
    return;
  }
  if (command === "query") {
    let graph = await readJSON(
      path.join(
        output(root),
        values.network ? "network" : "project",
        "graph.json",
      ),
    );
    if (!graph) {
      const current = await scanProject(root);
      graph = values.network ? await updateNetwork(root, current) : current;
    }
    const result = queryGraph(graph, args.join(" "), {
      budget: values.budget,
      depth: values.depth === undefined ? 1 : values.depth,
      nodeId: values.node,
    });
    console.log(values.json ? JSON.stringify(result, null, 2) : result.text);
    return;
  }
  if (command === "remember") {
    console.log(
      JSON.stringify(
        await recordMemory(root, {
          title: args.join(" "),
          text: values.text,
          kind: values.kind || "decision",
          basis: values.basis || "inferred",
          author: values.author || "agent",
          sources: (values.source || []).map((source) => {
            const [file, line] = source.split(/:(?=\d+$)/);
            return { path: file, line: Number(line) || 1 };
          }),
        }),
        null,
        2,
      ),
    );
    return;
  }
  let runtime = await running(root);
  if (command === "status") {
    console.log(JSON.stringify(runtime || { running: false }, null, 2));
    return;
  }
  if (command === "stop") {
    if (runtime)
      await send(runtime.url, "/api/stop", { session: runtime.session });
    console.log(runtime ? "Graphora encerrado." : "Nenhum painel ativo.");
    return;
  }
  if (!(await readJSON(path.join(output(root), "integrations.json")))) {
    const { install } = await import("../lib/install.js");
    await install({ root });
  }
  if (runtime) {
    const response = await send(runtime.url, "/api/refresh");
    if (!response.ok) throw new Error((await response.json()).error);
  } else {
    await fs.promises.mkdir(output(root), { recursive: true });
    const log = fs.openSync(path.join(output(root), "server.log"), "a", 0o600);
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(import.meta.url),
        "serve",
        root,
        "--port",
        values.port || "4545",
        ...(values["no-watch"] ? ["--no-watch"] : []),
      ],
      { detached: true, stdio: ["ignore", log, log], cwd: root },
    );
    child.unref();
    fs.closeSync(log);
    for (let attempt = 0; attempt < 120; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      runtime = await running(root);
      if (runtime) break;
    }
    if (!runtime)
      throw new Error(
        `O painel nao iniciou. Consulte ${path.join(output(root), "server.log")}`,
      );
  }
  if (!values["no-open"]) openBrowser(runtime.url);
  console.log(
    `Graphora: ${runtime.url}\nProjeto: ${root}\nAnalise e watcher locais. Relatorio: ${path.join(output(root), "project", "PROJECT.md")}`,
  );
}
main().catch((error) => {
  console.error(`Graphora: ${error.message}`);
  process.exitCode = 1;
});
