import path from "node:path";
import fs from "node:fs/promises";
import ts from "typescript";
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { collectFiles } from "./files.js";
import { extractFile, resolveImports } from "./extract.js";
import {
  canonical,
  id,
  output,
  readJSON,
  writeJSON,
  atomicWrite,
  withLock,
  VERSION,
  redact,
} from "./storage.js";
import { report } from "./report.js";

export async function buildGraph(root, options = {}) {
  root = await canonical(root);
  const started = Date.now(),
    projectId = id(root),
    directory = options.cacheDir || path.join(output(root), "project");
  const previous = await readJSON(path.join(directory, "cache.json"), {
    version: VERSION,
    files: {},
  });
  const config =
    options.config ||
    (await readJSON(path.join(output(root), "config.json"), {}));
  const { files, skipped } = await collectFiles(root, config);
  const fragments = {},
    fileCache = {};
  let changed = 0,
    reused = 0;
  for (const file of files) {
    if (
      !options.force &&
      previous.version === VERSION &&
      previous.files[file.path]?.hash === file.hash
    ) {
      fragments[file.path] = previous.files[file.path].fragment;
      reused++;
    } else {
      fragments[file.path] = extractFile(file, projectId);
      changed++;
    }
    fileCache[file.path] = { hash: file.hash, fragment: fragments[file.path] };
  }
  const nodes = new Map(),
    edges = new Map(),
    warnings = [];
  let name = path.basename(root),
    description = "";
  try {
    const pkg = JSON.parse(
      files.find((file) => file.path === "package.json")?.text || "{}",
    );
    name = pkg.name || name;
    description = pkg.description || "";
  } catch {
    /* Extraction reports malformed manifests. */
  }
  nodes.set(projectId, {
    id: projectId,
    label: name,
    kind: "project",
    path: ".",
    line: 1,
    information: files.reduce((sum, file) => sum + file.bytes, 0),
    summary: description || `Projeto local: ${name}`,
    evidence: "extracted",
    confidence: 1,
  });
  const link = (source, target, relation) => {
    const key = id(source, target, relation);
    edges.set(key, {
      id: key,
      source,
      target,
      relation,
      evidence: "extracted",
      confidence: 1,
      sourcePath: nodes.get(target)?.path || ".",
      line: 1,
    });
  };
  for (const [filename, fragment] of Object.entries(fragments)) {
    for (const node of fragment.nodes)
      nodes.set(node.id, { ...node, projectId });
    for (const edge of fragment.edges) edges.set(edge.id, edge);
    warnings.push(...fragment.warnings);
    const parts = filename.split("/");
    parts.pop();
    let parent = projectId;
    for (let i = 0; i < parts.length; i++) {
      const directoryPath = parts.slice(0, i + 1).join("/"),
        directoryId = id(projectId, "directory", directoryPath);
      if (!nodes.has(directoryId)) {
        nodes.set(directoryId, {
          id: directoryId,
          label: parts[i],
          kind: "directory",
          path: directoryPath,
          line: 1,
          information: 0,
          summary: `Modulo ${directoryPath}`,
          evidence: "extracted",
          confidence: 1,
          projectId,
        });
        link(parent, directoryId, "contains");
      }
      nodes.get(directoryId).information +=
        fileCache[filename].fragment.nodes[0].bytes;
      parent = directoryId;
    }
    link(parent, id(projectId, "file", filename), "contains");
  }
  let compilerOptions = {};
  const tsconfig = files.find((file) =>
    ["tsconfig.json", "jsconfig.json"].includes(file.path),
  );
  if (tsconfig) {
    const parsed = ts.parseConfigFileTextToJson(tsconfig.path, tsconfig.text);
    if (!parsed.error)
      compilerOptions = ts.convertCompilerOptionsFromJson(
        parsed.config.compilerOptions || {},
        root,
      ).options;
  }
  const resolved = resolveImports(
    fragments,
    files,
    projectId,
    root,
    compilerOptions,
  );
  for (const node of resolved.nodes)
    if (!nodes.has(node.id)) nodes.set(node.id, { ...node, projectId });
  for (const edge of resolved.edges) edges.set(edge.id, edge);
  const memories = await readJSON(
    path.join(output(root), "project", "memory.json"),
    [],
  );
  for (const memory of memories) {
    const validSources = (memory.sources || []).filter(
      (source) => fileCache[source.path],
    );
    const stale = (memory.sources || []).some(
      (source) =>
        !fileCache[source.path] || fileCache[source.path].hash !== source.hash,
    );
    const memoryId = id(projectId, "memory", memory.id);
    nodes.set(memoryId, {
      id: memoryId,
      label: memory.title,
      kind: memory.kind,
      summary: memory.text,
      information: Buffer.byteLength(memory.text),
      path: validSources[0]?.path || ".graphora/project/memory.json",
      line: validSources[0]?.line || 1,
      evidence: memory.basis === "explicit" ? "declared" : "inferred",
      confidence: memory.basis === "explicit" ? 1 : 0.7,
      stale,
      author: memory.author,
      createdAt: memory.createdAt,
      projectId,
    });
    link(projectId, memoryId, "remembers");
    for (const source of validSources) {
      const target = id(projectId, "file", source.path),
        key = id(memoryId, target, "documented_in");
      edges.set(key, {
        id: key,
        source: memoryId,
        target,
        relation: "documented_in",
        evidence: "declared",
        confidence: 1,
        sourcePath: source.path,
        line: source.line || 1,
      });
    }
  }
  const topology = new Graph({
    type: "undirected",
    multi: false,
    allowSelfLoops: false,
  });
  for (const node of nodes.values()) topology.addNode(node.id);
  for (const edge of edges.values()) {
    if (
      edge.source !== edge.target &&
      nodes.has(edge.source) &&
      nodes.has(edge.target) &&
      !topology.hasEdge(edge.source, edge.target)
    )
      topology.addEdge(edge.source, edge.target, {
        weight: edge.relation === "contains" ? 0.4 : 1,
      });
  }
  let communities = {};
  if (topology.size) {
    let seed = 19;
    communities = louvain(topology, {
      rng: () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      },
    });
  }
  for (const node of nodes.values()) {
    node.degree = topology.degree(node.id);
    node.community = communities[node.id] ?? 0;
  }
  const removed = Object.keys(previous.files).filter(
    (filename) => !fileCache[filename],
  ).length;
  const graph = {
    schemaVersion: 1,
    generator: `graphora/${VERSION}`,
    generatedAt: new Date().toISOString(),
    project: { id: projectId, name, root, description },
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    stats: {
      files: files.length,
      nodes: nodes.size,
      edges: edges.size,
      communities: new Set(Object.values(communities)).size,
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      lines: files.reduce((sum, file) => sum + file.lines, 0),
      changed,
      reused,
      removed,
      durationMs: Date.now() - started,
      skipped,
    },
    inventory: files.map(({ text, ...file }) => file),
    unresolved: resolved.unresolved,
    warnings,
  };
  if (options.persist !== false) {
    await writeJSON(path.join(directory, "cache.json"), {
      version: VERSION,
      files: fileCache,
    });
    await writeJSON(path.join(directory, "graph.json"), graph);
    await atomicWrite(path.join(directory, "PROJECT.md"), report(graph));
    const historyFile = path.join(directory, "history.json");
    const history = await readJSON(historyFile, []);
    if (changed || removed || !history.length) {
      history.unshift({ at: graph.generatedAt, ...graph.stats });
      await writeJSON(historyFile, history.slice(0, 100));
    }
    await atomicWrite(
      path.join(directory, "CONTEXT.md"),
      `# ${name}\n\n${redact(description)}\n\n${files.length} arquivos; ${nodes.size} nos; ${edges.size} relacoes.\nAtualizado: ${graph.generatedAt}.\n\nConsulte graphora query antes de carregar o relatorio completo.\nFonte de verdade: arquivos originais. Grafo: .graphora/project/graph.json.\nMemoria: .graphora/project/memory.json. Relatorio: .graphora/project/PROJECT.md.\nInferencias nao sao fatos; memorias com stale=true precisam de revisao.\n`,
    );
  }
  return graph;
}
export const scanProject = (root, options) =>
  withLock(root, () => buildGraph(root, options));
