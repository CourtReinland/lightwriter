import { useMemo } from "react";
import "./ScreenplayPreview.css";

interface ScreenplayPreviewProps {
  html: string;
  titlePageHtml: string;
}

/**
 * Strip Fountain forced-element prefixes (!, !!, @) from HTML text content.
 * These are formatting markers that shouldn't appear in the rendered preview.
 */
function stripForcePrefixes(html: string): string {
  // Replace text content that starts with !!, !, or @ inside tags
  // Match: >!! text  or  >! text  or  >@ text  (after an HTML tag close)
  return html
    .replace(/>!!(\s*)/g, ">")
    .replace(/>!(\s*)/g, ">")
    .replace(/>@(\s*)/g, ">");
}

export default function ScreenplayPreview({ html, titlePageHtml }: ScreenplayPreviewProps) {
  const cleanHtml = useMemo(() => stripForcePrefixes(html), [html]);

  return (
    <div className="screenplay-preview">
      {titlePageHtml && (
        <div
          className="preview-title-page"
          dangerouslySetInnerHTML={{ __html: titlePageHtml }}
        />
      )}
      <div
        className="preview-script"
        dangerouslySetInnerHTML={{ __html: cleanHtml }}
      />
    </div>
  );
}
