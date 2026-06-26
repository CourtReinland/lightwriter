# LightWriter to ScriptToScreen Handoff

This document records the compatibility contract between LightWriter asset exports and ScriptToScreen's Full Wizard / project manifest metadata.

## Purpose

LightWriter is the writing and asset-staging side. ScriptToScreen (STS) is the DaVinci Resolve generation/assembly side. The safest handoff is:

1. Export the screenplay from LightWriter as Fountain (`.fountain`).
2. Export the AI Assets metadata as an STS Manifest (`*.script2screen-manifest.json`).
3. In ScriptToScreen Full Wizard, import the Fountain script in Step 2.
4. If pre-generated LightWriter images are being reused, copy/merge the STS Manifest into the matching STS project directory before using standalone metadata lookup / re-prompt tools.

The STS Manifest is intentionally narrower than the LightWriter Package. It does not export API keys, local text/image provider settings, or LightWriter-only project state.

## Script input contract

ScriptToScreen Full Wizard Step 2 accepts:

- `.fountain` through `script_to_screen.parsing.fountain_parser.parse_fountain()`
- `.pdf` through `script_to_screen.parsing.pdf_parser.parse_pdf()`

LightWriter should export normal Fountain screenplay text. STS shot keys are assigned from parsed scenes and shots as:

```text
s{scene_index}_sh{shot_index}
```

Examples:

```text
s0_sh0
s0_sh1
s1_sh0
```

For best alignment, LightWriter shot assets should carry `metadata.script2ScreenShotKey` when they are tied to an explicit `!!` shot line. Scene-set assets without a shot line fall back to `s{sceneIndex}_sh0`.

## STS manifest shape exported by LightWriter

LightWriter exports this top-level shape for ScriptToScreen:

```json
{
  "version": 1,
  "resolve_project_name": "Demo Project",
  "series_name": "The Maddox Chronicles",   // only when the script is in a World-State Series
  "characters": {},
  "locations": {},
  "world_locations": {},                     // only when the script is in a Series; see "World State" below
  "generated_media": {}
}
```

This matches ScriptToScreen's `script_to_screen/manifest.py` empty manifest
structure, plus the optional `series_name` / `world_locations` keys added by the
World State feature (STS ignores keys it doesn't recognize, so older importers
are unaffected).

### Character entries

LightWriter character image assets export to:

```json
{
  "characters": {
    "ALEX": {
      "reference_image_path": "/absolute/path/to/alex.png",
      "visual_prompt": "Character portrait prompt...",
      "voice_samples": []
    }
  }
}
```

This lines up with STS `update_character()` fields:

- `reference_image_path`
- `visual_prompt`
- `voice_id` / `voice_provider` if STS later adds them
- `voice_samples`

### Generated image entries

ScriptToScreen stores `generated_media` entries keyed by media filename, not by shot key. LightWriter must do the same so STS `lookup_by_filename()` and standalone clip metadata tools can find the entry.

Correct:

```json
{
  "generated_media": {
    "s0_sh0_coffee.png": {
      "type": "image",
      "shot_key": "s0_sh0",
      "prompt": "Cinematic coffee shop background",
      "provider": "gemini",
      "provider_settings": {
        "model": "gemini-2.5-flash-image",
        "aspect_ratio": "16:9",
        "lightwriter_asset_id": "scene-asset",
        "source_provider": "gemini-nano-banana"
      },
      "style_reference_path": "",
      "character_refs": {},
      "file_path": "/absolute/path/to/s0_sh0_coffee.png",
      "generated_at": "2026-05-15T00:00:00.000Z",
      "lightwriter_script_ref": {
        "sceneIndex": 0,
        "sceneHeading": "INT. COFFEE SHOP - DAY"
      }
    }
  }
}
```

Incorrect legacy shape:

```json
{
  "generated_media": {
    "s0_sh0:lightwriter:image:scene-asset": {}
  }
}
```

That legacy key is not a filename, so STS filename lookup cannot find it.

### Scene background (location) entries

Scene backgrounds (AI Assets of kind `scene_set`) export into `locations`, keyed by the
0-based scene index — **not** into `generated_media` as a fake `sN_sh0` shot. ScriptToScreen's
importer (`lightwriter_handoff.py`) reads `locations` into `scene_style_reference_paths`, so a
scene background becomes a reusable per-scene visual treatment instead of being wrongly bound to
shot 0 of the scene.

