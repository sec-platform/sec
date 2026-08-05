import { uniqueSorted } from './canonical-primitives.ts';
import type {
  FactProvenanceKind,
  SemanticAuthority,
  SemanticEntityKind,
  SemanticPredicate,
  SemanticValue
} from './engineering-ir-types.ts';

export const SEMANTIC_VIEW_FORMAT_VERSION = '1' as const;
export const SEMANTIC_VIEW_SET_FORMAT_VERSION = '1' as const;

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
export type ViewRelation = SemanticPredicate;
export type ViewReferenceKind = 'entity' | 'fact' | 'scenario' | 'scenario-step' | 'evidence';
export type AuthorityOverlayStatus = 'uniform' | 'mixed' | 'inferred' | 'conflict';

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
  target?: string;
  value?: SemanticValue;
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
  status: AuthorityOverlayStatus;
  authorities: SemanticAuthority[];
  hasInferred: boolean;
  hasConflict: boolean;
  confidence: {
    min: number;
    max: number;
  };
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

export interface SemanticViewSet {
  formatVersion: typeof SEMANTIC_VIEW_SET_FORMAT_VERSION;
  inputRevision: string;
  semanticRevision: string;
  views: SemanticView[];
}

export function semanticViewFactIds(view: SemanticView): string[] {
  const references: ViewReference[] = [
    ...view.nodes.flatMap((node) => node.references),
    ...view.edges.flatMap((edge) => edge.references),
    ...view.inspector.flatMap((section) => section.items.flatMap((item) => item.references)),
    ...view.overlays.flatMap((overlay) => overlay.entries.flatMap((entry) =>
      entry.factIds.map((ref) => ({ kind: 'fact' as const, ref }))
    ))
  ];
  return uniqueSorted(
    references
      .filter((reference) => reference.kind === 'fact')
      .map((reference) => reference.ref)
  );
}
