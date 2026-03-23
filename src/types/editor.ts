export interface EditorState {
  content: string;
  targetPages: number;
  activeFrameworks: string[];
  cursorPosition: number;
}

export interface Project {
  id: string;
  name: string;
  content: string;
  targetPages: number;
  updatedAt: number;
}
