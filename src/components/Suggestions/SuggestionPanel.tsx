import { useState, useCallback } from "react";
import { getSelectedTextAiProviderSettings, textAiProviderLabel, type TextAiProviderSettings } from "../../services/textAiSettingsService";
import { rewriteScriptWithShotDirections, type ShotPassProgress } from "../../services/shotDirectionService";
import { generateFromPrompt, type GenerationUnit } from "../../services/promptGenerationService";
import { generateLongScreenplay } from "../../services/planThenWriteService";
import { fillSceneDescriptions } from "../../services/expandDescriptionsService";
import { rewriteScriptWithCleanup } from "../../services/cleanupService";
import { normalizeShotLines } from "../../services/fountainShotNormalizer";
import { correctFountainFormatting } from "../../services/fountainFormatCorrector";
import { runScriptReportCard, generateMetricImprovementPlan, rewriteScriptForMetric, fillScriptGaps, summarizeRewriteDiff, compareReportCards, validateRewriteScript, type ScriptReportCard, type ScriptRewriteResult, type RewriteDiffSummary, type ReportCardComparison, type RewriteValidationResult } from "../../services/scriptReportCardService";
import { runStoryDoctor, isFrameworkMetric } from "../../services/storyDoctorService";
import {
  generate,
  isAnalysisMode,
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
  const [rewriteReview, setRewriteReview] = useState<RewriteReviewState | null>(null);
  const [scriptDoctorStage, setScriptDoctorStage] = useState<ScriptDoctorStage>("idle");
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
        // Hand the result to App, which opens a full-width Review pane (big, with a
        // change diff) and navigates the user to it on completion.
        onOpenToolReview({ label, beforeScript: fullScript, afterScript: rewritten });
      } catch (e) {
        setError(e instanceof Error ? e.message : `${label} failed`);
      } finally {
        setLoading(false);
        setShotPassProgress(null);
      }
    },
    [fullScript, onOpenToolReview],
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
    onOpenToolReview({ label: "Fix shot lines", beforeScript: fullScript, afterScript: fixed });
  }, [fullScript, onOpenToolReview]);

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
    onOpenToolReview({ label: "Formatting correction", beforeScript: fullScript, afterScript: fixed });
  }, [fullScript, knowledgeBase, onOpenToolReview]);


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
        };

        const result = await generate(ctx);
        setSuggestion(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [selectedText, contextText, fullScript, cursorLine, cursorBeats, knowledgeBase, styleProfile, targetPages, seriesContext],
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
    if (!selectedText.trim()) {
      setError("Select the paragraph or passage to re-roll first.");
      return;
    }
    setReRolling(true);
    setError(null);
    setReRollVariants(null);
    try {
      const variants = await generateReRollVariants({
        selectedText,
        surroundingContext: contextText,
        fullScript,
        cursorLine,
        cursorBeats,
        knowledgeBase,
        styleProfile,
        mode: "re_roll",
        targetPages,
        seriesContext,
      });
      setReRollVariants(variants);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Re-roll failed");
    } finally {
      setReRolling(false);
    }
  }, [selectedText, contextText, fullScript, cursorLine, cursorBeats, knowledgeBase, styleProfile, targetPages, seriesContext]);

  const applyReRoll = useCallback((text: string) => {
    onApply(text);
    setReRollVariants(null);
  }, [onApply]);

  const handleCustomSubmit = useCallback(() => {
    if (!customPrompt.trim()) return;
    handleSuggest("custom", customPrompt.trim());
  }, [customPrompt, handleSuggest]);

  const handleReportCard = useCallback(async () => {
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
      const report = await runScriptReportCard({
        script: fullScript,
        knowledgeBase,
        styleProfile,
        targetPages,
      });
      setReportCard(report);
      setRewriteReview(null);
      setScriptDoctorStage("treatment");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Report card failed");
    } finally {
      setLoading(false);
    }
  }, [fullScript, knowledgeBase, styleProfile, targetPages]);

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
  }, [stageRewritePreview, ensureRewriteReady, fullScript, knowledgeBase, reportCard, styleProfile, targetPages, seriesContext]);

  const handleFillGaps = useCallback(async (mode: "missing_beats" | "target_pages") => {
    if (!ensureRewriteReady() || !reportCard) return;
    const label = mode === "target_pages" ? "complete toward target pages" : "fill missing beats";
    const confirmed = window.confirm(`Ask AI to ${label}? This will create a rewrite preview first and will NOT change the editor until you click Apply To Draft.`);
    if (!confirmed) return;

    setLoading(true);
    setError(null);
    setSuggestion(null);
    setScriptDoctorStage("requesting");
    try {
      // If the writer has exactly one framework overlay active, complete toward THAT framework's
      // beat ladder; otherwise consider all frameworks (broad gap fill).
      const targetFrameworkId = activeFrameworks && activeFrameworks.length === 1 ? activeFrameworks[0] : undefined;
      const result = await fillScriptGaps({
        script: fullScript,
        knowledgeBase,
        styleProfile,
        targetPages,
        reportCard,
        mode,
        targetFrameworkId,
        seriesContext,
      }, setShotPassProgress);
      setScriptDoctorStage("validating");
      const focusSuffix = targetFrameworkId ? " (focused on active framework)" : "";
      stageRewritePreview(result, (mode === "target_pages" ? "Target-page completion" : "Missing-beat fill") + focusSuffix, fullScript, reportCard);
    } catch (e) {
      setScriptDoctorStage(reportCard ? "treatment" : "idle");
      setError(e instanceof Error ? e.message : "Fill gaps rewrite failed");
    } finally {
      setLoading(false);
      setShotPassProgress(null);
    }
  }, [stageRewritePreview, ensureRewriteReady, fullScript, knowledgeBase, reportCard, styleProfile, targetPages, activeFrameworks, seriesContext]);

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
  }, [knowledgeBase, rewriteReview, styleProfile, targetPages]);

  const handleApplyRewriteToDraft = useCallback(() => {
    if (!rewriteReview) return;
    if (!rewriteReview.validation.canApply) {
      setError(`Cannot apply yet: ${rewriteReview.validation.issues.join(" ")}`);
      return;
    }
    onAiCommit?.(rewriteReview.label || "Rewrite", rewriteReview.afterScript);
    onReplaceScript(rewriteReview.afterScript);
    setRewriteReview({ ...rewriteReview, applied: true });
    setScriptDoctorStage("applied");
    setSuggestion("Rewrite applied to the main editor. You can Re-score, Revert to the pre-rewrite snapshot, or Accept the rewrite.");
    setLastMode(null);
  }, [onReplaceScript, onAiCommit, rewriteReview]);

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
        <div className="ai-group-label">Re-roll selection</div>
        <div className="full-shot-pass">
          <button
            className="full-shot-pass-btn"
            onClick={handleReRoll}
            disabled={reRolling || !selectedText.trim()}
            title="Regenerate the highlighted passage into a few variants under the same constraints"
          >
            {reRolling ? "Rolling…" : "Re-roll Selection"}
          </button>
          <div className="full-shot-pass-hint">
            Highlight a paragraph, then re-roll it into a few takes (faithful → wild) under the same story, style, and series arcs — pick the one you like.
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
            onClick={handleReportCard}
            disabled={loading || !fullScript.trim()}
            title="Score the whole script against structure frameworks, style match, character consistency, and pacing"
          >
            Run Script Report Card
          </button>
          <div className="full-shot-pass-hint">
            Diagnose, plan a fix, and preview targeted/framework rewrites. Scores Hero's Journey, Save the Cat, Propp, Aristotle, Dan Harmon, style, characters, and pacing.
          </div>
        </div>
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
            <button className="report-card-clear" onClick={() => { setReportCard(null); setReportCollapsed(false); }} title="Dismiss scorecard">✕</button>
          </div>
          {!reportCollapsed && (
            <ReportCard
              report={reportCard}
              onImproveMetric={handleImproveMetric}
              onRewriteMetric={handleRewriteMetric}
              onFillGaps={handleFillGaps}
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
