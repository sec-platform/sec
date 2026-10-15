export interface AcceptanceItem {
  id: string;
  source?: {
    tests: string[];
  };
  dependsOn?: string[];
  covers?: {
    blocks?: string[];
  };
}

export interface AcceptanceSource {
  declaringBlockId: string;
  acceptance: AcceptanceItem;
}
