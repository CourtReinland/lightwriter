declare module "fountain-js" {
  interface FountainToken {
    type: string;
    text: string;
    scene_number?: string;
    depth?: number;
  }

  export interface FountainResult {
    title: string;
    html: { title_page: string; script: string };
    tokens: FountainToken[];
  }

  export class Fountain {
    parse(text: string, getTokens?: boolean): FountainResult;
  }
}
