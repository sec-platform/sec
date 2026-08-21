import path from 'node:path';

import { Glob } from 'bun';
import { describe, expect, test } from 'bun:test';

import {
  parseDocumentationAuthorityRegistry,
  resolveDocumentationOperationOwnersV1
} from '../../platform/shared/documentation-authority-contract.ts';
import { compilerRoot } from '../../platform/shared/paths.ts';
import { parseSecRoadmapWorkCatalogV1 } from '../../platform/shared/work-selection-live-contract.ts';
import {
  CodexDevelopmentParseActivePointerV2,
  CodexDevelopmentParseRollingPlanV1
} from '../../scripts/codex/document-control-plane-contract.ts';
import { NEXUS_EPR_BINDINGS_V1 } from '../../scripts/codex/repository-audit.ts';
import {
  CodexDevelopmentParseWorkPackageManifest,
  CodexDevelopmentWorkPackageManifestDigest
} from '../../scripts/codex/work-package-contract.ts';
import { readCompilerFile, readCompilerTextFile } from '../helpers/compiler-fixtures.ts';

describe('canonical documentation authority', () => {
  test('operation owner closure derives explicit source owners and changed document projections', async () => {
    const registry = parseDocumentationAuthorityRegistry(
      await readCompilerFile('docs/authority.json')
    );
    const changedPaths = [
      'AGENTS.md',
      'docs/verification-governance.md',
      'docs/work/active-work-package.md',
      'docs/work/rolling-plan.md'
    ].sort();
    expect(resolveDocumentationOperationOwnersV1({
      registry,
      authorityRefs: ['development-governance', 'verification-governance'],
      changedPaths
    }).map(({ id }) => id)).toEqual([
      'development-governance',
      'roadmap',
      'verification-governance'
    ]);
    expect(() => resolveDocumentationOperationOwnersV1({
      registry,
      authorityRefs: ['agents-entry'],
      changedPaths: []
    })).toThrow(/non-owning/u);
    expect(() => resolveDocumentationOperationOwnersV1({
      registry,
      authorityRefs: ['verification-governance'],
      changedPaths: []
    })).toThrow(/development-governance/u);
    expect(resolveDocumentationOperationOwnersV1({
      registry,
      authorityRefs: ['development-governance', 'product'],
      changedPaths: []
    }).map(({ id }) => id)).toEqual(['development-governance', 'product']);
    expect(resolveDocumentationOperationOwnersV1({
      registry,
      authorityRefs: ['development-governance', 'system-architecture'],
      changedPaths: []
    }).map(({ id }) => id)).toEqual(['development-governance', 'system-architecture']);
    expect(() => resolveDocumentationOperationOwnersV1({
      registry,
      authorityRefs: ['development-governance', 'development-governance'],
      changedPaths: []
    })).toThrow(/sorted and unique/u);
    expect(() => resolveDocumentationOperationOwnersV1({
      registry,
      authorityRefs: ['development-governance', 'unknown-owner'],
      changedPaths: []
    })).toThrow(/unknown document owner/u);
  });

  test('roadmap exposes one structured work catalog without dynamic project identities', async () => {
    const roadmap = await readCompilerFile('docs/roadmap.md');
    const workCatalog = parseSecRoadmapWorkCatalogV1(roadmap);
    expect(workCatalog.stageRef).toBe('r14-agent-operation');
    expect(workCatalog.items.length).toBeGreaterThanOrEqual(3);
    expect(workCatalog.items.length).toBeLessThanOrEqual(7);
    expect(new Set(workCatalog.items.map(({ workId }) => workId)).size)
      .toBe(workCatalog.items.length);
    expect(roadmap).not.toMatch(/\b[0-9a-f]{40}\b/u);
    expect(roadmap).not.toMatch(/\bPR #\d+\b/u);
  });

  test('rolling plan is relationally bound to the active pointer and keeps the remaining candidates', async () => {
    const [rollingPlanSource, pointerSource, roadmapSource] = await Promise.all([
      readCompilerFile('docs/work/rolling-plan.md'),
      readCompilerFile('docs/work/active-work-package.md'),
      readCompilerFile('docs/roadmap.md')
    ]);
    const rollingPlan = CodexDevelopmentParseRollingPlanV1(rollingPlanSource);
    const pointer = CodexDevelopmentParseActivePointerV2(pointerSource);
    const catalog = parseSecRoadmapWorkCatalogV1(roadmapSource);
    const selectedManifestId = path.posix.basename(pointer.manifest, '.md');
    const manifestSource = await readCompilerTextFile(pointer.manifest);
    const manifest = CodexDevelopmentParseWorkPackageManifest(
      manifestSource,
      pointer.manifest
    );
    const rawManifestDigest = pointerSource.match(
      /manifestDigest: (sha256:[0-9a-f]{64})/u
    )?.[1];

    expect(rollingPlan.activePackageId).toBe(selectedManifestId);
    expect(rollingPlan.candidatePackageIds.length).toBeGreaterThanOrEqual(2);
    expect(rollingPlan.candidatePackageIds.length).toBeLessThanOrEqual(5);
    expect(new Set(rollingPlan.candidatePackageIds).size)
      .toBe(rollingPlan.candidatePackageIds.length);
    expect(rollingPlan.candidatePackageIds).not.toContain(selectedManifestId);
    const catalogPackageIds = catalog.items.map(({ packageId }) => packageId);
    const activeCatalogIndex = catalogPackageIds.indexOf(rollingPlan.activePackageId);
    if (activeCatalogIndex >= 0) {
      expect(rollingPlan.candidatePackageIds.every((packageId) =>
        catalogPackageIds.includes(packageId))).toBe(true);
    } else {
      expect(manifest.tracking === 'none' || catalog.items.some(({ tracking }) => tracking === manifest.tracking)).toBe(true);
      const retainedCatalogIndexes = rollingPlan.candidatePackageIds.map((packageId) =>
        catalogPackageIds.indexOf(packageId));
      expect(retainedCatalogIndexes.every((index) => index >= 0)).toBe(true);
      expect(retainedCatalogIndexes).toEqual([...retainedCatalogIndexes].sort((left, right) => left - right));
    }
    expect(rawManifestDigest).toBeDefined();
    expect(CodexDevelopmentWorkPackageManifestDigest(manifestSource)).toBe(rawManifestDigest!);
    expect(manifest.id).toBe(selectedManifestId);
    expect(manifest.manifestState).toBe('frozen');
    expect(manifest.tasks.length).toBeGreaterThan(0);
    expect(manifest.acceptance.length).toBeGreaterThan(0);
  });

  test('historical agent prose remains non-discoverable and is stored as a fixture', async () => {
    const discoverableArchiveEntries: string[] = [];
    for await (const entry of new Glob('docs/archive/**/AGENTS.md').scan({
      cwd: compilerRoot,
      onlyFiles: true
    })) {
      discoverableArchiveEntries.push(entry);
    }

    expect(discoverableArchiveEntries).toEqual([]);
    expect((await readCompilerFile(
      'tests/fixtures/documentation-history/AGENTS.authority-v5.historical.md'
    )).length).toBeGreaterThan(0);
  });

  test('Nexus absorption ledger binds the exact corpus baseline and the 29 EPR binding records', async () => {
    const ledger = await readCompilerFile('docs/governance/nexus-absorption-ledger.yaml');
    const parsed = Bun.YAML.parse(ledger) as {
      status: string;
      source: {
        repository: string;
        baselineCommit: string;
        baselineTree: string;
        trackedPaths: number;
      };
      coverage: { eprBindings: { bound: number; expected: number } };
      completion: {
        censusComplete: boolean;
        parityComplete: boolean;
        retirementComplete: boolean;
        noOmissionProven: boolean;
      };
    };

    expect(parsed.status).toBe('incomplete');
    expect(parsed.source.repository).toBe('QzCrane/nexus');
    expect(parsed.source.baselineCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(parsed.source.baselineTree).toMatch(/^[0-9a-f]{40}$/);
    expect(parsed.source.trackedPaths).toBeGreaterThan(0);
    expect(parsed.coverage.eprBindings.expected).toBe(29);
    expect(parsed.coverage.eprBindings.bound).toBe(
      NEXUS_EPR_BINDINGS_V1.filter((entry) => entry.binding === 'bound').length
    );
    expect(NEXUS_EPR_BINDINGS_V1).toHaveLength(29);
    expect(NEXUS_EPR_BINDINGS_V1.filter((entry) => entry.binding === 'blocked')).toHaveLength(
      29 - parsed.coverage.eprBindings.bound
    );
    expect(parsed.completion).toEqual({
      censusComplete: false,
      parityComplete: false,
      retirementComplete: false,
      noOmissionProven: false
    });
  });
});
