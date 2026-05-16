import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { importExcel, resolvePdfWorkerSrc } from "../src/services/fileImporter";

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

describe("fileImporter Excel import", () => {
  it("extracts workbook rows as tab-delimited context text", async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Thread", "Status", "Description"],
      ["Missing locket", "Foreshadowed", "Pendant appears before reveal"],
      ["Sister betrayal", "Resolved", "Aliyah discovers the lie"],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Plot Threads");
    const data = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const text = await importExcel(data);

    expect(text).toContain("# Sheet: Plot Threads");
    expect(text).toContain("Thread	Status	Description");
    expect(text).toContain("Missing locket	Foreshadowed	Pendant appears before reveal");
  });
});
