export interface AcceptanceItem {
  id: string;
  dependsOn?: string[];
  covers?: {
    blocks?: string[];
  };
}
