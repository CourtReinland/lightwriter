export interface FountainToken {
  type: string;
  text: string;
  scene_number?: string;
  depth?: number;
}

export interface FountainScript {
  title: string;
  html: { title_page: string; script: string };
  tokens: FountainToken[];
}

export interface SceneInfo {
  heading: string;
  sceneNumber?: string;
  startIndex: number;
  tokenCount: number;
}
