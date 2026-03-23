import { useState, useEffect, useRef, useMemo } from "react";
import { Fountain, type FountainResult } from "fountain-js";
import type { SceneInfo } from "../types/fountain";

const LINES_PER_PAGE = 56;

export function useFountainParser(content: string) {
  const [parsed, setParsed] = useState<FountainResult | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined as unknown as ReturnType<typeof setTimeout>);

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      try {
        const f = new Fountain();
        const result = f.parse(content, true);
        setParsed(result);
      } catch {
        // Parse error — keep last valid parse
      }
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [content]);

  const pageCount = useMemo(() => {
    const lines = content.split("\n").length;
    return Math.max(1, Math.ceil(lines / LINES_PER_PAGE));
  }, [content]);

  const scenes = useMemo((): SceneInfo[] => {
    if (!parsed?.tokens) return [];
    const result: SceneInfo[] = [];
    let currentScene: SceneInfo | null = null;
    let tokenIndex = 0;

    for (const token of parsed.tokens) {
      if (token.type === "scene_heading") {
        if (currentScene) {
          currentScene.tokenCount = tokenIndex - currentScene.startIndex;
          result.push(currentScene);
        }
        currentScene = {
          heading: token.text,
          sceneNumber: token.scene_number,
          startIndex: tokenIndex,
          tokenCount: 0,
        };
      }
      tokenIndex++;
    }
    if (currentScene) {
      currentScene.tokenCount = tokenIndex - currentScene.startIndex;
      result.push(currentScene);
    }
    return result;
  }, [parsed]);

  return { parsed, pageCount, scenes };
}
