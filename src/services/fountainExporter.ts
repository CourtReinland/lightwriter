/**
 * Export services for .fountain and .fdx formats.
 */

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── .fountain export ───────────────────────────────────────────────

export function exportFountain(content: string, filename = "screenplay.fountain") {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  downloadBlob(blob, filename);
}

// ─── .fdx (Final Draft XML) export ──────────────────────────────────

interface FdxParagraph {
  type: string;
  text: string;
}

function fountainToFdxParagraphs(content: string): FdxParagraph[] {
  const lines = content.split("\n");
  const paragraphs: FdxParagraph[] = [];
  let inDialogue = false;
  let inTitlePage = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      if (inDialogue && !lines[i + 1]?.trim()) {
        inDialogue = false;
      }
      continue;
    }

    // Page break ends title page
    if (/^===+$/.test(trimmed)) {
      inTitlePage = false;
      continue;
    }

    // Title page key: value
    if (inTitlePage && /^(Title|Author|Credit|Source|Draft date|Date|Contact|Copyright|Notes|Revision)\s*:/i.test(trimmed)) {
      continue; // Skip title page in body content
    }

    // Scene headings
    if (/^\.((?!\.)\S)|^(INT|EXT|EST|INT\.\/EXT|I\/E)[.\s]/i.test(trimmed)) {
      inDialogue = false;
      const heading = trimmed.startsWith(".") ? trimmed.slice(1) : trimmed;
      paragraphs.push({ type: "Scene Heading", text: heading });
      continue;
    }

    // Transitions: > text or lines ending in TO:
    if (/^>(?!>)/.test(trimmed)) {
      inDialogue = false;
      paragraphs.push({ type: "Transition", text: trimmed.replace(/^>\s*/, "").replace(/<\s*$/, "") });
      continue;
    }
    if (/^[A-Z ]+TO:\s*$/.test(trimmed)) {
      inDialogue = false;
      paragraphs.push({ type: "Transition", text: trimmed });
      continue;
    }

    // Centered: >text<
    if (/^>.*<$/.test(trimmed)) {
      paragraphs.push({ type: "Action", text: trimmed.replace(/^>\s*/, "").replace(/<\s*$/, "") });
      continue;
    }

    // Character (ALL CAPS, possibly with @, or ext like (V.O.))
    if (/^@/.test(trimmed) || /^[A-Z][A-Z0-9 ._\-']*(\s*\(.*\))?\s*\^?\s*$/.test(trimmed)) {
      const charName = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
      paragraphs.push({ type: "Character", text: charName });
      inDialogue = true;
      continue;
    }

    // Parenthetical (in dialogue context)
    if (inDialogue && /^\s*\(.*\)\s*$/.test(trimmed)) {
      paragraphs.push({ type: "Parenthetical", text: trimmed });
      continue;
    }

    // Dialogue (in dialogue context)
    if (inDialogue) {
      paragraphs.push({ type: "Dialogue", text: trimmed });
      continue;
    }

    // Sections
    if (/^#{1,3}\s/.test(trimmed)) {
      paragraphs.push({ type: "Action", text: trimmed.replace(/^#+\s*/, "") });
      continue;
    }

    // Synopsis
    if (/^=(?!=)/.test(trimmed)) {
      continue; // Skip synopses in FDX
    }

    // Default: Action
    paragraphs.push({ type: "Action", text: trimmed });
  }

  return paragraphs;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stripFountainFormatting(text: string): { plain: string; style: string } {
  // Strip bold/italic/underline markers and return style
  let style = "";
  let plain = text;

  if (/\*\*\*(.+?)\*\*\*/.test(plain)) {
    style = "Bold+Italic";
    plain = plain.replace(/\*\*\*(.+?)\*\*\*/g, "$1");
  } else if (/\*\*(.+?)\*\*/.test(plain)) {
    style = "Bold";
    plain = plain.replace(/\*\*(.+?)\*\*/g, "$1");
  } else if (/\*(.+?)\*/.test(plain)) {
    style = "Italic";
    plain = plain.replace(/\*(.+?)\*/g, "$1");
  } else if (/_(.+?)_/.test(plain)) {
    style = "Underline";
    plain = plain.replace(/_(.+?)_/g, "$1");
  }

  return { plain, style };
}

export function exportFdx(content: string, filename = "screenplay.fdx") {
  const paragraphs = fountainToFdxParagraphs(content);

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<FinalDraft DocumentType="Script" Template="No" Version="4">\n`;
  xml += `  <Content>\n`;

  for (const para of paragraphs) {
    const { plain, style } = stripFountainFormatting(para.text);
    const styleAttr = style ? ` Style="${escapeXml(style)}"` : "";
    xml += `    <Paragraph Type="${escapeXml(para.type)}">\n`;
    xml += `      <Text${styleAttr}>${escapeXml(plain)}</Text>\n`;
    xml += `    </Paragraph>\n`;
  }

  xml += `  </Content>\n`;
  xml += `</FinalDraft>\n`;

  const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
  downloadBlob(blob, filename);
}

// ─── PDF export ─────────────────────────────────────────────────────
// Opens a print-ready window with properly formatted screenplay HTML,
// then triggers the browser's print dialog (Save as PDF).

/**
 * Strip Fountain forced-element prefixes (!, !!, @) from HTML text content.
 */
function stripForcePrefixes(html: string): string {
  return html
    .replace(/>!!(\s*)/g, ">")
    .replace(/>!(\s*)/g, ">")
    .replace(/>@(\s*)/g, ">");
}

export function exportPdf(scriptHtml: string, titlePageHtml: string, title = "Screenplay") {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Please allow popups to export PDF.");
    return;
  }

  const cleanScript = stripForcePrefixes(scriptHtml);

  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${escapeXml(title)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Courier+Prime:ital,wght@0,400;0,700;1,400;1,700&display=swap');

  @page {
    size: letter;
    margin: 1in 1in 0.75in 1.5in;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Courier Prime', 'Courier New', Courier, monospace;
    font-size: 12pt;
    line-height: 1;
    color: #000;
    background: #fff;
  }

  /* Reset all paragraph margins from fountain-js HTML output */
  p { margin: 0; padding: 0; }

  /* Title page */
  .title-page {
    text-align: center;
    padding-top: 3in;
    page-break-after: always;
  }
  .title-page p { margin: 4px 0; }

  /* Scene headings */
  .scene_heading, h3 {
    font-size: 12pt;
    font-weight: bold;
    text-transform: uppercase;
    margin-top: 22px;
    margin-bottom: 0;
  }

  /* Action */
  .action, .script > p:not([class]) {
    margin-top: 11px;
    margin-bottom: 0;
  }

  /* Character — centered above dialogue column, double-space above */
  /* fountain-js outputs character names as <h4> elements */
  .character, h4 {
    font-weight: bold;
    font-size: 12pt;
    text-transform: uppercase;
    margin-top: 22px;
    margin-bottom: 0;
    padding-left: 1.7in;
  }

  /* Dialogue — narrower column */
  .dialogue {
    margin: 0;
    padding-left: 0.7in;
    padding-right: 1in;
  }

  /* Parenthetical — between character and dialogue indent */
  .parenthetical {
    font-style: italic;
    margin: 0;
    padding-left: 1.2in;
    padding-right: 1.2in;
  }

  /* Transition */
  .transition {
    text-align: right;
    text-transform: uppercase;
    margin: 12px 0;
  }

  /* Centered */
  .centered {
    text-align: center;
  }

  /* Page break */
  .page_break {
    page-break-after: always;
    visibility: hidden;
    height: 0;
  }

  /* Lyrics */
  .lyrics {
    font-style: italic;
    padding-left: 1in;
    padding-right: 1.5in;
  }

  /* Section headings */
  .section {
    font-weight: bold;
    font-size: 14pt;
    margin-top: 24px;
  }

  /* Notes and synopsis — hide in print */
  .note, .synopsis { display: none; }
</style>
</head>
<body>
${titlePageHtml ? `<div class="title-page">${titlePageHtml}</div>` : ""}
<div class="script">${cleanScript}</div>
<script>
  // Wait for fonts to load, then trigger print
  document.fonts.ready.then(function() {
    setTimeout(function() { window.print(); }, 300);
  });
<\/script>
</body>
</html>`);

  printWindow.document.close();
}
