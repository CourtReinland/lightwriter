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

  return importFountain(await file.text());
}
