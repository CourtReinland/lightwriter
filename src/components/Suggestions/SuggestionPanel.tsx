import { useState, useCallback, useEffect, useMemo } from "react";
import { ALL_FRAMEWORKS } from "../../frameworks";
import { loadStoredReportCard, clearStoredReportCard } from "../../services/reportCardStore";
import { getSelectedTextAiProviderSettings, getTextAiProviderSettings, getTextAiSettings, textAiProviderLabel, textAiProviderOptions, type TextAiProvider, type TextAiProviderSettings } from "../../services/textAiSettingsService";
import { runMultiProviderRewrite } from "../../services/multiProviderRewriteService";
import { runWritersRoom } from "../../services/writersRoomService";
import { TextAiService } from "../../services/textAiService";
import type { RewriteDiffCandidate, RewriteReRollHandler, ReRollSelection } from "../../services/inlineDiffService";
import { collectAllowedCast, findInventedCharacters } from "../../services/castLockService";
import { cleanupGeneratedScreenplay } from "../../services/generatedScriptCleanup";
import type { EditorView } from "@codemirror/view";
import { rewriteScriptWithShotDirections, type ShotPassProgress } from "../../services/shotDirectionService";
import { generateFromPrompt, type GenerationUnit } from "../../services/promptGenerationService";
import { generateLongScreenplay } from "../../services/planThenWriteService";
import { fillSceneDescriptions } from "../../services/expandDescriptionsService";
import { rewriteScriptWithCleanup } from "../../services/cleanupService";
import { normalizeShotLines } from "../../services/fountainShotNormalizer";
import { correctFountainFormatting } from "../../services/fountainFormatCorrector";
import { runScriptReportCard, generateMetricImprovementPlan, rewriteScriptForMetric, summarizeRewriteDiff, compareReportCards, validateRewriteScript, buildMetricRewritePrompt, parseRewriteResponse, metricScoreFromCard, type ScriptReportCard, type ScriptRewriteResult, type RewriteDiffSummary, type ReportCardComparison, type RewriteValidationResult } from "../../services/scriptReportCardService";
import { runStoryDoctor, isFrameworkMetric } from "../../services/storyDoctorService";
import {
  generate,
  isAnalysisMode,
  buildPrompt,
  type OrchestratorMode,
  type OrchestratorContext,
} from "../../services/aiOrchestrator";
import { generateReRollVariants, type ReRollVariant } from "../../services/reRollService";
import type { KnowledgeBase } from "../../services/knowledgeBase";
import type { StyleProfile } from "../../services/styleProfile";
import type { ComputedBeat } from "../../frameworks/utils";
import ApiKeyDialog from "./ApiKeyDialog";
import SuggestionCard from "./SuggestionCard";
import AnalysisCard from "./AnalysisCard";
import ReportCard from "./ReportCard";
import RewriteReviewCard from "./RewriteReviewCard";
import AssetPanel from "../Assets/AssetPanel";
import type { Project } from "../../services/storageService";
import type { GeneratedAsset, AssetKind } from "../../types/assets";
import "./SuggestionPanel.css";

interface SuggestionPanelProps {
  selectedText: string;
  contextText: string;
  fullScript: string;
  cursorLine: number;
  cursorBeats: ComputedBeat[];
  knowledgeBase: KnowledgeBase | null;
  styleProfile: StyleProfile | null;
  targetPages: number;
  activeFrameworks?: string[];
  project: Project;
  assets: GeneratedAsset[];
  onAssetsChange: (assets: GeneratedAsset[]) => void;
  onGenerationComplete?: (assets: GeneratedAsset[], kind: AssetKind) => void;
  /** Bump App's worldVersion when a series scene/character image is assigned in image-gen. */
  onWorldChange?: () => void;
  onApply: (text: string) => void;
  onInsertBelow: (text: string) => void;
  onReplaceScript: (text: string) => void;
  /** Insert freshly generated screenplay text at the cursor and seal a checkpoint. */
  onInsertGenerated?: (text: string) => void;
  /** Seal a version-history snapshot for a direct AI apply (not a revert). */
  onAiCommit?: (label: string, text: string) => void;
  /** Pre-serialized series/arc/cliffhanger context for this episode (see seriesContextService). */
  seriesContext?: string;
  onOpenToolReview: (review: { label: string; beforeScript: string; afterScript: string }) => void;
  /** Show a pending rewrite as an inline diff overlay in the editor (best-first candidates). */
  onShowRewriteDiff?: (candidates: RewriteDiffCandidate[], label: string, reRoll?: RewriteReRollHandler) => void;
  /** The shared editor view, for reading the live selection (scoped re-roll). */
  editorViewRef?: React.MutableRefObject<EditorView | undefined>;
}

interface RewriteReviewState {
  id: number;
  label: string;
  beforeScript: string;
  afterScript: string;
  beforeReport: ScriptReportCard;
  afterReport: ScriptReportCard | null;
  comparison: ReportCardComparison | null;
  result: ScriptRewriteResult;
  diff: RewriteDiffSummary;
  validation: RewriteValidationResult;
  applied: boolean;
  accepted: boolean;
}

type ScriptDoctorStage = "idle" | "diagnosing" | "treatment" | "requesting" | "validating" | "preview" | "applied" | "rescoring";

const WRITING_MODES: { id: OrchestratorMode; label: string; icon: string }[] = [
  { id: "improve_dialogue", label: "Improve", icon: "^" },
  { id: "expand_scene", label: "Expand", icon: "+" },
  { id: "compress", label: "Compress", icon: "-" },
  { id: "alternative_line", label: "Alt Lines", icon: "~" },
  { id: "add_action", label: "Action", icon: "!" },
  { id: "add_shots", label: "Shots", icon: "MS" },
  { id: "fix_formatting", label: "Fix Fmt", icon: "#" },
];

const ADVANCED_MODES: { id: OrchestratorMode; label: string; icon: string; needsSelection: boolean }[] = [
  { id: "smart_continue", label: "Continue", icon: ">>", needsSelection: false },
  { id: "scene_builder", label: "Scene Build", icon: "[]", needsSelection: false },
  { id: "character_voice", label: "Char Voice", icon: "@", needsSelection: true },
  { id: "instant_critique", label: "Critique", icon: "?!", needsSelection: true },
  { id: "plot_hole_check", label: "Plot Holes", icon: "!?", needsSelection: true },
  { id: "beat_alignment_check", label: "Beat Check", icon: "<>", needsSelection: true },
];