export async function recordMemory(root, input) {
  if (!["decision", "preference", "concept"].includes(input.kind))
    throw new Error("Tipo de memoria invalido.");
  if (!input.title?.trim() || !input.text?.trim())
    throw new Error("Titulo e conteudo sao obrigatorios.");
  if (input.text.length > 12000 || input.title.length > 160)
    throw new Error("Memoria excede o limite de tamanho.");
  if (input.basis === "explicit" && !input.author?.trim())
    throw new Error("Memorias explicitas precisam de autoria.");
  return withLock(root, async () => {
    const graph = await readJSON(
      path.join(output(root), "project", "graph.json"),
    );
    if (!graph)
      throw new Error("Analise o projeto antes de registrar memorias.");
    const sources = (input.sources || []).map((source) => {
      const file = graph.inventory.find((item) => item.path === source.path);
      if (!file) throw new Error(`Fonte nao indexada: ${source.path}`);
      return { path: source.path, line: source.line || 1, hash: file.hash };
    });
    const memory = {
      id: id(input.kind, input.title, new Date().toISOString()),
      kind: input.kind,
      title: redact(input.title.trim()),
      text: redact(input.text.trim()),
      basis: input.basis === "explicit" ? "explicit" : "inferred",
      author: input.author || "agent",
      sources,
      createdAt: new Date().toISOString(),
    };
    const file = path.join(output(root), "project", "memory.json");
    const memories = await readJSON(file, []);
    memories.push(memory);
    await writeJSON(file, memories);
    await buildGraph(root);
    return memory;
  });
}
