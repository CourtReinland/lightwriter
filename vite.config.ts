import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";

// LW_WEB_ONLY=1 runs Vite as a plain browser dev server (no Electron launch),
// which lets the renderer be previewed in a browser. Production builds always
// include the Electron plugin.
const webOnly = process.env.LW_WEB_ONLY === "1";

export default defineConfig({
  // Use relative paths so the built index.html works under file:// in Electron
  base: "./",
  plugins: [
    react(),
    ...(webOnly
      ? []
      : [
          electron({
            main: {
              entry: "electron/main.ts",
              vite: {
                build: {
                  outDir: "dist-electron",
                  rollupOptions: {
                    external: ["electron"],
                  },
                },
              },
            },
            preload: {
              input: "electron/preload.ts",
              vite: {
                build: {
                  outDir: "dist-electron",
                  rollupOptions: {
                    external: ["electron"],
                  },
                },
              },
            },
          }),
        ]),
  ],
});
