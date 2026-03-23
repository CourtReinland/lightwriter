import type { DragEvent } from "react";
import "./IndexCard.css";

interface IndexCardProps {
  heading: string;
  sceneNumber?: string;
  synopsis?: string;
  pageRange: string;
  index: number;
  isDragging?: boolean;
  aiDescription?: string;
  aiLoading?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: () => void;
}

export default function IndexCard({
  heading,
  sceneNumber,
  synopsis,
  pageRange,
  index,
  isDragging,
  aiDescription,
  aiLoading,
  onDragStart,
  onDragEnd,
}: IndexCardProps) {
  const className = [
    "index-card",
    isDragging ? "dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className}
      draggable
      onDragStart={onDragStart}
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
      {aiLoading && (
        <div className="card-ai-desc loading">Analyzing scene...</div>
      )}
      {aiDescription && !aiLoading && (
        <div className="card-ai-desc">{aiDescription}</div>
      )}
      <div className="card-drag-handle">: :</div>
    </div>
  );
}
