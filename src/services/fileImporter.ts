/**
 * File import services for .fountain, .fdx (Final Draft), and .celtx formats.
 * All converters return plain Fountain text.
 */

// ─── .fountain import ───────────────────────────────────────────────
export function importFountain(text: string): string {
  return text;
}

// ─── .fdx (Final Draft XML) import ──────────────────────────────────
// Modeled after Beat's FDXImport.m — handles all paragraph types.

export function importFdx(xmlString: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "text/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("Invalid FDX file: XML parse error");
  }

  const lines: string[] = [];

  // 1. Extract title page from TitlePage section or top-level metadata
  const titlePageContent = extractFdxTitlePage(doc);
  if (titlePageContent) {
    lines.push(titlePageContent);
    lines.push("");
    lines.push("====");
    lines.push("");
  }

  // 2. Extract screenplay content
  // FDX has <Content><Paragraph>... — get all paragraphs under Content
  const content = doc.querySelector("Content");
  if (!content) {
    throw new Error("No Content section found in FDX file");
  }

  const paragraphs = content.querySelectorAll("Paragraph");
  let lastType = "";
  let inDialogueBlock = false;

  for (const para of paragraphs) {
    const type = para.getAttribute("Type") || "Action";
    const sceneNum = para.getAttribute("Number") || "";

    // Extract text from all <Text> children, preserving inline styles
    const textContent = extractFdxText(para);
    if (!textContent.trim() && type !== "Action") continue;

    // Determine if we need a blank line separator
    const needsBlankBefore = shouldAddBlankLine(lastType, type, inDialogueBlock);
    if (needsBlankBefore && lines.length > 0) {
      lines.push("");
    }

    // Track dialogue blocks
    if (type === "Character") {
      inDialogueBlock = true;
    } else if (
      type !== "Dialogue" &&
      type !== "Parenthetical"
    ) {
      inDialogueBlock = false;
    }

    // Convert FDX paragraph type to Fountain
    const fountainLine = convertFdxParagraph(type, textContent.trim(), sceneNum);
    if (fountainLine !== null) {
      lines.push(fountainLine);
    }

    lastType = type;
  }

  return lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trim() + "\n";
}

function extractFdxText(para: Element): string {
  const textNodes = para.querySelectorAll("Text");
  let result = "";

  for (const textNode of textNodes) {
    const style = textNode.getAttribute("Style") || "";
    let content = textNode.textContent || "";

    // Handle AllCaps style — we don't need to force uppercase in Fountain
    // since character names/scene headings are already uppercase by convention

    // Handle inline formatting
    if (style.includes("Bold") && style.includes("Italic")) {
      content = `***${content}***`;
    } else if (style.includes("Bold")) {
      content = `**${content}**`;
    } else if (style.includes("Italic")) {
      content = `*${content}*`;
    } else if (style.includes("Underline")) {
      content = `_${content}_`;
    }

    result += content;
  }

  return result;
}

function shouldAddBlankLine(
  lastType: string,
  currentType: string,
  inDialogueBlock: boolean,
): boolean {
  if (!lastType) return false;

  // Inside dialogue blocks: Character → Dialogue, Dialogue → Parenthetical, etc.
  // NO blank line between these
  if (
    (lastType === "Character" && (currentType === "Dialogue" || currentType === "Parenthetical")) ||
    (lastType === "Parenthetical" && currentType === "Dialogue") ||
    (lastType === "Dialogue" && currentType === "Parenthetical")
  ) {
    return false;
  }

  // Everything else gets a blank line
  return true;
}

function convertFdxParagraph(
  type: string,
  text: string,
  sceneNum: string,
): string | null {
  switch (type) {
    case "Scene Heading": {
      // Ensure it starts with INT/EXT/etc, force with . prefix if not
      const heading = text.toUpperCase();
      if (/^(INT|EXT|EST|INT\.\/EXT|I\/E)[\s.]/.test(heading)) {
        return sceneNum ? `${heading} #${sceneNum}#` : heading;
      }
      return sceneNum ? `.${heading} #${sceneNum}#` : `.${heading}`;
    }

    case "Character": {
      // Character names are uppercase in Fountain
      return text.toUpperCase();
    }

    case "Dialogue": {
      return text;
    }

    case "Parenthetical": {
      // Ensure parentheses
      const p = text.trim();
      if (!p.startsWith("(")) return `(${p})`;
      return p;
    }

    case "Action": {
      return text;
    }

    case "Transition": {
      // Fountain transitions use > prefix
      return `> ${text.toUpperCase()}`;
    }

    case "Shot": {
      // Shots are uppercase action lines (camera directions)
      return text.toUpperCase();
    }

    case "Lyrics": {
      // Fountain lyrics use ~ prefix
      return `~${text}`;
    }

    case "General": {
      // General/centered text
      return `>${text}<`;
    }

    case "New Act":
    case "End of Act": {
      // Section heading
      return `# ${text.toUpperCase()}`;
    }

    case "Outline": {
      // Section headings with depth
      return `## ${text}`;
    }

    case "Cast List": {
      return `>${text}<`;
    }

    // Title page elements — handled separately
    case "Title Page":
    case "Script":
    case "Page #":
    case "Last Revised":
    case "Right":
    case "Image": {
      // Skip — these are metadata/header elements
      return null;
    }

    default: {
      // Unknown type — treat as action
      if (text.trim()) return text;
      return null;
    }
  }
}

