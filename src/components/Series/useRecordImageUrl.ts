import { useEffect, useState } from "react";
import { loadPersistedImageDataUrl } from "../../services/imageAssetStorageService";

// Resolve a world record's reference image to a renderable data url. Prefers the
// inline data url (browser fallback); otherwise hydrates it once from the
// on-disk referenceFilePath (Electron). Mirrors the load pattern used in
// KBPanel / AssetPanel for GeneratedAsset previews, scoped to a single record.
export default function useRecordImageUrl(
  record: { referenceImageDataUrl?: string; referenceFilePath?: string } | null | undefined,
): string | undefined {
  const inline = record?.referenceImageDataUrl;
  const filePath = record?.referenceFilePath;
  const [loaded, setLoaded] = useState<string | undefined>(undefined);

  useEffect(() => {
    // Inline blob present (browser) — use it directly, no disk load needed.
    if (inline || !filePath) {
      setLoaded(undefined);
      return;
    }
    let cancelled = false;
    loadPersistedImageDataUrl(filePath)
      .then((dataUrl) => {
        if (!cancelled && dataUrl) setLoaded(dataUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [inline, filePath]);

  return inline || loaded;
}
