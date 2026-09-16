import ts from "typescript";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { id, redact } from "./storage.js";

export const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
];
const CODE =
  /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|c|h|cpp|cs|rb|php|swift|vue|svelte)$/;
export function extractFile(file, projectId) {
  const nodes = [],
    edges = [],
    imports = [],
    calls = [],
    warnings = [];
  const fileId = id(projectId, "file", file.path);
  const kind = /\.(?:mdx?|txt|rst)$/.test(file.path)
    ? "document"
    : CODE.test(file.path)
      ? "file"
      : "config";
  const firstParagraph =
    file.text
      .split(/\n\s*\n/)
      .find((part) => /[a-zA-Z]{4}/.test(part) && !part.startsWith("---")) ||
    "";
  nodes.push({
    id: fileId,
    label: path.posix.basename(file.path),
    kind,
    path: file.path,
    line: 1,
    endLine: file.lines,
    bytes: file.bytes,
    information: file.bytes,
    summary: redact(
      firstParagraph.replace(/[#`*]/g, "").replace(/\s+/g, " ").slice(0, 280),
    ),
    language: path.extname(file.path).slice(1),
    hash: file.hash,
    evidence: "extracted",
    confidence: 1,
  });
  const addEdge = (
    source,
    target,
    relation,
    line = 1,
    evidence = "extracted",
    confidence = 1,
  ) =>
    edges.push({
      id: id(source, target, relation),
      source,
      target,
      relation,
      evidence,
      confidence,
      sourcePath: file.path,
      line,
    });
  const addSymbol = (
    label,
    symbolKind,
    line,
    endLine,
    summary = "",
    parent = fileId,
  ) => {
    const nodeId = id(projectId, file.path, symbolKind, label, String(line));
    const information = Buffer.byteLength(
      file.text
        .split("\n")
        .slice(line - 1, endLine)
        .join("\n"),
    );
    nodes.push({
      id: nodeId,
      label,
      kind: symbolKind,
      path: file.path,
      line,
      endLine,
      information,
      bytes: information,
      summary: redact(summary).slice(0, 500),
      hash: file.hash,
      evidence: "extracted",
      confidence: 1,
    });
    addEdge(parent, nodeId, "defines", line);
    return nodeId;
  };
  if (/\.[cm]?[jt]sx?$/.test(file.path)) {
    const source = ts.createSourceFile(
      file.path,
      file.text,
      ts.ScriptTarget.Latest,
      true,
      /x$/.test(file.path)
        ? ts.ScriptKind.TSX
        : /\.[cm]?js$/.test(file.path)
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS,
    );
    const lineOf = (position) =>
      source.getLineAndCharacterOfPosition(position).line + 1;
    const symbols = new Map();
    function visit(node, parent = fileId) {
      let nextParent = parent;
      const named =
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        (ts.isVariableDeclaration(node) &&
          node.initializer &&
          (ts.isArrowFunction(node.initializer) ||
            ts.isFunctionExpression(node.initializer)));
      if (named && node.name) {
        const symbolKind =
          ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isEnumDeclaration(node)
            ? "type"
            : "function";
        const label = node.name.getText(source);
        const comment = ts
          .getJSDocCommentsAndTags(node)
          .map((item) => item.comment || "")
          .filter((item) => typeof item === "string")
          .join(" ");
        nextParent = addSymbol(
          label,
          symbolKind,
          lineOf(node.getStart(source)),
          lineOf(node.end),
          comment,
          parent,
        );
        const matches = symbols.get(label) || [];
        matches.push(nextParent);
        symbols.set(label, matches);
      }
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        imports.push({
          specifier: node.moduleSpecifier.text,
          source: fileId,
          line: lineOf(node.getStart(source)),
          relation: ts.isExportDeclaration(node) ? "reexports" : "imports",
        });
      }
      if (ts.isCallExpression(node)) {
        if (
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) &&
              node.expression.text === "require")) &&
          node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0])
        ) {
          imports.push({
            specifier: node.arguments[0].text,
            source: fileId,
            line: lineOf(node.getStart(source)),
            relation: "imports",
          });
        } else if (ts.isIdentifier(node.expression))
          calls.push({
            caller: parent,
            label: node.expression.text,
            line: lineOf(node.getStart(source)),
          });
      }
      ts.forEachChild(node, (child) => visit(child, nextParent));
    }
    visit(source);
    for (const call of calls) {
      const matches = symbols.get(call.label);
      if (matches?.length === 1 && matches[0] !== call.caller)
        addEdge(call.caller, matches[0], "calls", call.line, "inferred", 0.85);
    }
    if (source.parseDiagnostics.length)
      warnings.push(
        `${file.path}: ${source.parseDiagnostics.length} erro(s) de sintaxe; extracao parcial.`,
      );
  } else if (file.path.endsWith(".py")) {
    const script = `import ast,json,sys\ns=json.load(sys.stdin)\ntry:\n t=ast.parse(s)\n out={'symbols':[],'imports':[]}\n for n in ast.walk(t):\n  if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)):\n   out['symbols'].append({'label':n.name,'kind':'type' if isinstance(n,ast.ClassDef) else 'function','line':n.lineno,'endLine':n.end_lineno,'summary':ast.get_docstring(n) or ''})\n  elif isinstance(n,ast.Import):\n   for a in n.names: out['imports'].append({'specifier':a.name,'line':n.lineno})\n  elif isinstance(n,ast.ImportFrom): out['imports'].append({'specifier':'.'*n.level+(n.module or ''),'line':n.lineno})\n print(json.dumps(out))\nexcept SyntaxError:\n print(json.dumps({'error':'syntax'}))`;
    const result = spawnSync("python3", ["-c", script], {
      input: JSON.stringify(file.text),
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 4 * 1024 * 1024,
    });
    try {
      const data = JSON.parse(result.stdout);
      if (data.error) warnings.push(`${file.path}: sintaxe Python invalida.`);
      for (const symbol of data.symbols || [])
        addSymbol(
          symbol.label,
          symbol.kind,
          symbol.line,
          symbol.endLine,
          symbol.summary,
        );
      for (const dependency of data.imports || [])
        imports.push({
          ...dependency,
          source: fileId,
          relation: "imports",
          python: true,
        });
    } catch {
      warnings.push(
        `${file.path}: Python AST indisponivel; arquivo indexado como texto.`,
      );
    }
  }
  if (kind === "document") {
    const lines = file.text.split("\n");
    let codeFence = false;
    lines.forEach((line, index) => {
      if (/^\s*```/.test(line)) codeFence = !codeFence;
      if (codeFence) return;
      const heading = line.match(/^#{1,4}\s+(.+)/);
      if (heading) {
        let end = index + 1;
        while (end < lines.length && !/^#{1,4}\s/.test(lines[end])) end++;
        addSymbol(
          heading[1].replace(/[`*]/g, ""),
          "concept",
          index + 1,
          end,
          lines
            .slice(index + 1, Math.min(end, index + 7))
            .join(" ")
            .slice(0, 350),
        );
      }
      for (const match of line.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
        if (!/^(?:https?:|mailto:|data:|#)/.test(match[1]))
          imports.push({
            source: fileId,
            specifier: match[1],
            line: index + 1,
            relation: "references",
            document: true,
          });
      }
    });
  }
  if (file.path.endsWith("package.json")) {
    try {
      const pkg = JSON.parse(file.text);
      for (const [scope, dependencies] of Object.entries({
        runtime: pkg.dependencies || {},
        development: pkg.devDependencies || {},
      })) {
        for (const [name, version] of Object.entries(dependencies)) {
          const depId = id(projectId, "dependency", name);
          nodes.push({
            id: depId,
            label: name,
            kind: "dependency",
            path: file.path,
            line: 1,
            information: 100,
            summary: `${scope}: ${version}`,
            evidence: "extracted",
            confidence: 1,
            version,
            scope,
          });
          addEdge(fileId, depId, "depends_on");
        }
      }
    } catch {
      warnings.push(`${file.path}: JSON invalido.`);
    }
  }
  return { nodes, edges, imports, warnings };
}

