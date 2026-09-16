import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { buildGraph } from "./graph.js";
import {
  canonical,
  home,
  id,
  output,
  readJSON,
  writeJSON,
  atomicWrite,
  exists,
} from "./storage.js";
import { isExcluded } from "./files.js";

const markers = [
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "composer.json",
  ".git",
  ".graphora",
];
export async function discoverProjects(root, config = {}) {
  const registry = await readJSON(path.join(home(), "registry.json"), {
    projects: [],
  });
  const roots = new Set([await canonical(root)]),
    errors = [];
  for (const project of registry.projects || []) {
    try {
      roots.add(await canonical(project.root));
    } catch {
      errors.push({
        root: project.root,
        error: "Projeto registrado indisponivel.",
      });
    }
  }
  if (config.discover !== false) {
    const scopes = config.discoveryRoots || [path.dirname(root)];
    async function search(directory, depth) {
      if (roots.size >= (config.maxProjects || 40)) return;
      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        errors.push({
          root: directory,
          error: "Diretorio de descoberta indisponivel.",
        });
        return;
      }
      for (const entry of entries) {
        if (
          !entry.isDirectory() ||
          entry.isSymbolicLink() ||
          entry.name.startsWith(".") ||
          isExcluded(entry.name)
        )
          continue;
        const candidate = path.join(directory, entry.name);
        if (roots.has(candidate)) continue;
        if (
          (
            await Promise.all(
              markers.map((marker) => exists(path.join(candidate, marker))),
            )
          ).some(Boolean)
        )
          roots.add(await canonical(candidate));
        else if (depth > 0 && directory !== os.homedir())
          await search(candidate, depth - 1);
        if (roots.size >= (config.maxProjects || 40)) break;
      }
    }
    for (const scope of scopes)
      await search(path.resolve(scope), config.discoveryDepth ?? 1);
  }
  const excluded = new Set(
    (config.excludedProjects || []).map((value) => path.resolve(value)),
  );
  return { roots: [...roots].filter((value) => !excluded.has(value)), errors };
}

