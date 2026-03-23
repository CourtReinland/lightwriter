export interface BeatDefinition {
  name: string;
  description: string;
  startPercent: number;
  endPercent: number;
}

export interface FrameworkDefinition {
  id: string;
  name: string;
  color: string;
  beats: BeatDefinition[];
}

export interface ComputedBeat {
  name: string;
  description: string;
  startPage: number;
  endPage: number;
  startLine: number;
  endLine: number;
  color: string;
  frameworkId: string;
}
