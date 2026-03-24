import { useState, useCallback, useRef, useEffect } from "react";
import type { SceneInfo } from "../../types/fountain";
import { GrokService } from "../../services/grokService";
import IndexCard from "./IndexCard";
import ConnectorToggle, { type Connector } from "./ConnectorToggle";
import "./IndexCardView.css";

interface IndexCardViewProps {
  scenes: SceneInfo[];
  totalLines: number;
  targetPages: number;
  content: string;
  onContentChange: (content: string) => void;
  connectors: Record<number, string>;
  onConnectorsChange: (connectors: Record<number, string>) => void;
  aiDescs: Record<number, string>;
  onAiDescsChange: (descs: Record<number, string>) => void;
  aiEnabled: boolean;
  onAiEnabledChange: (enabled: boolean) => void;
}

function getSceneBlocks(content: string): { heading: string; startIdx: number; endIdx: number }[] {
  const lines = content.split("\n");
  const scenePattern = /^\.((?!\.)\S)|^(INT|EXT|EST|INT\.\/EXT|I\/E)[.\s]/i;
  const blocks: { heading: string; startIdx: number; endIdx: number }[] = [];

  let charIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (scenePattern.test(line.trim())) {
      blocks.push({ heading: line.trim(), startIdx: charIdx, endIdx: -1 });
    }
    charIdx += line.length + 1;
  }

  for (let i = 0; i < blocks.length; i++) {
    blocks[i].endIdx = i + 1 < blocks.length
      ? blocks[i + 1].startIdx
      : content.length;
  }

  return blocks;
}

/** Extract the raw text of a scene block for AI analysis */
function getSceneText(content: string, sceneIdx: number): string {
  const blocks = getSceneBlocks(content);
  if (sceneIdx >= blocks.length) return "";
  const block = blocks[sceneIdx];
  return content.slice(block.startIdx, block.endIdx).trim();
}

