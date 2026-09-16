import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Code2,
  Copy,
  Database,
  Eye,
  FileCode2,
  FileText,
  Folder,
  Focus,
  GitBranch,
  Globe2,
  Layers3,
  ListFilter,
  LoaderCircle,
  Maximize2,
  Menu,
  Minus,
  Network,
  Orbit,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Terminal,
  Waypoints,
  X,
  ZoomIn,
  ScanLine,
  Camera,
  Plug,
  BrainCircuit,
  Clock3,
} from "lucide-react";
import { GraphScene, COLORS, LABELS } from "./GraphScene.jsx";

const fmt = (value) => new Intl.NumberFormat("pt-BR").format(value || 0);
const size = (bytes) =>
  bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(0.1, bytes / 1024).toFixed(1)} KB`;
const time = (value) =>
  value
    ? new Date(value).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "--:--";
const RELATIONS = {
  contains: "contem",
  defines: "define",
  imports: "importa",
  reexports: "reexporta",
  calls: "chama",
  depends_on: "depende de",
  references: "referencia",
  remembers: "registra",
  documented_in: "documentado em",
  uses: "utiliza",
  shares_content: "compartilha conteudo",
};
async function api(route, body) {
  const response = await fetch(
    `/api/${route}`,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Graphora-Client": "local",
          },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Nao foi possivel concluir a operacao.");
  return data;
}
function IconButton({ icon: Icon, label, active, ...props }) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      {...props}
    >
      <Icon size={17} strokeWidth={1.65} />
    </button>
  );
}
function Dot({ kind, color }) {
  return (
    <span
      className="dot"
      style={{ background: color || COLORS[kind] || "#9da6a7" }}
    />
  );
}
function Empty({ icon: Icon = Network, children }) {
  return (
    <div className="empty">
      <Icon size={28} strokeWidth={1.2} />
      <p>{children}</p>
    </div>
  );
}

export default function App() {
  const [graph, setGraph] = useState(null),
    [network, setNetwork] = useState(null),
    [status, setStatus] = useState({ scanning: true });
  const [scope, setScope] = useState("project"),
    [view, setView] = useState("map"),
    [selected, setSelected] = useState(null);
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState(null),
    [level, setLevel] = useState("files");
  const [labels, setLabels] = useState(true),
    [orbit, setOrbit] = useState(false),
    [frozen, setFrozen] = useState(false),
    [colorMode, setColorMode] = useState("kind");
  const [focus, setFocus] = useState(null),
    [isolated, setIsolated] = useState(false),
    [settings, setSettings] = useState(false);
  const [modal, setModal] = useState(null),
    [source, setSource] = useState(null),
    [toast, setToast] = useState("");
  const [mobileNav, setMobileNav] = useState(false),
    [history, setHistory] = useState([]),
    [integrations, setIntegrations] = useState(null);
  const [question, setQuestion] = useState(""),
    [budget, setBudget] = useState(1800),
    [context, setContext] = useState(null),
    [querying, setQuerying] = useState(false);
  const [memory, setMemory] = useState({
      kind: "decision",
      title: "",
      text: "",
      basis: "explicit",
      author: "user",
    }),
    [saving, setSaving] = useState(false);
  const scene = useRef(null),
    workspace = useRef(null),
    queryInput = useRef(null);
  const notify = (message) => {
    setToast(message);
    setTimeout(() => setToast(""), 3500);
  };
  async function load() {
    try {
      const [projectData, networkData, currentStatus] = await Promise.all([
        api("graph"),
        api("network"),
        api("status"),
      ]);
      if (!projectData.pending) setGraph(projectData);
      if (!networkData.pending) setNetwork(networkData);
      setStatus(currentStatus);
    } catch (error) {
      setStatus((previous) => ({
        ...previous,
        error: error.message,
        scanning: false,
      }));
    }
  }
  useEffect(() => {
    void load();
    const events = new EventSource("/api/events");
    const onStatus = (event) => {
      const next = JSON.parse(event.data);
      setStatus(next);
      if (!next.scanning) void load();
    };
    events.addEventListener("status", onStatus);
    events.addEventListener("graph", () => {
      void load();
    });
    events.addEventListener("network", () => {
      void load();
    });
    events.onerror = () =>
      setStatus((previous) => ({ ...previous, disconnected: true }));
    events.onopen = () =>
      setStatus((previous) => ({ ...previous, disconnected: false }));
    return () => events.close();
  }, []);
  useEffect(() => {
    if (view === "activity")
      api("history")
        .then(setHistory)
        .catch((error) => notify(error.message));
    if (view === "integrations")
      api("integrations")
        .then(setIntegrations)
        .catch((error) => notify(error.message));
  }, [view, graph?.generatedAt]);
  useEffect(() => {
    if (!modal) return;
    const previousFocus = document.activeElement;
    const dialog = document.querySelector('[role="dialog"]');
    const elements = () => [...dialog.querySelectorAll('button:not([disabled]), input, select, textarea, a[href]')];
    elements()[0]?.focus();
    const keydown = event => {
      if (event.key === 'Escape') setModal(null);
      if (event.key === 'Tab') {
        const items = elements(), first = items[0], last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previousFocus?.focus(); };
  }, [modal]);
  const activeGraph = scope === "network" ? network : graph;
  const selectedNode = activeGraph?.nodes.find((node) => node.id === selected);
  const connections = useMemo(
    () =>
      (activeGraph?.edges || [])
        .filter((edge) => edge.source === selected || edge.target === selected)
        .map((edge) => ({
          ...edge,
          incoming: edge.target === selected,
          node: activeGraph.nodes.find(
            (node) =>
              node.id ===
              (edge.source === selected ? edge.target : edge.source),
          ),
        }))
        .filter((edge) => edge.node),
    [activeGraph, selected],
  );
  const categories = useMemo(
    () =>
      Object.entries(
        Object.groupBy(activeGraph?.nodes || [], (node) => node.kind),
      ).map(([kind, nodes]) => ({ kind, count: nodes.length })),
    [activeGraph],
  );
  const visible = useMemo(() => {
    if (!activeGraph) return { nodes: [], edges: [], total: 0 };
    const adjacent = new Set([
      selected,
      ...connections.map((edge) => edge.node.id),
    ]);
    let nodes = activeGraph.nodes.filter(
      (node) =>
        (!filter || node.kind === filter) &&
        (scope === "network" ||
          level === "all" ||
          !["function", "type", "concept"].includes(node.kind) ||
          node.id === selected),
    );
    if (isolated && selected)
      nodes = activeGraph.nodes.filter((node) => adjacent.has(node.id));
    if (search.trim()) {
      const term = search.toLowerCase();
      nodes = nodes.filter((node) =>
        `${node.label} ${node.path} ${node.summary}`
          .toLowerCase()
          .includes(term),
      );
    }
    const total = nodes.length;
    nodes = [...nodes]
      .sort(
        (a, b) =>
          (b.id === selected ? 100000 : b.degree) -
          (a.id === selected ? 100000 : a.degree),
      )
      .slice(0, 700);
    const ids = new Set(nodes.map((node) => node.id));
    return {
      nodes,
      edges: activeGraph.edges.filter(
        (edge) => ids.has(edge.source) && ids.has(edge.target),
      ),
      total,
    };
  }, [
    activeGraph,
    filter,
    level,
    scope,
    search,
    selected,
    isolated,
    connections,
  ]);
  const hubs = useMemo(
    () =>
      [...(activeGraph?.nodes || [])]
        .filter((node) => !["project", "dependency"].includes(node.kind))
        .sort((a, b) => b.degree - a.degree)
        .slice(0, 5),
    [activeGraph],
  );
  function select(node, fly = false) {
    setSelected(node?.id || null);
    if (fly && node) setFocus({ id: node.id, at: Date.now() });
  }
  function changeScope(next) {
    setScope(next);
    setSelected(null);
    setFilter(null);
    setSearch("");
    setIsolated(false);
    setContext(null);
  }
  function navigate(next) {
    setView(next);
    setMobileNav(false);
  }
  async function refresh() {
    try {
      setStatus((previous) => ({ ...previous, scanning: true }));
      await api("refresh", {});
      await load();
      notify("Mapa atualizado.");
    } catch (error) {
      notify(error.message);
      setStatus((previous) => ({ ...previous, scanning: false }));
    }
  }
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      notify("Copiado.");
    } catch {
      notify("Nao foi possivel acessar a area de transferencia.");
    }
  }
  async function query(event) {
    event?.preventDefault();
    setQuerying(true);
    try {
      setContext(
        await api("query", {
          question,
          budget,
          scope,
          depth: 1,
          nodeId: selected || undefined,
        }),
      );
    } catch (error) {
      notify(error.message);
    } finally {
      setQuerying(false);
    }
  }
  async function inspectSource() {
    try {
      setSource(await api(`source?node=${encodeURIComponent(selected)}`));
      setModal("source");
    } catch (error) {
      notify(error.message);
    }
  }
  async function saveMemory(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await api("memory", {
        ...memory,
        sources:
          selectedNode &&
          graph?.inventory.some((file) => file.path === selectedNode.path)
            ? [{ path: selectedNode.path, line: selectedNode.line }]
            : [],
      });
      setModal(null);
      setMemory({
        kind: "decision",
        title: "",
        text: "",
        basis: "explicit",
        author: "user",
      });
      await load();
      notify("Memoria registrada com autoria.");
    } catch (error) {
      notify(error.message);
    } finally {
      setSaving(false);
    }
  }
  const stats = activeGraph?.stats || {};
  const nav = [
    { id: "map", icon: Orbit, label: "Observatorio" },
    { id: "files", icon: Layers3, label: "Explorador" },
    { id: "memory", icon: BrainCircuit, label: "Memoria" },
    { id: "activity", icon: Activity, label: "Atividade" },
    { id: "integrations", icon: Plug, label: "Assistentes" },
  ];

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <a className="brand" href="/" aria-label="Graphora inicio">
          <Waypoints size={28} strokeWidth={1.4} />
          <span>
            Graphora<span className="brand-period">.</span>
          </span>
          <span className="version">01</span>
        </a>
        <button
          className="project-picker"
          onClick={() => {
            changeScope(scope === "project" ? "network" : "project");
            navigate("map");
          }}
          title="Alternar entre projeto e constelacao"
        >
          <span className="project-icon">
            <Box size={18} />
          </span>
          <span>
            <small>WORKSPACE LOCAL</small>
            <strong>{graph?.project.name || "Carregando..."}</strong>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="section-label">ESPACO DE TRABALHO</div>
        <nav>
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? "selected" : ""}`}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={18} strokeWidth={1.55} />
              <span>{item.label}</span>
              {item.id === "map" && <span className="nav-count">3D</span>}
              {item.id === "memory" && (
                <span className="nav-count neutral">
                  {graph?.nodes.filter((node) =>
                    ["decision", "preference"].includes(node.kind),
                  ).length || 0}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <div className="section-label">
          ESCOPO <span>{scope === "network" ? "02" : "01"}</span>
        </div>
        <button
          className={`scope-item ${scope === "project" ? "current" : ""}`}
          onClick={() => changeScope("project")}
        >
          <Folder size={15} />
          <span>Este projeto</span>
          <span className="tiny-light" />
        </button>
        <button
          className={`scope-item ${scope === "network" ? "current" : ""}`}
          onClick={() => changeScope("network")}
        >
          <Globe2 size={15} />
          <span>Entre projetos</span>
          <span className="mono muted">{network?.projects?.length || 0}</span>
        </button>
        <div className="sidebar-bottom">
          <div className="local-badge">
            <span
              className={`status-dot ${status.disconnected || status.error ? "bad" : ""}`}
            />
            <span>
              {status.disconnected ? "Desconectado" : "Ambiente local"}
            </span>
            <span className="mono">127.0.0.1</span>
          </div>
          <div className="sidebar-footer">
            <span>GRAPHORA ENGINE</span>
            <span>v0.1.0</span>
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumb">
            <IconButton
              icon={Menu}
              label="Abrir navegacao"
              onClick={() => setMobileNav(!mobileNav)}
              className="icon-button mobile-menu"
            />
            <span className="breadcrumb-icon">
              <Network size={16} />
            </span>
            <span>Workspace</span>
            <ChevronRight size={12} />
            <strong>
              {scope === "network"
                ? "Constelacao"
                : graph?.project.name || "Projeto"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="private-label">
              <span className="status-dot" /> Local e privado
            </span>
            <button
              className="button small"
              onClick={() => window.open("/api/export/md", "_blank")}
            >
              <FileText size={14} />
              <span>Relatorio .md</span>
              <ArrowUpRight size={13} />
            </button>
            <span className="avatar">G</span>
          </div>
        </header>
        <main className="workspace" ref={workspace}>
          <div className="workspace-heading">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-line" />
                {scope === "network"
                  ? "INTELIGENCIA ENTRE PROJETOS"
                  : "INTELIGENCIA DO PROJETO"}
              </div>
              <h1>
                {view === "map"
                  ? "Mapa de conhecimento"
                  : nav.find((item) => item.id === view)?.label}
              </h1>
            </div>
            <div className="heading-actions">
              <div
                className={`live-indicator ${status.scanning ? "working" : ""}`}
              >
                {status.scanning ? (
                  <LoaderCircle size={12} className="spin" />
                ) : (
                  <span className="status-dot" />
                )}
                <span>
                  {status.scanning
                    ? "Analisando"
                    : status.disconnected
                      ? "Offline"
                      : status.watching
                        ? "Sincronizado"
                        : "Snapshot"}
                </span>
              </div>
              <button
                className="button"
                onClick={refresh}
                disabled={status.scanning}
              >
                <RefreshCw
                  size={14}
                  className={status.scanning ? "spin" : ""}
                />
                <span>Atualizar</span>
              </button>
            </div>
          </div>
          {status.error && (
            <div className="error-banner">
              {status.error}
              <button onClick={refresh}>Tentar novamente</button>
            </div>
          )}
          <div className="metrics-strip">
            <div>
              <span className="metric-value">{fmt(stats.nodes)}</span>
              <span>nos</span>
              <Waypoints size={15} />
            </div>
            <div>
              <span className="metric-value">{fmt(stats.edges)}</span>
              <span>conexoes</span>
              <GitBranch size={15} />
            </div>
            <div>
              <span className="metric-value">{fmt(stats.communities)}</span>
              <span>{scope === "network" ? "projetos" : "comunidades"}</span>
              <Box size={15} />
            </div>
            <div>
              <span className="metric-value">{fmt(stats.files)}</span>
              <span>arquivos</span>
              <FileCode2 size={15} />
            </div>
            <span className="last-sync mono">
              ULTIMA LEITURA <strong>{time(activeGraph?.generatedAt)}</strong>
            </span>
          </div>

          {view === "map" && (
            <div className="observatory">
              <div className="map-column">
                <div className="map-toolbar">
                  <div className="segmented">
                    <button
                      className={scope === "project" ? "active" : ""}
                      onClick={() => changeScope("project")}
                    >
                      Projeto
                    </button>
                    <button
                      className={scope === "network" ? "active" : ""}
                      onClick={() => changeScope("network")}
                    >
                      Constelacao
                    </button>
                  </div>
                  <div className="toolbar-right">
                    <label className="search-field">
                      <Search size={14} />
                      <input
                        placeholder="Buscar no mapa"
                        aria-label="Buscar no mapa"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                      {search && (
                        <button
                          aria-label="Limpar busca"
                          onClick={() => setSearch("")}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </label>
                    <IconButton
                      icon={SlidersHorizontal}
                      label="Ajustes do mapa"
                      active={settings}
                      onClick={() => setSettings(!settings)}
                    />
                  </div>
                </div>
                <div className="scene-area">
                  {activeGraph ? (
                    <GraphScene
                      ref={scene}
                      data={visible}
                      selected={selected}
                      onSelect={(node) => select(node)}
                      labels={labels}
                      orbit={orbit}
                      frozen={frozen}
                      colorMode={colorMode}
                      focus={focus}
                    />
                  ) : (
                    <div className="scene-loading">
                      <LoaderCircle className="spin" size={28} />
                      <span>Construindo o mapa do projeto</span>
                    </div>
                  )}
                  {activeGraph && !visible.nodes.length && (
                    <div className="scene-empty">
                      <Search size={26} />
                      <p>Nenhum no neste recorte.</p>
                      <button
                        className="button"
                        onClick={() => {
                          setFilter(null);
                          setSearch("");
                          setLevel("all");
                        }}
                      >
                        Limpar filtros
                      </button>
                    </div>
                  )}
                  <div className="map-coordinate">
                    <span className="crosshair">+</span>
                    <span className="mono">
                      {scope === "network" ? "CONSTELLATION" : "PROJECT GRAPH"}
                      <br />
                      <small>
                        {fmt(visible.nodes.length)} / {fmt(stats.nodes)} NOS
                        VISIVEIS
                      </small>
                    </span>
                  </div>
                  {isolated && (
                    <button
                      className="focus-pill"
                      onClick={() => setIsolated(false)}
                    >
                      <Focus size={13} /> Vizinhanca do no <X size={13} />
                    </button>
                  )}
                  {settings && (
                    <div className="settings-panel">
                      <div className="panel-label">
                        VISUALIZACAO
                        <IconButton
                          icon={X}
                          label="Fechar ajustes"
                          onClick={() => setSettings(false)}
                        />
                      </div>
                      <label>
                        Detalhamento
                        <select
                          value={level}
                          onChange={(event) => setLevel(event.target.value)}
                        >
                          <option value="files">Arquivos e modulos</option>
                          <option value="all">Todos os simbolos</option>
                        </select>
                      </label>
                      <label>
                        Cores
                        <select
                          value={colorMode}
                          onChange={(event) => setColorMode(event.target.value)}
                        >
                          <option value="kind">Tipo de informacao</option>
                          <option value="community">Comunidade</option>
                        </select>
                      </label>
                      <label className="toggle-row">
                        Rotulos
                        <input
                          type="checkbox"
                          checked={labels}
                          onChange={(event) => setLabels(event.target.checked)}
                        />
                      </label>
                      <label className="toggle-row">
                        Orbita automatica
                        <input
                          type="checkbox"
                          checked={orbit}
                          onChange={(event) => setOrbit(event.target.checked)}
                        />
                      </label>
                    </div>
                  )}
                  <div className="scene-tools">
                    <IconButton
                      icon={Plus}
                      label="Aproximar"
                      onClick={() => scene.current?.zoom(0.78)}
                    />
                    <IconButton
                      icon={Minus}
                      label="Afastar"
                      onClick={() => scene.current?.zoom(1.28)}
                    />
                    <span />
                    <IconButton
                      icon={ScanLine}
                      label="Enquadrar grafo"
                      onClick={() => scene.current?.fit()}
                    />
                    <IconButton
                      icon={orbit ? Pause : Orbit}
                      label={orbit ? "Parar orbita" : "Orbitar grafo"}
                      active={orbit}
                      onClick={() => setOrbit(!orbit)}
                    />
                    <IconButton
                      icon={Camera}
                      label="Exportar imagem"
                      onClick={() => scene.current?.screenshot()}
                    />
                    <IconButton
                      icon={Maximize2}
                      label="Tela cheia"
                      onClick={() => {
                        if (document.fullscreenElement)
                          document.exitFullscreen();
                        else
                          workspace.current
                            ?.requestFullscreen()
                            .catch(() => notify("Tela cheia indisponivel."));
                      }}
                    />
                  </div>
                  <div className="axis-widget" aria-hidden="true">
                    <i />
                    <b />
                    <span />
                    <em>X</em>
                    <em>Y</em>
                    <em>Z</em>
                  </div>
                  <div className="map-bottom">
                    <span className="mono">
                      <span className="status-dot" /> WEBGL / 3D
                    </span>
                    <button
                      className="text-button"
                      onClick={() => setModal("legend")}
                    >
                      <Circle size={11} />
                      <span>Volume = informacao</span>
                      <ArrowUpRight size={12} />
                    </button>
                  </div>
                </div>
                <div className="legend-strip">
                  <button
                    className={!filter ? "selected" : ""}
                    onClick={() => setFilter(null)}
                  >
                    Todos
                  </button>
                  {categories
                    .filter(
                      (item) =>
                        scope === "network" ||
                        level === "all" ||
                        !["function", "type", "concept"].includes(item.kind),
                    )
                    .map((item) => (
                      <button
                        key={item.kind}
                        className={filter === item.kind ? "selected" : ""}
                        onClick={() =>
                          setFilter(filter === item.kind ? null : item.kind)
                        }
                      >
                        <Dot kind={item.kind} />
                        <span>{LABELS[item.kind]}</span>
                        <small>{item.count}</small>
                      </button>
                    ))}
                </div>
              </div>

              <aside className="inspector">
                <div className="inspector-top">
                  <span>
                    {selectedNode ? "NO SELECIONADO" : "VISAO DO PROJETO"}
                  </span>
                  {selectedNode ? (
                    <IconButton
                      icon={X}
                      label="Limpar selecao"
                      onClick={() => {
                        setSelected(null);
                        setIsolated(false);
                      }}
                    />
                  ) : (
                    <Box size={15} />
                  )}
                </div>
                {selectedNode ? (
                  <>
                    <div className="selected-heading">
                      <span className="node-type">
                        <Dot kind={selectedNode.kind} />
                        {LABELS[selectedNode.kind]}
                      </span>
                      <h2>{selectedNode.label}</h2>
                      <span className="file-path mono">
                        {selectedNode.path}
                        {selectedNode.line ? `:${selectedNode.line}` : ""}
                      </span>
                    </div>
                    <div className="node-stats">
                      <div>
                        <strong>{selectedNode.degree || 0}</strong>
                        <span>Conexoes</span>
                      </div>
                      <div>
                        <strong>{size(selectedNode.information || 0)}</strong>
                        <span>Informacao</span>
                      </div>
                      <div>
                        <strong>
                          {Number(selectedNode.community || 0) + 1}
                        </strong>
                        <span>Comunidade</span>
                      </div>
                    </div>
                    <div className="inspector-section">
                      <div className="section-title">
                        EVIDENCIA
                        <span className={`evidence ${selectedNode.evidence}`}>
                          {selectedNode.evidence === "extracted"
                            ? "Extraida"
                            : selectedNode.evidence === "declared"
                              ? "Declarada"
                              : "Inferida"}
                        </span>
                      </div>
                      <p className="node-summary">
                        {selectedNode.summary ||
                          "Entidade identificada na estrutura do projeto."}
                      </p>
                      {selectedNode.stale && (
                        <p className="stale-note">
                          A fonte mudou. Esta memoria precisa de revisao.
                        </p>
                      )}
                      <div className="node-actions">
                        <button
                          className="button"
                          onClick={() => {
                            setFocus({ id: selected, at: Date.now() });
                            setIsolated(true);
                          }}
                        >
                          <Focus size={13} />
                          Isolar
                        </button>
                        <button className="button" onClick={inspectSource}>
                          <Code2 size={13} />
                          Fonte
                        </button>
                        <IconButton
                          icon={Copy}
                          label="Copiar referencia"
                          onClick={() =>
                            copy(
                              `${selectedNode.label} (${selectedNode.path}:${selectedNode.line || 1})`,
                            )
                          }
                        />
                      </div>
                    </div>
                    <div className="inspector-section connections">
                      <div className="section-title">
                        CONEXOES <span>{connections.length}</span>
                      </div>
                      {connections.slice(0, 40).map((edge) => (
                        <button
                          key={edge.id}
                          className="connection"
                          onClick={() => select(edge.node, true)}
                        >
                          <Dot kind={edge.node.kind} />
                          <span>
                            <strong>{edge.node.label}</strong>
                            <small>
                              {edge.incoming ? "recebe: " : ""}
                              {RELATIONS[edge.relation] || edge.relation} ·{" "}
                              {edge.evidence === "inferred"
                                ? "inferida"
                                : "extraida"}
                            </small>
                          </span>
                          <ArrowUpRight size={13} />
                        </button>
                      ))}
                      {connections.length > 40 && (
                        <span className="muted small-text">
                          40 de {connections.length} conexoes
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="overview-title">
                      <span className="node-type">
                        <Dot kind="project" />
                        {scope === "network"
                          ? "Memoria compartilhada"
                          : "Projeto ativo"}
                      </span>
                      <h2>
                        {scope === "network"
                          ? "Sua constelacao"
                          : graph?.project.name || "Analisando"}
                      </h2>
                      <p>
                        {scope === "network"
                          ? `${network?.projects.length || 0} projetos locais conectados por evidencias.`
                          : graph?.project.description ||
                            "Estrutura, dependencias e conhecimento do projeto."}
                      </p>
                    </div>
                    <div className="inspector-section">
                      <div className="section-title">
                        DISTRIBUICAO
                        <Layers3 size={13} />
                      </div>
                      <div className="distribution-bar">
                        {categories.map((item) => (
                          <span
                            key={item.kind}
                            style={{
                              flex: item.count,
                              background: COLORS[item.kind],
                            }}
                            title={`${LABELS[item.kind]}: ${item.count}`}
                          />
                        ))}
                      </div>
                      {categories.slice(0, 7).map((item) => (
                        <button
                          key={item.kind}
                          className="distribution-row"
                          onClick={() => {
                            setFilter(filter === item.kind ? null : item.kind);
                            if (
                              ["function", "type", "concept"].includes(
                                item.kind,
                              )
                            )
                              setLevel("all");
                          }}
                        >
                          <Dot kind={item.kind} />
                          <span>{LABELS[item.kind]}</span>
                          <strong>{fmt(item.count)}</strong>
                          <small>
                            {Math.round(
                              (item.count / Math.max(1, stats.nodes)) * 100,
                            )}
                            %
                          </small>
                        </button>
                      ))}
                    </div>
                    <div className="inspector-section">
                      <div className="section-title">
                        MAIS CONECTADOS
                        <GitBranch size={13} />
                      </div>
                      {hubs.map((node, index) => (
                        <button
                          className="hub-row"
                          key={node.id}
                          onClick={() => select(node, true)}
                        >
                          <span className="mono">0{index + 1}</span>
                          <Dot kind={node.kind} />
                          <strong>{node.label}</strong>
                          <small>{node.degree}</small>
                        </button>
                      ))}
                    </div>
                    <div className="snapshot-summary">
                      <Clock3 size={15} />
                      <div>
                        <strong>
                          {status.scanning
                            ? "Atualizando o conhecimento"
                            : "Conhecimento persistido"}
                        </strong>
                        <span>
                          {stats.reused !== undefined
                            ? `${stats.reused} arquivos reutilizados · ${stats.changed} atualizados`
                            : "Memoria entre projetos"}
                        </span>
                      </div>
                    </div>
                  </>
                )}
                <button
                  className="context-open"
                  onClick={() => {
                    setModal("context");
                    setTimeout(() => queryInput.current?.focus(), 50);
                  }}
                >
                  <Terminal size={16} />
                  <span>Consultar contexto</span>
                  <ArrowRight size={15} />
                </button>
              </aside>
            </div>
          )}

          {view === "files" && (
            <section className="content-view">
              <div className="content-toolbar">
                <label className="search-field wide">
                  <Search size={15} />
                  <input
                    placeholder="Buscar arquivo, simbolo ou conceito"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <select
                  value={filter || ""}
                  onChange={(event) => setFilter(event.target.value || null)}
                >
                  <option value="">Todos os tipos</option>
                  {categories.map((item) => (
                    <option key={item.kind} value={item.kind}>
                      {LABELS[item.kind]}
                    </option>
                  ))}
                </select>
                <span className="mono muted">{visible.total} resultados</span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>ENTIDADE</th>
                      <th>TIPO</th>
                      <th>FONTE</th>
                      <th>CONEXOES</th>
                      <th>INFORMACAO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.nodes.map((node) => (
                      <tr
                        key={node.id}
                        onClick={() => {
                          setView("map");
                          select(node, true);
                        }}
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            setView("map");
                            select(node, true);
                          }
                        }}
                      >
                        <td>
                          <Dot kind={node.kind} />
                          <strong>{node.label}</strong>
                        </td>
                        <td>{LABELS[node.kind]}</td>
                        <td className="mono file-cell">{node.path}</td>
                        <td className="mono">{node.degree}</td>
                        <td className="mono">{size(node.information || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!visible.nodes.length && (
                  <Empty>Nenhuma entidade encontrada.</Empty>
                )}
              </div>
            </section>
          )}

          {view === "memory" && (
            <section className="content-view memory-view">
              <div className="content-toolbar">
                <h2>Decisoes e preferencias</h2>
                <button
                  className="button primary"
                  onClick={() => setModal("memory")}
                >
                  <Plus size={15} />
                  Registrar memoria
                </button>
              </div>
              {(graph?.nodes || []).filter((node) =>
                ["decision", "preference"].includes(node.kind),
              ).length ? (
                <div className="memory-list">
                  {graph.nodes
                    .filter((node) =>
                      ["decision", "preference"].includes(node.kind),
                    )
                    .map((node) => (
                      <article key={node.id} className="memory-item">
                        <div>
                          <span className="node-type">
                            <Dot kind={node.kind} />
                            {LABELS[node.kind]}
                          </span>
                          <span className="mono muted">
                            {new Date(node.createdAt).toLocaleDateString(
                              "pt-BR",
                            )}
                          </span>
                        </div>
                        <h3>{node.label}</h3>
                        <p>{node.summary}</p>
                        <footer>
                          <span>
                            {node.author} ·{" "}
                            {node.evidence === "declared"
                              ? "Declarada"
                              : "Inferida"}
                            {node.stale ? " · Revisao pendente" : ""}
                          </span>
                          <button
                            className="text-button"
                            onClick={() => {
                              changeScope("project");
                              setView("map");
                              select(node, true);
                            }}
                          >
                            Ver no mapa <ArrowUpRight size={13} />
                          </button>
                        </footer>
                      </article>
                    ))}
                </div>
              ) : (
                <Empty icon={BrainCircuit}>
                  Nenhuma decisao ou preferencia registrada.
                </Empty>
              )}
              <div className="content-toolbar secondary">
                <h2>Padroes entre projetos</h2>
                <span className="evidence inferred">Observados</span>
              </div>
              {network?.patterns.length ? (
                <div className="pattern-list">
                  {network.patterns.map((pattern) => (
                    <div className="pattern-row" key={pattern.technology}>
                      <GitBranch size={17} />
                      <strong>{pattern.technology}</strong>
                      <span>
                        {pattern.sources
                          .map((source) => source.project)
                          .join(", ")}
                      </span>
                      <span className="mono">{pattern.projects} projetos</span>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty icon={GitBranch}>
                  Nenhuma dependencia recorrente entre projetos encontrada.
                </Empty>
              )}
            </section>
          )}

          {view === "activity" && (
            <section className="content-view">
              <div className="content-toolbar">
                <h2>Historico de analises</h2>
                <span className="mono muted">{history.length} snapshots</span>
              </div>
              <div className="timeline">
                {history.map((entry, index) => (
                  <article key={entry.at}>
                    <div className="timeline-mark">
                      <span className={index === 0 ? "new" : ""} />
                    </div>
                    <div>
                      <h3>
                        {index === 0
                          ? "Grafo atualizado"
                          : "Snapshot do projeto"}
                      </h3>
                      <p>
                        {entry.changed} alterados · {entry.reused} reutilizados
                        · {entry.removed} removidos
                      </p>
                      <span className="mono">
                        {entry.nodes} nos / {entry.edges} conexoes /{" "}
                        {entry.durationMs} ms
                      </span>
                    </div>
                    <time>{new Date(entry.at).toLocaleString("pt-BR")}</time>
                  </article>
                ))}
              </div>
              {!history.length && (
                <Empty icon={Activity}>
                  O historico aparece apos a primeira analise.
                </Empty>
              )}
            </section>
          )}

          {view === "integrations" && (
            <section className="content-view integrations-view">
              <div className="content-toolbar">
                <h2>Memoria acessivel aos assistentes</h2>
                <span className="evidence extracted">Local</span>
              </div>
              <div className="integration-list">
                {[
                  { name: "Codex", detail: "Agent Skills + AGENTS.md" },
                  {
                    name: "Claude Code",
                    detail: "/Graphora + CLAUDE.md + MCP",
                  },
                  { name: "Cursor", detail: "Regras persistentes + MCP" },
                  { name: "Gemini CLI", detail: "GEMINI.md" },
                  { name: "Outros clientes MCP", detail: "Servidor stdio" },
                ].map((item, index) => (
                  <div className="integration-row" key={item.name}>
                    <div className="integration-symbol">
                      {index === 0 ? (
                        <Terminal size={22} />
                      ) : index === 1 ? (
                        <Waypoints size={22} />
                      ) : index === 2 ? (
                        <Code2 size={22} />
                      ) : index === 3 ? (
                        <Box size={22} />
                      ) : (
                        <Plug size={22} />
                      )}
                    </div>
                    <div>
                      <h3>{item.name}</h3>
                      <span>{item.detail}</span>
                    </div>
                    <span
                      className={`integration-state ${integrations?.installed?.some((entry) => entry.name === item.name) ? "installed" : ""}`}
                    >
                      {integrations?.installed?.some(
                        (entry) => entry.name === item.name,
                      ) ? (
                        <>
                          <Check size={13} /> Configurado
                        </>
                      ) : (
                        "Disponivel"
                      )}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mcp-block">
                <div className="section-title">
                  CONFIGURACAO MCP
                  <IconButton
                    icon={Copy}
                    label="Copiar configuracao MCP"
                    onClick={() =>
                      copy(
                        JSON.stringify(
                          { mcpServers: { graphora: integrations?.mcp } },
                          null,
                          2,
                        ),
                      )
                    }
                  />
                </div>
                <pre>
                  {JSON.stringify(
                    { mcpServers: { graphora: integrations?.mcp } },
                    null,
                    2,
                  )}
                </pre>
              </div>
            </section>
          )}
          <footer className="workspace-footer">
            <span>
              <span className="status-dot" />
              {scope === "network"
                ? "Memoria entre projetos"
                : "Memoria do projeto"}
              <span className="footer-separator">/</span>Sem chamadas a modelos
            </span>
            <span className="mono">
              GRAPHORA <span className="footer-separator">/</span>{" "}
              {activeGraph ? "INDEXADO" : "INDEXANDO"}
            </span>
          </footer>
        </main>
      </div>

      {modal && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setModal(null);
          }}
        >
          <section
            className={`modal ${modal === "source" || modal === "context" ? "modal-wide" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "context"
                ? "Consultar contexto"
                : modal === "memory"
                  ? "Registrar memoria"
                  : modal === "source"
                    ? "Fonte do no"
                    : "Legenda do mapa"
            }
          >
            <header>
              <h2>
                {modal === "context"
                  ? "Contexto sob medida"
                  : modal === "memory"
                    ? "Nova memoria"
                    : modal === "source"
                      ? source?.path
                      : "Leitura do mapa"}
              </h2>
              <IconButton
                icon={X}
                label="Fechar janela"
                onClick={() => setModal(null)}
              />
            </header>
            {modal === "source" && (
              <div className="source-view">
                <span className="mono muted">
                  LINHAS {source?.from} - {source?.to}
                </span>
                <pre>
                  {source?.text.split("\n").map((line, index) => (
                    <div key={index}>
                      <span>{source.from + index}</span>
                      <code>{line || " "}</code>
                    </div>
                  ))}
                </pre>
                <button className="button" onClick={() => copy(source.text)}>
                  <Copy size={14} />
                  Copiar trecho
                </button>
              </div>
            )}
            {modal === "context" && (
              <form className="context-form" onSubmit={query}>
                <label>
                  Pergunta
                  <input
                    autoFocus
                    ref={queryInput}
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder="Como os modulos deste projeto se conectam?"
                  />
                </label>
                <div className="query-options">
                  <label>
                    Orcamento de tokens
                    <select
                      value={budget}
                      onChange={(event) =>
                        setBudget(Number(event.target.value))
                      }
                    >
                      <option value={600}>600 tokens</option>
                      <option value={1800}>1.800 tokens</option>
                      <option value={4000}>4.000 tokens</option>
                    </select>
                  </label>
                  <button className="button primary" disabled={querying}>
                    <Search size={14} />
                    {querying ? "Consultando..." : "Recuperar contexto"}
                  </button>
                </div>
                {selectedNode && (
                  <div className="query-node">
                    <Dot kind={selectedNode.kind} />
                    {selectedNode.label}
                    <button
                      type="button"
                      aria-label="Remover no da consulta"
                      onClick={() => setSelected(null)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
                {context && (
                  <div className="context-result">
                    <div>
                      <span className="mono">
                        {context.tokens} / {context.budget} TOKENS ·{" "}
                        {context.nodes.length} NOS
                      </span>
                      <IconButton
                        icon={Copy}
                        label="Copiar contexto"
                        onClick={() => copy(context.text)}
                      />
                    </div>
                    <pre>{context.text}</pre>
                    <span className="small-text muted">
                      {context.tokenizer}
                      {context.truncated
                        ? " · Recorte limitado pelo orcamento"
                        : ""}
                    </span>
                  </div>
                )}
              </form>
            )}
            {modal === "memory" && (
              <form className="memory-form" onSubmit={saveMemory}>
                <label>
                  Tipo
                  <select
                    value={memory.kind}
                    onChange={(event) =>
                      setMemory({ ...memory, kind: event.target.value })
                    }
                  >
                    <option value="decision">Decisao</option>
                    <option value="preference">Preferencia</option>
                    <option value="concept">Conceito</option>
                  </select>
                </label>
                <label>
                  Titulo
                  <input
                    required
                    maxLength={160}
                    value={memory.title}
                    onChange={(event) =>
                      setMemory({ ...memory, title: event.target.value })
                    }
                  />
                </label>
                <label>
                  Contexto e justificativa
                  <textarea
                    required
                    rows={5}
                    maxLength={12000}
                    value={memory.text}
                    onChange={(event) =>
                      setMemory({ ...memory, text: event.target.value })
                    }
                  />
                </label>
                <label>
                  Evidencia
                  <select
                    value={memory.basis}
                    onChange={(event) =>
                      setMemory({ ...memory, basis: event.target.value })
                    }
                  >
                    <option value="explicit">Minha declaracao</option>
                    <option value="inferred">Hipotese a verificar</option>
                  </select>
                </label>
                <button className="button primary" disabled={saving}>
                  {saving ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <Plus size={15} />
                  )}
                  Registrar memoria
                </button>
              </form>
            )}
            {modal === "legend" && (
              <div className="legend-content">
                <p>
                  O volume de cada esfera cresce com a quantidade de informacao
                  da entidade. Arquivos usam bytes; funcoes usam o tamanho do
                  trecho; diretorios agregam seus arquivos.
                </p>
                <p>
                  As cores distinguem tipos ou comunidades, conforme o ajuste do
                  mapa. Conexoes registram relacoes direcionadas com suas
                  fontes.
                </p>
                <p>
                  Linhas extraidas possuem evidencia no codigo ou documento.
                  Inferencias e padroes entre projetos permanecem identificados
                  como hipoteses.
                </p>
                {categories.map((item) => (
                  <div className="distribution-row" key={item.kind}>
                    <Dot kind={item.kind} />
                    <span>{LABELS[item.kind]}</span>
                    <strong>{item.count}</strong>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={14} />
          {toast}
        </div>
      )}
    </div>
  );
}
