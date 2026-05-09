import { describe, expect, it } from "vitest";
import { resolvePdfWorkerSrc } from "../src/services/fileImporter";

describe("fileImporter PDF worker resolution", () => {
  it("resolves the PDF.js worker relative to the packaged Electron index file", () => {
    const workerSrc = resolvePdfWorkerSrc("file:///Applications/LightWriter.app/Contents/Resources/app.asar/dist/index.html");

    expect(workerSrc).toBe("file:///Applications/LightWriter.app/Contents/Resources/app.asar/dist/pdf.worker.min.mjs");
    expect(workerSrc).not.toBe("file:///pdf.worker.min.mjs");
  });

  it("resolves the PDF.js worker relative to the Vite dev server root", () => {
    expect(resolvePdfWorkerSrc("http://localhost:5173/")).toBe("http://localhost:5173/pdf.worker.min.mjs");
  });
});
