import { SEMANTIC_VIEW_FORMAT_VERSION, SEMANTIC_VIEW_SET_FORMAT_VERSION, type SemanticViewSet } from '../../src/semantic/projection/contract/types.ts';

export function buildSemanticViewFixture(
  inputRevision = 'sha256:fixture-input',
  semanticRevision = 'sha256:fixture-semantic'
): SemanticViewSet {
  return {
    formatVersion: SEMANTIC_VIEW_SET_FORMAT_VERSION,
    inputRevision,
    semanticRevision,
    views: [{
      formatVersion: SEMANTIC_VIEW_FORMAT_VERSION,
      viewKind: 'architecture',
      subject: 'app:fixture',
      nodes: [],
      edges: [],
      inspector: [],
      overlays: []
    }]
  };
}
