import { ALL_FRAMEWORKS, computeBeatRanges, type ComputedBeat } from "../../frameworks";
import "./OverlayLegend.css";

interface OverlayLegendProps {
  activeFrameworks: string[];
  targetPages: number;
  totalLines: number;
}

export default function OverlayLegend({
  activeFrameworks,
  targetPages,
  totalLines,
}: OverlayLegendProps) {
  if (activeFrameworks.length === 0) return null;

  const allBeats: ComputedBeat[] = [];
  for (const fw of ALL_FRAMEWORKS) {
    if (activeFrameworks.includes(fw.id)) {
      allBeats.push(...computeBeatRanges(fw, targetPages, totalLines));
    }
  }

  // Sort by start page
  allBeats.sort((a, b) => a.startPage - b.startPage);

  return (
    <div className="overlay-legend">
      <div className="legend-header">Beat Map</div>
      <div className="legend-beats">
        {allBeats.map((beat, i) => (
          <div key={`${beat.frameworkId}-${i}`} className="legend-beat">
            <span
              className="legend-color"
              style={{ backgroundColor: beat.color }}
            />
            <span className="legend-pages">
              p{beat.startPage}-{beat.endPage}
            </span>
            <span className="legend-name">{beat.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
