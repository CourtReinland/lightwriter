import { useState, useCallback } from "react";
import {
  KnowledgeBaseService,
  type KnowledgeBase,
  type KBCharacter,
  type KBWorldRule,
  type KBPlotThread,
  type KBCustomNote,
} from "../../services/knowledgeBase";
import { StyleProfileService, type StyleProfile } from "../../services/styleProfile";
import { GrokService } from "../../services/grokService";
import KBEntryEditor from "./KBEntryEditor";
import "./KBPanel.css";

interface KBPanelProps {
  kb: KnowledgeBase;
  onKBChange: (kb: KnowledgeBase) => void;
  styleProfile: StyleProfile | null;
  onStyleChange: (profile: StyleProfile | null) => void;
  scriptContent: string;
  projectId: string;
}

type EditTarget = {
  type: "character" | "worldRule" | "plotThread" | "customNote";
  existing?: KBCharacter | KBWorldRule | KBPlotThread | KBCustomNote;
} | null;

export default function KBPanel({
  kb,
  onKBChange,
  styleProfile,
  onStyleChange,
  scriptContent,
  projectId,
}: KBPanelProps) {
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    characters: true,
    world: false,
    plot: false,
    tone: false,
    notes: false,
    style: false,
  });
  const [styleSample, setStyleSample] = useState("");
  const [analyzingStyle, setAnalyzingStyle] = useState(false);
  const [styleError, setStyleError] = useState<string | null>(null);

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = useCallback((type: string, data: Record<string, unknown>) => {
    let updated = kb;
    const existingId = editTarget?.existing && "id" in editTarget.existing ? editTarget.existing.id : null;

    switch (type) {
      case "character":
        updated = existingId
          ? KnowledgeBaseService.updateCharacter(kb, existingId, data as Partial<KBCharacter>)
          : KnowledgeBaseService.addCharacter(kb, data as Omit<KBCharacter, "id">);
        break;
      case "worldRule":
        updated = existingId
          ? KnowledgeBaseService.updateWorldRule(kb, existingId, data as Partial<KBWorldRule>)
          : KnowledgeBaseService.addWorldRule(kb, data as Omit<KBWorldRule, "id">);
        break;
      case "plotThread":
        updated = existingId
          ? KnowledgeBaseService.updatePlotThread(kb, existingId, data as Partial<KBPlotThread>)
          : KnowledgeBaseService.addPlotThread(kb, data as Omit<KBPlotThread, "id">);
        break;
      case "customNote":
        updated = existingId
          ? KnowledgeBaseService.updateCustomNote(kb, existingId, data as Partial<KBCustomNote>)
          : KnowledgeBaseService.addCustomNote(kb, data as Omit<KBCustomNote, "id">);
        break;
    }

    KnowledgeBaseService.saveKB(updated);
    onKBChange(updated);
    setEditTarget(null);
  }, [kb, editTarget, onKBChange]);

  const handleDelete = useCallback((type: string, id: string) => {
    let updated = kb;
    switch (type) {
      case "character": updated = KnowledgeBaseService.deleteCharacter(kb, id); break;
      case "worldRule": updated = KnowledgeBaseService.deleteWorldRule(kb, id); break;
      case "plotThread": updated = KnowledgeBaseService.deletePlotThread(kb, id); break;
      case "customNote": updated = KnowledgeBaseService.deleteCustomNote(kb, id); break;
    }
    KnowledgeBaseService.saveKB(updated);
    onKBChange(updated);
  }, [kb, onKBChange]);

  const handleScanScript = useCallback(async () => {
    const apiKey = GrokService.getStoredApiKey();
    if (!apiKey) { setScanError("Set your Grok API key first."); return; }
    if (!scriptContent.trim()) { setScanError("No script content to scan."); return; }

    setScanning(true);
    setScanError(null);
    try {
      const extracted = await KnowledgeBaseService.scanScript(scriptContent, apiKey);
      let updated = { ...kb };

      // Merge extracted entries (add new, don't overwrite existing)
      if (extracted.characters) {
        for (const c of extracted.characters) {
          if (!updated.characters.some(ex => ex.name.toLowerCase() === c.name.toLowerCase())) {
            updated.characters.push(c);
          }
        }
      }
      if (extracted.worldRules) {
        for (const r of extracted.worldRules) {
          if (!updated.worldRules.some(ex => ex.title.toLowerCase() === r.title.toLowerCase())) {
            updated.worldRules.push(r);
          }
        }
      }
      if (extracted.plotThreads) {
        for (const t of extracted.plotThreads) {
          if (!updated.plotThreads.some(ex => ex.title.toLowerCase() === t.title.toLowerCase())) {
            updated.plotThreads.push(t);
          }
        }
      }
      if (extracted.toneStyle && !updated.toneStyle.genre) {
        updated.toneStyle = extracted.toneStyle;
      }

      KnowledgeBaseService.saveKB(updated);
      onKBChange(updated);
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }, [kb, scriptContent, onKBChange]);

  const handleToneChange = useCallback((field: string, value: string) => {
    const updated = KnowledgeBaseService.updateToneStyle(kb, { [field]: value });
    KnowledgeBaseService.saveKB(updated);
    onKBChange(updated);
  }, [kb, onKBChange]);

  const handleAnalyzeStyle = useCallback(async () => {
    const apiKey = GrokService.getStoredApiKey();
    if (!apiKey) { setStyleError("Set your Grok API key first."); return; }
    if (!styleSample.trim()) { setStyleError("Paste a writing sample first."); return; }

    setAnalyzingStyle(true);
    setStyleError(null);
    try {
      const profile = await StyleProfileService.analyzeStyle(styleSample, projectId, apiKey);
      StyleProfileService.saveProfile(profile);
      onStyleChange(profile);
    } catch (e) {
      setStyleError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzingStyle(false);
    }
  }, [styleSample, projectId, onStyleChange]);

  const handleFileImport = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,.fountain";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => setStyleSample(reader.result as string);
      reader.readAsText(file);
    };
    input.click();
  }, []);

  return (
    <div className="kb-panel">
      <div className="kb-header">
        <span className="kb-title">Knowledge Base</span>
        <button className="kb-scan-btn" onClick={handleScanScript} disabled={scanning}>
          {scanning ? "Scanning..." : "Scan Script"}
        </button>
      </div>
      {scanError && <div className="kb-error">{scanError}</div>}

      {/* Characters */}
      <div className="kb-section">
        <button className="kb-section-header" onClick={() => toggleSection("characters")}>
          <span>{expandedSections.characters ? "v" : ">"} Characters ({kb.characters.length})</span>
          <button className="kb-add-btn" onClick={e => { e.stopPropagation(); setEditTarget({ type: "character" }); }}>+</button>
        </button>
        {expandedSections.characters && kb.characters.map(c => (
          <div key={c.id} className="kb-entry">
            <div className="kb-entry-name">{c.name}</div>
            <div className="kb-entry-preview">{c.description.slice(0, 60)}{c.description.length > 60 ? "..." : ""}</div>
            <div className="kb-entry-actions">
              <button onClick={() => setEditTarget({ type: "character", existing: c })}>Edit</button>
              <button onClick={() => handleDelete("character", c.id)}>Del</button>
            </div>
          </div>
        ))}
      </div>

      {/* World Rules */}
      <div className="kb-section">
        <button className="kb-section-header" onClick={() => toggleSection("world")}>
          <span>{expandedSections.world ? "v" : ">"} World Rules ({kb.worldRules.length})</span>
          <button className="kb-add-btn" onClick={e => { e.stopPropagation(); setEditTarget({ type: "worldRule" }); }}>+</button>
        </button>
        {expandedSections.world && kb.worldRules.map(r => (
          <div key={r.id} className="kb-entry">
            <div className="kb-entry-name">{r.title} <span className="kb-tag">{r.category}</span></div>
            <div className="kb-entry-actions">
              <button onClick={() => setEditTarget({ type: "worldRule", existing: r })}>Edit</button>
              <button onClick={() => handleDelete("worldRule", r.id)}>Del</button>
            </div>
          </div>
        ))}
      </div>

      {/* Plot Threads */}
      <div className="kb-section">
        <button className="kb-section-header" onClick={() => toggleSection("plot")}>
          <span>{expandedSections.plot ? "v" : ">"} Plot Threads ({kb.plotThreads.length})</span>
          <button className="kb-add-btn" onClick={e => { e.stopPropagation(); setEditTarget({ type: "plotThread" }); }}>+</button>
        </button>
        {expandedSections.plot && kb.plotThreads.map(t => (
          <div key={t.id} className="kb-entry">
            <div className="kb-entry-name">{t.title} <span className={`kb-status ${t.status}`}>{t.status}</span></div>
            <div className="kb-entry-actions">
              <button onClick={() => setEditTarget({ type: "plotThread", existing: t })}>Edit</button>
              <button onClick={() => handleDelete("plotThread", t.id)}>Del</button>
            </div>
          </div>
        ))}
      </div>

      {/* Tone & Style */}
      <div className="kb-section">
        <button className="kb-section-header" onClick={() => toggleSection("tone")}>
          <span>{expandedSections.tone ? "v" : ">"} Tone & Style</span>
        </button>
        {expandedSections.tone && (
          <div className="kb-tone-fields">
            <input className="kb-input-sm" placeholder="Genre" value={kb.toneStyle.genre} onChange={e => handleToneChange("genre", e.target.value)} />
            <input className="kb-input-sm" placeholder="Mood" value={kb.toneStyle.mood} onChange={e => handleToneChange("mood", e.target.value)} />
            <textarea className="kb-textarea-sm" placeholder="Pacing notes" value={kb.toneStyle.pacingNotes} onChange={e => handleToneChange("pacingNotes", e.target.value)} rows={2} />
          </div>
        )}
      </div>

      {/* Custom Notes */}
      <div className="kb-section">
        <button className="kb-section-header" onClick={() => toggleSection("notes")}>
          <span>{expandedSections.notes ? "v" : ">"} Notes ({kb.customNotes.length})</span>
          <button className="kb-add-btn" onClick={e => { e.stopPropagation(); setEditTarget({ type: "customNote" }); }}>+</button>
        </button>
        {expandedSections.notes && kb.customNotes.map(n => (
          <div key={n.id} className="kb-entry">
            <div className="kb-entry-name">{n.title}</div>
            <div className="kb-entry-actions">
              <button onClick={() => setEditTarget({ type: "customNote", existing: n })}>Edit</button>
              <button onClick={() => handleDelete("customNote", n.id)}>Del</button>
            </div>
          </div>
        ))}
      </div>

      {/* Style Profile */}
      <div className="kb-section">
        <button className="kb-section-header" onClick={() => toggleSection("style")}>
          <span>{expandedSections.style ? "v" : ">"} Style Profile {styleProfile ? "(active)" : ""}</span>
        </button>
        {expandedSections.style && (
          <div className="kb-style-section">
            {styleProfile && (
              <div className="kb-style-card">
                <div className="kb-style-row"><span>Tone:</span> {styleProfile.predominantTone}</div>
                <div className="kb-style-row"><span>POV:</span> {styleProfile.pov}</div>
                <div className="kb-style-row"><span>Tense:</span> {styleProfile.tense}</div>
                <div className="kb-style-row"><span>Vocab:</span> {styleProfile.vocabularyComplexity}</div>
                <div className="kb-style-row"><span>Dialogue:</span> {styleProfile.dialogueToActionRatio}</div>
                {styleProfile.rawAnalysis && (
                  <div className="kb-style-analysis">{styleProfile.rawAnalysis}</div>
                )}
              </div>
            )}
            <textarea
              className="kb-textarea-sm"
              placeholder="Paste a writing sample to analyze style..."
              value={styleSample}
              onChange={e => setStyleSample(e.target.value)}
              rows={4}
            />
            <div className="kb-style-actions">
              <button className="kb-action-btn" onClick={handleFileImport}>Import .txt</button>
              <button className="kb-action-btn primary" onClick={handleAnalyzeStyle} disabled={analyzingStyle}>
                {analyzingStyle ? "Analyzing..." : "Analyze Style"}
              </button>
            </div>
            {styleError && <div className="kb-error">{styleError}</div>}
          </div>
        )}
      </div>

      {editTarget && (
        <KBEntryEditor
          type={editTarget.type}
          existing={editTarget.existing}
          onSave={handleSave}
          onClose={() => setEditTarget(null)}
        />
      )}
    </div>
  );
}