```json
{
  "locations": {
    "0": {
      "reference_image_paths": ["/absolute/path/to/s0_sh0_coffee.png"],
      "file_path": "/absolute/path/to/s0_sh0_coffee.png",
      "style_reference_path": "",
      "description": "INT. COFFEE SHOP - DAY",
      "lightwriter_asset_id": "scene-asset"
    }
  }
}
```

- The importer matches `0`, `s0`, and `scene_0` key variants, so the plain 0-based index is safest.
- It reads `style_reference_path` first, then `file_path` — both are exported so either resolves.
- Real per-shot images (kind `shot`) still flow into `generated_media` keyed by filename, unchanged.

## World State: portable, series-scoped locations (NEW — 2026-06)

The single most important addition for cross-script continuity. In LightWriter a
script can opt into a named **Series**; the series owns a library of **World
Locations** (the family kitchen, the rooftop, etc.), each with a human name,
alias tokens (`KITCHEN`, `FAMILY KITCHEN`), description, a reference image, and a
**stable `stsLocationKey` that never changes**. Scenes resolve to a location by
an explicit per-scene binding, or by alias match on the heading token. The same
physical place in episode 1 and episode 2 carries the **same `stsLocationKey`**.

Source: `src/services/worldStateService.ts` (`resolveLocationForScene`,
`listSceneHeadings`, `matchForHeading`); emitted by `buildScript2ScreenManifest`.

### What the manifest carries

1. **`series_name`** (top level) — the series this script belongs to.
2. **`world_locations`** — the shared library, keyed by the stable
   `stsLocationKey`. This is the canonical definition of each place:

   ```json
   {
     "world_locations": {
       "stsloc_mqupmxh7_18arq": {
         "name": "Maddox Family Kitchen",
         "category": "interior",
         "aliases": ["KITCHEN", "FAMILY KITCHEN"],
         "description": "Warm sunlit kitchen with wooden cabinets...",
         "reference_image_path": "/abs/path/series/kitchen.png",
         "reference_image_data_url": "data:image/png;base64,..."  // only if no file path
       }
     }
   }
   ```

3. **`locations[sceneIndex]`** gains a foreign key into that library (merged with
   any generated `scene_set` image for the same scene):

   ```json
   {
     "locations": {
       "1": {
         "world_location_key": "stsloc_mqupmxh7_18arq",
         "world_location_name": "Maddox Family Kitchen",
         "lightwriter_world_location_id": "loc_...",
         "description": "Warm sunlit kitchen...",
         "reference_image_paths": ["/abs/path/series/kitchen.png"],
         "file_path": "/abs/path/series/kitchen.png"
       }
     }
   }
   ```

### How ScriptToScreen should consume it

- Build a **Location library** from `world_locations`, keyed by
  `world_location_key`. Import each location's reference image (prefer
  `reference_image_path`; fall back to `reference_image_data_url`) + description.
- For each scene, read `locations[sceneIndex].world_location_key`. Scenes sharing
  a key — **in the same script or across scripts of the same series** — are the
  **same place**: render/generate the environment once and reuse it. Persist
  STS's location→asset mapping against `world_location_key`, **not** against the
  scene index (which is positional and can shift) or heading text.
- If a scene has no `world_location_key`, fall back to its own
  `locations[...]` image, then to generating from `description`.

### Round-trip test for the agent

Export two scripts in the same series that both contain `INT. KITCHEN` (linked to
the same World Location). Confirm both manifests carry the **same**
`world_location_key` and an identical `world_locations[key]` entry → one shared
environment across episodes.

### Image durability

World-location reference images are persisted to disk on save in the desktop app
(`persistGeneratedImageFile`) and exported as `reference_image_path`. If a
location has no saved file path yet, the exporter embeds
`reference_image_data_url` and adds a `_lightwriter_warnings` note. Accept either.

### Browser-mode export limit (no silent drops)

An asset only exports if it has a durable `filePath`. In the desktop (Electron) app, generated
images are persisted to `~/Library/Application Support/.../assets` via IPC and get a real path.
In the browser build there is no durable path (only an in-memory data URL), so such assets cannot
be referenced by ScriptToScreen. Rather than dropping them silently, the exporter collects a
non-canonical `_lightwriter_warnings` array (ScriptToScreen ignores unknown keys) and the AI Assets
panel reports how many assets were skipped. To include scene/character images in a handoff, generate
or persist them in the desktop app before exporting.

## Provider ID mapping

LightWriter UI names are product-facing. STS provider IDs are pipeline-facing. Export maps them as:

| LightWriter provider | STS provider |
| --- | --- |
| `gemini-nano-banana` | `gemini` |
| `grok-imagine` | `grok` |

The original LightWriter provider is preserved in `provider_settings.source_provider` for provenance.

