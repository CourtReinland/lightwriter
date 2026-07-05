import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { VoiceCorpusStore } from "../../services/voiceCorpusStore";
import {
  compareToVoicePrint,
  voicePrintToPromptBlock,
  type VoiceMatchReport,
} from "../../services/voiceMetricsService";
import {
  buildVoicePack,
  compileVoicePack,
  loadVoicePack,
  saveVoicePack,
} from "../../services/voicePackService";
import "./Voice.css";

interface VoicePanelProps {
  seriesId: string;
  /** Notify App that voice data changed. */
  onChange?: () => void;
}

// Series card: import the author's produced scripts, measure the Voice Print
// (deterministic — no API key needed), and score any pasted text against it.
export default function VoicePanel({ seriesId, onChange }: VoicePanelProps) {
  const [version, setVersion] = useState(0);
  const bump = () => {
    setVersion((v) => v + 1);
    onChange?.();
  };

  const scripts = useMemo(() => VoiceCorpusStore.listScripts(seriesId), [seriesId, version]);
  const print = useMemo(() => VoiceCorpusStore.getPrint(seriesId), [seriesId, version]);
  const pack = useMemo(() => loadVoicePack(seriesId), [seriesId, version]);
  const [error, setError] = useState("");
  const [testerText, setTesterText] = useState("");
  const [report, setReport] = useState<VoiceMatchReport | null>(null);
  const [showPrint, setShowPrint] = useState(false);
  const [showPack, setShowPack] = useState(false);
  const [building, setBuilding] = useState("");
  const [newRule, setNewRule] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const handleBuildPack = async () => {
    setError("");
    setBuilding("starting…");
    try {
      await buildVoicePack(seriesId, { onProgress: setBuilding });
      bump();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBuilding("");
    }
  };

  const mutatePack = (fn: (p: NonNullable<typeof pack>) => void) => {
    if (!pack) return;
    fn(pack);
    saveVoicePack(pack);
    bump();
  };

  const handleImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    setError("");
    try {
      const inputs = await Promise.all(
        files.map(async (file) => ({
          title: file.name.replace(/\.(fountain|txt)$/i, ""),
          text: await file.text(),
        })),
      );
      VoiceCorpusStore.addScripts(seriesId, inputs);
      bump();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCompute = () => {
    setError("");
    try {
      VoiceCorpusStore.computePrint(seriesId);
      bump();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleScore = () => {
    if (!print || !testerText.trim()) return;
    setReport(compareToVoicePrint(testerText, print));
  };

  return (
    <section className="series-card voice-card">
      <div className="series-card-head">
        <h3>Author Voice</h3>
        <button className="series-btn" onClick={() => fileInput.current?.click()}>+ Import scripts</button>
        <input
          ref={fileInput}
          type="file"
          accept=".fountain,.txt"
          multiple
          style={{ display: "none" }}
          onChange={handleImport}
        />
      </div>

      {scripts.length === 0 ? (
        <p className="series-muted">
          Import your produced scripts (.fountain) to measure your voice — dialogue rhythm, action style,
          punctuation habits, signature phrases. The measured print becomes a hard target for every AI writing pass.
        </p>
      ) : (
        <>
          <ul className="voice-corpus-list">
            {scripts.map((s) => (
              <li key={s.id}>
                <span className="voice-corpus-title" title={s.title}>{s.title}</span>
                <span className="voice-corpus-meta">{s.wordCount.toLocaleString()}w</span>
                <button
                  className="voice-x"
                  title="Remove from corpus"
                  onClick={() => {
                    VoiceCorpusStore.removeScript(seriesId, s.id);
                    bump();
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>

          <div className="series-inline">
            <button className="series-btn primary" onClick={handleCompute}>
              {print ? "Recompute voice print" : "Compute voice print"}
            </button>
            {print && (
              <span className="voice-print-stamp">
                measured from {print.scriptCount} script{print.scriptCount === 1 ? "" : "s"}
              </span>
            )}
            {!print && scripts.length > 0 && <span className="voice-print-stamp stale">not computed yet</span>}
          </div>

          {print && (
            <>
              <dl className="voice-print-summary">
                <div><dt>Words / speech</dt><dd>{print.meanDialogueWordsPerCue}</dd></div>
                <div><dt>Speeches ≤3 words</dt><dd>{Math.round(print.shortCueRate * 100)}%</dd></div>
                <div><dt>Dialogue share</dt><dd>{Math.round(print.dialogueShareOfWords * 100)}%</dd></div>
                <div><dt>Action sentence</dt><dd>{print.action.meanSentenceWords}w</dd></div>
                <div><dt>Exclaim / ask</dt><dd>{Math.round(print.dialogue.exclamationRate * 100)}% / {Math.round(print.dialogue.questionRate * 100)}%</dd></div>
                <div><dt>Speeches / scene</dt><dd>{print.cuesPerScene}</dd></div>
              </dl>
              <button className="voice-link" onClick={() => setShowPrint((s) => !s)}>
                {showPrint ? "Hide full print" : "Show full print (as the AI sees it)"}
              </button>
              {showPrint && <pre className="voice-print-block">{voicePrintToPromptBlock(print)}</pre>}

              <div className="voice-pack-section">
                <div className="series-inline">
                  <button className="series-btn" onClick={handleBuildPack} disabled={!!building}>
                    {building ? `Building… ${building}` : pack ? "Rebuild voice pack" : "Build voice pack (uses your AI engine)"}
                  </button>
                  {pack && (
                    <span className="voice-print-stamp">
                      {pack.pairs.length} pair{pack.pairs.length === 1 ? "" : "s"} · {pack.rules.filter((r) => r.enabled).length} rules
                    </span>
                  )}
                </div>
                {pack && (
                  <>
                    {pack.policy && <p className="voice-policy">{pack.policy}</p>}
                    <ul className="voice-rules">
                      {pack.rules.map((rule) => (
                        <li key={rule.id} className={rule.enabled ? "" : "off"}>
                          <label title={rule.source === "user" ? "Your rule (survives rebuilds)" : "Harvested from the contrast pairs"}>
                            <input
                              type="checkbox"
                              checked={rule.enabled}
                              onChange={() => mutatePack((p) => {
                                const r = p.rules.find((x) => x.id === rule.id);
                                if (r) r.enabled = !r.enabled;
                              })}
                            />
                            <span className={`voice-rule-kind ${rule.kind}`}>{rule.kind}</span> {rule.text}
                          </label>
                          <button
                            className="voice-x"
                            title="Delete rule"
                            onClick={() => mutatePack((p) => {
                              p.rules = p.rules.filter((x) => x.id !== rule.id);
                            })}
                          >
                            ✕
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="series-inline">
                      <input
                        placeholder='Add your own rule, e.g. "never use the word suddenly"…'
                        value={newRule}
                        onChange={(e) => setNewRule(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && newRule.trim()) {
                            mutatePack((p) => p.rules.unshift({
                              id: `vr_user_${Date.now().toString(36)}`,
                              kind: /^always/i.test(newRule.trim()) ? "always" : "never",
                              text: newRule.trim(),
                              enabled: true,
                              source: "user",
                            }));
                            setNewRule("");
                          }
                        }}
                      />
                    </div>
                    <button className="voice-link" onClick={() => setShowPack((s) => !s)}>
                      {showPack ? "Hide compiled pack" : "Show compiled pack (as the AI sees it)"}
                    </button>
                    {showPack && <pre className="voice-print-block">{compileVoicePack(pack, print)}</pre>}
                  </>
                )}
              </div>

              <div className="voice-tester">
                <textarea
                  rows={4}
                  placeholder="Paste any scene here to score it against your voice…"
                  value={testerText}
                  onChange={(e) => setTesterText(e.target.value)}
                />
                <div className="series-inline">
                  <button className="series-btn" onClick={handleScore} disabled={!testerText.trim()}>
                    Score against my voice
                  </button>
                  {report && (
                    <span className={`voice-score ${report.score >= 75 ? "good" : report.score >= 50 ? "mid" : "bad"}`}>
                      {report.score}/100{report.lowConfidence ? " (short sample)" : ""}
                    </span>
                  )}
                </div>
                {report && report.deviations.length > 0 && (
                  <ul className="voice-deviations">
                    {report.deviations.slice(0, 4).map((d) => (
                      <li key={d.metric}>
                        <strong>{d.metric}:</strong> {d.actual} vs your {d.expected} — {d.note}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </>
      )}

      {error && <p className="voice-error">{error}</p>}
    </section>
  );
}
