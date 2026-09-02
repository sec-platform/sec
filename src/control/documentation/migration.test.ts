import { describe, expect, test } from 'bun:test';

import {
  compareCodeUnits
} from '../../system-architecture/foundation/runtime/canonical.ts';
import type {
  DocumentationAuthorityRecord,
  DocumentationAuthorityRegistry
} from './authority.ts';
import {
  compileDocumentationSemanticGraph,
  unavailableDocumentationAdmissionProjection
} from './compiler.ts';
import {
  compileDocumentationMigrationDesign,
  deriveDocumentationMigrationGenerationBinding,
  DOCUMENTATION_MIGRATION_DESIGN_SCHEMA,
  DOCUMENTATION_MIGRATION_TARGET_CONTRACT_DIGEST,
  encodeDocumentationMigrationDesign,
  type DocumentationMigrationCorpusEntry
} from './migration.ts';

const DIGEST = 'sha256:0000000000000000000000000000000000000000000000000000000000000000' as const;

function record(
  id: string,
  path: string,
  kind: DocumentationAuthorityRecord['kind']
): DocumentationAuthorityRecord {
  return {
    id,
    path,
    kind,
    domain: 'fixture',
    lifecycle: kind === 'proposal' ? 'draft' : 'stable',
    dynamicPolicy: 'forbidden',
    owns: [],
    projects: []
  };
}

function corpus(
  path: string,
  status: DocumentationMigrationCorpusEntry['status'],
  registryId: string | null,
  externalConsumerStatus: DocumentationMigrationCorpusEntry['externalConsumerStatus'] = 'none-observed',
  consumerRefs: readonly string[] = [],
  localConsumerCoverageStatus: DocumentationMigrationCorpusEntry['localConsumerCoverageStatus'] = 'complete'
): DocumentationMigrationCorpusEntry {
  return {
    path,
    status,
    registryId,
    contentDigest: status === 'missing' ? null : DIGEST,
    consumerRefs,
    localConsumerCoverageStatus,
    externalConsumerStatus
  };
}

function registry(...documents: readonly DocumentationAuthorityRecord[]): DocumentationAuthorityRegistry {
  return { documents };
}

function sourceGraphFor(
  input: DocumentationAuthorityRegistry,
  trustedTree = 'tree-a',
  untyped = false
) {
  const sourceRecords = input.documents
    .filter((document) => (
      (document.kind === 'authority' || document.kind === 'corpus-contract')
      && document.lifecycle === 'stable'
    ))
    .sort((left, right) => compareCodeUnits(left.id, right.id));
  return compileDocumentationSemanticGraph({
    trustedTree,
    registry: input,
    sources: sourceRecords.map(({ id }) => ({
      documentId: id,
      source: `${untyped ? '' : '<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->\n'}# ${id}\n`
    })),
    admission: unavailableDocumentationAdmissionProjection(trustedTree)
  });
}

function compileDesign(input: Readonly<{
  readonly registry: DocumentationAuthorityRegistry;
  readonly corpus: readonly DocumentationMigrationCorpusEntry[];
}>): ReturnType<typeof compileDocumentationMigrationDesign> {
  const sourceGraph = sourceGraphFor(input.registry);
  return compileDocumentationMigrationDesign({
    ...input,
    targetContractDigest: DOCUMENTATION_MIGRATION_TARGET_CONTRACT_DIGEST,
    currentGenerationBinding: deriveDocumentationMigrationGenerationBinding({
      generationRef: sourceGraph.trustedTree,
      providerRef: 'git',
      revisionOrSnapshotRef: sourceGraph.trustedTree,
      observationEpoch: sourceGraph.trustedTree,
      registry: input.registry,
      corpus: input.corpus,
      sourceGraph
    }),
    sourceGraph
  });
}

