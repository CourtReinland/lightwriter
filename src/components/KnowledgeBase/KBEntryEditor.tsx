import { useState } from "react";
import type { KBCharacter, KBWorldRule, KBPlotThread, KBCustomNote } from "../../services/knowledgeBase";
import "./KBEntryEditor.css";

type EntryType = "character" | "worldRule" | "plotThread" | "customNote";

interface KBEntryEditorProps {
  type: EntryType;
  existing?: KBCharacter | KBWorldRule | KBPlotThread | KBCustomNote;
  onSave: (type: EntryType, data: Record<string, unknown>) => void;
  onClose: () => void;
}

export default function KBEntryEditor({ type, existing, onSave, onClose }: KBEntryEditorProps) {
  // Character fields
  const [name, setName] = useState((existing as KBCharacter)?.name ?? "");
  const [description, setDescription] = useState(
    (existing as KBCharacter | KBWorldRule | KBPlotThread)?.description ?? "",
  );
  const [traits, setTraits] = useState(
    (existing as KBCharacter)?.traits?.join(", ") ?? "",
  );
  const [voiceNotes, setVoiceNotes] = useState(
    (existing as KBCharacter)?.voiceNotes ?? "",
  );

  // World rule fields
  const [category, setCategory] = useState(
    (existing as KBWorldRule)?.category ?? "setting",
  );
  const [title, setTitle] = useState(
    (existing as KBWorldRule | KBPlotThread | KBCustomNote)?.title ?? "",
  );

  // Plot thread fields
  const [status, setStatus] = useState(
    (existing as KBPlotThread)?.status ?? "unresolved",
  );

  // Custom note fields
  const [content, setContent] = useState(
    (existing as KBCustomNote)?.content ?? "",
  );

  const handleSave = () => {
    switch (type) {
      case "character":
        onSave(type, {
          name, description,
          traits: traits.split(",").map(t => t.trim()).filter(Boolean),
          voiceNotes,
          relationships: (existing as KBCharacter)?.relationships ?? [],
        });
        break;
      case "worldRule":
        onSave(type, { category, title, description });
        break;
      case "plotThread":
        onSave(type, { title, status, description });
        break;
      case "customNote":
        onSave(type, { title, content });
        break;
    }
  };

  const typeLabel = {
    character: "Character",
    worldRule: "World Rule",
    plotThread: "Plot Thread",
    customNote: "Note",
  }[type];

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="kb-editor-dialog" onClick={e => e.stopPropagation()}>
        <div className="kb-editor-title">
          {existing ? "Edit" : "Add"} {typeLabel}
        </div>

        {type === "character" && (
          <>
            <label className="kb-label">Name</label>
            <input className="kb-input" value={name} onChange={e => setName(e.target.value)} placeholder="Character name" autoFocus />
            <label className="kb-label">Description</label>
            <textarea className="kb-textarea" value={description} onChange={e => setDescription(e.target.value)} placeholder="Who is this character?" rows={3} />
            <label className="kb-label">Traits (comma-separated)</label>
            <input className="kb-input" value={traits} onChange={e => setTraits(e.target.value)} placeholder="brave, sarcastic, loyal" />
            <label className="kb-label">Voice Notes</label>
            <textarea className="kb-textarea" value={voiceNotes} onChange={e => setVoiceNotes(e.target.value)} placeholder="How do they speak? Short sentences? Formal? Slang?" rows={2} />
          </>
        )}

        {type === "worldRule" && (
          <>
            <label className="kb-label">Category</label>
            <select className="kb-select" value={category} onChange={e => setCategory(e.target.value as KBWorldRule["category"])}>
              <option value="setting">Setting</option>
              <option value="magic">Magic</option>
              <option value="technology">Technology</option>
              <option value="time_period">Time Period</option>
              <option value="other">Other</option>
            </select>
            <label className="kb-label">Title</label>
            <input className="kb-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Rule name" autoFocus />
            <label className="kb-label">Description</label>
            <textarea className="kb-textarea" value={description} onChange={e => setDescription(e.target.value)} placeholder="What is this rule?" rows={3} />
          </>
        )}

        {type === "plotThread" && (
          <>
            <label className="kb-label">Title</label>
            <input className="kb-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Thread name" autoFocus />
            <label className="kb-label">Status</label>
            <select className="kb-select" value={status} onChange={e => setStatus(e.target.value as KBPlotThread["status"])}>
              <option value="unresolved">Unresolved</option>
              <option value="foreshadowed">Foreshadowed</option>
              <option value="resolved">Resolved</option>
            </select>
            <label className="kb-label">Description</label>
            <textarea className="kb-textarea" value={description} onChange={e => setDescription(e.target.value)} placeholder="What is this thread about?" rows={3} />
          </>
        )}

        {type === "customNote" && (
          <>
            <label className="kb-label">Title</label>
            <input className="kb-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Note title" autoFocus />
            <label className="kb-label">Content</label>
            <textarea className="kb-textarea" value={content} onChange={e => setContent(e.target.value)} placeholder="Free-form notes..." rows={5} />
          </>
        )}

        <div className="kb-editor-actions">
          <button className="dialog-btn secondary" onClick={onClose}>Cancel</button>
          <button className="dialog-btn primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
