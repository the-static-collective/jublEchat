import { useEffect, useRef, useState, useCallback } from 'react';
import type { GraphNode, GraphEdge } from '../lib/types';
import { getArtifactTypeMeta, getEdgeTypeMeta } from '../lib/constants';

interface GraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId?: string | null;
  onSelectNode?: (id: string) => void;
  height?: number;
}

const FORCE_STRENGTH = 0.85;
const REPULSION = 1800;
const LINK_DISTANCE = 140;
const DAMPING = 0.82;
const CENTER_FORCE = 0.015;

export function GraphCanvas({ nodes, edges, selectedId, onSelectNode, height = 520 }: GraphCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [width, setWidth] = useState(800);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const animFrame = useRef<number>(0);
  const nodeRefs = useRef<GraphNode[]>([]);
  const edgeRefs = useRef<GraphEdge[]>([]);
  const positionsRef = useRef<Record<string, { x: number; y: number; vx: number; vy: number }>>({});
  const dragOffset = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  useEffect(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setWidth(rect.width);
    }
  }, []);

  useEffect(() => {
    nodeRefs.current = nodes;
    edgeRefs.current = edges;

    const newPositions: Record<string, { x: number; y: number; vx: number; vy: number }> = {};
    const cx = width / 2;
    const cy = height / 2;
    nodes.forEach((node, i) => {
      if (!positionsRef.current[node.id]) {
        const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
        const radius = 120 + Math.random() * 80;
        newPositions[node.id] = {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
          vx: 0,
          vy: 0,
        };
      } else {
        newPositions[node.id] = positionsRef.current[node.id];
      }
    });
    positionsRef.current = newPositions;
  }, [nodes, edges, width, height]);

  useEffect(() => {
    if (nodes.length === 0) return;

    const tick = () => {
      const pos = positionsRef.current;
      const cx = width / 2;
      const cy = height / 2;
      const currentNodes = nodeRefs.current;
      const currentEdges = edgeRefs.current;

      currentNodes.forEach((node) => {
        const p = pos[node.id];
        if (!p) return;
        if (draggingId === node.id) return;

        let fx = 0;
        let fy = 0;

        fx += (cx - p.x) * CENTER_FORCE;
        fy += (cy - p.y) * CENTER_FORCE;

        currentNodes.forEach((other) => {
          if (other.id === node.id) return;
          const op = pos[other.id];
          if (!op) return;
          const dx = p.x - op.x;
          const dy = p.y - op.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const repel = REPULSION / (dist * dist);
          fx += (dx / dist) * repel;
          fy += (dy / dist) * repel;
        });

        currentEdges.forEach((edge) => {
          if (edge.source === node.id || edge.target === node.id) {
            const otherId = edge.source === node.id ? edge.target : edge.source;
            const op = pos[otherId];
            if (!op) return;
            const dx = op.x - p.x;
            const dy = op.y - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = (dist - LINK_DISTANCE) * FORCE_STRENGTH;
            fx += (dx / dist) * force;
            fy += (dy / dist) * force;
          }
        });

        p.vx = (p.vx + fx) * DAMPING;
        p.vy = (p.vy + fy) * DAMPING;
        p.x += p.vx;
        p.y += p.vy;

        p.x = Math.max(40, Math.min(width - 40, p.x));
        p.y = Math.max(40, Math.min(height - 40, p.y));
      });

      const snapshot: Record<string, { x: number; y: number }> = {};
      currentNodes.forEach((node) => {
        const p = pos[node.id];
        if (p) snapshot[node.id] = { x: p.x, y: p.y };
      });
      setPositions(snapshot);

      animFrame.current = requestAnimationFrame(tick);
    };

    animFrame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrame.current);
  }, [nodes.length, draggingId, width, height]);

  const handleMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    const p = positionsRef.current[nodeId];
    if (!p) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    dragOffset.current = { dx: p.x - mx, dy: p.y - my };
    setDraggingId(nodeId);
  }, []);

  useEffect(() => {
    if (!draggingId) return;
    const handleMove = (e: MouseEvent) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const p = positionsRef.current[draggingId];
      if (!p) return;
      p.x = mx + dragOffset.current.dx;
      p.y = my + dragOffset.current.dy;
      p.vx = 0;
      p.vy = 0;
    };
    const handleUp = () => setDraggingId(null);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [draggingId]);

  return (
    <div ref={containerRef} className="relative w-full overflow-hidden rounded-2xl border border-slate-700/50 bg-slate-950/60" style={{ height }}>
      {nodes.length === 0 ? (
        <div className="flex h-full items-center justify-center text-slate-500 text-sm">
          No artifacts in this workspace yet.
        </div>
      ) : (
        <svg ref={svgRef} width={width} height={height} className="absolute inset-0">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="24" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" />
            </marker>
            <marker id="arrow-hover" viewBox="0 0 10 10" refX="24" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8" />
            </marker>
          </defs>

          {edges.map((edge) => {
            const sp = positions[edge.source];
            const tp = positions[edge.target];
            if (!sp || !tp) return null;
            const meta = getEdgeTypeMeta(edge.edge_type);
            const isHighlighted =
              hoveredId === edge.source || hoveredId === edge.target ||
              selectedId === edge.source || selectedId === edge.target;
            const mx = (sp.x + tp.x) / 2;
            const my = (sp.y + tp.y) / 2;
            const dx = tp.x - sp.x;
            const dy = tp.y - sp.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const offset = 20;
            const cx = mx - (dy / dist) * offset;
            const cy = my + (dx / dist) * offset;
            return (
              <path
                key={edge.id}
                d={`M ${sp.x} ${sp.y} Q ${cx} ${cy} ${tp.x} ${tp.y}`}
                fill="none"
                stroke={isHighlighted ? '#38bdf8' : meta.color}
                strokeWidth={isHighlighted ? 2 : 1.2}
                strokeOpacity={isHighlighted ? 0.9 : 0.35}
                strokeDasharray={meta.dashed ? '5 4' : undefined}
                markerEnd={isHighlighted ? 'url(#arrow-hover)' : 'url(#arrow)'}
              />
            );
          })}

          {nodes.map((node) => {
            const p = positions[node.id];
            if (!p) return null;
            const meta = getArtifactTypeMeta(node.type);
            const isSelected = selectedId === node.id;
            const isHovered = hoveredId === node.id;
            const radius = isSelected ? 14 : isHovered ? 12 : 10;
            const opacity = node.status === 'retired' ? 0.4 : 1;
            return (
              <g
                key={node.id}
                transform={`translate(${p.x}, ${p.y})`}
                style={{ cursor: 'pointer', opacity }}
                onMouseDown={(e) => handleMouseDown(e, node.id)}
                onMouseEnter={() => setHoveredId(node.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => onSelectNode?.(node.id)}
              >
                {isSelected && (
                  <circle r={radius + 6} fill="none" stroke="#38bdf8" strokeWidth={1.5} strokeOpacity={0.5}>
                    <animate attributeName="r" values={`${radius + 4};${radius + 10};${radius + 4}`} dur="2s" repeatCount="indefinite" />
                  </circle>
                )}
                <circle
                  r={radius}
                  fill={meta.color}
                  fillOpacity={0.2}
                  stroke={meta.color}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                />
                {node.status === 'retired' && (
                  <line x1={-radius} y1={-radius} x2={radius} y2={radius} stroke="#94a3b8" strokeWidth={1.5} />
                )}
                <text
                  y={radius + 14}
                  textAnchor="middle"
                  fill={isSelected ? '#f1f5f9' : '#94a3b8'}
                  fontSize={10}
                  fontWeight={isSelected ? 600 : 400}
                  className="pointer-events-none select-none"
                >
                  {node.label.length > 22 ? node.label.slice(0, 20) + '…' : node.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}

      {edges.length > 0 && (
        <div className="absolute bottom-3 left-3 flex flex-wrap gap-3 rounded-lg bg-slate-900/80 px-3 py-2 backdrop-blur-sm border border-slate-700/50">
          {Array.from(new Set(edges.map((e) => e.edge_type))).map((type) => {
            const meta = getEdgeTypeMeta(type);
            return (
              <div key={type} className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <div
                  className="h-0.5 w-5 rounded"
                  style={{ backgroundColor: meta.color, borderTop: meta.dashed ? '2px dashed ' + meta.color : undefined }}
                />
                {meta.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