## Mini tutorial: handing LightWriter work to ScriptToScreen

Use this checklist when handing off a script, scene images, and character references.

1. Prepare the draft in LightWriter.
   - Write or import the screenplay in LightWriter.
   - Use LightWriter's AI asset tools to generate scene/shot prompts, scene images, and character reference images.
   - Preserve explicit shot lines when possible. LightWriter can mark shots with forced Fountain shot lines such as:

     ```text
     !! WS - The heroine stands in a neon-lit street.
     !! CU - Her eyes narrow as she recognizes someone.
     ```

2. Export the handoff materials from LightWriter.
   - Export the screenplay as `.fountain`.
   - Export the ScriptToScreen-compatible manifest (`*.script2screen-manifest.json`).
   - Keep the exported images and character references in the same bundle/folder as the manifest.

3. Keep the bundle structure stable.
   - A simple handoff folder can look like this:

     ```text
     MyFilm_Handoff/
       script.fountain
       manifest.script2screen-manifest.json
       assets/
         s1_sh1_alley.png
         s1_sh2_maya_closeup.png
         characters/
           maya_ref.png
           elena_ref.png
         style/
           noir_reference.png
     ```

   - Do not rename image files after export. ScriptToScreen looks up generated media by filename.
   - Prefer filenames that include the shot key, such as `s1_sh1_alley.png`.

4. Import the script in ScriptToScreen Full Wizard.
   - Open ScriptToScreen in DaVinci Resolve.
   - Launch Full Wizard Mode.
   - In the script input step, select the LightWriter `.fountain` file.
   - STS will parse LightWriter shot lines like `!! WS`, `!! MS`, and `!! CU` as shots.

5. Reuse LightWriter-generated images and character references.
   - Copy or merge the LightWriter STS manifest into the matching STS project directory when you want STS metadata tools to see the pre-generated assets.
   - Keep asset paths valid. If the manifest says `assets/characters/maya_ref.png`, that file must still exist at that path relative to the handoff/project location, or be converted to an absolute path that exists on disk.
   - Character references should appear in manifest `characters` entries and/or image `character_refs` fields.

6. Confirm the match before continuing generation.
   - Script shots should have keys like `s1_sh1`, `s1_sh2`, etc.
   - Manifest image entries should include the matching `shot_key`.
   - Manifest `generated_media` must be keyed by filename, not by a synthetic LightWriter asset ID.

7. If import or lookup fails, check these first.
   - Was an image renamed after export?
   - Does the manifest point to files that still exist?
   - Did the script get edited after export, changing shot order?
   - Does each generated image entry have a `shot_key`?
   - Are character reference paths still valid?

## What lines up today

Verified by code inspection and tests:

- LightWriter `.fountain` output is the right script input format for STS Step 2.
- LightWriter scene/shot indexing matches STS `s{scene}_sh{shot}` convention when `metadata.script2ScreenShotKey` is present or the asset is scene-indexed.
- LightWriter character assets export fields that STS manifest accepts.
- LightWriter generated image entries now use filename keys, which is how STS writes and looks up generated media.
- LightWriter STS manifest includes STS image metadata fields: `type`, `shot_key`, `prompt`, `provider`, `provider_settings`, `style_reference_path`, `character_refs`, `file_path`, and `generated_at`.
- Scene backgrounds (`scene_set`) export into `locations` keyed by 0-based scene index and import into STS `scene_style_reference_paths` (round-trip test on both sides).
- The shot pass constrains the first token after `!!` to a parser-recognized type (WS/MS/CU/ECU/LS/OTS/POV) so generated shot lines always parse as STS shots.

## Recent changes (2026-06) — LightWriter <-> ScriptToScreen hardening pass

Branch `experimental/s2s-handoff-hardening`. Mapped to the integration asks:

