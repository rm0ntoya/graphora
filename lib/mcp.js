import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { scanProject, recordMemory } from "./graph.js";
import { queryGraph, resolveNodeAnchor } from "./query.js";
import { readJSON, output, canonical } from "./storage.js";
import { updateNetwork } from "./network.js";

export async function startMCP(projectRoot) {
  const root = await canonical(projectRoot);
  const server = new McpServer({ name: "graphora", version: "0.1.0" });
  const graph = async () =>
    (await readJSON(path.join(output(root), "project", "graph.json"))) ||
    (await scanProject(root));
  const result = (data, text = null) => ({
    content: [
      {
        type: "text",
        text:
          text ??
          (typeof data === "string" ? data : JSON.stringify(data, null, 2)),
      },
    ],
    ...(data && typeof data === "object" ? { structuredContent: data } : {}),
  });
  server.registerTool(
    "graphora_query",
    {
      description:
        "Retrieve a compact evidence-linked project subgraph. Search before reading broad files. Input tokens use o200k_base, other models may differ. Refresh after edits when the dashboard watcher is not running.",
      inputSchema: {
        question: z.string().max(2000),
        budget: z.number().int().min(128).max(32000).default(1800),
        depth: z.number().int().min(0).max(3).default(1),
        nodeId: z
          .string()
          .optional()
          .describe("Internal node ID, exact/unique path, or symbol name"),
      },
    },
    async (input) => {
      const query = queryGraph(await graph(), input.question, input);
      return result(query, query.text);
    },
  );
  server.registerTool(
    "graphora_inspect",
    {
      description:
        "Inspect one project node with a bounded set of evidence-linked incoming and outgoing relations.",
      inputSchema: {
        nodeId: z
          .string()
          .describe("Internal node ID, exact/unique path, or symbol name"),
        limit: z.number().int().min(1).max(100).default(25),
      },
    },
    async ({ nodeId, limit }) => {
      const data = await graph(),
        anchor = resolveNodeAnchor(data, nodeId),
        node = data.nodes.find((item) => item.id === anchor?.id);
      const relations = data.edges.filter(
        (edge) => edge.source === node?.id || edge.target === node?.id,
      );
      return result({
        node: node || null,
        anchor,
        edges: relations.slice(0, limit),
        totalEdges: relations.length,
        generatedAt: data.generatedAt,
      });
    },
  );
  server.registerTool(
    "graphora_refresh",
    {
      description:
        "Reconcile current project files, remove deleted entities and rebuild documentation. Incremental extraction uses file hashes.",
      inputSchema: {},
    },
    async () => result((await scanProject(root)).stats),
  );
  server.registerTool(
    "graphora_network",
    {
      description:
        "Read observed cross-project patterns separately from project context. Shared dependencies are not confirmed personal preferences.",
      inputSchema: {
        question: z.string().default(""),
        budget: z.number().int().min(128).max(6000).default(1200),
      },
    },
    async (input) => {
      const network =
        (await readJSON(path.join(output(root), "network", "graph.json"))) ||
        (await updateNetwork(root, await graph()));
      const query = queryGraph(network, input.question, input);
      return result(query, query.text);
    },
  );
  server.registerTool(
    "graphora_remember",
    {
      description:
        "Persist a project decision, concept, or preference with attribution. Use explicit only for a direct user declaration or documented decision; use inferred for hypotheses. Source hashes detect staleness.",
      inputSchema: {
        kind: z.enum(["decision", "preference", "concept"]),
        title: z.string().min(1).max(160),
        text: z.string().min(1).max(12000),
        basis: z.enum(["explicit", "inferred"]).default("inferred"),
        author: z.string().min(1),
        sources: z
          .array(
            z.object({
              path: z.string(),
              line: z.number().int().positive().optional(),
            }),
          )
          .default([]),
      },
    },
    async (input) => result(await recordMemory(root, input)),
  );
  await server.connect(new StdioServerTransport());
}
