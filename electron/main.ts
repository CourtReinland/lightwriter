import { app, BrowserWindow, Menu, shell, ipcMain } from "electron";
import * as fs from "node:fs/promises";
import { watch as fsWatch, type FSWatcher } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Vite dev server URL when running `npm run dev`
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

// Path to the bundled renderer (Vite build output)
const DIST = path.join(__dirname, "..", "dist");

// Pin BOTH the dev build (app name "lightwriter-app") and the packaged build
// (productName "LightWriter") to one stable data directory, so the user's
// projects and saved API keys persist across either entry point instead of
// silently splitting into two separate localStorage stores.
app.setPath("userData", path.join(app.getPath("appData"), "lightwriter-app"));

let mainWindow: BrowserWindow | null = null;

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return "png";
}

function mimeTypeForFilePath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

function assetRootDir(): string {
  return path.join(app.getPath("userData"), "assets");
}

// The shared, app-neutral Series Bible root (contract with ScriptToScreen):
// ~/Library/Application Support/SeriesBible — deliberately the appData ROOT,
// not LightWriter's own userData dir, so both apps see the same files.
function bibleRootDir(): string {
  return path.join(app.getPath("appData"), "SeriesBible");
}

function isInsideRoot(resolved: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), resolved);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function assertInsideAssetRoot(filePath: string): string {
  const resolved = path.resolve(filePath);
  // Readable image roots: LightWriter's own asset folder, plus the shared
  // Series Bible (imported records point at bible-owned asset copies).
  if (!isInsideRoot(resolved, assetRootDir()) && !isInsideRoot(resolved, bibleRootDir())) {
    throw new Error("Asset image path is outside LightWriter's asset folder.");
  }
  return resolved;
}

function safePathSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "asset";
}

