import { describe, expect, test } from 'bun:test';

import { parseDocumentationAuthorityRegistry } from './authority.ts';
import {
  compileDocumentationOperationAdmissionProjection,
  compileDocumentationSemanticGraph,
  compileDocumentationView,
  unavailableDocumentationAdmissionProjection
} from './compiler.ts';

const registry = parseDocumentationAuthorityRegistry(JSON.stringify({
  documents: [
    {
      id: 'architecture',
      path: 'docs/architecture.md',
      kind: 'authority',
      domain: 'architecture',
      lifecycle: 'stable',
      dynamicPolicy: 'forbidden',
      owns: ['architecture.boundary'],
      projects: []
    },
    {
      id: 'mutation',
      path: 'docs/mutation.md',
      kind: 'authority',
      domain: 'mutation',
      lifecycle: 'stable',
      dynamicPolicy: 'forbidden',
      owns: ['mutation.transaction'],
      projects: []
    }
  ]
}));

const sources = [
  {
    documentId: 'architecture',
    source: `---
title: Architecture
status: stable
domain: architecture
---

# Architecture

## Boundary

Only the owner may publish.
`
  },
  {
    documentId: 'mutation',
    source: `---
title: Mutation
status: stable
domain: mutation
---

# Mutation

<!-- sec-clause {"blocker":"projection-unavailable","kind":"temporary-safety-denial"} -->
## Current denial

The public effect is not admitted.
`
  }
] as const;

describe('documentation semantic compiler', () => {
  test('one graph produces byte-distinct compact/full views with one semantic identity', () => {
    const graph = compileDocumentationSemanticGraph({
      trustedTree: 'tree-a',
      registry,
      sources,
      admission: compileDocumentationOperationAdmissionProjection({
        trustedTree: 'tree-a',
        registry,
        owners: [registry.documents[0]!],
        subjectRefs: ['src/architecture.ts']
      })
    });
    const boundary = graph.clauses.find(({ headingPath }) => headingPath.at(-1) === 'Boundary')!;
    const compact = compileDocumentationView(graph, {
      kind: 'compact-agent',
      clauseIds: [boundary.id],
      ownerDocumentIds: ['architecture'],
      decisionQuestionDigest: `sha256:${'1'.repeat(64)}`
    });
    const full = compileDocumentationView(graph, {
      kind: 'full-human',
      clauseIds: [],
      ownerDocumentIds: [],
      decisionQuestionDigest: `sha256:${'1'.repeat(64)}`
    });

    expect(compact.semanticGraphDigest).toBe(full.semanticGraphDigest);
    expect(compact.compilerInputDigest).toBe(full.compilerInputDigest);
    expect(compact.viewBytesDigest).not.toBe(full.viewBytesDigest);
    expect(compact.clauses.map(({ headingPath }) => headingPath.at(-1)))
      .toEqual(['Architecture', 'Boundary']);
    expect(graph.blockers).toContain('projection-unavailable');
  });

  test('unavailable admission is typed and cannot smuggle runtime facts', () => {
    const graph = compileDocumentationSemanticGraph({
      trustedTree: 'tree-b',
      registry,
      sources,
      admission: unavailableDocumentationAdmissionProjection('tree-b')
    });
    expect(graph.blockers).toContain('documentation-admission-projection-unavailable');
    expect(() => compileDocumentationSemanticGraph({
      trustedTree: 'tree-b',
      registry,
      sources,
      admission: {
        status: 'unavailable',
        trustedTree: 'tree-b',
        registryDigest: null,
        facts: [{
          id: 'forged-result',
          ownerDocumentId: 'mutation',
          subjectRefs: [],
          admission: 'eligible',
          evidenceObligations: [],
          consumerRefs: [],
          invalidationRefs: []
        }]
      } as never
    })).toThrow('admission projection was not issued');
  });
});
