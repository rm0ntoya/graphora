# Graphora: a local knowledge graph for understanding codebases with less context

I am building **Graphora**, a local tool that turns software projects into navigable and queryable knowledge graphs.

The goal is to help developers and AI agents understand large repositories without sending the entire codebase as context.

## The dashboard in action

### Graph overview

![Graphora dashboard on desktop](https://raw.githubusercontent.com/rm0ntoya/graphora/main/test-results/desktop.png)

### Mobile view

![Graphora dashboard on mobile](https://raw.githubusercontent.com/rm0ntoya/graphora/main/test-results/mobile.png)

### Symbol map

![Graphora symbol map](https://raw.githubusercontent.com/rm0ntoya/graphora/main/test-results/desktop-symbols.png)

### Cross-project constellation

![Graphora cross-project constellation](https://raw.githubusercontent.com/rm0ntoya/graphora/main/test-results/network.png)

## What it does

- Analyzes files, symbols, imports, and relationships between modules;
- Builds a structural graph of the project;
- Preserves evidence with source paths and line numbers;
- Supports queries with an explicit token budget;
- Provides persistent memory for architecture decisions;
- Includes a local 3D dashboard;
- Integrates with AI assistants through MCP;
- Updates the graph incrementally with a file watcher;
- Filters sensitive files, binaries, and oversized files.

Example query:

```bash
node bin/graphora.js query \
  "which function requires an authenticated user?" \
  --project /path/to/project \
  --budget 600 \
  --json
```

The result may look like this:

```text
requireUserId
Source: src/lib/session.ts:106
```

## Token savings

In a test run against the Graphora repository itself:

```text
Raw project context: 56,063 tokens
Context selected by Graphora: 593 tokens
Measured savings: 98.94%
```

This measures the reduction in context sent for the investigation. It does not mean that every token in an AI call disappears, since the prompt, instructions, and final answer still have their own cost.

## A real-world project test

I also ran Graphora against a larger project:

```text
6,249 files processed
56,763 nodes
109,851 relationships
14 sensitive files filtered
5,384 binary files skipped
6,249 files reused on the second scan
```

The dashboard is available locally, for example:

```text
http://127.0.0.1:4546
```

## How AI models use Graphora

Graphora can be used directly through the CLI or integrated with AI assistants through MCP.

In this workflow, the model queries the graph, receives relevant nodes, and uses the returned sources to build an answer. Graphora acts as a structured evidence layer, while the model turns that evidence into a readable explanation.

The goal is not just to return an answer, but also to identify:

- which file contains the information;
- which line contains it;
- which symbols are related;
- how much context was used;
- what is a discovered fact versus an inference.

## Current limitations

In projects with many legacy systems, compiled bundles, and assets, broad queries can return noise. Queries anchored to a specific file or symbol produce better results:

```bash
node bin/graphora.js query \
  "how does the session system work?" \
  --project /path/to/project \
  --node NODE_ID \
  --budget 1000
```

The project is still an early release, and I am looking for feedback on:

- query quality;
- better filtering strategies;
- MCP integration;
- graph visualization;
- ways to measure context savings;
- use with different AI models.

## Repository

https://github.com/rm0ntoya/graphora

How do you currently handle context from large repositories in AI tools?
