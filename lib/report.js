const cell = (value) =>
  String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
export function report(graph) {
  const { project, stats, nodes, edges } = graph;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const kinds = Object.entries(Object.groupBy(nodes, (node) => node.kind))
    .map(([kind, values]) => `| ${kind} | ${values.length} |`)
    .join("\n");
  const hubs = [...nodes]
    .filter((node) => node.kind !== "project")
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 20);
  const docs = nodes.filter((node) => node.kind === "document");
  const memories = nodes.filter((node) =>
    ["decision", "preference"].includes(node.kind),
  );
  const groups = Object.entries(
    Object.groupBy(
      nodes.filter((node) => !["dependency", "project"].includes(node.kind)),
      (node) => node.community,
    ),
  );
  const sections = [
    `# ${cell(project.name)}: mapa detalhado do projeto`,
    `Gerado em ${graph.generatedAt} por ${graph.generator}.\n\nRaiz: \`${project.root}\`.\n\n${project.description || "O manifesto nao declara uma descricao."}`,
    `## 1. Escopo e estado\n\n${stats.files} arquivos de texto indexados, ${stats.lines} linhas, ${stats.bytes} bytes, ${stats.nodes} nos e ${stats.edges} relacoes.\n\nUltima analise: ${stats.changed} arquivos alterados, ${stats.reused} reaproveitados, ${stats.removed} removidos.\n\n| Categoria | Nos |\n| --- | ---: |\n${kinds}`,
    `## 2. Arquitetura observada\n\nA estrutura abaixo e derivada dos arquivos e dependencias. Os grupos sao comunidades topologicas calculadas por Louvain; seus nomes nao representam fronteiras arquiteturais confirmadas.\n\n${groups
      .map(
        ([community, members]) =>
          `### Comunidade ${Number(community) + 1}\n\n${members.length} nos. Mais conectados: ${members
            .sort((a, b) => b.degree - a.degree)
            .slice(0, 8)
            .map((node) => `\`${node.label}\` (${node.degree})`)
            .join(", ")}.\n\nCaminhos: ${[
            ...new Set(members.map((node) => node.path)),
          ]
            .slice(0, 15)
            .map((p) => `\`${p}\``)
            .join(", ")}.`,
      )
      .join("\n\n")}`,
    `## 3. Pontos de maior conectividade\n\n| Entidade | Tipo | Conexoes | Fonte |\n| --- | --- | ---: | --- |\n${hubs.map((node) => `| ${cell(node.label)} | ${node.kind} | ${node.degree} | ${cell(node.path)}:${node.line} |`).join("\n")}`,
    `## 4. Dependencias externas\n\n| Dependencia | Versao / evidencia | Fonte |\n| --- | --- | --- |\n${nodes
      .filter((node) => node.kind === "dependency")
      .map(
        (node) =>
          `| ${cell(node.label)} | ${cell(node.summary)} | ${cell(node.path)}:${node.line} |`,
      )
      .join("\n")}`,
    `## 5. Documentacao e conceitos\n\n${
      docs.length
        ? docs
            .map(
              (node) =>
                `### ${cell(node.path)}\n\n${node.summary}\n\n${nodes
                  .filter(
                    (concept) =>
                      concept.path === node.path && concept.kind === "concept",
                  )
                  .map(
                    (concept) =>
                      `- **${cell(concept.label)}** (linha ${concept.line}): ${concept.summary}`,
                  )
                  .join("\n")}`,
            )
            .join("\n\n")
        : "Nenhum documento textual encontrado."
    }`,
    `## 6. Decisoes e preferencias\n\n${memories.length ? memories.map((node) => `### ${cell(node.label)}\n\n${node.summary}\n\nTipo: ${node.kind}; evidencia: ${node.evidence}; autor: ${cell(node.author)}; desatualizada: ${node.stale ? "sim, revisar fontes" : "nao"}.`).join("\n\n") : "Nenhuma decisao ou preferencia registrada explicitamente. Dependencias recorrentes entre projetos sao apenas padroes observados, nao preferencias confirmadas."}`,
    `## 7. Inventario completo\n\n| Arquivo | Linhas | Bytes | SHA-256 |\n| --- | ---: | ---: | --- |\n${graph.inventory.map((file) => `| ${cell(file.path)} | ${file.lines} | ${file.bytes} | ${file.hash.slice(0, 12)} |`).join("\n")}`,
    `## 8. Catalogo de simbolos\n\n| Simbolo | Tipo | Arquivo | Linhas |\n| --- | --- | --- | --- |\n${nodes
      .filter((node) => ["function", "type"].includes(node.kind))
      .map(
        (node) =>
          `| ${cell(node.label)} | ${node.kind} | ${cell(node.path)} | ${node.line}-${node.endLine} |`,
      )
      .join("\n")}`,
    `## 9. Relacoes rastreaveis\n\n| Origem | Relacao | Destino | Evidencia | Fonte |\n| --- | --- | --- | --- | --- |\n${edges
      .filter((edge) => !["contains", "defines"].includes(edge.relation))
      .map(
        (edge) =>
          `| ${cell(nodeById.get(edge.source)?.label)} | ${edge.relation} | ${cell(nodeById.get(edge.target)?.label)} | ${edge.evidence} (${edge.confidence}) | ${cell(edge.sourcePath)}:${edge.line} |`,
      )
      .join("\n")}`,
    `## 10. Lacunas e limites\n\n- A analise estrutural de JavaScript e TypeScript usa o parser TypeScript; Python usa ast quando python3 esta disponivel. Outras linguagens sao indexadas como texto.\n- Chamadas locais por nome sao inferencias: nao ha resolucao completa de escopo ou de tipos.\n- Midia, binarios, arquivos ignorados, dependencias vendorizadas e arquivos sensiveis nao sao analisados.\n- Limites de tamanho e quantidade sao configuraveis em .graphora/config.json.\n- Nao ha treinamento do modelo, nem promessa de memoria perfeita; a recuperacao depende da integracao e da atualidade das fontes.\n- O relatorio descreve evidencias observadas; a intencao do produto requer documentacao ou memorias declaradas.\n\nExclusoes: \`${JSON.stringify(stats.skipped)}\`.\n\n### Referencias nao resolvidas\n\n${graph.unresolved.length ? graph.unresolved.map((item) => `- ${cell(item.path)}:${item.line} -> \`${cell(item.specifier)}\``).join("\n") : "Nenhuma referencia local nao resolvida."}\n\n### Avisos de extracao\n\n${graph.warnings.length ? graph.warnings.map((warning) => `- ${warning}`).join("\n") : "Nenhum aviso."}`,
    `## 11. Uso por assistentes\n\n1. Consultar o grafo com um orcamento de contexto, mantendo arquivo e linha como fontes.\n2. Ler o codigo original antes de editar ou tirar conclusoes que o grafo nao comprova.\n3. Registrar decisoes, justificativas e preferencias declaradas por meio de graphora remember ou MCP.\n4. Atualizar o grafo apos alteracoes; enquanto o servidor esta ativo, o watcher realiza atualizacoes incrementais.\n5. Consultar a memoria entre projetos separadamente. Nao assumir que uma regra de outro projeto se aplica aqui.\n\nRelatorio completo: este arquivo. Contexto curto: CONTEXT.md. Dados: graph.json. Memorias: memory.json. Rede entre projetos: ../network/.`,
  ];
  return sections.join("\n\n") + "\n";
}
