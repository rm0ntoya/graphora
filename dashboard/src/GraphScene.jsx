import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import ForceGraph3D from "3d-force-graph";
import * as THREE from "three";
import SpriteText from "three-spritetext";
import { forceCollide, forceX, forceY, forceZ } from "d3-force-3d";

export const COLORS = {
  project: "#d4f3a3",
  directory: "#88b5f7",
  file: "#79cec2",
  config: "#a5b0bd",
  document: "#edc485",
  function: "#a3a0ed",
  type: "#ed97b0",
  dependency: "#85b7e1",
  concept: "#dcd399",
  decision: "#efa38f",
  preference: "#cce793",
  pattern: "#d9b7f0",
};
export const LABELS = {
  project: "Projeto",
  directory: "Modulo",
  file: "Codigo",
  config: "Configuracao",
  document: "Documento",
  function: "Funcao",
  type: "Tipo",
  dependency: "Dependencia",
  concept: "Conceito",
  decision: "Decisao",
  preference: "Preferencia",
  pattern: "Padrao",
};
const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const endpoint = (endpoint) =>
  typeof endpoint === "object" ? endpoint.id : endpoint;
const radiusOf = (node) =>
  Math.max(3, Math.cbrt(Math.max(1, node.information || 100)) * 0.42);
export const GraphScene = forwardRef(function GraphScene(
  {
    data,
    selected,
    onSelect,
    labels,
    orbit,
    frozen,
    colorMode,
    focus,
    onReady,
  },
  ref,
) {
  const container = useRef(null),
    graph = useRef(null),
    selection = useRef(onSelect),
    state = useRef({ selected, labels, colorMode });
  const [error, setError] = useState("");
  selection.current = onSelect;
  state.current = { selected, labels, colorMode };
  useImperativeHandle(ref, () => ({
    fit: () => graph.current?.zoomToFit(700, 55),
    zoom: (amount) => {
      const engine = graph.current;
      if (!engine) return;
      const target = engine.controls().target,
        camera = engine.camera(),
        vector = camera.position.clone().sub(target).multiplyScalar(amount);
      engine.cameraPosition(target.clone().add(vector), target, 350);
    },
    screenshot: () => {
      const engine = graph.current;
      if (!engine) return;
      engine.renderer().render(engine.scene(), engine.camera());
      const anchor = document.createElement("a");
      anchor.href = engine.renderer().domElement.toDataURL("image/png");
      anchor.download = "graphora-mapa.png";
      anchor.click();
    },
    reset: () => {
      const engine = graph.current;
      if (engine) {
        engine.cameraPosition(
          { x: 100, y: 70, z: 420 },
          { x: 0, y: 0, z: 0 },
          700,
        );
        setTimeout(() => engine.zoomToFit(700, 55), 750);
      }
    },
  }));
  useEffect(() => {
    const element = container.current;
    let engine, observer;
    try {
      engine = new ForceGraph3D(element, {
        controlType: "orbit",
        rendererConfig: {
          antialias: true,
          alpha: false,
          preserveDrawingBuffer: true,
        },
      })
        .backgroundColor("#111315")
        .showNavInfo(false)
        .width(element.clientWidth)
        .height(element.clientHeight)
        .nodeId("id")
        .nodeLabel(
          (node) =>
            `<div class="graph-tooltip"><b>${escape(node.label)}</b><span>${escape(LABELS[node.kind] || node.kind)} · ${node.degree || 0} conexoes</span></div>`,
        )
        .nodeRelSize(4)
        .nodeVal((node) => Math.max(1, Math.cbrt(node.information || 100)))
        .linkOpacity(0.24)
        .linkColor(() => "#829097")
        .linkWidth(0.45)
        .linkDirectionalParticleWidth(1.2)
        .linkDirectionalParticleSpeed(0.003)
        .onNodeClick((node) => selection.current(node))
        .onBackgroundClick(() => selection.current(null))
        .onNodeHover((node) => {
          element.style.cursor = node ? "pointer" : "grab";
        })
        .warmupTicks(100)
        .cooldownTicks(110)
        .d3AlphaDecay(0.035)
        .d3VelocityDecay(0.4);
      engine.d3Force("charge").strength(-90).distanceMax(240);
      engine
        .d3Force("link")
        .distance((link) =>
          ["contains", "defines"].includes(link.relation) ? 43 : 75,
        )
        .strength(0.2);
      engine.d3Force(
        "collision",
        forceCollide((node) => radiusOf(node) + 4).iterations(2),
      );
      engine.d3Force("x", forceX((node) => node.anchorX || 0).strength(0.16));
      engine.d3Force("y", forceY((node) => node.anchorY || 0).strength(0.16));
      engine.d3Force("z", forceZ((node) => node.anchorZ || 0).strength(0.16));
      const renderer = engine.renderer();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      engine.scene().add(new THREE.AmbientLight("#ffffff", 2.0));
      const light = new THREE.DirectionalLight("#ffffff", 3.0);
      light.position.set(100, 150, 250);
      engine.scene().add(light);
      const fill = new THREE.DirectionalLight("#a3cbdc", 1.1);
      fill.position.set(-100, -20, -80);
      engine.scene().add(fill);
      engine.controls().enableDamping = true;
      engine.controls().dampingFactor = 0.08;
      engine.controls().autoRotateSpeed = 0.32;
      engine.cameraPosition({ x: 60, y: 40, z: 380 });
      observer = new ResizeObserver(() => {
        if (element.clientWidth && element.clientHeight)
          engine.width(element.clientWidth).height(element.clientHeight);
      });
      observer.observe(element);
      graph.current = engine;
      onReady?.();
    } catch (failure) {
      setError(
        "WebGL indisponivel neste navegador. O explorador e as consultas continuam acessiveis.",
      );
    }
    return () => {
      observer?.disconnect();
      engine?._destructor();
      graph.current = null;
    };
  }, []);
  useEffect(() => {
    const engine = graph.current;
    if (!engine || !data) return;
    const old = new Map(
      engine.graphData().nodes.map((node) => [node.id, node]),
    );
    const communities = [...new Set(data.nodes.map((node) => node.community))];
    const nodes = data.nodes.map((node, index) => {
      const existing = old.get(node.id);
      const angle =
        (communities.indexOf(node.community) /
          Math.max(communities.length, 1)) *
        Math.PI *
        2;
      return {
        ...node,
        anchorX: Math.cos(angle) * 105,
        anchorY: Math.sin(angle * 2) * 60,
        anchorZ: Math.sin(angle) * 65,
        x: existing?.x ?? Math.cos(angle) * 105 + Math.sin(index * 2.4) * 32,
        y: existing?.y ?? Math.sin(angle * 2) * 60 + Math.cos(index * 1.7) * 30,
        z: existing?.z ?? Math.sin(angle) * 65 + Math.cos(index * 2.4) * 32,
      };
    });
    const links = data.edges.map((edge) => ({
      ...edge,
      source: endpoint(edge.source),
      target: endpoint(edge.target),
    }));
    engine.graphData({ nodes, links });
    const timer = setTimeout(
      () => engine.zoomToFit(900, 55),
      old.size ? 150 : 600,
    );
    return () => clearTimeout(timer);
  }, [data]);
  useEffect(() => {
    const engine = graph.current;
    if (!engine) return;
    const neighbors = new Set(selected ? [selected] : []);
    for (const edge of data?.edges || []) {
      if (endpoint(edge.source) === selected)
        neighbors.add(endpoint(edge.target));
      if (endpoint(edge.target) === selected)
        neighbors.add(endpoint(edge.source));
    }
    const palette = [
      "#79cec2",
      "#a3a0ed",
      "#edc485",
      "#ed97b0",
      "#88b5f7",
      "#d4f3a3",
      "#efa38f",
    ];
    engine.nodeThreeObject((node) => {
      const group = new THREE.Group();
      const color =
        colorMode === "community"
          ? palette[(node.community || 0) % palette.length]
          : COLORS[node.kind] || "#a5b0bd";
      const active = !selected || neighbors.has(node.id);
      const radius = radiusOf(node);
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.32,
        metalness: 0.18,
        emissive: color,
        emissiveIntensity: node.id === selected ? 0.35 : 0.06,
        transparent: !active,
        opacity: active ? 1 : 0.16,
      });
      group.add(
        new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 20), material),
      );
      if (node.id === selected) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(radius + 2.3, 0.25, 8, 64),
          new THREE.MeshBasicMaterial({
            color: "#e4ffc0",
            transparent: true,
            opacity: 0.8,
          }),
        );
        ring.rotation.x = 0.5;
        ring.rotation.y = 0.4;
        group.add(ring);
      }
      if (
        labels &&
        active &&
        (node.degree >= 4 ||
          node.kind === "project" ||
          node.id === selected ||
          data.nodes.length < 35)
      ) {
        const label = new SpriteText(
          node.label.length > 30 ? node.label.slice(0, 28) + "…" : node.label,
        );
        label.color = node.id === selected ? "#efffdc" : "#c9cfce";
        label.textHeight = node.kind === "project" ? 5.5 : 3.8;
        label.fontFace = "Manrope Variable, sans-serif";
        label.position.y = -(radius + 4);
        label.material.depthWrite = false;
        group.add(label);
      }
      return group;
    });
    engine
      .linkColor((edge) =>
        selected &&
        (endpoint(edge.source) === selected ||
          endpoint(edge.target) === selected)
          ? "#d4f3a3"
          : "#677277",
      )
      .linkOpacity(selected ? 0.32 : 0.24)
      .linkWidth((edge) =>
        selected &&
        (endpoint(edge.source) === selected ||
          endpoint(edge.target) === selected)
          ? 1
          : 0.35,
      )
      .linkDirectionalParticles((edge) =>
        selected &&
        (endpoint(edge.source) === selected ||
          endpoint(edge.target) === selected)
          ? 2
          : 0,
      );
  }, [data, selected, labels, colorMode]);
  useEffect(() => {
    const engine = graph.current;
    if (engine) engine.controls().autoRotate = orbit;
  }, [orbit]);
  useEffect(() => {
    const engine = graph.current;
    if (engine) {
      if (frozen) engine.pauseAnimation();
      else engine.resumeAnimation();
    }
  }, [frozen]);
  useEffect(() => {
    const engine = graph.current;
    if (!engine || !focus) return;
    const node = engine.graphData().nodes.find((node) => node.id === focus.id);
    if (node)
      engine.cameraPosition(
        { x: node.x + 65, y: node.y + 35, z: node.z + 100 },
        node,
        900,
      );
  }, [focus]);
  return (
    <div className="graph-scene" ref={container} data-testid="graph-scene">
      {error && <div className="webgl-error">{error}</div>}
    </div>
  );
});