function extractFdxTitlePage(doc: Document): string {
  const parts: string[] = [];

  // Look for TitlePage section
  const titlePage = doc.querySelector("TitlePage");
  if (!titlePage) return "";

  const content = titlePage.querySelector("Content");
  if (!content) return "";

  const paragraphs = content.querySelectorAll("Paragraph");

  for (const para of paragraphs) {
    const type = (para.getAttribute("Type") || "").toLowerCase();
    const text = Array.from(para.querySelectorAll("Text"))
      .map((t) => t.textContent || "")
      .join("")
      .trim();

    if (!text) continue;

    if (type.includes("title") && !type.includes("page")) {
      parts.push(`Title: ${text}`);
    } else if (type === "author" || type === "authors") {
      parts.push(`Author: ${text}`);
    } else if (type === "credit" || text.toLowerCase().includes("written by")) {
      parts.push(`Credit: ${text}`);
    } else if (type.includes("source")) {
      parts.push(`Source: ${text}`);
    } else if (type.includes("draft") || type.includes("date") || type === "last revised") {
      parts.push(`Draft date: ${text}`);
    } else if (type.includes("contact") || type.includes("address")) {
      parts.push(`Contact: ${text}`);
    } else if (type.includes("copyright")) {
      parts.push(`Copyright: ${text}`);
    } else if (type.includes("notes") || type.includes("note")) {
      parts.push(`Notes: ${text}`);
    } else if (type.includes("revision")) {
      parts.push(`Revision: ${text}`);
    } else if (text.trim()) {
      // Continuation or unknown field — append to notes
      parts.push(`   ${text}`);
    }
  }

  return parts.join("\n");
}

// ─── .celtx import ──────────────────────────────────────────────────

const CELTX_CLASS_MAP: Record<string, (text: string) => string> = {
  sceneheading: (t) => `\n${t.toUpperCase()}\n`,
  action: (t) => `\n${t}\n`,
  character: (t) => `\n${t.toUpperCase()}`,
  dialog: (t) => `${t}`,
  dialogue: (t) => `${t}`,
  parenthetical: (t) => `(${t.replace(/^\(|\)$/g, "")})`,
  transition: (t) => `\n> ${t}\n`,
  shot: (t) => `\n${t}\n`,
};

export async function importCeltx(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    return await parseCeltxZip(arrayBuffer);
  } catch (e) {
    throw new Error(
      `Failed to parse Celtx file: ${e instanceof Error ? e.message : "Unknown error"}. ` +
        "The file may be corrupted or in an unsupported Celtx format.",
    );
  }
}

async function parseCeltxZip(buffer: ArrayBuffer): Promise<string> {
  const view = new DataView(buffer);
  const files = extractZipEntries(view, buffer);

  const scriptEntry = files.find(
    (f) => f.name.startsWith("script-") && f.name.endsWith(".html"),
  );

  if (!scriptEntry) {
    const anyHtml = files.find((f) => f.name.endsWith(".html"));
    if (!anyHtml) {
      throw new Error("No screenplay content found in Celtx file");
    }
    return parseCeltxHtml(anyHtml.content);
  }

  return parseCeltxHtml(scriptEntry.content);
}

interface ZipEntry {
  name: string;
  content: string;
}

function extractZipEntries(view: DataView, buffer: ArrayBuffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;
  const decoder = new TextDecoder("utf-8");

  while (offset < view.byteLength - 4) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break;

    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);

    const nameBytes = new Uint8Array(buffer, offset + 30, nameLength);
    const name = decoder.decode(nameBytes);

    const dataStart = offset + 30 + nameLength + extraLength;

    if (compressionMethod === 0) {
      const content = decoder.decode(
        new Uint8Array(buffer, dataStart, uncompressedSize),
      );
      entries.push({ name, content });
    } else if (compressionMethod === 8) {
      entries.push({ name, content: `[compressed:${compressedSize}]` });
    }

    offset = dataStart + compressedSize;
  }

  return entries;
}

