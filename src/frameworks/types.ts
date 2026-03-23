export interface BeatDefinition {
  name: string;
  description: string;
  examples: string[];
  startPercent: number;
  endPercent: number;
}

export interface FrameworkDefinition {
  id: string;
  name: string;
  color: string;
  beats: BeatDefinition[];
}
