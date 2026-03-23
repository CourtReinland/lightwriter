import "./SuggestionCard.css";

interface SuggestionCardProps {
  text: string;
  onApply: () => void;
  onInsertBelow: () => void;
}

export default function SuggestionCard({
  text,
  onApply,
  onInsertBelow,
}: SuggestionCardProps) {
  return (
    <div className="suggestion-card">
      <pre className="suggestion-text">{text}</pre>
      <div className="suggestion-actions">
        <button className="suggestion-btn apply" onClick={onApply}>
          Replace
        </button>
        <button className="suggestion-btn insert" onClick={onInsertBelow}>
          Insert Below
        </button>
      </div>
    </div>
  );
}
