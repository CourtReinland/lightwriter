import { useState, useCallback, useRef } from "react";
import type { SceneInfo } from "../../types/fountain";
import IndexCard from "./IndexCard";
import "./IndexCardView.css";

interface IndexCardViewProps {
  scenes: SceneInfo[];
  totalLines: number;
  targetPages: number;
  content: string;
  onContentChange: (content: string) => void;
}

/**
 * Extract scene blocks from raw fountain text.
 * Each block = from scene heading line to just before the next scene heading.
 */
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
    charIdx += line.length + 1; // +1 for \n
  }

  // Set end indices
  for (let i = 0; i < blocks.length; i++) {
    blocks[i].endIdx = i + 1 < blocks.length
      ? blocks[i + 1].startIdx
      : content.length;
  }

  return blocks;
}

export default function IndexCardView({
  scenes,
  totalLines,
  targetPages,
  content,
  onContentChange,
}: IndexCardViewProps) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const dragCounter = useRef(0);

  const handleDragStart = useCallback((idx: number, e: React.DragEvent) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
  }, []);

  const handleDragOver = useCallback((idx: number, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragIdx !== null && idx !== dragIdx) {
      setDropIdx(idx);
    }
  }, [dragIdx]);

  const handleDragEnter = useCallback((idx: number, e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (dragIdx !== null && idx !== dragIdx) {
      setDropIdx(idx);
    }
  }, [dragIdx]);

  const handleDragLeave = useCallback((_idx: number, _e: React.DragEvent) => {
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDropIdx(null);
    }
  }, []);

  const handleDrop = useCallback((targetIdx: number, e: React.DragEvent) => {
    e.preventDefault();
    const sourceIdx = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (isNaN(sourceIdx) || sourceIdx === targetIdx) {
      setDragIdx(null);
      setDropIdx(null);
      return;
    }

    // Reorder scenes in the actual fountain text
    const blocks = getSceneBlocks(content);
    if (sourceIdx >= blocks.length || targetIdx >= blocks.length) {
      setDragIdx(null);
      setDropIdx(null);
      return;
    }

    // Extract scene text blocks
    const sceneTexts = blocks.map((b) => content.slice(b.startIdx, b.endIdx));

    // Get content before the first scene (title page, etc.)
    const preamble = blocks.length > 0 ? content.slice(0, blocks[0].startIdx) : "";

    // Reorder
    const moved = sceneTexts.splice(sourceIdx, 1)[0];
    sceneTexts.splice(targetIdx, 0, moved);

    // Rebuild content
    const newContent = preamble + sceneTexts.join("");
    onContentChange(newContent);

    setDragIdx(null);
    setDropIdx(null);
    dragCounter.current = 0;
  }, [content, onContentChange]);

  const handleDragEnd = useCallback(() => {
    setDragIdx(null);
    setDropIdx(null);
    dragCounter.current = 0;
  }, []);

  if (scenes.length === 0) {
    return (
      <div className="index-cards-empty">
        <p>No scenes found.</p>
        <p className="hint">
          Start a scene with INT. or EXT. in the editor.
        </p>
      </div>
    );
  }

  return (
    <div className="index-cards-view">
      <div className="cards-header">
        <span>{scenes.length} scene{scenes.length !== 1 ? "s" : ""}</span>
        <span className="cards-hint">Drag to reorder</span>
        <span className="cards-target">Target: {targetPages}pp</span>
      </div>
      <div className="cards-grid">
        {scenes.map((scene, i) => {
          const startPage = Math.max(
            1,
            Math.ceil((scene.startIndex / Math.max(1, totalLines)) * targetPages),
          );
          const endPage = Math.min(
            targetPages,
            Math.ceil(
              ((scene.startIndex + scene.tokenCount) /
                Math.max(1, totalLines)) *
                targetPages,
            ),
          );

          const isDragging = dragIdx === i;
          const isDropTarget = dropIdx === i;

          return (
            <IndexCard
              key={`${i}-${scene.heading}`}
              heading={scene.heading}
              sceneNumber={scene.sceneNumber}
              pageRange={`p${startPage}${endPage > startPage ? `-${endPage}` : ""}`}
              index={i}
              isDragging={isDragging}
              isDropTarget={isDropTarget}
              onDragStart={(e) => handleDragStart(i, e)}
              onDragOver={(e) => handleDragOver(i, e)}
              onDragEnter={(e) => handleDragEnter(i, e)}
              onDragLeave={(e) => handleDragLeave(i, e)}
              onDrop={(e) => handleDrop(i, e)}
              onDragEnd={handleDragEnd}
            />
          );
        })}
      </div>
    </div>
  );
}