export function resolveImports(
  fragments,
  files,
  projectId,
  root,
  compilerOptions = {},
) {
  const paths = new Set(files.map((file) => file.path)),
    edges = [],
    externals = new Map(),
    unresolved = [];
  const candidates = (relative) => [
    relative,
    ...SOURCE_EXTENSIONS.map((ext) => relative + ext),
    ...SOURCE_EXTENSIONS.map((ext) => `${relative}/index${ext}`),
    relative + "/__init__.py",
  ];
  for (const [filename, fragment] of Object.entries(fragments)) {
    for (const imported of fragment.imports) {
      let resolved;
      const directory = path.posix.dirname(filename);
      if (imported.document)
        resolved = candidates(
          path.posix.normalize(path.posix.join(directory, imported.specifier)),
        ).find((item) => paths.has(item));
      else if (imported.python) {
        const dots = imported.specifier.match(/^\.+/)?.[0].length || 0;
        const module = imported.specifier.slice(dots).replaceAll(".", "/");
        const target = dots
          ? path.posix.join(directory, ...Array(dots - 1).fill(".."), module)
          : module;
        resolved = candidates(target).find((item) => paths.has(item));
      } else {
        const resolution = ts.resolveModuleName(
          imported.specifier,
          path.join(root, filename),
          {
            allowJs: true,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            ...compilerOptions,
          },
          ts.sys,
        ).resolvedModule;
        if (resolution && !resolution.isExternalLibraryImport) {
          const target = path
            .relative(root, resolution.resolvedFileName)
            .split(path.sep)
            .join("/");
          if (paths.has(target)) resolved = target;
        }
        if (!resolved && imported.specifier.startsWith(".")) {
          const target = path.posix.normalize(
            path.posix.join(directory, imported.specifier),
          );
          resolved =
            candidates(target).find((item) => paths.has(item)) ||
            candidates(target.replace(/\.[cm]?js$/, "")).find((item) =>
              paths.has(item),
            );
        }
      }
      let target;
      if (resolved) target = id(projectId, "file", resolved);
      else if (
        !imported.document &&
        !imported.specifier.startsWith(".") &&
        !imported.specifier.startsWith("@/") &&
        !imported.specifier.startsWith("~/")
      ) {
        const name = imported.python
          ? imported.specifier.split(".")[0]
          : imported.specifier.startsWith("@")
            ? imported.specifier.split("/").slice(0, 2).join("/")
            : imported.specifier.split("/")[0];
        target = id(projectId, "dependency", name);
        externals.set(target, {
          id: target,
          label: name,
          kind: "dependency",
          path: filename,
          line: imported.line,
          information: 90,
          summary: "Modulo externo referenciado no codigo.",
          evidence: "extracted",
          confidence: 1,
        });
      } else {
        unresolved.push({
          path: filename,
          specifier: imported.specifier,
          line: imported.line,
        });
        continue;
      }
      edges.push({
        id: id(imported.source, target, imported.relation),
        source: imported.source,
        target,
        relation: imported.relation,
        evidence: "extracted",
        confidence: 1,
        sourcePath: filename,
        line: imported.line,
      });
    }
  }
  return { edges, nodes: [...externals.values()], unresolved };
}
