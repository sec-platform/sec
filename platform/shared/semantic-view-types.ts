import type {
  FactProvenanceKind,
  SemanticAuthority,
  SemanticEntityKind,
  SemanticPredicate,
  SemanticValue
} from './engineering-ir-types.ts';

export const SEMANTIC_VIEW_FORMAT_VERSION = '1' as const;

export const INSPECTOR_SECTION_IDS = [
  'IDENTITY',
  'ROLE',
  'CONTRACT',
  'OWNED STATE',
  'DATA',
  'EFFECTS',
  'ERRORS',
  'LIFECYCLE',
  'CONCURRENCY',
  'PERMISSIONS',
  'RELATIONS',
  'EVIDENCE'
] as const;

export type SemanticViewKind = 'architecture' | 'scenario' | 'state';
export type InspectorSectionId = (typeof INSPECTOR_SECTION_IDS)[number];
export type ViewBadge = 'stateful' | 'io' | 'async' | 'permission' | 'invariant' | 'inferred' | 'entry' | 'retry';
export type ViewRelation = SemanticPredicate | 'SCENARIO_PRECEDES' | 'SCENARIO_ERROR';
export type ViewReferenceKind = 'entity' | 'fact' | 'scenario' | 'scenario-step' | 'evidence';

export interface ViewReference {
  kind: ViewReferenceKind;
  ref: string;
}

export interface ViewNode {
  id: string;
  entityId: string;
  entityKind: SemanticEntityKind;
  label: string;
  role?: string;
  badges: ViewBadge[];
  group?: string;
  references: ViewReference[];
}

export interface ViewEdge {
  id: string;
  source: string;
  target: string;
  relation: ViewRelation;
  label: string;
  references: ViewReference[];
}

export interface InspectorItem {
  key: string;
  value: SemanticValue;
  references: ViewReference[];
}

export interface InspectorSection {
  id: InspectorSectionId;
  items: InspectorItem[];
}

export interface ViewOverlayEntry {
  targetId: string;
  factIds: string[];
  authority: SemanticAuthority;
  confidence: number;
  provenanceKinds: FactProvenanceKind[];
  evidenceRefs: string[];
}

export interface ViewOverlay {
  kind: 'provenance-authority';
  entries: ViewOverlayEntry[];
}

export interface SemanticView {
  formatVersion: typeof SEMANTIC_VIEW_FORMAT_VERSION;
  viewKind: SemanticViewKind;
  subject?: string;
  nodes: ViewNode[];
  edges: ViewEdge[];
  inspector: InspectorSection[];
  overlays: ViewOverlay[];
}
