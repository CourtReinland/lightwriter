import type { ReactNode } from "react";
import "./ArtisticBorder.css";

interface ArtisticBorderProps {
  children: ReactNode;
}

export default function ArtisticBorder({ children }: ArtisticBorderProps) {
  return (
    <div className="artistic-frame">
      <div className="frame-corner frame-tl">
        <div className="pixel-block p1" />
        <div className="pixel-block p2" />
        <div className="pixel-block p3" />
        <div className="kawaii-star">*</div>
      </div>
      <div className="frame-edge frame-top">
        <div className="film-strip">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="film-frame" />
          ))}
        </div>
      </div>
      <div className="frame-corner frame-tr">
        <div className="pixel-block p4" />
        <div className="pixel-block p5" />
        <div className="kawaii-face">^_^</div>
      </div>

      <div className="frame-edge frame-left">
        <div className="side-deco">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={`deco-element deco-${i % 4}`} />
          ))}
        </div>
      </div>
      <div className="frame-content">{children}</div>
      <div className="frame-edge frame-right">
        <div className="side-deco">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={`deco-element deco-${(i + 2) % 4}`} />
          ))}
        </div>
      </div>

      <div className="frame-corner frame-bl">
        <div className="pixel-block p6" />
        <div className="pixel-block p7" />
        <div className="kawaii-heart">&lt;3</div>
      </div>
      <div className="frame-edge frame-bottom">
        <div className="film-strip">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="film-frame" />
          ))}
        </div>
      </div>
      <div className="frame-corner frame-br">
        <div className="pixel-block p8" />
        <div className="pixel-block p9" />
        <div className="kawaii-star">~</div>
      </div>
    </div>
  );
}