function registerAssetIpc() {
  ipcMain.handle("lightwriter:save-asset-image", async (_event, request: { projectId?: string; assetId?: string; name?: string; mimeType?: string; dataUrl?: string }) => {
    const dataUrl = request.dataUrl || "";
    const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
    if (!match) throw new Error("Invalid generated image payload.");
    const mimeType = request.mimeType || match[1] || "image/png";
    const projectId = safePathSegment(request.projectId || "project");
    const assetId = request.assetId ? `${safePathSegment(request.assetId)}_` : `${Date.now().toString(36)}_`;
    const fileName = `${assetId}${safePathSegment(request.name || "lightwriter_asset")}.${extensionForMimeType(mimeType)}`;
    const dir = path.join(assetRootDir(), projectId);
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, fileName);
    await fs.writeFile(filePath, Buffer.from(match[2], "base64"));
    return { filePath };
  });

  ipcMain.handle("lightwriter:load-asset-image", async (_event, request: { filePath?: string }) => {
    const filePath = assertInsideAssetRoot(request.filePath || "");
    const bytes = await fs.readFile(filePath);
    const mimeType = mimeTypeForFilePath(filePath);
    return { dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}` };
  });
}

// ---------------------------------------------------------------------------
// Series Bible IPC (shared with ScriptToScreen).
// Layout under bibleRootDir():
//   index.json                    — series index
//   <series_id>/bible.json        — characters/locations for one series
//   <series_id>/assets/<key><ext> — bible-owned copies of reference images
// Writes are ATOMIC (tmp + rename) and optimistic: the renderer passes the
// mtimeMs it last read; if the file changed since, we return conflict=true
// WITHOUT writing so the renderer can re-read, re-merge, and retry.
// ---------------------------------------------------------------------------

function assertSafeSeriesId(seriesId: unknown): string {
  const id = String(seriesId || "");
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error("Invalid series id for the Series Bible.");
  }
  return id;
}

function bibleSeriesDir(seriesId: string): string {
  return path.join(bibleRootDir(), assertSafeSeriesId(seriesId));
}

async function statMtimeMs(filePath: string): Promise<number | null> {
  try {
    return (await fs.stat(filePath)).mtimeMs;
  } catch {
    return null;
  }
}

async function readJsonWithMtime(filePath: string): Promise<{ json: string | null; mtimeMs: number | null }> {
  try {
    const mtimeMs = (await fs.stat(filePath)).mtimeMs;
    const json = await fs.readFile(filePath, "utf8");
    return { json, mtimeMs };
  } catch {
    return { json: null, mtimeMs: null };
  }
}

/**
 * Atomic optimistic write: conflict (no write) when the file's mtime no longer
 * matches what the caller read. expectedMtimeMs === null means "the caller saw
 * no file" — a now-existing file is therefore also a conflict.
 */
async function writeJsonAtomic(filePath: string, json: string, expectedMtimeMs: number | null): Promise<{ ok: boolean; conflict: boolean; mtimeMs: number | null }> {
  const current = await statMtimeMs(filePath);
  if (current !== (expectedMtimeMs ?? null)) {
    return { ok: false, conflict: true, mtimeMs: current };
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  await fs.writeFile(tmp, json, "utf8");
  await fs.rename(tmp, filePath);
  return { ok: true, conflict: false, mtimeMs: await statMtimeMs(filePath) };
}

const bibleWatchers = new Map<string, { watcher: FSWatcher; timer: ReturnType<typeof setTimeout> | null }>();

function closeBibleWatcher(seriesId: string): void {
  const entry = bibleWatchers.get(seriesId);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.watcher.close();
  bibleWatchers.delete(seriesId);
}

function registerBibleIpc() {
  ipcMain.handle("lightwriter:bible-read", async (_event, request: { seriesId?: string }) => {
    return readJsonWithMtime(path.join(bibleSeriesDir(request.seriesId || ""), "bible.json"));
  });

  ipcMain.handle("lightwriter:bible-read-index", async () => {
    return readJsonWithMtime(path.join(bibleRootDir(), "index.json"));
  });

  ipcMain.handle("lightwriter:bible-write", async (_event, request: { seriesId?: string; json?: string; expectedMtimeMs?: number | null }) => {
    const file = path.join(bibleSeriesDir(request.seriesId || ""), "bible.json");
    return writeJsonAtomic(file, request.json || "", request.expectedMtimeMs ?? null);
  });

  ipcMain.handle("lightwriter:bible-write-index", async (_event, request: { json?: string; expectedMtimeMs?: number | null }) => {
    return writeJsonAtomic(path.join(bibleRootDir(), "index.json"), request.json || "", request.expectedMtimeMs ?? null);
  });

  // Copy a reference image INTO the bible so it owns a durable copy —
  // bible records must never point at app-private paths.
  ipcMain.handle("lightwriter:bible-copy-asset", async (_event, request: { seriesId?: string; sourcePath?: string; dataUrl?: string; mimeType?: string; stableKey?: string }) => {
    const assetsDir = path.join(bibleSeriesDir(request.seriesId || ""), "assets");
    await fs.mkdir(assetsDir, { recursive: true });
    const key = safePathSegment(request.stableKey || "asset");
    if (request.sourcePath) {
      // SECURITY: only copy from LightWriter's own asset root or the bible
      // root — otherwise the renderer could launder any readable file into
      // the bible assets dir and read it back via load-asset-image.
      const source = assertInsideAssetRoot(request.sourcePath);
      const ext = path.extname(source).toLowerCase() || ".png";
      const dest = path.join(assetsDir, `${key}${ext}`);
      await fs.copyFile(source, dest);
      return { filePath: dest };
    }
    const dataUrl = request.dataUrl || "";
    const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
    if (!match) throw new Error("Invalid bible asset payload: need a sourcePath or a base64 data url.");
    const mimeType = request.mimeType || match[1] || "image/png";
    const dest = path.join(assetsDir, `${key}.${extensionForMimeType(mimeType)}`);
    await fs.writeFile(dest, Buffer.from(match[2], "base64"));
    return { filePath: dest };
  });

  // Watch one series' bible dir; notify the renderer (debounced 500ms) so it
  // can re-import when ScriptToScreen writes.
  ipcMain.handle("lightwriter:bible-watch", async (event, request: { seriesId?: string }) => {
    const seriesId = assertSafeSeriesId(request.seriesId || "");
    if (bibleWatchers.has(seriesId)) return { ok: true };
    const dir = bibleSeriesDir(seriesId);
    await fs.mkdir(dir, { recursive: true });
    const sender = event.sender;
    const watcher = fsWatch(dir, () => {
      const entry = bibleWatchers.get(seriesId);
      if (!entry) return;
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        if (!sender.isDestroyed()) sender.send("lightwriter:bible-changed", { seriesId });
      }, 500);
    });
    watcher.on("error", () => closeBibleWatcher(seriesId));
    sender.once("destroyed", () => closeBibleWatcher(seriesId));
    bibleWatchers.set(seriesId, { watcher, timer: null });
    return { ok: true };
  });

  ipcMain.handle("lightwriter:bible-unwatch", async (_event, request: { seriesId?: string }) => {
    closeBibleWatcher(assertSafeSeriesId(request.seriesId || ""));
    return { ok: true };
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: "LightWriter",
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0f0f0f",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 16 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  // Load the app
  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(DIST, "index.html"));
  }

  // Open external links in the user's default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const isMac = process.platform === "darwin";

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [isMac ? { role: "close" as const } : { role: "quit" as const }],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [
              { type: "separator" as const },
              { role: "front" as const },
              { type: "separator" as const },
              { role: "window" as const },
            ]
          : [{ role: "close" as const }]),
      ],
    },
    {
      role: "help",
      submenu: [
        {
          label: "LightWriter on GitHub",
          click: () => {
            shell.openExternal("https://github.com/CourtReinland/lightwriter");
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Prevent multiple simultaneous instances from racing on the same localStorage
// (which silently drops the saved API key and shows stale data). A second launch
// just focuses the window that already exists.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerAssetIpc();
    registerBibleIpc();
    buildMenu();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