describe('documentation migration design compiler', () => {
  test('keeps derivable projections and blocks unresolved source ownership', () => {
    const design = compileDesign({
      registry: registry(
        record('a-authority', 'docs/a.md', 'authority'),
        record('a-index', 'docs/README.md', 'navigation')
      ),
      corpus: [
        corpus('docs/README.md', 'tracked-registered', 'a-index', 'none-observed', ['consumer:docs']),
        corpus('docs/a.md', 'tracked-registered', 'a-authority', 'none-observed')
      ]
    });

    expect(design.schema).toBe(DOCUMENTATION_MIGRATION_DESIGN_SCHEMA);
    expect(design.status).toBe('blocked');
    expect(design.preservation.find(({ currentId }) => currentId === 'a-index')?.disposition)
      .toBe('derive-projection');
    expect(design.frontier.map(({ code }) => code)).toEqual([
      'authority-role-adoption-required',
      'consumer-rewrite-required'
    ]);
    expect(encodeDocumentationMigrationDesign(design) as string).toContain(
      'sec-documentation-migration-design'
    );
  });

  test('permits a fully classified proposal with no consumers', () => {
    const design = compileDesign({
      registry: registry(record('proposal', 'docs/proposals/p.md', 'proposal')),
      corpus: [corpus('docs/proposals/p.md', 'tracked-registered', 'proposal')]
    });

    expect(design.status).toBe('ready');
    expect(design.frontier).toEqual([]);
    expect(design.preservation[0]?.disposition).toBe('preserve-as-source');
  });

  test('does not treat an empty literal hit list as complete consumer-zero evidence', () => {
    const design = compileDesign({
      registry: registry(record('proposal', 'docs/proposals/p.md', 'proposal')),
      corpus: [corpus('docs/proposals/p.md', 'tracked-registered', 'proposal', 'none-observed', [], 'unknown')]
    });

    expect(design.status).toBe('blocked');
    expect(design.frontier.map(({ code }) => code)).toEqual(['local-consumer-coverage-unknown']);
    expect(design.preservation[0]?.frontierCodes).toEqual(['local-consumer-coverage-unknown']);
  });

  test('retains explicit missing registered sources as a typed migration frontier', () => {
    const design = compileDesign({
      registry: registry(record('authority', 'docs/a.md', 'authority')),
      corpus: [corpus('docs/a.md', 'missing', 'authority', 'unknown')]
    });

    expect(design.status).toBe('blocked');
    expect(design.preservation[0]?.frontierCodes).toEqual([
      'authority-role-adoption-required',
      'external-consumer-unknown',
      'missing-current-source'
    ]);
  });

  test('classifies corpus contracts as source fragments rather than a blocked unknown kind', () => {
    const design = compileDesign({
      registry: registry(record('contract', 'docs/contract.md', 'corpus-contract')),
      corpus: [corpus('docs/contract.md', 'tracked-registered', 'contract')]
    });

    expect(design.status).toBe('ready');
    expect(design.preservation[0]?.targetClass).toBe('source-fragment');
    expect(design.preservation[0]?.disposition).toBe('preserve-as-source');
  });

  test('does not silently absorb an unregistered or externally unknown artifact', () => {
    const design = compileDesign({
      registry: registry(record('proposal', 'docs/proposals/p.md', 'proposal')),
      corpus: [
        corpus('docs/proposals/p.md', 'tracked-registered', 'proposal'),
        corpus('docs/work/unknown.md', 'tracked-unclassified', null, 'unknown')
      ]
    });

    expect(design.status).toBe('blocked');
    expect(design.frontier.map(({ code, subjectRef }) => `${code}:${subjectRef}`)).toEqual([
      'external-consumer-unknown:docs/work/unknown.md',
      'unclassified-current-source:docs/work/unknown.md'
    ]);
    expect(design.preservation.find(({ currentPath }) => currentPath === 'docs/work/unknown.md')?.disposition)
      .toBe('blocked');
  });

  test('keeps known consumers on non-active artifacts in the migration frontier', () => {
    const design = compileDesign({
      registry: registry(record('proposal', 'docs/proposals/p.md', 'proposal')),
      corpus: [
        corpus('docs/proposals/p.md', 'tracked-registered', 'proposal'),
        corpus('docs/work/retired.md', 'tracked-non-active', null, 'none-observed', ['consumer:runtime'])
      ]
    });

    expect(design.status).toBe('blocked');
    expect(design.frontier.map(({ code, subjectRef }) => `${code}:${subjectRef}`)).toEqual([
      'consumer-rewrite-required:docs/work/retired.md'
    ]);
    expect(design.preservation.find(({ currentPath }) => currentPath === 'docs/work/retired.md')?.frontierCodes)
      .toEqual(['consumer-rewrite-required']);
  });

  test('rejects an unsorted corpus or a registry/path mismatch before producing a design', () => {
    expect(() => compileDesign({
      registry: registry(record('a', 'docs/a.md', 'proposal')),
      corpus: [
        corpus('docs/z.md', 'tracked-unclassified', null),
        corpus('docs/a.md', 'tracked-registered', 'a')
      ]
    })).toThrow(/canonical path order/u);

    expect(() => compileDesign({
      registry: registry(record('a', 'docs/a.md', 'proposal')),
      corpus: [corpus('docs/a.md', 'tracked-registered', 'a')]
    })).not.toThrow();

    expect(() => compileDesign({
      registry: registry(record('a', 'docs/a.md', 'proposal')),
      corpus: [corpus('docs/a.md', 'tracked-registered', 'other')]
    })).toThrow(/unknown registry id|does not match registry record/u);
  });

  test('rejects caller-supplied digests that do not bind the actual inputs', () => {
    const currentRegistry = registry(record('a', 'docs/a.md', 'proposal'));
    const currentCorpus = [corpus('docs/a.md', 'tracked-registered', 'a')];
    const sourceGraph = sourceGraphFor(currentRegistry);
    const binding = deriveDocumentationMigrationGenerationBinding({
      generationRef: sourceGraph.trustedTree,
      providerRef: 'git',
      revisionOrSnapshotRef: sourceGraph.trustedTree,
      observationEpoch: sourceGraph.trustedTree,
      registry: currentRegistry,
      corpus: currentCorpus,
      sourceGraph
    });

    expect(() => compileDocumentationMigrationDesign({
      registry: currentRegistry,
      targetContractDigest: DOCUMENTATION_MIGRATION_TARGET_CONTRACT_DIGEST,
      corpus: currentCorpus,
      currentGenerationBinding: { ...binding, registryDigest: DIGEST } as never,
      sourceGraph
    })).toThrow(/not issued by the migration owner/u);

    expect(() => compileDocumentationMigrationDesign({
      registry: currentRegistry,
      targetContractDigest: DIGEST,
      corpus: currentCorpus,
      currentGenerationBinding: binding,
      sourceGraph
    })).toThrow(/targetContractDigest does not match/u);
  });

  test('keeps untyped source clauses in the migration frontier', () => {
    const currentRegistry = registry(record('a-authority', 'docs/a.md', 'authority'));
    const currentCorpus = [corpus('docs/a.md', 'tracked-registered', 'a-authority')];
    const sourceGraph = sourceGraphFor(currentRegistry, 'tree-a', true);
    const design = compileDocumentationMigrationDesign({
      registry: currentRegistry,
      targetContractDigest: DOCUMENTATION_MIGRATION_TARGET_CONTRACT_DIGEST,
      corpus: currentCorpus,
      currentGenerationBinding: deriveDocumentationMigrationGenerationBinding({
        generationRef: sourceGraph.trustedTree,
        providerRef: 'git',
        revisionOrSnapshotRef: sourceGraph.trustedTree,
        observationEpoch: sourceGraph.trustedTree,
        registry: currentRegistry,
        corpus: currentCorpus,
        sourceGraph
      }),
      sourceGraph
    });

    expect(design.status).toBe('blocked');
    expect(design.frontier.some(({ code }) => code === 'source-semantic-frontier')).toBe(true);
    expect(design.preservation[0]?.frontierCodes).toContain('source-semantic-frontier');
  });
});
