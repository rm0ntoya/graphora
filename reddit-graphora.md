# Graphora: um grafo local de conhecimento para entender projetos de código com menos contexto

Estou desenvolvendo o **Graphora**, uma ferramenta local para transformar projetos de software em grafos navegáveis e consultáveis.

A ideia é ajudar desenvolvedores e agentes de IA a entenderem repositórios grandes sem precisar enviar o projeto inteiro como contexto.

## O dashboard em funcionamento

### Visão geral do grafo

![Graphora dashboard em desktop](https://raw.githubusercontent.com/rm0ntoya/graphora/main/test-results/desktop.png)

### Visão mobile

![Graphora dashboard em mobile](https://raw.githubusercontent.com/rm0ntoya/graphora/main/test-results/mobile.png)

### Mapa de símbolos

![Mapa de símbolos do Graphora](https://raw.githubusercontent.com/rm0ntoya/graphora/main/test-results/desktop-symbols.png)

### Constelação entre projetos

![Constelação entre projetos no Graphora](https://raw.githubusercontent.com/rm0ntoya/graphora/main/test-results/network.png)

## O que ele faz

- Analisa arquivos, símbolos, imports e relações entre módulos;
- Gera um grafo estrutural do projeto;
- Mantém evidências com caminho e linha de origem;
- Permite consultas limitadas por orçamento de tokens;
- Possui memória persistente para decisões de arquitetura;
- Mantém um dashboard 3D local;
- Oferece integração via MCP para assistentes de IA;
- Atualiza o grafo incrementalmente com um watcher;
- Filtra arquivos sensíveis, binários e arquivos muito grandes.

Exemplo de consulta:

```bash
node bin/graphora.js query \
  "qual funcao exige um usuario autenticado?" \
  --project /caminho/do/projeto \
  --budget 600 \
  --json
```

A resposta pode retornar algo como:

```text
requireUserId
Fonte: src/lib/session.ts:106
```

## Economia de tokens

Em um teste no próprio repositório do Graphora:

```text
Contexto bruto do projeto: 56.063 tokens
Contexto selecionado pelo Graphora: 593 tokens
Economia medida: 98,94%
```

Essa medição representa a redução do contexto enviado para a investigação. Não significa que todos os tokens de uma chamada de IA desaparecerão, porque ainda existem instruções, pergunta e resposta final.

## Teste em um projeto real

Também executei o Graphora em um projeto maior:

```text
6.249 arquivos processados
56.763 nós
109.851 relações
14 arquivos sensíveis filtrados
5.384 arquivos binários ignorados
6.249 arquivos reutilizados na segunda varredura
```

O dashboard fica disponível localmente, por exemplo:

```text
http://127.0.0.1:4546
```

## Como os modelos usam o Graphora

O Graphora pode ser usado diretamente pelo CLI ou integrado a assistentes de IA por MCP.

Nesse fluxo, o modelo consulta o grafo, recebe os nós relevantes e usa as fontes retornadas para construir a resposta. O Graphora funciona como uma camada de evidências estruturadas, enquanto o modelo transforma essas evidências em uma explicação legível.

O objetivo não é apenas retornar uma resposta, mas também informar:

- qual arquivo contém a informação;
- em qual linha ela aparece;
- quais símbolos estão relacionados;
- quanto contexto foi utilizado;
- o que é fato encontrado e o que é inferência.

## Limitações atuais

Em projetos com muitos sistemas legados, bundles compilados e assets, consultas genéricas podem retornar ruído. Consultas ancoradas em um arquivo ou símbolo específico produzem resultados melhores:

```bash
node bin/graphora.js query \
  "como funciona a sessao?" \
  --project /caminho/do/projeto \
  --node ID_DO_NO \
  --budget 1000
```

O projeto ainda está em early release e estou buscando feedback sobre:

- qualidade das consultas;
- melhores estratégias de filtragem;
- integração MCP;
- visualização do grafo;
- formas de medir economia de contexto;
- uso com diferentes modelos de IA.

## Repositório

https://github.com/rm0ntoya/graphora

Como vocês lidam hoje com contexto de grandes repositórios em ferramentas de IA?
