import type { FrameworkDefinition } from "./types";

export interface ComputedBeat {
  name: string;
  description: string;
  examples: string[];
  startPage: number;
  endPage: number;
  startLine: number;
  endLine: number;
  color: string;
  frameworkId: string;
}

const LINES_PER_PAGE = 56;

/**
 * Convert a framework's percentage-based beats into concrete page and line ranges.
 */
export function computeBeatRanges(
  framework: FrameworkDefinition,
  targetPages: number,
  totalLines: number,
): ComputedBeat[] {
  return framework.beats.map((beat) => {
    const startPage = Math.max(1, Math.round((beat.startPercent / 100) * targetPages));
    const endPage = Math.max(startPage, Math.round((beat.endPercent / 100) * targetPages));

    // Map pages to lines proportionally
    const startLine = Math.max(0, Math.round((beat.startPercent / 100) * totalLines));
    const endLine = Math.min(totalLines, Math.round((beat.endPercent / 100) * totalLines));

    return {
      name: beat.name,
      description: beat.description,
      examples: beat.examples,
      startPage,
      endPage,
      startLine,
      endLine,
      color: framework.color,
      frameworkId: framework.id,
    };
  });
}

/**
 * Estimate page count from line count.
 */
export function estimatePages(lineCount: number): number {
  return Math.max(1, Math.ceil(lineCount / LINES_PER_PAGE));
}