export default function IndexCardView({
  scenes,
  totalLines,
  targetPages,
  content,
  onContentChange,
  connectors,
  onConnectorsChange,
  aiDescs,
  onAiDescsChange,
  aiEnabled,
  onAiEnabledChange,
}: IndexCardViewProps) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropSlot, setDropSlot] = useState<number | null>(null);
  const [aiLoading, setAiLoading] = useState<Record<number, boolean>>({});

  // Ref accumulator so concurrent async callbacks don't overwrite each other
  const aiDescsRef = useRef(aiDescs);
  aiDescsRef.current = aiDescs;

  /** Generate AI descriptions for all scenes. Called only on explicit button click. */
  const generateAiDescriptions = useCallback(() => {
    const apiKey = GrokService.getStoredApiKey();
    if (!apiKey) return;

    const service = new GrokService(apiKey);

    for (let i = 0; i < scenes.length; i++) {
      const sceneText = getSceneText(content, i);
      if (!sceneText) continue;

      const truncated = sceneText.length > 500 ? sceneText.slice(0, 500) + "..." : sceneText;

      setAiLoading((prev) => ({ ...prev, [i]: true }));

      service
        .suggest(
          truncated,
          "",
          "custom",
          "Describe what happens in this screenplay scene in 1-2 short sentences. Be concise and factual. Return ONLY the description, nothing else.",
        )
        .then((desc) => {
          // Use ref to get latest accumulated state, not stale closure
          const updated = { ...aiDescsRef.current, [i]: desc };
          aiDescsRef.current = updated;
          onAiDescsChange(updated);
        })
        .catch(() => {})
        .finally(() => {
          setAiLoading((prev) => ({ ...prev, [i]: false }));
        });
    }
  }, [scenes.length, content, onAiDescsChange]);

  const handleDragStart = useCallback((idx: number, e: React.DragEvent) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragIdx(null);
    setDropSlot(null);
  }, []);

  const handleSlotDragOver = useCallback((slotIdx: number, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropSlot(slotIdx);
  }, []);

  const handleSlotDrop = useCallback((slotIdx: number, e: React.DragEvent) => {
    e.preventDefault();
    const sourceIdx = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (isNaN(sourceIdx)) {
      setDragIdx(null);
      setDropSlot(null);
      return;
    }

    // Calculate the actual target index after removal
    // slotIdx is the gap index: 0=before card 0, 1=between card 0 and 1, etc.
    let targetIdx = slotIdx;
    if (sourceIdx < slotIdx) {
      targetIdx = slotIdx - 1; // Account for removal shifting indices
    }

    if (sourceIdx === targetIdx) {
      setDragIdx(null);
      setDropSlot(null);
      return;
    }

    const blocks = getSceneBlocks(content);
    if (sourceIdx >= blocks.length) {
      setDragIdx(null);
      setDropSlot(null);
      return;
    }

    const sceneTexts = blocks.map((b) => content.slice(b.startIdx, b.endIdx));
    const preamble = blocks.length > 0 ? content.slice(0, blocks[0].startIdx) : "";

    const moved = sceneTexts.splice(sourceIdx, 1)[0];
    sceneTexts.splice(targetIdx, 0, moved);

    const newContent = preamble + sceneTexts.join("");
    onContentChange(newContent);

    // Clear AI descs on reorder (scene positions changed)
    onAiDescsChange({});
    aiDescsRef.current = {};
    setAiLoading({});

    setDragIdx(null);
    setDropSlot(null);
  }, [content, onContentChange]);

  const handleConnectorChange = useCallback((index: number, value: Connector) => {
    onConnectorsChange({ ...connectors, [index]: value });
  }, [connectors, onConnectorsChange]);

  if (scenes.length === 0) {
    return (
      <div className="index-cards-empty">
        <p>No scenes found.</p>
        <p className="hint">Start a scene with INT. or EXT. in the editor.</p>
      </div>
    );
  }

  const hasApiKey = !!GrokService.getStoredApiKey();

  return (
    <div className="index-cards-view">
      <div className="cards-header">
        <span>{scenes.length} scene{scenes.length !== 1 ? "s" : ""}</span>
        <span className="cards-hint">Drag to reorder</span>
        <div className="cards-header-right">
          {hasApiKey && (
            <button
              className={`ai-desc-toggle ${aiEnabled ? "active" : ""}`}
              onClick={() => {
                if (!aiEnabled) {
                  // Turning ON: enable display and generate fresh descriptions
                  onAiEnabledChange(true);
                  onAiDescsChange({});
                  setAiLoading({});
                  // Small delay so state updates before generation reads scenes
                  setTimeout(() => generateAiDescriptions(), 50);
                } else {
                  // Turning OFF: just hide, keep cached descriptions
                  onAiEnabledChange(false);
                }
              }}
              title="Generate AI scene descriptions"
            >
              AI Desc
            </button>
          )}
          <span className="cards-target">Target: {targetPages}pp</span>
        </div>
      </div>

      <div className="cards-list">
        {/* Drop slot before first card */}
        <div
          className={`drop-slot ${dropSlot === 0 && dragIdx !== null && dragIdx !== 0 ? "active" : ""}`}
          onDragOver={(e) => handleSlotDragOver(0, e)}
          onDrop={(e) => handleSlotDrop(0, e)}
        >
          <div className="drop-indicator" />
        </div>

        {scenes.map((scene, i) => {
          const startPage = Math.max(
            1,
            Math.ceil((scene.startIndex / Math.max(1, totalLines)) * targetPages),
          );
          const endPage = Math.min(
            targetPages,
            Math.ceil(
              ((scene.startIndex + scene.tokenCount) / Math.max(1, totalLines)) * targetPages,
            ),
          );

          return (
            <div key={`scene-${i}-${scene.heading}`}>
              <IndexCard
                heading={scene.heading}
                sceneNumber={scene.sceneNumber}
                pageRange={`p${startPage}${endPage > startPage ? `-${endPage}` : ""}`}
                index={i}
                isDragging={dragIdx === i}
                aiDescription={aiEnabled ? aiDescs[i] : undefined}
                aiLoading={aiEnabled ? aiLoading[i] : false}
                onDragStart={(e) => handleDragStart(i, e)}
                onDragEnd={handleDragEnd}
              />

              {/* Connector toggle + drop slot between cards */}
              {i < scenes.length - 1 && (
                <>
                  <ConnectorToggle
                    index={i}
                    value={(connectors[i] || "AND") as Connector}
                    onChange={handleConnectorChange}
                  />
                  <div
                    className={`drop-slot ${dropSlot === i + 1 && dragIdx !== null && dragIdx !== i + 1 && dragIdx !== i ? "active" : ""}`}
                    onDragOver={(e) => handleSlotDragOver(i + 1, e)}
                    onDrop={(e) => handleSlotDrop(i + 1, e)}
                  >
                    <div className="drop-indicator" />
                  </div>
                </>
              )}

              {/* Drop slot after last card */}
              {i === scenes.length - 1 && (
                <div
                  className={`drop-slot ${dropSlot === scenes.length && dragIdx !== null && dragIdx !== scenes.length - 1 ? "active" : ""}`}
                  onDragOver={(e) => handleSlotDragOver(scenes.length, e)}
                  onDrop={(e) => handleSlotDrop(scenes.length, e)}
                >
                  <div className="drop-indicator" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
