import { useState } from "react";
import type { Project } from "../../services/storageService";
import type { GeneratedAsset } from "../../types/assets";
import {
  buildLightWriterPackage,
  buildScript2ScreenManifest,
  countUnexportableAssets,
  exportJsonDownload,
} from "../../services/assetManifestExporter";
import { downloadImageDataUrl, loadPersistedImageDataUrl } from "../../services/imageAssetStorageService";
import "./ExportPanel.css";

interface ExportPanelProps {
  project: Project;
  assets: GeneratedAsset[];
  onExportFountain: () => void;
  onExportFdx: () => void;
  onExportPdf: () => void;
  canExportPdf: boolean;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_") || "screenplay";
}

function downloadText(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export default function ExportPanel({
  project,
  assets,
  onExportFountain,
  onExportFdx,
  onExportPdf,
  canExportPdf,
}: ExportPanelProps) {
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const sceneImages = assets.filter((a) => a.kind === "scene_set");
  const characterImages = assets.filter((a) => a.kind === "character");
  const shotImages = assets.filter((a) => a.kind === "shot");
  const unexportable = countUnexportableAssets(assets);

  const downloadAllOfKind = async (subset: GeneratedAsset[], label: string) => {
    if (subset.length === 0) {
      setStatus(`No ${label} images to export yet — generate them in the AI tab.`);
      return;
    }
    setBusy(true);
    setStatus(`Exporting ${label} images...`);
    let done = 0;
    let missing = 0;
    for (const asset of subset) {
      let dataUrl = asset.imageDataUrl;
      if (!dataUrl) dataUrl = await loadPersistedImageDataUrl(asset.filePath);
      if (!dataUrl) {
        missing += 1;
        continue;
      }
      downloadImageDataUrl({ name: asset.name, mimeType: asset.mimeType, dataUrl });
      done += 1;
      // Small gap so the browser/Electron doesn't drop rapid-fire downloads.
      await new Promise((r) => setTimeout(r, 150));
    }
    setBusy(false);
    setStatus(
      `Downloaded ${done} of ${subset.length} ${label} image${subset.length === 1 ? "" : "s"}.` +
        (missing > 0 ? ` ${missing} had no image data.` : ""),
    );
  };

  const handleExportTxt = () => {
    downloadText(project.content, `${safeName(project.name)}.txt`, "text/plain");
    setStatus("Exported plain-text screenplay.");
  };

  const handleExportManifest = () => {
    const manifest = buildScript2ScreenManifest({ project, assets });
    exportJsonDownload(manifest, `${safeName(project.name)}.script2screen-manifest.json`);
    const sceneCount = Object.keys(manifest.locations).length;
    const charCount = Object.keys(manifest.characters).length;
    const shotCount = Object.keys(manifest.generated_media).length;
    const worldCount = manifest.world_locations ? Object.keys(manifest.world_locations).length : 0;
    const skipped = manifest._lightwriter_warnings?.length ?? 0;
    let msg = `Exported ScriptToScreen manifest: ${sceneCount} scene location${sceneCount === 1 ? "" : "s"}, ${charCount} character${charCount === 1 ? "" : "s"}, ${shotCount} shot${shotCount === 1 ? "" : "s"}.`;
    if (worldCount > 0) msg += ` ${worldCount} world location${worldCount === 1 ? "" : "s"} from the series.`;
    if (skipped > 0) msg += ` ${skipped} note${skipped === 1 ? "" : "s"} (see manifest warnings).`;
    setStatus(msg);
  };

  const handleExportPackage = () => {
    const pkg = buildLightWriterPackage({ project, assets });
    exportJsonDownload(pkg, `${safeName(project.name)}.lightwriter-package.json`);
    setStatus(`Exported LightWriter package (${pkg.shots.length} shots, ${Object.keys(pkg.characters).length} characters).`);
  };

  return (
    <aside className="export-panel">
      <div className="export-panel-header">
        <h2>Export</h2>
        <p>Send your script, images, and ScriptToScreen handoff out of LightWriter.</p>
      </div>

      {/* Script */}
      <section className="export-section">
        <h3>Script</h3>
        <p className="export-muted">The current draft — {project.targetPages ? `target ${project.targetPages}pp` : "screenplay"}.</p>
        <div className="export-btn-grid">
          <button onClick={onExportFountain}>.fountain</button>
          <button onClick={onExportFdx}>.fdx (Final Draft)</button>
          <button onClick={handleExportTxt}>.txt (plain)</button>
          <button onClick={onExportPdf} disabled={!canExportPdf} title={canExportPdf ? "" : "Open the script in the editor first"}>
            .pdf (print)
          </button>
        </div>
      </section>

      {/* Images */}
      <section className="export-section">
        <h3>Images</h3>
        <p className="export-muted">Generated in the AI tab. Each downloads as a separate image file.</p>
        <div className="export-row">
          <button
            className="export-row-btn"
            onClick={() => downloadAllOfKind(sceneImages, "scene background")}
            disabled={busy || sceneImages.length === 0}
          >
            Scene backgrounds
          </button>
          <span className="export-count">{sceneImages.length}</span>
        </div>
        <div className="export-row">
          <button
            className="export-row-btn"
            onClick={() => downloadAllOfKind(characterImages, "character portrait")}
            disabled={busy || characterImages.length === 0}
          >
            Character portraits
          </button>
          <span className="export-count">{characterImages.length}</span>
        </div>
        {shotImages.length > 0 && (
          <div className="export-row">
            <button
              className="export-row-btn"
              onClick={() => downloadAllOfKind(shotImages, "shot frame")}
              disabled={busy}
            >
              Shot start frames
            </button>
            <span className="export-count">{shotImages.length}</span>
          </div>
        )}
        {sceneImages.length === 0 && characterImages.length === 0 && (
          <p className="export-muted">No images yet — generate scenes &amp; characters in the AI tab.</p>
        )}
      </section>

      {/* ScriptToScreen handoff */}
      <section className="export-section">
        <h3>ScriptToScreen</h3>
        <p className="export-muted">Hand the project off to the ScriptToScreen pipeline.</p>
        <div className="export-btn-grid">
          <button className="export-primary" onClick={handleExportManifest}>STS manifest .json</button>
          <button onClick={handleExportPackage}>LW package .json</button>
        </div>
        {unexportable > 0 && (
          <p className="export-warn">
            {unexportable} image{unexportable === 1 ? "" : "s"} have no saved file path and will be skipped in the manifest. Generate/persist them in the desktop app to include them.
          </p>
        )}
      </section>

      {status && <p className="export-status">{status}</p>}
    </aside>
  );
}
