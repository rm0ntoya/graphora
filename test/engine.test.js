import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scanProject, recordMemory } from "../lib/graph.js";
import { queryGraph, resolveNodeAnchor, tokenCount } from "../lib/query.js";
import { updateNetwork } from "../lib/network.js";
import { readJSON, writeJSON, output } from "../lib/storage.js";
import { install, managedBlock } from "../lib/install.js";

const registryHome = await fs.mkdtemp(
  path.join(os.tmpdir(), "graphora-registry-"),
);
process.env.GRAPHORA_HOME = registryHome;
after(() => fs.rm(registryHome, { recursive: true, force: true }));

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "graphora-test-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, "alpha");
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "alpha", dependencies: { react: "^19" } }),
  );
  await fs.writeFile(
    path.join(root, "src", "math.ts"),
    "/** Add two values. */\nexport function add(a: number, b: number) { return a + b; }\n",
  );
  await fs.writeFile(
    path.join(root, "src", "index.ts"),
    "import { add } from './math.js';\nexport const run = () => add(1, 2);\n",
  );
  await fs.writeFile(
    path.join(root, "README.md"),
    "# Alpha\n\nA local test project.\n\n## Math\n\nSee [implementation](src/math.ts).\n",
  );
  await writeJSON(path.join(output(root), "config.json"), {
    discoveryRoots: [base],
  });
  return { base, root };
}

test("extracts AST symbols, resolves ESM imports and carries source evidence", async (t) => {
  const { root } = await fixture(t),
    graph = await scanProject(root);
  const symbol = graph.nodes.find(
    (node) => node.label === "add" && node.kind === "function",
  );
  assert.equal(symbol.line, 2);
  assert.equal(symbol.path, "src/math.ts");
  const edge = graph.edges.find(
    (edge) =>
      edge.relation === "imports" &&
      graph.nodes.find((node) => node.id === edge.target)?.path ===
        "src/math.ts",
  );
  assert.ok(edge);
  assert.equal(edge.evidence, "extracted");
  assert.equal(edge.confidence, 1);
  assert.ok(
    graph.nodes.find(
      (node) => node.label === "Math" && node.kind === "concept",
    ),
  );
  assert.ok(graph.edges.find((edge) => edge.relation === "references"));
  const report = await fs.readFile(
    path.join(output(root), "project", "PROJECT.md"),
    "utf8",
  );
  assert.match(report, /src\/math.ts/);
  assert.match(report, /Catalogo de simbolos/);
  const ids = new Set(graph.nodes.map((node) => node.id));
  assert.ok(
    graph.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target)),
  );
});

test("reuses unchanged extraction, handles changes, deletion and stale decisions", async (t) => {
  const { root } = await fixture(t),
    first = await scanProject(root),
    second = await scanProject(root);
  assert.equal(second.stats.reused, first.stats.files);
  assert.equal(second.stats.changed, 0);
  await recordMemory(root, {
    kind: "decision",
    title: "Keep pure functions",
    text: "Arithmetic functions remain pure.",
    basis: "explicit",
    author: "user",
    sources: [{ path: "src/math.ts", line: 2 }],
  });
  await fs.writeFile(
    path.join(root, "src", "math.ts"),
    "export function subtract(a: number, b: number) { return a - b; }\n",
  );
  const changed = await scanProject(root);
  assert.equal(changed.stats.changed, 1);
  assert.ok(
    !changed.nodes.find(
      (node) => node.label === "add" && node.kind === "function",
    ),
  );
  assert.ok(changed.nodes.find((node) => node.label === "subtract"));
  assert.equal(
    changed.nodes.find((node) => node.kind === "decision").stale,
    true,
  );
  await fs.rm(path.join(root, "src", "math.ts"));
  const deleted = await scanProject(root);
  assert.equal(deleted.stats.removed, 1);
  assert.ok(!deleted.inventory.find((file) => file.path === "src/math.ts"));
  assert.ok(deleted.unresolved.some((item) => item.specifier === "./math.js"));
});

test("excludes sensitive, ignored, generated, oversized and symlink sources", async (t) => {
  const { root, base } = await fixture(t);
  await fs.writeFile(path.join(root, ".env"), "API_KEY=secretsecret");
  await fs.writeFile(path.join(root, ".env.local"), "PASSWORD=secretsecret");
  await fs.writeFile(path.join(root, ".gitignore"), "ignored/\n");
  await fs.mkdir(path.join(root, "ignored"));
  await fs.writeFile(path.join(root, "ignored", "private.ts"), "private");
  await fs.mkdir(path.join(root, "src", "nested"));
  await fs.writeFile(path.join(root, "src", ".gitignore"), "nested/\n");
  await fs.writeFile(path.join(root, "src", "nested", "ignored.ts"), "ignored");
  await fs.writeFile(path.join(root, "large.md"), "a".repeat(1024 * 1024 + 1));
  await fs.writeFile(
    path.join(root, "legacy.bundle.min.js"),
    "function bundled() {}\n",
  );
  await fs.writeFile(path.join(base, "outside.txt"), "never index");
  await fs.symlink(path.join(base, "outside.txt"), path.join(root, "link.txt"));
  const graph = await scanProject(root);
  assert.equal(graph.stats.files, 4);
  assert.equal(graph.stats.skipped.sensitive, 2);
  assert.equal(graph.stats.skipped.oversized, 1);
  assert.equal(graph.stats.skipped.symlink, 1);
  assert.equal(graph.stats.skipped.generated, 1);
  assert.ok(!JSON.stringify(graph).includes("secretsecret"));
});