export async function updateNetwork(root, currentGraph, options = {}) {
  const config = await readJSON(path.join(output(root), "config.json"), {});
  const discovered = await discoverProjects(root, config);
  const graphs = [],
    errors = [...discovered.errors];
  for (const projectRoot of discovered.roots) {
    try {
      graphs.push(
        projectRoot === root
          ? currentGraph
          : await buildGraph(projectRoot, {
              cacheDir: path.join(
                output(root),
                "network",
                "projects",
                id(projectRoot),
              ),
              config: await readJSON(
                path.join(output(projectRoot), "config.json"),
                {},
              ),
            }),
      );
    } catch (error) {
      errors.push({ root: projectRoot, error: error.message });
    }
  }
  const nodes = [],
    edges = [],
    technologies = new Map();
  for (const graph of graphs) {
    nodes.push({
      id: graph.project.id,
      label: graph.project.name,
      kind: "project",
      path: graph.project.root,
      information: graph.stats.bytes,
      summary:
        graph.project.description ||
        `${graph.stats.files} arquivos, ${graph.stats.nodes} nos.`,
      evidence: "extracted",
      confidence: 1,
      community: nodes.length,
      degree: 0,
      projectId: graph.project.id,
      files: graph.stats.files,
    });
    for (const node of graph.nodes.filter(
      (node) => node.kind === "dependency" && node.version,
    )) {
      const name = node.label;
      if (!technologies.has(name)) technologies.set(name, []);
      technologies
        .get(name)
        .push({
          projectId: graph.project.id,
          project: graph.project.name,
          path: node.path,
          version: node.version,
          root: graph.project.root,
        });
    }
  }
  const preferences = new Map();
  for (const graph of graphs)
    for (const node of graph.nodes.filter(
      (node) => node.kind === "preference" && !node.stale,
    )) {
      const preferenceId = id("preference", node.label, node.summary);
      if (!preferences.has(preferenceId))
        preferences.set(preferenceId, {
          ...node,
          id: preferenceId,
          sources: [],
          community: 0,
        });
      const preference = preferences.get(preferenceId);
      preference.sources.push({
        projectId: graph.project.id,
        project: graph.project.name,
        path: node.path,
        author: node.author,
      });
      edges.push({
        id: id(graph.project.id, preferenceId),
        source: graph.project.id,
        target: preferenceId,
        relation: "remembers",
        evidence: node.evidence,
        confidence: node.confidence,
        sourcePath: node.path,
        line: node.line || 1,
      });
    }
  nodes.push(...preferences.values());
  const patterns = [];
  for (const [technology, sources] of technologies) {
    const unique = [
      ...new Map(sources.map((source) => [source.projectId, source])).values(),
    ];
    if (unique.length < 2) continue;
    const key = id("technology", technology);
    nodes.push({
      id: key,
      label: technology,
      kind: "pattern",
      information: 150 * unique.length,
      summary: `Dependencia declarada em ${unique.length} projetos. Recorrencia observada; preferencia nao confirmada.`,
      evidence: "inferred",
      confidence: 0.75,
      community: 0,
      degree: unique.length,
      path: unique.map((source) => source.project).join(", "),
      sources: unique,
    });
    for (const source of unique)
      edges.push({
        id: id(source.projectId, key),
        source: source.projectId,
        target: key,
        relation: "uses",
        evidence: "extracted",
        confidence: 1,
        sourcePath: `${source.project}/${source.path}`,
        line: 1,
      });
    patterns.push({
      technology,
      projects: unique.length,
      basis: "observed",
      preferenceConfirmed: false,
      sources: unique,
    });
  }
  for (let i = 0; i < graphs.length; i++)
    for (let j = i + 1; j < graphs.length; j++) {
      const left = graphs[i],
        right = graphs[j];
      const rightHashes = new Map(
        right.inventory
          .filter((file) => file.bytes > 80)
          .map((file) => [file.hash, file.path]),
      );
      const shared = left.inventory.filter(
        (file) => file.bytes > 80 && rightHashes.has(file.hash),
      );
      if (shared.length)
        edges.push({
          id: id(left.project.id, right.project.id, "shares_content"),
          source: left.project.id,
          target: right.project.id,
          relation: "shares_content",
          evidence: "extracted",
          confidence: 1,
          sourcePath: `${shared[0].path} = ${rightHashes.get(shared[0].hash)}`,
          line: 1,
          count: shared.length,
        });
    }
  for (const node of nodes)
    node.degree = edges.filter(
      (edge) => edge.source === node.id || edge.target === node.id,
    ).length;
  const network = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    project: { id: "network", name: "Constelacao de projetos", root },
    nodes,
    edges,
    patterns,
    projects: graphs.map((graph) => ({
      ...graph.project,
      stats: graph.stats,
      generatedAt: graph.generatedAt,
    })),
    errors,
    stats: {
      nodes: nodes.length,
      edges: edges.length,
      files: graphs.reduce((sum, graph) => sum + graph.stats.files, 0),
      communities: graphs.length,
      projects: graphs.length,
    },
  };
  await writeJSON(path.join(output(root), "network", "graph.json"), network);
  await writeJSON(
    path.join(output(root), "network", "patterns.json"),
    patterns,
  );
  await atomicWrite(
    path.join(output(root), "network", "USER_PATTERNS.md"),
    `# Padroes entre projetos\n\nAtualizado: ${network.generatedAt}.\n\nEstes dados descrevem tecnologias e conteudos recorrentes em ${graphs.length} projetos locais. Nao sao atributos pessoais nem preferencias confirmadas.\n\n${patterns.map((pattern) => `## ${pattern.technology}\n\nPresente em ${pattern.projects} projetos: ${pattern.sources.map((source) => source.project).join(", ")}.\n\n${pattern.sources.map((source) => `- Fonte: ${source.root}/${source.path}, versao ${source.version}`).join("\n")}`).join("\n\n") || "Nenhuma recorrencia de dependencia entre projetos encontrada."}\n\n## Projetos observados\n\n${graphs.map((graph) => `- ${graph.project.name}: ${graph.project.root}`).join("\n")}\n\n## Lacunas\n\n${errors.map((error) => `- ${error.root}: ${error.error}`).join("\n") || "Nenhum erro de leitura."}\n`,
  );
  return network;
}

export async function registerProject(root) {
  const file = path.join(home(), "registry.json"),
    registry = await readJSON(file, { projects: [] });
  const projectRoot = await canonical(root);
  registry.projects = registry.projects.filter(
    (project) => project.root !== projectRoot,
  );
  registry.projects.push({
    root: projectRoot,
    lastSeen: new Date().toISOString(),
  });
  await writeJSON(file, registry);
}