export default function SuggestionPanel({
  selectedText,
  contextText,
  fullScript,
  cursorLine,
  cursorBeats,
  knowledgeBase,
  styleProfile,
  targetPages,
  activeFrameworks,
  project,
  assets,
  onAssetsChange,
  onGenerationComplete,
  onWorldChange,
  onApply,
  onInsertBelow,
  onReplaceScript,
  onInsertGenerated,
  onAiCommit,
  seriesContext,
  onOpenToolReview,
  onShowRewriteDiff,
  editorViewRef,
}: SuggestionPanelProps) {
  const [textAiSettings, setTextAiSettings] = useState(() => getSelectedTextAiProviderSettings());
  const [showImageGen, setShowImageGen] = useState(false);
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [lastMode, setLastMode] = useState<OrchestratorMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [charSelect, setCharSelect] = useState<string>("");
  const [shotPassProgress, setShotPassProgress] = useState<ShotPassProgress | null>(null);
  const [reportCard, setReportCard] = useState<ScriptReportCard | null>(null);
  const [reportCollapsed, setReportCollapsed] = useState(false);
  // Score only the writer's active framework(s) (default all) — a small payload
  // keeps the model focused and stops the last framework from being truncated.
  const scoringFrameworks = useMemo(() => {
    const subset = ALL_FRAMEWORKS.filter((f) => activeFrameworks?.includes(f.id));
    return subset.length ? subset : undefined;
  }, [activeFrameworks]);
  // Persistence: restore the last report card for this project so it survives
  // leaving the AI tab (this panel unmounts) and app restarts.
  useEffect(() => {
    const stored = loadStoredReportCard(project.id);
    setReportCard(stored?.card ?? null);
  }, [project.id]);
  // Which providers the parallel rewrite / re-roll fan out to (up to 4). Defaults
  // to Claude + the current writer; persisted. Only keyed providers actually run.
  const [rewriteProviders, setRewriteProviders] = useState<TextAiProvider[]>(() => {
    try {
      const raw = localStorage.getItem("lw-rewrite-providers");
      const arr = raw ? JSON.parse(raw) : null;
      if (Array.isArray(arr) && arr.length) return arr as TextAiProvider[];
    } catch { /* ignore */ }
    return Array.from(new Set(["claude", getTextAiSettings().selectedProvider])) as TextAiProvider[];
  });
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const toggleRewriteProvider = useCallback((p: TextAiProvider) => {
    setRewriteProviders((prev) => {
      // Keep at least one engine selected (unchecking the last would leave nothing to run),
      // and cap at 4.
      const next = prev.includes(p)
        ? (prev.length <= 1 ? prev : prev.filter((x) => x !== p))
        : (prev.length >= 4 ? prev : [...prev, p]);
      try { localStorage.setItem("lw-rewrite-providers", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const [rewriteReview, setRewriteReview] = useState<RewriteReviewState | null>(null);
  const [scriptDoctorStage, setScriptDoctorStage] = useState<ScriptDoctorStage>("idle");

  // ── Cast lock: every character the story already knows about (script cues +
  // KB + series world characters + character arcs). Fed to every rewrite prompt
  // as a hard "do not invent characters" rule, and enforced deterministically on
  // each candidate below.
  const allowedCast = useMemo(
    () => collectAllowedCast({ script: fullScript, knowledgeBase, seriesId: project.seriesId }),
    [fullScript, knowledgeBase, project.seriesId],
  );

  // Flag candidates that invented characters anyway (label ⚠ + castWarnings) and
  // demote them below clean takes — the model was told, now we check its work.
  const annotateCast = useCallback((cands: RewriteDiffCandidate[]): RewriteDiffCandidate[] => {
    const flagged = cands.map((c) => {
      const invented = findInventedCharacters(c.afterScript, allowedCast);
      return invented.length ? { ...c, castWarnings: invented } : c;
    });
    // Stable sort: clean takes first, violators last (score order preserved within groups).
    return flagged.sort((a, b) => Number(Boolean(a.castWarnings?.length)) - Number(Boolean(b.castWarnings?.length)));
  }, [allowedCast]);

  /**
   * Bar Re-roll factory: rotates through the INSTALLED (keyed) engines, starting
   * after the ones that produced the initial candidates. A re-roll with a live
   * selection regenerates just that passage (re_roll mode, spliced back into the
   * draft); with no selection it re-runs the source task's own prompt whole-doc
   * on the next engine. One take per click, cleaned + cast-checked.
   */
  const makeReRollHandler = useCallback((cfg: {
    usedProviders: TextAiProvider[];
    /** Rebuild the source task's whole-doc prompt against the current before-text. */
    buildWholeDoc: (before: string) => { system: string; user: string; temperature: number; maxTokens: number; kind: "json" | "raw" };
  }): RewriteReRollHandler | undefined => {
    const keyed = textAiProviderOptions().filter((p) => getTextAiProviderSettings(p).apiKey.trim());
    if (!keyed.length) return undefined;
    let idx = keyed.findIndex((p) => !cfg.usedProviders.includes(p));
    if (idx < 0) idx = 0; // every engine already used -> cycle from the top
    const peek = () => textAiProviderLabel(keyed[idx % keyed.length]);
    return {
      nextLabel: peek(),
      run: async (selection: ReRollSelection | null) => {
        const provider = keyed[idx % keyed.length];
        idx += 1;
        const service = TextAiService.forProvider(provider);
        const before = editorViewRef?.current ? editorViewRef.current.state.doc.toString() : fullScript;
        setError(null);
        try {
          let after: string;
          let scope = "re-roll";
          if (selection && selection.text.trim() && !(selection.from === 0 && selection.to === before.length)) {
            scope = "selection re-roll";
            const variants = await generateReRollVariants({
              selectedText: selection.text,
              surroundingContext: before.slice(Math.max(0, selection.from - 400), Math.min(before.length, selection.to + 400)),
              fullScript: before,
              cursorLine,
              cursorBeats,
              knowledgeBase,
              styleProfile,
              mode: "re_roll",
              targetPages,
              seriesContext,
              allowedCast,
            }, {
              temps: [0.9],
              service,
              maxTokens: selection.text.length > 4000 ? Math.min(16000, Math.max(2048, Math.ceil(selection.text.length / 3))) : undefined,
            });
            const v = variants.find((x) => !x.error && x.text.trim());
            if (!v) throw new Error(variants.find((x) => x.error)?.error ?? "Re-roll produced nothing usable.");
            after = before.slice(0, selection.from) + v.text + before.slice(selection.to);
          } else {
            const p = cfg.buildWholeDoc(before);
            const raw = await service.complete(p.system, p.user, { temperature: p.temperature, maxTokens: p.maxTokens, timeoutMs: 300_000 });
            after = p.kind === "json"
              ? parseRewriteResponse(raw, allowedCast).rewrittenScript
              : cleanupGeneratedScreenplay(raw, allowedCast).trim();
            // Whole-doc guard for BOTH kinds: a result far shorter than the source is
            // a truncated/partial rewrite — Accept would shrink the script to a fragment.
            if (after.length < before.length * 0.5) {
              throw new Error("Re-roll came back truncated (too short for a whole-script rewrite). Try re-rolling a smaller selection.");
            }
          }
          const cand: RewriteDiffCandidate = { afterScript: after, label: `${textAiProviderLabel(provider)} · ${scope}`, score: null };
          return { candidates: annotateCast([cand]), nextLabel: peek() };
        } catch (e) {
          const message = e instanceof Error ? e.message : "Re-roll failed";
          setError(message); // panel banner (when open)
          return { candidates: [], nextLabel: peek(), error: message }; // bar display (always visible)
        }
      },
    };
  }, [editorViewRef, fullScript, cursorLine, cursorBeats, knowledgeBase, styleProfile, targetPages, seriesContext, allowedCast, annotateCast]);
  // Story Generator (direct single-call generation from the WRITER model)
  const [genPrompt, setGenPrompt] = useState("");
  const [genAmount, setGenAmount] = useState(23);
  const [genUnit, setGenUnit] = useState<GenerationUnit>("pages");
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genStatus, setGenStatus] = useState<string | null>(null);
  const [genPlan, setGenPlan] = useState(true);

  const handleGenerateFromPrompt = useCallback(async () => {
    const currentSettings = getSelectedTextAiProviderSettings();
    setTextAiSettings(currentSettings);
    if (!currentSettings.apiKey.trim()) {
      setShowKeyDialog(true);
      return;
    }
    if (!genPrompt.trim()) {
      setGenError("Type a brief describing what to write.");
      return;
    }
    setGenLoading(true);
    setGenError(null);
    try {
      let text: string;
      let failedBeats: number[] = [];
      if (genPlan) {
        // Plan-then-write: analyst plans a beat outline, writer drafts each beat
        // in its own call with KB/style/outline/synopsis/tail carried forward.
        const pages = genUnit === "pages" ? genAmount : Math.max(1, Math.round(genAmount / 190));
        setGenStatus("Planning the story (analyst)...");
        const result = await generateLongScreenplay(
          { prompt: genPrompt.trim(), pages, knowledgeBase, styleProfile, seriesContext },
          new Date().toISOString().slice(0, 10),
          (p) => setGenStatus(p.label + (p.total > 1 ? ` (${p.completed}/${p.total})` : "")),
        );
        text = result.script;
        failedBeats = result.failedBeats;
      } else {
        setGenStatus(`Generating ~${genAmount} ${genUnit} with ${textAiProviderLabel(currentSettings.provider)}...`);
        text = await generateFromPrompt({
          prompt: genPrompt.trim(),
          amount: genAmount,
          unit: genUnit,
          knowledgeBase,
          styleProfile,
          seriesContext,
          // Existing script (empty on a blank test doc → fresh generation;
          // otherwise the writer continues from where it leaves off).
          precedingContext: fullScript,
        });
      }
      if (!text.trim()) {
        setGenError("The writer returned nothing. Try again or shorten the target length.");
        return;
      }
      if (onInsertGenerated) onInsertGenerated(text);
      else onReplaceScript(text);
      const wordCount = text.trim().split(/\s+/).length;
      setGenStatus(
        `Done — inserted ~${wordCount} words at the cursor.` +
          (failedBeats.length ? ` ${failedBeats.length} beat(s) failed (network) — re-run to fill the gaps.` : ""),
      );
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Generation failed");
      setGenStatus(null);
    } finally {
      setGenLoading(false);
    }
  }, [genPrompt, genAmount, genUnit, genPlan, knowledgeBase, styleProfile, fullScript, seriesContext, onInsertGenerated, onReplaceScript]);

  const handleFullShotPass = useCallback(async () => {
    const currentSettings = getSelectedTextAiProviderSettings();
    setTextAiSettings(currentSettings);
    if (!currentSettings.apiKey.trim()) {
      setShowKeyDialog(true);
      return;
    }
    if (!fullScript.trim()) {
      setError("No script content to rewrite.");
      return;
    }
    const confirmed = window.confirm(
      `Run a full-script shot pass with ${textAiProviderLabel(currentSettings.provider)}? This will send the script scene-by-scene and replace the editor text with a shot-annotated version. Undo remains available in the editor.`,
    );
    if (!confirmed) return;

    setLoading(true);
    setError(null);
    setSuggestion(null);
    setLastMode(null);
    setShotPassProgress({ completed: 0, total: 1, label: "Starting full-script shot pass..." });

    try {
      const rewritten = await rewriteScriptWithShotDirections(
        fullScript,
        currentSettings,
        knowledgeBase,
        setShotPassProgress,
      );
      onAiCommit?.("Expand shots", rewritten);
      onReplaceScript(rewritten);
      setSuggestion("Full-script shot pass complete. The editor has been updated with professional shot direction lines.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Shot pass failed");
    } finally {
      setLoading(false);
      setShotPassProgress(null);
    }
  }, [fullScript, knowledgeBase, onReplaceScript, onAiCommit]);

  // Shared runner for whole-script à la carte tool passes that PREVIEW before applying.
  const runWholeScriptTool = useCallback(
    async (
      label: string,
      confirmMsg: string,
      run: (settings: TextAiProviderSettings, onProgress: (p: ShotPassProgress) => void) => Promise<string>,
    ) => {
      const currentSettings = getSelectedTextAiProviderSettings();
      setTextAiSettings(currentSettings);
      if (!currentSettings.apiKey.trim()) {
        setShowKeyDialog(true);
        return;
      }
      if (!fullScript.trim()) {
        setError("No script content to rewrite.");
        return;
      }
      if (!window.confirm(confirmMsg)) return;

      setLoading(true);
      setError(null);
      setSuggestion(null);
      setLastMode(null);
      setShotPassProgress({ completed: 0, total: 1, label: `Starting ${label}...` });
      try {
        const rewritten = await run(currentSettings, setShotPassProgress);
        // Show the result as an inline diff overlay in the editor (deletions
        // struck through, additions highlighted) instead of a side pane.
        if (onShowRewriteDiff) onShowRewriteDiff(annotateCast([{ afterScript: rewritten, label, score: null }]), label);
        else onOpenToolReview({ label, beforeScript: fullScript, afterScript: rewritten });
      } catch (e) {
        setError(e instanceof Error ? e.message : `${label} failed`);
      } finally {
        setLoading(false);
        setShotPassProgress(null);
      }
    },
    [fullScript, onOpenToolReview, onShowRewriteDiff, annotateCast],
  );

  const handleExpandDescriptions = useCallback(
    () =>
      runWholeScriptTool(
        "Scene Descriptions",
        "Add scene-setting descriptions across the whole script? This detects the genre, finds every INT./EXT. that jumps straight into a shot or action with no establishing description, and writes a short visual description of the location under it (so the asset generator has something to draw from). Dialogue, character action, and existing descriptions are left alone. Opens a Review pane before anything touches the editor.",
        (settings, onProgress) => fillSceneDescriptions(fullScript, settings, knowledgeBase, styleProfile, onProgress),
      ),
    [runWholeScriptTool, fullScript, knowledgeBase, styleProfile],
  );

  const handleCleanUp = useCallback(
    () =>
      runWholeScriptTool(
        "Clean Up",
        "Run Clean Up across the whole script? This fixes grammar, spelling, and redundant duplications (like back-to-back shots with no action between) scene-by-scene and opens a Review pane with the changes highlighted before anything touches the editor.",
        (settings, onProgress) => rewriteScriptWithCleanup(fullScript, settings, knowledgeBase, onProgress),
      ),
    [runWholeScriptTool, fullScript, knowledgeBase],
  );

  // Deterministic, instant (no LLM): re-prefix bare ALL-CAPS shot lines with "!!"
  // so camera shots stop rendering in the character/dialogue slots.
  const handleFixShotLines = useCallback(() => {
    if (!fullScript.trim()) {
      setError("No script content to fix.");
      return;
    }
    const fixed = normalizeShotLines(fullScript);
    if (fixed === fullScript) {
      setError(null);
      setLastMode(null);
      setSuggestion("All camera shots already use the !! prefix — nothing to fix.");
      return;
    }
    setError(null);
    if (onShowRewriteDiff) onShowRewriteDiff([{ afterScript: fixed, label: "Fix shot lines", score: null }], "Fix shot lines");
    else onOpenToolReview({ label: "Fix shot lines", beforeScript: fullScript, afterScript: fixed });
  }, [fullScript, onOpenToolReview, onShowRewriteDiff]);

  // Deterministic, instant (no LLM): a full formatting pass that reclassifies
  // every line by context — scene / shot / character + dialogue / transition /
  // action — so the writer can write loosely and the formatter fixes the slots.
  const handleFormattingCorrection = useCallback(() => {
    if (!fullScript.trim()) {
      setError("No script content to format.");
      return;
    }
    const kbNames = (knowledgeBase?.characters ?? []).map((character) => character.name);
    const fixed = correctFountainFormatting(fullScript, kbNames);
    if (fixed.trim() === fullScript.trim()) {
      setError(null);
      setLastMode(null);
      setSuggestion("Formatting already looks correct — nothing to change.");
      return;
    }
    setError(null);
    if (onShowRewriteDiff) onShowRewriteDiff([{ afterScript: fixed, label: "Formatting correction", score: null }], "Formatting correction");
    else onOpenToolReview({ label: "Formatting correction", beforeScript: fullScript, afterScript: fixed });
  }, [fullScript, knowledgeBase, onOpenToolReview, onShowRewriteDiff]);


  const handleSuggest = useCallback(
    async (mode: OrchestratorMode, prompt?: string, characterName?: string) => {
      const currentSettings = getSelectedTextAiProviderSettings();
      setTextAiSettings(currentSettings);
      if (!currentSettings.apiKey.trim()) {
        setShowKeyDialog(true);
        return;
      }
      // Smart continue doesn't need selection
      if (mode !== "smart_continue" && mode !== "scene_builder" && !selectedText.trim()) {
        setError("Select some text in the editor first.");
        return;
      }

      setLoading(true);
      setError(null);
      setSuggestion(null);
      setLastMode(mode);

      try {
        const ctx: OrchestratorContext = {
          selectedText,
          surroundingContext: contextText,
          fullScript,
          cursorLine,
          cursorBeats,
          knowledgeBase,
          styleProfile,
          mode,
          customPrompt: prompt,
          characterName,
          targetPages,
          seriesContext,
          allowedCast,
        };

        const result = await generate(ctx);
        setSuggestion(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [selectedText, contextText, fullScript, cursorLine, cursorBeats, knowledgeBase, styleProfile, targetPages, seriesContext, allowedCast],
  );

  // Re-roll the selected passage into several variants (varied weighting).
  const [reRollVariants, setReRollVariants] = useState<ReRollVariant[] | null>(null);
  const [reRolling, setReRolling] = useState(false);

  const handleReRoll = useCallback(async () => {
    const currentSettings = getSelectedTextAiProviderSettings();
    setTextAiSettings(currentSettings);
    if (!currentSettings.apiKey.trim()) {
      setShowKeyDialog(true);
      return;
    }

    // Snapshot the selection at roll time (variants generate asynchronously, so we
    // must not re-read the live selection on apply). Empty selection -> whole doc.
    const view = editorViewRef?.current;
    const before = view ? view.state.doc.toString() : fullScript;
    let from = 0;
    let to = before.length;
    let passage = before;
    let context = "";
    if (view && !view.state.selection.main.empty) {
      const sel = view.state.selection.main;
      from = sel.from;
      to = sel.to;
      passage = view.state.doc.sliceString(from, to);
      context = view.state.doc.sliceString(Math.max(0, from - 400), Math.min(before.length, to + 400));
    } else if (!view && selectedText.trim()) {
      const idx = before.indexOf(selectedText);
      if (idx >= 0) { from = idx; to = idx + selectedText.length; passage = selectedText; context = contextText; }
    }
    const wholeDoc = from === 0 && to === before.length;
    if (!passage.trim()) {
      setError("Nothing to re-roll.");
      return;
    }

    setReRolling(true);
    setError(null);
    setReRollVariants(null);
    try {
      // Scale the token budget to the passage size so a large/whole-doc re-roll isn't
      // truncated at re_roll's 2048 default (which, on Accept, would replace the whole
      // script with a fragment). Small selections keep the default.
      const rollMaxTokens = (wholeDoc || passage.length > 4000)
        ? Math.min(16000, Math.max(2048, Math.ceil(passage.length / 3)))
        : undefined;
      const variants = await generateReRollVariants({
        selectedText: passage,
        surroundingContext: wholeDoc ? "" : context,
        fullScript,
        cursorLine,
        cursorBeats,
        knowledgeBase,
        styleProfile,
        mode: "re_roll",
        targetPages,
        seriesContext,
        allowedCast,
      }, { maxTokens: rollMaxTokens });
      // For a whole-doc re-roll, a result far shorter than the source is almost
      // certainly a truncated (cut-off) generation — drop it rather than let Accept
      // shrink the script to a fragment.
      const notTruncated = (v: ReRollVariant) => !wholeDoc || v.text.trim().length >= before.length * 0.5;
      const nonError = variants.filter((v) => !v.error && v.text.trim());
      const usable = nonError.filter(notTruncated);
      if (!usable.length) {
        if (nonError.length) {
          setError("Re-roll came back truncated (too short for a whole-script rewrite). Try re-rolling a smaller selection.");
        } else {
          setError(variants.find((v) => v.error)?.error ?? "Re-roll produced nothing usable.");
        }
        return;
      }
      if (onShowRewriteDiff) {
        const candidates: RewriteDiffCandidate[] = usable.map((v) => ({
          afterScript: before.slice(0, from) + v.text + before.slice(to),
          label: `Re-roll · ${v.label}`,
          score: null,
        }));
        // Bar Re-roll: a fresh take on the next installed engine. The live editor
        // selection (which persists through the preview) re-rolls just that passage;
        // with nothing selected it re-rolls the whole draft.
        const reRoll = makeReRollHandler({
          usedProviders: [getTextAiSettings().selectedProvider],
          buildWholeDoc: (beforeNow) => {
            const built = buildPrompt({
              selectedText: beforeNow,
              surroundingContext: "",
              fullScript: beforeNow,
              cursorLine,
              cursorBeats,
              knowledgeBase,
              styleProfile,
              mode: "re_roll",
              targetPages,
              seriesContext,
              allowedCast,
            });
            return {
              ...built,
              temperature: 0.9,
              maxTokens: Math.min(16000, Math.max(2048, Math.ceil(beforeNow.length / 3))),
              kind: "raw" as const,
            };
          },
        });
        onShowRewriteDiff(annotateCast(candidates), wholeDoc ? "Re-roll (whole script)" : "Re-roll selection", reRoll);
        setSuggestion(`Re-rolled ${wholeDoc ? "the whole script" : "the selection"} into ${usable.length} takes. Review the inline diff, then Accept, Reject, Compare next, or Re-roll on the next engine.`);
      } else {
        setReRollVariants(variants);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Re-roll failed");
    } finally {
      setReRolling(false);
    }
  }, [editorViewRef, selectedText, contextText, fullScript, cursorLine, cursorBeats, knowledgeBase, styleProfile, targetPages, seriesContext, onShowRewriteDiff, allowedCast, annotateCast, makeReRollHandler]);

  const applyReRoll = useCallback((text: string) => {
    onApply(text);
    setReRollVariants(null);
  }, [onApply]);

  const handleCustomSubmit = useCallback(() => {
    if (!customPrompt.trim()) return;
    handleSuggest("custom", customPrompt.trim());
  }, [customPrompt, handleSuggest]);

  const handleReportCard = useCallback(async (force = false) => {
    const currentSettings = getSelectedTextAiProviderSettings();
    setTextAiSettings(currentSettings);
    if (!currentSettings.apiKey.trim()) {
      setShowKeyDialog(true);
      return;
    }
    if (!fullScript.trim()) {
      setError("No script content to analyze.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuggestion(null);
    setLastMode(null);
    setScriptDoctorStage("diagnosing");
    try {
      const report = await runScriptReportCard(
        {
          script: fullScript,
          knowledgeBase,
          styleProfile,
          targetPages,
          frameworks: scoringFrameworks,
        },
        { cache: { projectId: project.id, force } },
      );
      setReportCard(report);
      setRewriteReview(null);
      setScriptDoctorStage("treatment");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Report card failed");
    } finally {
      setLoading(false);
    }
  }, [fullScript, knowledgeBase, styleProfile, targetPages, scoringFrameworks, project.id]);

  const handleImproveMetric = useCallback(async (metricId: string, metricName: string) => {
    if (!reportCard) return;
    const currentSettings = getSelectedTextAiProviderSettings();
    setTextAiSettings(currentSettings);
    if (!currentSettings.apiKey.trim()) {
      setShowKeyDialog(true);
      return;
    }

    setLoading(true);
    setError(null);
    setSuggestion(null);
    setLastMode("instant_critique");
    try {
      const plan = await generateMetricImprovementPlan({
        script: fullScript,
        knowledgeBase,
        styleProfile,
        targetPages,
        reportCard,
        metricId,
        metricName,
      });
      setSuggestion(plan);
      setScriptDoctorStage("treatment");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Improve plan failed");
    } finally {
      setLoading(false);
    }
  }, [fullScript, knowledgeBase, styleProfile, targetPages, reportCard]);

  const ensureRewriteReady = useCallback((): boolean => {
    const currentSettings = getSelectedTextAiProviderSettings();
    setTextAiSettings(currentSettings);
    if (!currentSettings.apiKey.trim()) {
      setShowKeyDialog(true);
      return false;
    }
    if (!reportCard) {
      setError("Run Script Report Card first, then choose a rewrite action.");
      return false;
    }
    if (!fullScript.trim()) {
      setError("No script content to rewrite.");
      return false;
    }
    return true;
  }, [fullScript, reportCard]);

  const stageRewritePreview = useCallback((result: ScriptRewriteResult, label: string, beforeScript: string, beforeReport: ScriptReportCard) => {
    const validation = validateRewriteScript(result.rewrittenScript);
    setRewriteReview({
      id: Date.now(),
      label,
      beforeScript,
      afterScript: result.rewrittenScript,
      beforeReport,
      afterReport: null,
      comparison: null,
      result,
      diff: summarizeRewriteDiff(beforeScript, result.rewrittenScript),
      validation,
      applied: false,
      accepted: false,
    });
    setScriptDoctorStage("preview");
    setSuggestion(validation.canApply
      ? `${label} preview is ready. The main editor has NOT been changed. Review the rewrite below, then Apply To Draft or Discard.`
      : `${label} returned a draft, but validation found issues. The main editor has NOT been changed.`);
    setLastMode(null);
  }, []);

  const handleRewriteMetric = useCallback(async (metricId: string, metricName: string) => {
    if (!ensureRewriteReady() || !reportCard) return;
    const confirmed = window.confirm(`Ask AI for a full-script rewrite to improve ${metricName}? This will create a preview first and will NOT change the editor until you click Apply To Draft.`);
    if (!confirmed) return;

    setLoading(true);
    setError(null);
    setSuggestion(null);
    setScriptDoctorStage("requesting");
    try {
      // Framework metrics (Dan Harmon, Save the Cat, etc.) get the closed-loop
      // Story Doctor: restructure -> re-score -> fix -> re-score, keep the best.
      // Craft metrics (style/character/pacing) use the single-pass rewrite.
      const result = isFrameworkMetric(metricId)
        ? await runStoryDoctor({
            script: fullScript,
            metricId,
            metricName,
            targetPages,
            reportCard,
            knowledgeBase,
            styleProfile,
            seriesContext,
            allowedCast,
          }, setShotPassProgress)
        : await rewriteScriptForMetric({
            script: fullScript,
            knowledgeBase,
            styleProfile,
            targetPages,
            reportCard,
            metricId,
            metricName,
            seriesContext,
            allowedCast,
          }, setShotPassProgress);
      setScriptDoctorStage("validating");
      stageRewritePreview(result, `${metricName} rewrite`, fullScript, reportCard);
    } catch (e) {
      setScriptDoctorStage(reportCard ? "treatment" : "idle");
      setError(e instanceof Error ? e.message : "Metric rewrite failed");
    } finally {
      setLoading(false);
      setShotPassProgress(null);
    }
  }, [stageRewritePreview, ensureRewriteReady, fullScript, knowledgeBase, reportCard, styleProfile, targetPages, seriesContext, allowedCast]);

  // Multi-provider rewrite: run the selected providers in parallel and show the best
  // as an inline diff overlay (with Compare-next to cycle).
  //  - Framework metrics (Dan Harmon, Save the Cat, ...) run the FULL closed-loop
  //    Story Doctor per provider (restructure -> re-score -> fix -> re-score, plus
  //    page-expansion toward the target). This preserves the "reach the target pages /
  //    beat the score" behaviour across N engines instead of a single shot.
  //  - Craft metrics (style/character/pacing) use a single strong pass per provider,
  //    scored and ranked (breadth over depth).
  const handleMultiRewrite = useCallback(async (metricId: string, metricName: string) => {
    if (!ensureRewriteReady() || !reportCard || !onShowRewriteDiff) return;
    const providers = rewriteProviders.filter((p) => getTextAiProviderSettings(p).apiKey.trim());
    if (!providers.length) {
      setError("None of the selected rewrite providers has an API key. Pick providers with keys (Rewrite engines ▾) or add one in Settings.");
      return;
    }
    const labelFor = (p: TextAiProvider) => textAiProviderLabel(p);
    const start = metricScoreFromCard(reportCard, metricId);

    setLoading(true);
    setError(null);
    setSuggestion(null);
    setLastMode(null); // status text must render as a banner, never an applyable suggestion
    setScriptDoctorStage("requesting");
    try {
      let candidates: RewriteDiffCandidate[] = [];
      let okCount = 0;

      if (isFrameworkMetric(metricId)) {
        // Each provider gets its own Story Doctor loop, run concurrently.
        const settled = await Promise.allSettled(providers.map(async (p) => {
          const svc = TextAiService.forProvider(p);
          const res = await runStoryDoctor(
            { script: fullScript, metricId, metricName, targetPages, reportCard, knowledgeBase, styleProfile, seriesContext, allowedCast },
            (prog) => setShotPassProgress({ ...prog, label: `${labelFor(p)}: ${prog.label}` }),
            svc.complete.bind(svc),
          );
          return { provider: p, label: labelFor(p), res };
        }));
        const done = settled
          .filter((s): s is PromiseFulfilledResult<{ provider: TextAiProvider; label: string; res: Awaited<ReturnType<typeof runStoryDoctor>> }> => s.status === "fulfilled")
          .map((s) => s.value)
          .sort((a, b) => (b.res.finalScore ?? -1) - (a.res.finalScore ?? -1));
        okCount = done.length;
        candidates = done
          .filter((d) => d.res.rewrittenScript.trim() && d.res.rewrittenScript.trim() !== fullScript.trim())
          .map((d) => ({ afterScript: d.res.rewrittenScript, label: `${d.label} · ${metricName} ${d.res.finalScore}`, score: d.res.finalScore }));
      } else {
        const prompt = buildMetricRewritePrompt({ script: fullScript, knowledgeBase, styleProfile, targetPages, seriesContext, reportCard, metricId, metricName, allowedCast });
        const result = await runMultiProviderRewrite({
          providers,
          prompt,
          characterNames: allowedCast,
          onProgress: (label) => setShotPassProgress({ completed: 0, total: 1, label }),
          scoreCandidate: async (after) => {
            const card = await runScriptReportCard(
              { script: after, knowledgeBase, styleProfile, targetPages, seriesContext, frameworks: scoringFrameworks },
              { samples: 2 },
            );
            return metricScoreFromCard(card, metricId);
          },
        });
        okCount = result.candidates.filter((c) => !c.error).length;
        candidates = result.candidates
          .filter((c) => !c.error && c.afterScript.trim() && c.afterScript.trim() !== fullScript.trim())
          .map((c) => ({ afterScript: c.afterScript, label: `${c.providerLabel}${c.score !== null ? ` · ${metricName} ${c.score}` : ""}`, score: c.score }));
      }

      if (!candidates.length) {
        setError(okCount ? "Every engine returned the original unchanged. Try again or pick different engines." : "No engine produced a usable rewrite. Try again or pick different engines.");
        setScriptDoctorStage("treatment");
        return;
      }
      // Bar Re-roll: one fresh single-pass take on the next installed engine, using
      // this metric's own prompt (or the highlighted passage when one is selected).
      const reRoll = makeReRollHandler({
        usedProviders: providers,
        buildWholeDoc: (before) => ({
          ...buildMetricRewritePrompt({ script: before, knowledgeBase, styleProfile, targetPages, seriesContext, reportCard, metricId, metricName, allowedCast }),
          temperature: 0.65, // hotter than the fan-out pass — a re-roll wants a different take
          kind: "json" as const,
        }),
      });
      // Annotate BEFORE composing the status line: cast-lock demotion can reorder
      // the takes, and the message must describe the take the bar actually shows.
      const annotated = annotateCast(candidates);
      const shown = annotated[0];
      const flaggedCount = annotated.filter((c) => c.castWarnings?.length).length;
      onShowRewriteDiff(annotated, `${metricName} rewrite`, reRoll);
      setSuggestion(
        `Rewrote with ${okCount} engine${okCount === 1 ? "" : "s"}. Showing: ${shown.label}${shown.score !== null ? ` (${metricName} ${start} → ${shown.score})` : ""}.${flaggedCount ? ` ${flaggedCount} take${flaggedCount === 1 ? " was" : "s were"} flagged for invented characters and demoted.` : ""} Review the inline diff, then Accept, Reject, Compare next, or Re-roll.`,
      );
      setScriptDoctorStage("treatment");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Multi-provider rewrite failed");
      setScriptDoctorStage(reportCard ? "treatment" : "idle");
    } finally {
      setLoading(false);
      setShotPassProgress(null);
    }
  }, [ensureRewriteReady, reportCard, onShowRewriteDiff, rewriteProviders, fullScript, knowledgeBase, styleProfile, targetPages, seriesContext, scoringFrameworks, allowedCast, annotateCast, makeReRollHandler]);

  // The Writers' Room: the full multi-stage development pass (showrunner memo →
  // engine pitches → judged board iterated at OUTLINE level → one-voice scene-by-
  // scene draft → dialogue + cut punch-ups on a second engine → rival-model table
  // read with targeted fixes → final score). One click, whole room.
  const handleWritersRoom = useCallback(async (metricId: string, metricName: string) => {
    if (!ensureRewriteReady() || !reportCard || !onShowRewriteDiff) return;
    const writer = getTextAiSettings().selectedProvider;
    const keyed = Array.from(new Set([writer, ...rewriteProviders])).filter((p) => getTextAiProviderSettings(p).apiKey.trim());
    if (!keyed.length) {
      setError("The Writers' Room needs at least one engine with an API key. Pick engines (Rewrite engines ▾) or add a key in Settings.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuggestion(null);
    setLastMode(null); // status text must render as a banner, never an applyable suggestion
    setScriptDoctorStage("requesting");
    try {
      const result = await runWritersRoom({
        script: fullScript,
        frameworkId: metricId,
        frameworkName: metricName,
        targetPages,
        reportCard,
        knowledgeBase,
        styleProfile,
        seriesContext,
        allowedCast,
        engines: keyed,
      }, setShotPassProgress);

      if (!result.finalScript.trim() || result.finalScript.trim() === fullScript.trim()) {
        setError("The room returned the draft unchanged. Try again.");
        setScriptDoctorStage("treatment");
        return;
      }
      const reRoll = makeReRollHandler({
        usedProviders: keyed,
        buildWholeDoc: (before) => ({
          ...buildMetricRewritePrompt({ script: before, knowledgeBase, styleProfile, targetPages, seriesContext, reportCard, metricId, metricName, allowedCast }),
          temperature: 0.65,
          kind: "json" as const,
        }),
      });
      const candidates = annotateCast([{
        afterScript: result.finalScript,
        label: `Writers' Room · ${metricName}`, // the bar shows the score chip separately
        score: result.finalScore,
      }]);
      onShowRewriteDiff(candidates, `Writers' Room — ${metricName}`, reRoll);
      const start = metricScoreFromCard(reportCard, metricId);
      if (result.warnings.length) console.warn("Writers' Room warnings:", result.warnings);
      setSuggestion(
        `Writers' Room wrapped — ${result.seats.drafter} drafted, ${result.seats.judge} ran the board, ${result.seats.coverage} gave coverage. ` +
        `Board: ${result.board.length} scenes, outline ${result.outlineScores.join(" → ") || "unscored"}.` +
        (result.finalScore !== null ? ` ${metricName}: ${start} → ${result.finalScore}.` : "") +
        (result.memo.theme ? ` Theme: "${result.memo.theme}"` : "") +
        (result.warnings.length ? ` (${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"} — see console.)` : ""),
      );
      setScriptDoctorStage("treatment");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Writers' Room failed");
      setScriptDoctorStage(reportCard ? "treatment" : "idle");
    } finally {
      setLoading(false);
      setShotPassProgress(null);
    }
  }, [ensureRewriteReady, reportCard, onShowRewriteDiff, rewriteProviders, fullScript, knowledgeBase, styleProfile, targetPages, seriesContext, allowedCast, annotateCast, makeReRollHandler]);

  const handleReScoreRewrite = useCallback(async () => {
    if (!rewriteReview) return;
    if (!rewriteReview.applied) {
      setError("Apply the rewrite to the draft before re-scoring it.");
      return;
    }
    const currentSettings = getSelectedTextAiProviderSettings();
    setTextAiSettings(currentSettings);
    if (!currentSettings.apiKey.trim()) {
      setShowKeyDialog(true);
      return;
    }

    setLoading(true);
    setError(null);
    setSuggestion(null);
    setScriptDoctorStage("rescoring");
    try {
      const afterReport = await runScriptReportCard({
        script: rewriteReview.afterScript,
        knowledgeBase,
        styleProfile,
        targetPages,
        frameworks: scoringFrameworks,
      });
      const comparison = compareReportCards(rewriteReview.beforeReport, afterReport);
      setReportCard(afterReport);
      setRewriteReview((current) => current && current.id === rewriteReview.id ? { ...current, afterReport, comparison } : current);
      setSuggestion(`Re-score complete. Overall score ${comparison.beforeOverall} -> ${comparison.afterOverall} (${comparison.overallDelta > 0 ? "+" : ""}${comparison.overallDelta}).`);
      setScriptDoctorStage("applied");
      setLastMode(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Re-score after rewrite failed");
    } finally {
      setLoading(false);
    }
  }, [knowledgeBase, rewriteReview, styleProfile, targetPages, scoringFrameworks]);

  const handleApplyRewriteToDraft = useCallback(() => {
    if (!rewriteReview) return;
    if (!rewriteReview.validation.canApply) {
      setError(`Cannot apply yet: ${rewriteReview.validation.issues.join(" ")}`);
      return;
    }
    onAiCommit?.(rewriteReview.label || "Rewrite", rewriteReview.afterScript);
    onReplaceScript(rewriteReview.afterScript);
    // The editor content just changed to the rewrite — drop the persisted card so
    // a stale pre-rewrite score isn't restored on remount; the next Run/Re-score
    // recomputes (and re-caches) against the new content.
    clearStoredReportCard(project.id);
    setRewriteReview({ ...rewriteReview, applied: true });
    setScriptDoctorStage("applied");
    setSuggestion("Rewrite applied to the main editor. You can Re-score, Revert to the pre-rewrite snapshot, or Accept the rewrite.");
    setLastMode(null);
  }, [onReplaceScript, onAiCommit, rewriteReview, project.id]);

  const handleDiscardRewritePreview = useCallback(() => {
    setRewriteReview(null);
    setScriptDoctorStage(reportCard ? "treatment" : "idle");
    setSuggestion("Rewrite preview discarded. The main editor was not changed.");
    setLastMode(null);
  }, [reportCard]);

  const handleAcceptRewrite = useCallback(() => {
    if (!rewriteReview) return;
    setRewriteReview({ ...rewriteReview, accepted: true });
    setSuggestion("Rewrite accepted. You can continue editing or run another report card pass.");
    setLastMode(null);
  }, [rewriteReview]);

  const handleRevertRewrite = useCallback(() => {
    if (!rewriteReview) return;
    if (!rewriteReview.applied) {
      handleDiscardRewritePreview();
      return;
    }
    const confirmed = window.confirm("Revert to the pre-rewrite snapshot? This replaces the editor text with the saved pre-rewrite draft.");
    if (!confirmed) return;
    onReplaceScript(rewriteReview.beforeScript);
    setReportCard(rewriteReview.beforeReport);
    setSuggestion("Rewrite reverted. The editor has been restored to the pre-rewrite snapshot.");
    setScriptDoctorStage("treatment");
    setLastMode(null);
    setRewriteReview(null);
  }, [handleDiscardRewritePreview, onReplaceScript, rewriteReview]);

  const handleCopyRewriteScript = useCallback(() => {
    if (!rewriteReview) return;
    navigator.clipboard.writeText(rewriteReview.afterScript);
  }, [rewriteReview]);

  // Dismiss the rewrite-review overlay in any state (an applied change stays in
  // the editor; this just closes the panel).
  const handleCloseRewriteReview = useCallback(() => {
    setRewriteReview(null);
    setScriptDoctorStage(reportCard ? "treatment" : "idle");
    setLastMode(null);
  }, [reportCard]);

  // Let the writer tweak the proposed rewrite before applying; re-validate + re-diff live.
  const handleEditRewriteScript = useCallback((text: string) => {
    setRewriteReview((cur) => cur && !cur.applied ? {
      ...cur,
      afterScript: text,
      result: { ...cur.result, rewrittenScript: text },
      validation: validateRewriteScript(text),
      diff: summarizeRewriteDiff(cur.beforeScript, text),
    } : cur);
  }, []);

  const characters = knowledgeBase?.characters ?? [];

  return (
    <div className="suggestion-panel">
      <div className="suggestion-header">
        <span className="suggestion-title">AI Assist</span>
        <button
          className="key-btn"
          onClick={() => setShowKeyDialog(true)}
          title="Configure API key"
        >
          {textAiSettings.apiKey.trim() ? `${textAiProviderLabel(textAiSettings.provider)} OK` : "Set Text AI"}
        </button>
      </div>

      {/* Beat context indicator */}
      {cursorBeats.length > 0 && (
        <div className="beat-context">
          {cursorBeats.map((b, i) => (
            <span key={i} className="beat-badge" style={{ borderColor: b.color, color: b.color }}>
              {b.name}
            </span>
          ))}
        </div>
      )}

      {/* Context indicators */}
      <div className="context-indicators">
        {knowledgeBase && knowledgeBase.characters.length > 0 && (
          <span className="ctx-badge kb">KB: {knowledgeBase.characters.length}ch</span>
        )}
        {styleProfile && <span className="ctx-badge style">Style</span>}
      </div>

      {/* Story Generator — direct single-call generation from the writer model */}
      <div className="ai-group">
        <div className="ai-group-label">Story Generator</div>
        <div className="story-gen">
          <textarea
            className="story-gen-prompt"
            value={genPrompt}
            onChange={(e) => setGenPrompt(e.target.value)}
            placeholder="Describe what to write — e.g. a children's urban-fantasy adventure about an immortal boy and his pet dragon, following Dan Harmon's story circle, as a Hollywood screenplay."
            rows={4}
            disabled={genLoading}
          />
          <div className="story-gen-controls">
            <label className="story-gen-amount">
              <input
                type="number"
                min={1}
                max={120}
                value={genAmount}
                onChange={(e) => setGenAmount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                disabled={genLoading}
              />
            </label>
            <select
              className="story-gen-unit"
              value={genUnit}
              onChange={(e) => setGenUnit(e.target.value as GenerationUnit)}
              disabled={genLoading}
            >
              <option value="pages">pages</option>
              <option value="words">words</option>
            </select>
            <button
              className="story-gen-btn"
              onClick={handleGenerateFromPrompt}
              disabled={genLoading || !genPrompt.trim()}
            >
              {genLoading ? "Writing..." : "Generate"}
            </button>
          </div>
          <label className="story-gen-toggle">
            <input
              type="checkbox"
              checked={genPlan}
              onChange={(e) => setGenPlan(e.target.checked)}
              disabled={genLoading}
            />
            Plan &amp; write (long-form: outline first, then write each beat)
          </label>
          <div className="full-shot-pass-hint">
            {genPlan
              ? `Analyst outlines the beats, then the writer (${textAiProviderLabel(textAiSettings.provider)}) drafts each beat in its own call — carrying your KB, style, the outline, and the story-so-far forward. Built for length without repetition.`
              : `One direct call to the writer (${textAiProviderLabel(textAiSettings.provider)}) — no plan. Best for a single scene or short passage. Use a blank document to see the writer's raw output.`}
          </div>
          {genStatus && <div className="story-gen-status">{genStatus}</div>}
          {genError && <div className="story-gen-error">{genError}</div>}
        </div>
      </div>

      {/* Re-roll the selected passage into variants */}
      <div className="ai-group">
        <div className="ai-group-label">Re-roll</div>
        <div className="full-shot-pass">
          <button
            className="full-shot-pass-btn"
            onClick={handleReRoll}
            disabled={reRolling || !fullScript.trim()}
            title="Regenerate the highlighted passage (or the whole script if nothing is selected) into a few takes"
          >
            {reRolling ? "Rolling…" : selectedText.trim() ? "Re-roll Selection" : "Re-roll Whole Script"}
          </button>
          <div className="full-shot-pass-hint">
            Highlight a passage and re-roll it into a few takes (faithful → wild); with nothing selected it re-rolls the whole script. Review each as an inline diff.
          </div>
          {reRollVariants && (
            <div className="reroll-variants">
              {reRollVariants.map((v) => (
                <div key={v.id} className="reroll-variant">
                  <div className="reroll-variant-head">
                    <span className="reroll-variant-label">{v.label}</span>
                    {!v.error && v.text && (
                      <button className="reroll-use" onClick={() => applyReRoll(v.text)}>Use</button>
                    )}
                  </div>
                  {v.error ? (
                    <div className="reroll-variant-error">{v.error}</div>
                  ) : (
                    <div className="reroll-variant-text">{v.text}</div>
                  )}
                </div>
              ))}
              <button className="reroll-dismiss" onClick={() => setReRollVariants(null)}>Dismiss</button>
            </div>
          )}
        </div>
      </div>

      {/* Scorecard wizard */}
      <div className="ai-group">
        <div className="ai-group-label">Scorecard Wizard</div>
        <div className="full-shot-pass">
          <button
            className="full-shot-pass-btn report-card-btn"
            onClick={() => handleReportCard(false)}
            disabled={loading || !fullScript.trim()}
            title="Score the whole script against structure frameworks, style match, character consistency, and pacing"
          >
            Run Script Report Card
          </button>
          {reportCard && (
            <button
              className="full-shot-pass-btn report-card-rescore-btn"
              onClick={() => handleReportCard(true)}
              disabled={loading || !fullScript.trim()}
              title="Recompute from scratch (bypass the cached result for unchanged text)"
            >
              Re-score
            </button>
          )}
          <div className="full-shot-pass-hint">
            Diagnose, plan a fix, and preview targeted/framework rewrites. Same text returns the same score (cached); use Re-score to recompute. Scores your active framework(s), style, characters, and pacing.
          </div>
        </div>
        {onShowRewriteDiff && (
          <div className="rewrite-providers">
            <button className="rewrite-providers-toggle" onClick={() => setShowProviderPicker((s) => !s)}>
              {showProviderPicker ? "▾" : "▸"} Rewrite engines ({rewriteProviders.filter((p) => getTextAiProviderSettings(p).apiKey.trim()).length}/{rewriteProviders.length})
            </button>
            {showProviderPicker && (
              <div className="rewrite-providers-list">
                <div className="rewrite-providers-hint">A rewrite runs across these providers in parallel and shows the best (pick up to 4; only providers with a key run).</div>
                {textAiProviderOptions().map((p) => {
                  const keyed = Boolean(getTextAiProviderSettings(p).apiKey.trim());
                  const checked = rewriteProviders.includes(p);
                  return (
                    <label key={p} className={`rewrite-provider-row ${checked ? "on" : ""}`}>
                      <input type="checkbox" checked={checked} disabled={(!checked && rewriteProviders.length >= 4) || (checked && rewriteProviders.length <= 1)} onChange={() => toggleRewriteProvider(p)} />
                      <span>{textAiProviderLabel(p)}</span>
                      {!keyed && <span className="rewrite-provider-nokey">no key</span>}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* À la carte tools — whole-script passes */}
      <div className="ai-group">
        <div className="ai-group-label">À la carte tools</div>
        <div className="full-shot-pass">
          <button
            className="full-shot-pass-btn"
            onClick={handleFullShotPass}
            disabled={loading || !fullScript.trim()}
            title="Analyze the whole script scene-by-scene and automatically add professional shot direction lines"
          >
            Expand Shots
          </button>
          <div className="full-shot-pass-hint">
            Adds WS/MS/CU coverage, OTS dialogue shots, inserts, reactions, and action beats across the whole script.
          </div>
        </div>
        <div className="full-shot-pass">
          <button
            className="full-shot-pass-btn"
            onClick={handleExpandDescriptions}
            disabled={loading || !fullScript.trim()}
            title="Add a short visual description of the location under every INT./EXT. that lacks one, so the asset generator has something to draw from"
          >
            Scene Descriptions
          </button>
          <div className="full-shot-pass-hint">
            Detects the genre, then writes a short visual description of the location under any INT./EXT. that jumps straight into a shot or action — so the scene-image generator has something concrete. Leaves dialogue, character action, and existing descriptions alone. Preview before applying.
          </div>
        </div>
        <div className="full-shot-pass">
          <button
            className="full-shot-pass-btn"
            onClick={handleCleanUp}
            disabled={loading || !fullScript.trim()}
            title="Fix grammar, spelling, and redundant duplications across the whole script"
          >
            Clean Up
          </button>
          <div className="full-shot-pass-hint">
            Fixes grammar, spelling, and unnecessary duplications (like back-to-back shots with no action between). Preview before applying.
          </div>
        </div>
        <div className="full-shot-pass">
          <button
            className="full-shot-pass-btn"
            onClick={handleFixShotLines}
            disabled={loading || !fullScript.trim()}
            title="Re-prefix bare camera-shot lines with !! so they render as shots, not character cues"
          >
            Fix Shot Lines
          </button>
          <div className="full-shot-pass-hint">
            Instant, no AI: any camera shot written as plain CAPS (e.g. "WS LIVING ROOM") gets the "!!" prefix so it stops landing in the character/dialogue slot. Preview before applying.
          </div>
        </div>
        <div className="full-shot-pass">
          <button
            className="full-shot-pass-btn"
            onClick={handleFormattingCorrection}
            disabled={loading || !fullScript.trim()}
            title="Reclassify every line by context — scene, shot, character, dialogue, action — and fix the Fountain formatting"
          >
            Formatting Correction
          </button>
          <div className="full-shot-pass-hint">
            Instant, no AI: a full pass that guesses each line's type from context (INT./EXT. → scene, WS/CU… → shot, a known name → character + the lines under it → dialogue, the rest → action) and rewrites the formatting so the writer can write loosely. Preview before applying.
          </div>
        </div>
        <div className="full-shot-pass image-gen-section">
          <button
            className="full-shot-pass-btn"
            onClick={() => setShowImageGen((v) => !v)}
            title="Generate scene backgrounds and character portraits from the script"
          >
            {showImageGen ? "▾ Image Generation" : "▸ Image Generation"}
          </button>
          <div className="full-shot-pass-hint">
            Generate scene backgrounds and character portraits from the script (pulls each scene's description). Results show up in the KB lists and feed Export.
          </div>
          {showImageGen && (
            <div className="image-gen-embed">
              <AssetPanel
                mode="generation"
                project={project}
                assets={assets}
                onAssetsChange={onAssetsChange}
                onGenerationComplete={onGenerationComplete}
                onWorldChange={onWorldChange}
              />
            </div>
          )}
        </div>
      </div>

      {!selectedText.trim() && (
        <div className="suggestion-hint">
          Select text for suggestions, or use Continue/Scene Build without selection.
        </div>
      )}

      {selectedText.trim() && (
        <div className="suggestion-selected">
          <div className="selected-label">Selected:</div>
          <div className="selected-preview">
            {selectedText.length > 120
              ? selectedText.slice(0, 120) + "..."
              : selectedText}
          </div>
        </div>
      )}

      {/* Custom prompt */}
      <div className="custom-prompt-section">
        <textarea
          className="custom-prompt-input"
          placeholder="Ask anything about the selected text..."
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleCustomSubmit();
            }
          }}
          rows={2}
          disabled={loading}
        />
        <button
          className="custom-prompt-btn"
          onClick={handleCustomSubmit}
          disabled={loading || !customPrompt.trim()}
        >
          Ask
        </button>
      </div>

      {/* Writing mode buttons */}
      <div className="suggestion-modes">
        {WRITING_MODES.map((m) => (
          <button
            key={m.id}
            className="mode-btn"
            onClick={() => handleSuggest(m.id)}
            disabled={loading}
            title={m.id.replace(/_/g, " ")}
          >
            <span className="mode-icon">{m.icon}</span>
            {m.label}
          </button>
        ))}
      </div>

      {/* Advanced tools toggle */}
      <button
        className="advanced-toggle"
        onClick={() => setShowAdvanced(!showAdvanced)}
      >
        {showAdvanced ? "v" : ">"} AI Tools
      </button>

      {showAdvanced && (
        <div className="advanced-section">
          {/* Character selector for character-specific modes */}
          {characters.length > 0 && (
            <div className="char-selector">
              <select
                className="char-select"
                value={charSelect}
                onChange={e => setCharSelect(e.target.value)}
              >
                <option value="">Select character...</option>
                {characters.map(c => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="suggestion-modes">
            {ADVANCED_MODES.map((m) => (
              <button
                key={m.id}
                className={`mode-btn ${isAnalysisMode(m.id) ? "analysis" : ""}`}
                onClick={() => {
                  if (m.id === "character_voice" && charSelect) {
                    handleSuggest(m.id, undefined, charSelect);
                  } else if (m.id === "scene_builder") {
                    handleSuggest(m.id, undefined, charSelect || undefined);
                  } else {
                    handleSuggest(m.id);
                  }
                }}
                disabled={loading || (m.needsSelection && !selectedText.trim())}
                title={m.id.replace(/_/g, " ")}
              >
                <span className="mode-icon">{m.icon}</span>
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="suggestion-loading">
          <span className="spinner" />
          {shotPassProgress
            ? `${shotPassProgress.label} (${shotPassProgress.completed}/${shotPassProgress.total})`
            : "Thinking..."}
        </div>
      )}

      {error && <div className="suggestion-error">{error}</div>}

      {(reportCard || rewriteReview || scriptDoctorStage !== "idle") && (
        <ScriptDoctorWorkflow stage={scriptDoctorStage} reportReady={Boolean(reportCard)} previewReady={Boolean(rewriteReview)} applied={Boolean(rewriteReview?.applied)} />
      )}

      {reportCard && (
        <div className="report-card-shell">
          <div className="report-card-bar">
            <button
              className="report-card-toggle"
              onClick={() => setReportCollapsed((c) => !c)}
              title={reportCollapsed ? "Show scorecard" : "Hide scorecard"}
            >
              {reportCollapsed ? "▸" : "▾"} Scorecard
              <span className={`report-card-chip ${reportCard.overallScore >= 80 ? "high" : reportCard.overallScore >= 60 ? "mid" : "low"}`}>
                {reportCard.overallScore}/100
              </span>
            </button>
            <button className="report-card-clear" onClick={() => { setReportCard(null); setReportCollapsed(false); clearStoredReportCard(project.id); }} title="Dismiss scorecard">✕</button>
          </div>
          {!reportCollapsed && (
            <ReportCard
              report={reportCard}
              onImproveMetric={handleImproveMetric}
              onRewriteMetric={onShowRewriteDiff ? handleMultiRewrite : handleRewriteMetric}
              onWritersRoom={onShowRewriteDiff ? handleWritersRoom : undefined}
              loading={loading}
            />
          )}
        </div>
      )}

      {rewriteReview && (
        <div className="rewrite-review-overlay">
          <div className="rewrite-review-overlay-inner">
            <button className="rewrite-review-overlay-close" onClick={handleCloseRewriteReview} title="Close review">✕</button>
            <RewriteReviewCard
              label={rewriteReview.label}
              result={rewriteReview.result}
              diff={rewriteReview.diff}
              beforeReport={rewriteReview.beforeReport}
              afterReport={rewriteReview.afterReport}
              comparison={rewriteReview.comparison}
              loading={loading}
              accepted={rewriteReview.accepted}
              applied={rewriteReview.applied}
              validation={rewriteReview.validation}
              onApplyToDraft={handleApplyRewriteToDraft}
              onDiscard={handleDiscardRewritePreview}
              onRescore={handleReScoreRewrite}
              onAccept={handleAcceptRewrite}
              onRevert={handleRevertRewrite}
              onCopyScript={handleCopyRewriteScript}
              onEditScript={handleEditRewriteScript}
            />
          </div>
        </div>
      )}

      {suggestion && lastMode && isAnalysisMode(lastMode) && (
        <AnalysisCard text={suggestion} />
      )}

      {suggestion && lastMode && !isAnalysisMode(lastMode) && (
        <SuggestionCard
          text={suggestion}
          onApply={() => onApply(suggestion)}
          onInsertBelow={() => onInsertBelow(suggestion)}
        />
      )}

      {suggestion && !lastMode && (
        <div className="suggestion-success">{suggestion}</div>
      )}

      {showKeyDialog && (
        <ApiKeyDialog
          onSave={() => {
            setTextAiSettings(getSelectedTextAiProviderSettings());
            setShowKeyDialog(false);
          }}
          onClose={() => setShowKeyDialog(false)}
        />
      )}
    </div>
  );
}

function ScriptDoctorWorkflow({ stage, reportReady, previewReady, applied }: { stage: ScriptDoctorStage; reportReady: boolean; previewReady: boolean; applied: boolean }) {
  const rows = [
    { label: "Diagnose draft", status: reportReady ? "DONE" : stage === "diagnosing" ? "RUNNING" : "WAITING" },
    { label: "Select treatment", status: reportReady ? "READY" : "WAITING" },
    { label: "Ask AI for revised draft", status: stage === "requesting" ? "RUNNING" : previewReady || applied ? "DONE" : "WAITING" },
    { label: "Validate AI response", status: stage === "validating" ? "RUNNING" : previewReady || applied ? "DONE" : "WAITING" },
    { label: "Preview rewrite", status: previewReady && !applied ? "HUMAN DECISION" : applied ? "DONE" : "WAITING" },
    { label: "Apply to editor", status: applied ? "DONE" : previewReady ? "HUMAN DECISION" : "WAITING" },
    { label: "Re-score revised draft", status: stage === "rescoring" ? "RUNNING" : applied ? "OPTIONAL" : "WAITING" },
  ];
  return (
    <div className="script-doctor-workflow">
      <div className="script-doctor-title">Script Doctor Workflow</div>
      {rows.map((row, index) => (
        <div key={row.label} className="script-doctor-row">
          <span>{index + 1}. {row.label}</span>
          <span className={`script-doctor-status ${row.status.toLowerCase().replace(/\s+/g, "-")}`}>{row.status}</span>
        </div>
      ))}
    </div>
  );
}