test("bounded queries include source citations and do not invent search matches", async (t) => {
  const { root } = await fixture(t),
    graph = await scanProject(root);
  for (const budget of [128, 600, 1800]) {
    const result = queryGraph(graph, "add", { budget });
    assert.ok(result.tokens <= budget);
    assert.equal(result.tokens, tokenCount(result.text));
    assert.match(result.text, /src\/math.ts/);
  }
  assert.equal(queryGraph(graph, "zzzznomatch").matched, 0);
  const isolated = queryGraph(graph, "", {
    nodeId: graph.nodes.find((node) => node.label === "add").id,
    depth: 0,
  });
  assert.equal(isolated.nodes.length, 1);
  const byPath = queryGraph(graph, "math implementation", {
    nodeId: "src/math.ts",
    depth: 0,
  });
  assert.equal(byPath.anchor.matchedBy, "path");
  assert.match(byPath.text, /Ancora: math\.ts/);
  assert.equal(resolveNodeAnchor(graph, "add").matchedBy, "label");
});

test("cross-project graphs stay separate, infer recurrence and never mutate discovered projects", async (t) => {
  const { root, base } = await fixture(t),
    other = path.join(base, "beta");
  await fs.mkdir(other);
  await fs.writeFile(
    path.join(other, "package.json"),
    JSON.stringify({ name: "beta", dependencies: { react: "^19" } }),
  );
  await fs.writeFile(
    path.join(other, "secret-feature.ts"),
    'export function onlyBeta() { return "beta"; }',
  );
  const project = await scanProject(root),
    network = await updateNetwork(root, project);
  assert.ok(network.projects.some((item) => item.name === "beta"));
  assert.ok(
    network.patterns.some(
      (pattern) =>
        pattern.technology === "react" && !pattern.preferenceConfirmed,
    ),
  );
  assert.ok(!project.nodes.some((node) => node.label === "onlyBeta"));
  assert.equal(
    await fs.stat(path.join(other, ".graphora")).catch(() => null),
    null,
  );
  assert.ok(
    (await fs.readdir(path.join(output(root), "network", "projects"))).length >=
      1,
  );
});

test("memory rejects unknown sources, retains attribution and redacts obvious secrets", async (t) => {
  const { root } = await fixture(t);
  await scanProject(root);
  await assert.rejects(
    recordMemory(root, {
      kind: "decision",
      title: "bad source",
      text: "Something",
      sources: [{ path: "../outside.txt" }],
    }),
    /Fonte nao indexada/,
  );
  await recordMemory(root, {
    kind: "preference",
    title: "UI",
    text: "Use compact controls. api_key=sk-secret12345678901234567890",
    basis: "explicit",
    author: "user",
  });
  const data = await readJSON(
    path.join(output(root), "project", "memory.json"),
  );
  assert.equal(data[0].author, "user");
  assert.equal(data[0].basis, "explicit");
  assert.ok(!JSON.stringify(data).includes("sk-secret"));
  assert.match(data[0].text, /REDACTED/);
});

test("project integration is idempotent and preserves existing user configuration", async (t) => {
  const { root } = await fixture(t);
  await fs.writeFile(
    path.join(root, "AGENTS.md"),
    "# Existing\n\nKeep my rules.\n",
  );
  await writeJSON(path.join(root, ".mcp.json"), {
    mcpServers: { existing: { command: "example" } },
    other: true,
  });
  await install({ root });
  await install({ root });
  const agents = await fs.readFile(path.join(root, "AGENTS.md"), "utf8");
  assert.match(agents, /Keep my rules/);
  assert.equal(agents.split("<!-- graphora:start -->").length, 2);
  const mcp = await readJSON(path.join(root, ".mcp.json"));
  assert.equal(mcp.mcpServers.existing.command, "example");
  assert.equal(mcp.other, true);
  assert.ok(mcp.mcpServers.graphora);
  assert.ok(
    await fs.stat(path.join(root, ".claude", "commands", "Graphora.md")),
  );
  assert.ok(
    await fs.stat(path.join(root, ".codex", "skills", "graphora", "SKILL.md")),
  );
  assert.ok(
    await fs.stat(path.join(root, ".github", "copilot-instructions.md")),
  );
  assert.ok(
    await fs.stat(path.join(root, ".windsurf", "rules", "graphora.md")),
  );
});

test("tsconfig path aliases resolve to real project sources", async (t) => {
  const { root } = await fixture(t);
  await fs.writeFile(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
    }),
  );
  await fs.writeFile(
    path.join(root, "src", "index.ts"),
    "import { add } from '@/math';\nexport const run = () => add(1, 2);\n",
  );
  const graph = await scanProject(root);
  const math = graph.nodes.find(
    (node) => node.path === "src/math.ts" && node.kind === "file",
  );
  assert.ok(
    graph.edges.some(
      (edge) => edge.target === math.id && edge.relation === "imports",
    ),
  );
  assert.ok(!graph.unresolved.length);
});
