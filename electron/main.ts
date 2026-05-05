import { app, BrowserWindow, Menu, shell, ipcMain } from "electron";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Vite dev server URL when running `npm run dev`
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

// Path to the bundled renderer (Vite build output)
const DIST = path.join(__dirname, "..", "dist");

let mainWindow: BrowserWindow | null = null;

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return "png";
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
    const dir = path.join(app.getPath("userData"), "assets", projectId);
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, fileName);
    await fs.writeFile(filePath, Buffer.from(match[2], "base64"));
    return { filePath };
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

app.whenReady().then(() => {
  registerAssetIpc();
  buildMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
