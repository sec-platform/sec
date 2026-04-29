export type ReviewRuntimeEntryKind = 'page' | 'api';

export interface ReviewRuntimeEntry {
  path: string;
  kind: ReviewRuntimeEntryKind;
  vertical?: string;
  relatedBlocks: string[];
}

export interface ReviewVerticalSlice {
  id: string;
  runtimeEntries: string[];
  relatedBlocks: string[];
}