function parseCeltxHtml(html: string): string {
  if (html.startsWith("[compressed:")) {
    throw new Error(
      "Celtx file uses compression. Please export as .fountain or .fdx first.",
    );
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const lines: string[] = [];

  const title = doc.querySelector("title");
  if (title?.textContent) {
    lines.push(`Title: ${title.textContent}`);
    lines.push("");
    lines.push("====");
    lines.push("");
  }

  const elements = doc.body?.querySelectorAll("p, div, span") || [];

  for (const el of elements) {
    const className = (el.className || "").toLowerCase().trim();
    const text = (el.textContent || "").trim();
    if (!text) continue;

    let matched = false;
    for (const [cls, formatter] of Object.entries(CELTX_CLASS_MAP)) {
      if (className.includes(cls)) {
        lines.push(formatter(text));
        matched = true;
        break;
      }
    }

    if (!matched && text) {
      lines.push(`\n${text}\n`);
    }
  }

  return lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trim() + "\n";
}

// ─── .pdf import ─────────────────────────────────────────────────────
// Uses pdf.js (pdfjs-dist) for client-side PDF text extraction.
// Extracts text page-by-page, attempts to reconstruct screenplay structure
// by analyzing vertical positioning of text items.

export async function importPdf(arrayBuffer: ArrayBuffer): Promise<string> {
  // Dynamic import to avoid loading pdf.js unless needed
  const pdfjsLib = await import("pdfjs-dist");

  // Set up the worker — use the bundled worker from pdfjs-dist
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const allLines: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1.0 });
    const pageWidth = viewport.width;

    // Group text items into lines by Y position (items on similar Y = same line)
    const lineMap = new Map<number, { x: number; text: string }[]>();

    for (const item of textContent.items) {
      if (!("str" in item) || !item.str.trim()) continue;

      const typedItem = item as { str: string; transform: number[] };
      const x = typedItem.transform[4]; // X position
      const y = Math.round(typedItem.transform[5]); // Y position (round to group)

      // Group by Y within a 2-unit tolerance
      let bestY = y;
      for (const existingY of lineMap.keys()) {
        if (Math.abs(existingY - y) <= 2) {
          bestY = existingY;
          break;
        }
      }

      if (!lineMap.has(bestY)) lineMap.set(bestY, []);
      lineMap.get(bestY)!.push({ x, text: typedItem.str });
    }

    // Sort lines by Y position (descending — PDF coordinates are bottom-up)
    const sortedLines = Array.from(lineMap.entries())
      .sort((a, b) => b[0] - a[0]);

    for (const [, items] of sortedLines) {
      // Sort items left-to-right within the line
      items.sort((a, b) => a.x - b.x);
      const lineText = items.map((i) => i.text).join("");
      if (!lineText.trim()) continue;

      // Analyze indentation to classify screenplay elements
      const firstX = items[0].x;
      const trimmed = lineText.trim();

      // Heuristic classification based on horizontal position:
      //   - Left margin (x < 110): Scene heading or action
      //   - Character indent (x ~170-250): Character name
      //   - Dialogue indent (x ~120-160): Dialogue
      //   - Parenthetical indent (x ~140-180 + starts with "(")
      //   - Right-aligned (x > 350): Transition
      // These thresholds assume a standard US Letter page (612pt wide)
      const relativeX = firstX / pageWidth;

      if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
        // Parenthetical
        allLines.push(trimmed);
      } else if (relativeX > 0.55) {
        // Right-aligned → Transition
        allLines.push(`> ${trimmed}`);
      } else if (relativeX > 0.32 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed) && trimmed.length < 40) {
        // Centered + ALL CAPS + short → Character name
        // Add blank line before character (Fountain convention)
        if (allLines.length > 0 && allLines[allLines.length - 1].trim() !== "") {
          allLines.push("");
        }
        allLines.push(trimmed);
      } else if (relativeX > 0.18 && relativeX <= 0.32) {
        // Dialogue indent range
        allLines.push(trimmed);
      } else {
        // Left margin — could be scene heading or action
        if (/^(INT|EXT|EST|INT\.?\/?EXT|I\/E)[\s.]/i.test(trimmed)) {
          // Scene heading — ensure blank line before
          if (allLines.length > 0 && allLines[allLines.length - 1].trim() !== "") {
            allLines.push("");
          }
          allLines.push(trimmed.toUpperCase());
        } else if (/^[A-Z\s]+TO:$/.test(trimmed)) {
          // Transition ending in TO:
          allLines.push(`> ${trimmed}`);
        } else {
          // Action
          if (allLines.length > 0) {
            const prevLine = allLines[allLines.length - 1].trim();
            // Add blank line before action after dialogue
            if (prevLine && !prevLine.startsWith("(") && !prevLine.startsWith(">") && !prevLine.startsWith(".") && !/^(INT|EXT)/.test(prevLine)) {
              // Check if previous was dialogue (not uppercase) and this is action
              // Simple heuristic: if this line is at left margin and previous wasn't a blank
            }
          }
          allLines.push(trimmed);
        }
      }
    }

    // Page break between pages (except after last)
    if (pageNum < pdf.numPages) {
      allLines.push("");
    }
  }

  // Clean up: normalize excessive blank lines
  return allLines.join("\n").replace(/\n{4,}/g, "\n\n\n").trim() + "\n";
}

/**
 * Detect file type and import accordingly.
 */
export async function importFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".fountain") || name.endsWith(".txt")) {
    return importFountain(await file.text());
  }

  if (name.endsWith(".fdx")) {
    return importFdx(await file.text());
  }

  if (name.endsWith(".celtx")) {
    return importCeltx(await file.arrayBuffer());
  }

  if (name.endsWith(".pdf")) {
    return importPdf(await file.arrayBuffer());
  }

  return importFountain(await file.text());
}
