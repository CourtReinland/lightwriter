import type { DragEvent } from "react";
import "./IndexCard.css";

interface IndexCardProps {
  heading: string;
  sceneNumber?: string;
  synopsis?: string;
  pageRange: string;
  index: number;
  isDragging?: boolean;
  isDropTarget?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDragEnter?: (e: DragEvent) => void;
  onDragLeave?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
  onDragEnd?: () => void;
}

export default function IndexCard({
  heading,
  sceneNumber,
  synopsis,
  pageRange,
  index,
  isDragging,
  isDropTarget,
  onDragStart,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  onDragEnd,
}: IndexCardProps) {
  const className = [
    "index-card",
    isDragging ? "dragging" : "",
    isDropTarget ? "drop-target" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div className="card-header">
        <span className="card-number">
          {sceneNumber || `#${index + 1}`}
        </span>
        <span className="card-pages">{pageRange}</span>
      </div>
      <div className="card-heading">{heading}</div>
      {synopsis && <div className="card-synopsis">{synopsis}</div>}
      <div className="card-drag-handle">: :</div>
    </div>
  );
}