- **Scene backgrounds round-trip (ask #5):** `buildScript2ScreenManifest` routes `scene_set`
  assets to `locations[sceneIndex]` instead of `generated_media[sN_sh0]`. Keyed on `asset.kind`,
  so already-staged assets with a legacy `s0_sh0` key are corrected on export.
- **No silent drops (ask #5):** assets without a durable `filePath` are reported via
  `_lightwriter_warnings` + an AI-Assets-panel skip count.
- **Framework-targeted rewrites (ask #2):** `scriptReportCardService` injects a single chosen
  framework's beat ladder ("land each beat in its page range") into `buildMetricRewritePrompt`
  (per-framework "Rewrite Metric") and `buildFillGapsRewritePrompt` (via `targetFrameworkId`,
  defaulted from the sole active overlay framework).
- **Render-ready descriptions (ask #3):** `scriptStructure` augments real scene descriptions with
  tone-derived visual tokens + composition/depth cues (prompt layer only; Fountain text untouched).
  `shotDirectionService` hard-constrains the shot-type vocabulary.
- **Concurrent testing (ask #4):** `script2screen/tests/__init__.py` + `scripts/test-both.sh`.

### World State — portable series locations (2026-06, on `main`)

- New: scripts opt into a named **Series** (`Project.seriesId`) that owns a
  library of **World Locations** with stable `stsLocationKey`s. See the
  "World State" section above for the full contract.
- `buildScript2ScreenManifest` now resolves every scene heading to its world
  location and emits `series_name`, a top-level `world_locations{}` library, and
  per-scene `world_location_key` / `world_location_name`.
- **Breaking signature change:** `buildScript2ScreenManifest` now takes
  `{ project: Project; assets }` (was `{ resolveProjectName: string; assets }`).
  `resolve_project_name` is derived from `project.name`. Any other caller must
  pass the project (it's needed for `seriesId` + `content` to walk scenes).
- Tests: `tests/assetManifestExporter.test.ts` covers alias-match resolution and
  per-scene binding override (with a localStorage mock).

### Known follow-ups (not yet done)

- **G5 (low priority):** `llmAssetPromptService` Pass-2 strips character names from `shot`-kind
  image prompts; blocking phrases like "OVER MARA'S SHOULDER ON AIDEN" can lose their subject.
  This affects only LightWriter's *own* shot-image prompt, NOT the Fountain shot text STS parses
  for character attachment, so it does not affect the handoff contract. Fix later by scoping the
  name-stripping to prose references and preserving names inside camera/blocking phrases.

## Known limits

- The ScriptToScreen Full Wizard currently imports screenplay files, not a LightWriter package. The manifest handoff is for project metadata / generated-media reuse, not a first-class wizard import button.
- LightWriter style references are often stored as app-local data URLs or generated asset files. STS expects a filesystem path for `style_reference_path`. Only export a non-empty `style_reference_path` when LightWriter has an actual durable file path.
- Scene-set background assets usually have no character refs. Character reference images are exported separately under `characters`; STS's image-generation pass attaches character refs based on parsed characters and user/manifest assignment.
- API keys are never exported.

## Regression checks

From the LightWriter repo:

```bash
npm test -- tests/assetManifestExporter.test.ts
```

From the ScriptToScreen repo, a safe parser/manifest probe can be run with a temporary HOME so no real STS project data is touched:

```bash
HOME=$(mktemp -d) python3 - <<'PY'
import json, os, tempfile
from pathlib import Path

from script_to_screen.parsing.fountain_parser import parse_fountain
from script_to_screen.manifest import get_project_dir, load_manifest, lookup_by_filename, lookup_by_shot_key

root = Path(tempfile.mkdtemp())
fountain = root / "demo.fountain"
fountain.write_text("""Title: LW STS Demo

INT. COFFEE SHOP - DAY

!! WS - A cozy coffee shop before opening.

ALEX
Ready for the first test?
""", encoding="utf-8")

screenplay = parse_fountain(str(fountain))
assert len(screenplay.scenes) == 1
assert screenplay.scenes[0].shots[0].description.startswith("A cozy coffee shop")
assert "ALEX" in screenplay.characters

project_slug = "lw_sts_demo"
project_dir = get_project_dir(project_slug)
manifest = load_manifest(project_slug)
manifest["resolve_project_name"] = "LW STS Demo"
manifest["characters"]["ALEX"] = {
    "reference_image_path": str(root / "alex.png"),
    "visual_prompt": "Character portrait for ALEX",
    "voice_samples": [],
}
manifest["generated_media"]["s0_sh0_demo.png"] = {
    "type": "image",
    "shot_key": "s0_sh0",
    "prompt": "Empty coffee shop background",
    "provider": "gemini",
    "provider_settings": {"model": "gemini-2.5-flash-image", "aspect_ratio": "16:9"},
    "style_reference_path": "",
    "character_refs": {},
    "file_path": str(root / "s0_sh0_demo.png"),
    "generated_at": "2026-05-15T00:00:00+00:00",
}
(project_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

assert lookup_by_filename(project_slug, "s0_sh0_demo.png")["shot_key"] == "s0_sh0"
assert lookup_by_shot_key(project_slug, "s0_sh0")["file_path"].endswith("s0_sh0_demo.png")
print("LightWriter -> ScriptToScreen handoff probe passed")
PY
```
