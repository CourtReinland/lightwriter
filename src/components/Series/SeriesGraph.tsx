import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { activeArcsForEpisode, type SeriesArc, type SeriesCliffhanger } from "../../services/worldStateService";
import "./SeriesGraph.css";

const ARC_COLOR: Record<"plot" | "character", string> = { plot: "#3b82f6", character: "#e0a83e" };

interface EpisodeNodeData {
  label: string;
  title: string;
  isCurrent: boolean;
  chips: { name: string; color: string }[];
  [key: string]: unknown;
}

function EpisodeNode({ data }: NodeProps) {
  const d = data as EpisodeNodeData;
  return (
    <div className={`series-gnode ${d.isCurrent ? "current" : ""}`}>
      <Handle type="source" position={Position.Top} id="arcSource" style={{ left: "35%" }} />
      <Handle type="target" position={Position.Top} id="arcTarget" style={{ left: "65%" }} />
      <Handle type="source" position={Position.Bottom} id="cliffSource" style={{ left: "35%" }} />
      <Handle type="target" position={Position.Bottom} id="cliffTarget" style={{ left: "65%" }} />
      <div className="series-gnode-num">{d.label}</div>
      <div className="series-gnode-title">{d.title}</div>
      <div className="series-gnode-arcs">
        {d.chips.map((c, i) => (
          <span key={i} className="series-gnode-chip" style={{ borderColor: c.color, color: c.color }}>{c.name}</span>
        ))}
      </div>
    </div>
  );
}

const nodeTypes = { episode: EpisodeNode };

export interface SeriesGraphProps {
  episodes: { id: string; name: string }[];
  arcs: SeriesArc[];
  cliffhangers: SeriesCliffhanger[];
  currentProjectId: string;
  onArcClick: (arcId: string) => void;
  onCliffhangerClick: (fromEpisode: number) => void;
}

export default function SeriesGraph({ episodes, arcs, cliffhangers, currentProjectId, onArcClick, onCliffhangerClick }: SeriesGraphProps) {
  const nodes = useMemo<Node[]>(
    () =>
      episodes.map((ep, i) => ({
        id: ep.id,
        type: "episode",
        position: { x: i * 260, y: 140 },
        data: {
          label: `EP ${i + 1}`,
          title: ep.name,
          isCurrent: ep.id === currentProjectId,
          chips: activeArcsForEpisode(arcs, i).map((a) => ({ name: a.name, color: a.color || ARC_COLOR[a.kind] })),
        } satisfies EpisodeNodeData,
        draggable: false,
      })),
    [episodes, arcs, currentProjectId],
  );

  const edges = useMemo<Edge[]>(() => {
    const lastIdx = episodes.length - 1;
    const arcEdges: Edge[] = arcs
      .map((a) => {
        const s = episodes[Math.min(a.startEpisode, lastIdx)]?.id;
        const t = episodes[Math.min(a.endEpisode, lastIdx)]?.id;
        if (!s || !t) return null;
        const color = a.color || ARC_COLOR[a.kind];
        return {
          id: `arc-${a.id}`,
          source: s,
          target: t,
          sourceHandle: "arcSource",
          targetHandle: "arcTarget",
          label: a.name,
          type: "default",
          style: { stroke: color, strokeWidth: 2 },
          labelStyle: { fill: color, fontSize: 10, fontFamily: "Courier Prime, monospace" },
          labelBgStyle: { fill: "#141414", fillOpacity: 0.85 },
          markerEnd: { type: MarkerType.ArrowClosed, color },
          data: { kind: "arc", arcId: a.id },
        } as Edge;
      })
      .filter((e): e is Edge => e !== null);

    const cliffEdges: Edge[] = cliffhangers
      .map((c) => {
        const s = episodes[c.fromEpisode]?.id;
        const t = episodes[c.toEpisode]?.id;
        if (!s || !t) return null;
        return {
          id: `cliff-${c.id}`,
          source: s,
          target: t,
          sourceHandle: "cliffSource",
          targetHandle: "cliffTarget",
          label: "▲ cliffhanger",
          type: "default",
          style: { stroke: "#dc5b3a", strokeWidth: 2, strokeDasharray: "5 4" },
          labelStyle: { fill: "#e0a83e", fontSize: 10, fontFamily: "Courier Prime, monospace" },
          labelBgStyle: { fill: "#141414", fillOpacity: 0.85 },
          data: { kind: "cliff", fromEpisode: c.fromEpisode },
        } as Edge;
      })
      .filter((e): e is Edge => e !== null);

    return [...arcEdges, ...cliffEdges];
  }, [episodes, arcs, cliffhangers]);

  return (
    <div className="series-graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        onEdgeClick={(_, edge) => {
          const data = edge.data as { kind?: string; arcId?: string; fromEpisode?: number } | undefined;
          if (data?.kind === "arc" && data.arcId) onArcClick(data.arcId);
          else if (data?.kind === "cliff" && typeof data.fromEpisode === "number") onCliffhangerClick(data.fromEpisode);
        }}
      >
        <Background color="#2a2a2a" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
