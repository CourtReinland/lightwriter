import "./AnalysisCard.css";

interface AnalysisCardProps {
  text: string;
}

export default function AnalysisCard({ text }: AnalysisCardProps) {
  // Parse structured sections from the analysis text
  const sections = parseAnalysis(text);

  return (
    <div className="analysis-card">
      {sections.map((section, i) => (
        <div key={i} className="analysis-section">
          {section.label && (
            <div className="analysis-section-header">
              <span className="analysis-label">{section.label}</span>
              {section.score !== null && (
                <span className={`analysis-score ${scoreClass(section.score)}`}>
                  {section.score}/10
                </span>
              )}
            </div>
          )}
          <div className="analysis-body">{section.body}</div>
        </div>
      ))}
      <button
        className="analysis-copy-btn"
        onClick={() => navigator.clipboard.writeText(text)}
      >
        Copy Analysis
      </button>
    </div>
  );
}

function scoreClass(score: number): string {
  if (score >= 7) return "high";
  if (score >= 4) return "mid";
  return "low";
}

interface AnalysisSection {
  label: string;
  score: number | null;
  body: string;
}

function parseAnalysis(text: string): AnalysisSection[] {
  const lines = text.split("\n");
  const sections: AnalysisSection[] = [];
  let current: AnalysisSection | null = null;

  for (const line of lines) {
    // Match "LABEL: N/10" or "LABEL: [N]/10"
    const scoreMatch = line.match(/^([A-Z][A-Z\s/&]+?):\s*\[?(\d+)\]?\s*\/\s*10/);
    if (scoreMatch) {
      if (current) sections.push(current);
      current = { label: scoreMatch[1].trim(), score: parseInt(scoreMatch[2]), body: "" };
      continue;
    }

    // Match "LABEL:" header without score
    const headerMatch = line.match(/^([A-Z][A-Z\s]+?):\s*$/);
    if (headerMatch) {
      if (current) sections.push(current);
      current = { label: headerMatch[1].trim(), score: null, body: "" };
      continue;
    }

    // Append to current section body
    if (current) {
      current.body += (current.body ? "\n" : "") + line;
    } else {
      // Pre-section text
      if (line.trim()) {
        current = { label: "", score: null, body: line };
      }
    }
  }

  if (current) sections.push(current);
  return sections;
}
