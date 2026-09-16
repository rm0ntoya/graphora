import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from "d3-force-3d";
import { COLORS } from "./GraphScene.jsx";

const endpoint = (value) => (typeof value === "object" ? value.id : value);
const radiusOf = (node, scale = 1) =>
  Math.max(3.2, Math.cbrt(Math.max(1, node.information || 100)) * 0.42) * scale;
const palette = [
  "#79cec2",
  "#a3a0ed",
  "#edc485",
  "#ed97b0",
  "#88b5f7",
  "#d4f3a3",
  "#efa38f",
];

export const GraphScene2D = forwardRef(function GraphScene2D(
  {
    data,
    selected,
    onSelect,
    labels,
    colorMode,
    focus,
    density = "adaptive",
    visualSettings = {},
  },
  ref,
) {
  const canvasRef = useRef(null);
  const runtime = useRef({
    nodes: [],
    links: [],
    transform: { x: 0, y: 0, k: 1 },
    selected: null,
    labels: true,
    colorMode: "kind",
    visualSettings: {},
  });

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    if (
      canvas.width !== Math.round(width * pixelRatio) ||
      canvas.height !== Math.round(height * pixelRatio)
    ) {
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
    }
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    const {
      nodes,
      links,
      transform,
      selected: activeId,
      visualSettings: visuals,
    } = runtime.current;
    const edgeThickness = visuals.edgeThickness ?? 1,
      edgeOpacity = visuals.edgeOpacity ?? 1,
      nodeScale = visuals.nodeScale ?? 1,
      labelScale = visuals.labelScale ?? 1,
      edgeColor = visuals.edgeColor || "#677277";
    context.save();
    context.translate(width / 2 + transform.x, height / 2 + transform.y);
    context.scale(transform.k, transform.k);
    const neighbors = new Set(activeId ? [activeId] : []);
    for (const link of links) {
      const sourceId = endpoint(link.source);
      const targetId = endpoint(link.target);
      if (sourceId === activeId) neighbors.add(targetId);
      if (targetId === activeId) neighbors.add(sourceId);
    }
    for (const link of links) {
      const source =
        typeof link.source === "object"
          ? link.source
          : nodes.find((node) => node.id === link.source);
      const target =
        typeof link.target === "object"
          ? link.target
          : nodes.find((node) => node.id === link.target);
      if (!source || !target) continue;
      const active =
        activeId && (source.id === activeId || target.id === activeId);
      context.beginPath();
      context.moveTo(source.x || 0, source.y || 0);
      context.lineTo(target.x || 0, target.y || 0);
      context.strokeStyle = active ? "#d4f3a3" : edgeColor;
      context.globalAlpha = Math.min(1, (active ? 0.72 : 0.28) * edgeOpacity);
      context.lineWidth = ((active ? 1.4 : 0.65) * edgeThickness) / transform.k;
      context.stroke();
    }
    context.globalAlpha = 1;
    for (const node of nodes) {
      const active = !activeId || neighbors.has(node.id);
      const radius = radiusOf(node, nodeScale);
      const color =
        runtime.current.colorMode === "community"
          ? palette[(node.community || 0) % palette.length]
          : COLORS[node.kind] || "#a5b0bd";
      context.globalAlpha = active ? 1 : 0.16;
      context.beginPath();
      context.arc(node.x || 0, node.y || 0, radius, 0, Math.PI * 2);
      context.fillStyle = color;
      context.shadowColor = color;
      context.shadowBlur = node.id === activeId ? 16 : 5;
      context.fill();
      context.shadowBlur = 0;
      if (node.id === activeId) {
        context.beginPath();
        context.arc(node.x || 0, node.y || 0, radius + 3.5, 0, Math.PI * 2);
        context.strokeStyle = "#efffdc";
        context.lineWidth = 1.2 / transform.k;
        context.stroke();
      }
      if (
        runtime.current.labels &&
        active &&
        (node.degree >= 4 ||
          node.kind === "project" ||
          node.id === activeId ||
          nodes.length < 35)
      ) {
        const text =
          node.label.length > 30 ? `${node.label.slice(0, 28)}…` : node.label;
        context.font = `${node.kind === "project" ? 600 : 500} ${Math.max(8, (11 * labelScale) / Math.sqrt(transform.k))}px Manrope`;
        context.textAlign = "center";
        context.fillStyle = node.id === activeId ? "#efffdc" : "#c9cfce";
        context.fillText(
          text,
          node.x || 0,
          (node.y || 0) + radius + 15 / transform.k,
        );
      }
    }
    context.globalAlpha = 1;
    context.restore();
  };

  const fit = (duration = 0) => {
    const canvas = canvasRef.current;
    const nodes = runtime.current.nodes;
    if (!canvas || !nodes.length) return;
    const xs = nodes.map((node) => node.x || 0);
    const ys = nodes.map((node) => node.y || 0);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs);
    const minY = Math.min(...ys),
      maxY = Math.max(...ys);
    const k = Math.min(
      2.2,
      Math.max(
        0.08,
        Math.min(
          (canvas.clientWidth - 100) / Math.max(1, maxX - minX),
          (canvas.clientHeight - 100) / Math.max(1, maxY - minY),
        ),
      ),
    );
    runtime.current.transform = {
      k,
      x: -((minX + maxX) / 2) * k,
      y: -((minY + maxY) / 2) * k,
    };
    draw();
  };

  useImperativeHandle(ref, () => ({
    fit,
    zoom: (amount) => {
      runtime.current.transform.k = Math.max(
        0.08,
        Math.min(6, runtime.current.transform.k / amount),
      );
      draw();
    },
    screenshot: () => {
      const anchor = document.createElement("a");
      anchor.href = canvasRef.current.toDataURL("image/png");
      anchor.download = "graphora-mapa-2d.png";
      anchor.click();
    },
    reset: () => fit(),
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    let pointer = null;
    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    const graphPoint = (event) => {
      const rect = canvas.getBoundingClientRect();
      const transform = runtime.current.transform;
      return {
        x:
          (event.clientX - rect.left - rect.width / 2 - transform.x) /
          transform.k,
        y:
          (event.clientY - rect.top - rect.height / 2 - transform.y) /
          transform.k,
      };
    };
    const hit = (event) => {
      const point = graphPoint(event);
      return [...runtime.current.nodes]
        .reverse()
        .find(
          (node) =>
            Math.hypot((node.x || 0) - point.x, (node.y || 0) - point.y) <=
            radiusOf(node, runtime.current.visualSettings.nodeScale ?? 1) +
              5 / runtime.current.transform.k,
        );
    };
    const down = (event) => {
      const node = hit(event);
      pointer = { x: event.clientX, y: event.clientY, node, moved: false };
      if (node) {
        node.fx = node.x;
        node.fy = node.y;
      }
      canvas.setPointerCapture(event.pointerId);
    };
    const move = (event) => {
      if (!pointer) {
        canvas.style.cursor = hit(event) ? "pointer" : "grab";
        return;
      }
      const dx = event.clientX - pointer.x,
        dy = event.clientY - pointer.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) pointer.moved = true;
      if (pointer.node) {
        const point = graphPoint(event);
        pointer.node.fx = point.x;
        pointer.node.fy = point.y;
      } else {
        runtime.current.transform.x += dx;
        runtime.current.transform.y += dy;
      }
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      draw();
    };
    const up = (event) => {
      if (!pointer) return;
      if (pointer.node) {
        pointer.node.fx = null;
        pointer.node.fy = null;
      }
      if (!pointer.moved) onSelect(pointer.node || null);
      pointer = null;
      canvas.releasePointerCapture(event.pointerId);
    };
    const wheel = (event) => {
      event.preventDefault();
      runtime.current.transform.k = Math.max(
        0.08,
        Math.min(
          6,
          runtime.current.transform.k * Math.exp(-event.deltaY * 0.001),
        ),
      );
      draw();
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("wheel", wheel);
    };
  }, [onSelect]);

  useEffect(() => {
    const count = Math.max(1, data.nodes.length);
    const repulsion = visualSettings.repulsion ?? 1,
      distanceScale = visualSettings.linkDistance ?? 1,
      collisionScale = visualSettings.collision ?? 1,
      nodeScale = visualSettings.nodeScale ?? 1;
    const densityMultiplier =
      density === "compact" ? 0.78 : density === "spacious" ? 1.38 : 1;
    const spread =
      Math.min(900, Math.max(180, 105 + Math.sqrt(count) * 20)) *
      densityMultiplier;
    const gap =
      Math.min(34, Math.max(10, 7 + Math.sqrt(count) * 0.7)) *
      densityMultiplier;
    const communities = [...new Set(data.nodes.map((node) => node.community))];
    const previous = new Map(
      runtime.current.nodes.map((node) => [node.id, node]),
    );
    const nodes = data.nodes.map((node, index) => {
      const angle =
        (communities.indexOf(node.community) /
          Math.max(communities.length, 1)) *
        Math.PI *
        2;
      const old = previous.get(node.id);
      return {
        ...node,
        x: old?.x ?? Math.cos(angle) * spread + Math.sin(index * 2.4) * gap * 2,
        y:
          old?.y ??
          Math.sin(angle) * spread * 0.65 + Math.cos(index * 1.7) * gap * 2,
        anchorX: Math.cos(angle) * spread,
        anchorY: Math.sin(angle) * spread * 0.65,
      };
    });
    const links = data.edges.map((edge) => ({
      ...edge,
      source: endpoint(edge.source),
      target: endpoint(edge.target),
    }));
    runtime.current.nodes = nodes;
    runtime.current.links = links;
    const simulation = forceSimulation(nodes, 2)
      .force(
        "charge",
        forceManyBody()
          .strength(
            -Math.min(720, 155 + Math.sqrt(count) * 20) *
              densityMultiplier *
              repulsion,
          )
          .distanceMax(Math.min(1600, 480 + Math.sqrt(count) * 36)),
      )
      .force(
        "link",
        forceLink(links)
          .id((node) => node.id)
          .distance(
            (link) =>
              (["contains", "defines"].includes(link.relation) ? 70 : 110) *
              densityMultiplier *
              distanceScale,
          )
          .strength(count > 350 ? 0.08 : 0.15),
      )
      .force(
        "collision",
        forceCollide(
          (node) => radiusOf(node, nodeScale) + gap * collisionScale,
        ).iterations(4),
      )
      .force("x", forceX((node) => node.anchorX).strength(0.09))
      .force("y", forceY((node) => node.anchorY).strength(0.09))
      .alphaDecay(0.035)
      .velocityDecay(0.4)
      .on("tick", draw)
      .on("end", () => fit());
    const timer = setTimeout(() => fit(), previous.size ? 120 : 650);
    return () => {
      clearTimeout(timer);
      simulation.stop();
    };
  }, [
    data,
    density,
    visualSettings.repulsion,
    visualSettings.linkDistance,
    visualSettings.collision,
    visualSettings.nodeScale,
  ]);

  useEffect(() => {
    runtime.current.selected = selected;
    runtime.current.labels = labels;
    runtime.current.colorMode = colorMode;
    runtime.current.visualSettings = visualSettings;
    draw();
  }, [selected, labels, colorMode, visualSettings]);

  useEffect(() => {
    if (!focus) return;
    const canvas = canvasRef.current;
    const node = runtime.current.nodes.find((item) => item.id === focus.id);
    if (!canvas || !node) return;
    runtime.current.transform = {
      k: Math.max(1.15, runtime.current.transform.k),
      x: -(node.x || 0) * Math.max(1.15, runtime.current.transform.k),
      y: -(node.y || 0) * Math.max(1.15, runtime.current.transform.k),
    };
    draw();
  }, [focus]);

  return (
    <div
      className="graph-scene graph-scene-2d"
      data-testid="graph-scene-2d"
      style={{ background: visualSettings.background || "#111315" }}
    >
      <canvas
        ref={canvasRef}
        aria-label="Mapa de conhecimento em duas dimensoes"
      />
    </div>
  );
});
