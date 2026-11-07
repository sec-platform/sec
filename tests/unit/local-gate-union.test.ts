import { expect, test } from 'bun:test';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { withAuthorityGitReadSession } from '../../src/adapters/providers/git-read/authority.ts';
import {
  acquireWorkingTreeWorkspaceSourceSnapshot,
  compileWorkspaceTypeScriptProjectInput,
  issueWorkspaceTypeScriptProjectGenerationEvidence
} from '../../src/adapters/repository/source-program-model/workspace-source-snapshot.ts';
import type { AuthorNativeMethodUnit } from '../../src/contracts/author-native-methods.ts';
import { sha256 } from '../../src/contracts/canonical.ts';
import { gitProtocolSuccess, inGitProtocolRepository } from '../testkit/git-protocol.ts';

import {
  buildLocalAffectedCheckPlan,
  isDocumentationOnlyAffectedSelection,
  type AffectedTestPlan,
  type LocalAffectedGateId
} from '../../src/adapters/self-hosting/development/runner/affected-plan-contract.ts';
import {
  classifyAffectedSelectionTrustBoundary,
  defaultAffectedSelectionProjectionContext,
  projectAffectedSelectionToVerificationGateResult
} from '../../src/adapters/verification/platform/test-impact/affected.ts';

function affectedPlan(
  changedPaths: string[],
  selectedFastTests: string[] = [],
  resolved = true,
  unresolvedModuleFiles: readonly string[] = [],
  native: Readonly<{ selectedNativeMethods?: readonly AuthorNativeMethodUnit[]; unresolvedNativeInputs?: readonly string[] }> = {}
): AffectedTestPlan {
  const sourceChanged = changedPaths.some((file) => !file.endsWith('.md'));
  const ownershipResolved = resolved;
  const selectedNativeMethods = native.selectedNativeMethods ?? [];
  const unresolvedNativeInputs = native.unresolvedNativeInputs ?? [];
  const selectionResolved = unresolvedModuleFiles.length === 0 && unresolvedNativeInputs.length === 0;
  const boundary = classifyAffectedSelectionTrustBoundary({
    gitDiscoveryFailed: false,
    ownershipResolved,
    sourceChanged,
    selectionResolved,
    unresolvedModuleFiles,
    selectedFastTestCount: selectedFastTests.length,
    selectedNativeMethodCount: selectedNativeMethods.length,
    broadFallbackEnabled: false
  });
  return {
    schema: 'sec-affected-test-plan-v1',
    changedPaths,
    owners: [],
    selectedFastTests,
    selectedNativeMethods,
    selectedSlowTests: [],
    riskSuites: [],
    riskTests: [],
    riskReasons: [],
    unresolvedPaths: resolved ? [] : changedPaths,
    resolved,
    selectionResolved: {
      selectedNativeMethods,
      unresolvedNativeInputs,
      tests: selectedFastTests,
      slowTests: [],
      affectedTests: selectedFastTests,
      affectedSlowTests: [],
      affectedOwners: [],
      sourceChanged,
      selectionResolved,
      unresolvedModuleFiles
    },
    selectionTrustBoundary: boundary,
    broadFallbackEnabled: false,
    verificationResult: projectAffectedSelectionToVerificationGateResult(
      boundary,
      defaultAffectedSelectionProjectionContext('HEAD', 'sha256:0', null)
    )
  };
}

function gateIds(plan: ReturnType<typeof buildLocalAffectedCheckPlan>): LocalAffectedGateId[] {
  return plan.gates.map(({ id }) => id);
}

// Plain source-only method data for pure gate planning, with no issued
// projection, execution capability or environment qualification.
function nativeMethod(): AuthorNativeMethodUnit {
  const fields = { id: 'cargo-tests' as const, owner: 'adapters.compilation' as const, phase: 'quick' as const,
    inputs: [], selectionPaths: ['crates/gift-author-kernel/src/binding.rs'],
    absentLookupPaths: [], unresolvedInputs: [] };
  return { ...fields, inputClosureDigest: sha256(fields) };
}

test('native-only and mixed Bun/native selection share exactly one affected test gate', () => {
  const method = nativeMethod();
  for (const selectedFastTests of [[], ['tests/unit/native-consumer.test.ts']]) {
    const affected = affectedPlan(['crates/gift-author-kernel/src/binding.rs'], selectedFastTests,
      true, [], { selectedNativeMethods: [method] });
    expect(affected.selectionTrustBoundary).toBe('applicable-with-tests');
    expect(affected.selectionResolved.unresolvedNativeInputs).toEqual([]);
    const plan = buildLocalAffectedCheckPlan(affected);
    expect(gateIds(plan)).toEqual(['test:affected']);
    expect(plan.subsumedStandaloneCommands).toEqual(['bun run test -- --affected']);
    expect(plan.affectedPlan.selectionResolved.selectedNativeMethods).toEqual([method]);
  }
});

test('a selected native method preserves missing-native, module-graph and ownership failures', () => {
  const method = nativeMethod();
  const paths = ['crates/gift-author-kernel/src/binding.rs'];
  const selected = { selectedNativeMethods: [method] };
  expect(affectedPlan(paths, [], true, [], selected).selectionTrustBoundary).toBe('applicable-with-tests');
  const missing = affectedPlan(paths, [], true, [], {
    ...selected, unresolvedNativeInputs: ['crates/gift-author-kernel/Cargo.lock']
  });
  expect(missing.selectionTrustBoundary).toBe('unresolved-selection');
  expect(missing.selectionResolved.selectionResolved).toBe(false);
  expect(missing.selectionResolved.unresolvedNativeInputs).toEqual(['crates/gift-author-kernel/Cargo.lock']);
  const graph = affectedPlan(paths, [], true, ['src/missing-consumer.ts'], selected);
  expect(graph.selectionTrustBoundary).toBe('unresolved-module-graph');
  const owner = affectedPlan(paths, [], false, [], selected);
  expect(owner.selectionTrustBoundary).toBe('unresolved-ownership');
  expect(owner.resolved).toBe(false);
});

test('local affected plan selects docs doctor alone for pure active documentation', () => {
  const plan = buildLocalAffectedCheckPlan(affectedPlan(
    ['docs/运行/保证/要求证据与裁决.md']
  ));

  expect(gateIds(plan)).toEqual(['docs:doctor']);
  expect(plan.subsumedStandaloneCommands).toEqual(['bun run docs:doctor']);
});

test('docs-only pre-compilation admission excludes Source Program roots and tool inputs', () => {
  expect(isDocumentationOnlyAffectedSelection(['docs/运行/保证/要求证据与裁决.md'])).toBe(true);
  expect(isDocumentationOnlyAffectedSelection(['docs/运行/保证/要求证据与裁决.md', '.documentation/source-manifest.json'])).toBe(false);
  expect(isDocumentationOnlyAffectedSelection(['examples/semantic-query/input.json'])).toBe(false);
  expect(isDocumentationOnlyAffectedSelection(['examples/documentation-example.ts'])).toBe(false);
  expect(isDocumentationOnlyAffectedSelection([])).toBe(false);
  expect(isDocumentationOnlyAffectedSelection(['.documentation/documents.json'])).toBe(false);
  expect(isDocumentationOnlyAffectedSelection(['.documentation/baseline.json'])).toBe(false);
  expect(isDocumentationOnlyAffectedSelection(['tools/documentation/check_docs.py'])).toBe(false);
  expect(isDocumentationOnlyAffectedSelection(['docs/运行/保证/要求证据与裁决.md', 'src/index.ts'])).toBe(false);
});

test('local affected plan forms one ordered union for mixed TypeScript and docs changes', () => {
  const plan = buildLocalAffectedCheckPlan(affectedPlan(
    [
      'docs/运行/保证/要求证据与裁决.md',
      'src/adapters/self-hosting/development/runner/check-runner.ts'
    ],
    [
      'tests/unit/local-gate-union.test.ts',
      'tests/unit/test-runner.test.ts'
    ]
  ));

  expect(gateIds(plan)).toEqual([
    'imports:check',
    'typecheck',
    'docs:doctor',
    'test:affected'
  ]);
  expect(plan.subsumedStandaloneCommands).toEqual([
    'bun run imports:check',
    'bun run typecheck',
    'bun run docs:doctor',
    'bun run test -- --affected'
  ]);
  expect(plan.umbrellaCommand).toBe('bun run check -- --affected');
});

test('local affected plan keeps non-TypeScript contracts narrow', () => {
  expect(gateIds(buildLocalAffectedCheckPlan(affectedPlan(
    ['package.json'],
    ['tests/contract/ci-lanes.test.ts']
  )))).toEqual(['typecheck', 'test:affected']);

  expect(gateIds(buildLocalAffectedCheckPlan(affectedPlan(
    ['.github/workflows/compiler-pr-validation.yml'],
    ['tests/contract/ci-lanes.test.ts']
  )))).toEqual(['test:affected']);
});

test('local affected plan does not turn Source Program invalidation into full-repository conformance', () => {
  expect(gateIds(buildLocalAffectedCheckPlan(affectedPlan(
    ['src/adapters/self-hosting/development/runner/check-runner.ts']
  )))).toEqual(['imports:check', 'typecheck', 'test:affected']);

  expect(gateIds(buildLocalAffectedCheckPlan(affectedPlan(
    ['docs/运行/保证/要求证据与裁决.md']
  )))).toEqual(['docs:doctor']);

  expect(gateIds(buildLocalAffectedCheckPlan(affectedPlan(
    ['.documentation/documents.json']
  )))).toEqual(['docs:doctor', 'test:affected']);
});

test('documentation support assets trigger docs doctor without becoming product TypeScript', () => {
  expect(gateIds(buildLocalAffectedCheckPlan(affectedPlan([
    '.documentation/baseline.json'
  ])))).toEqual(['docs:doctor', 'test:affected']);
  expect(gateIds(buildLocalAffectedCheckPlan(affectedPlan([
    'examples/documentation-example.ts'
  ])))).toEqual(['docs:doctor', 'test:affected']);
  expect(gateIds(buildLocalAffectedCheckPlan(affectedPlan(
    ['tools/documentation/check_docs.py'],
    ['tests/unit/active-documentation-contract.test.ts']
  )))).toEqual(['docs:doctor', 'test:affected']);
  expect(gateIds(buildLocalAffectedCheckPlan(affectedPlan([
    'docs/unregistered-legacy.md'
  ])))).toEqual(['docs:doctor']);
  expect(gateIds(buildLocalAffectedCheckPlan(affectedPlan([
    'config/repository/active-work-package.md'
  ])))).toEqual([]);
});

test('actual compiler inputs preserve JSON typecheck and reverse selection without widening to adjacent data', async () => {
  await inGitProtocolRepository(async (root, git) => {
    mkdirSync(path.join(root, 'src'));
    mkdirSync(path.join(root, 'examples'));
    mkdirSync(path.join(root, 'tests'));
    writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');
    writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', resolveJsonModule: true },
      include: ['src/**/*.ts', 'tests/**/*.ts']
    }));
    writeFileSync(path.join(root, 'src/value.ts'),
      'import input from "../examples/input.json" with { type: "json" }; export const value = input.value;\n');
    writeFileSync(path.join(root, 'tests/value.test.ts'), 'import { value } from "../src/value.js"; export { value };\n');
    writeFileSync(path.join(root, 'src/global.d.ts'), 'declare const ambientValue: string;\n');
    writeFileSync(path.join(root, 'src/package.json'), '{"type":"module"}\n');
    writeFileSync(path.join(root, 'examples/input.json'), '{"value":1}\n');
    writeFileSync(path.join(root, 'examples/adjacent.json'), '{"other":1}\n');
    gitProtocolSuccess(git(['add', '--all']));
    await withAuthorityGitReadSession({ cwd: root, budget: { deadlineMs: 120_000 } }, async (session) => {
      const snapshot = await acquireWorkingTreeWorkspaceSourceSnapshot({ session });
      const evidence = issueWorkspaceTypeScriptProjectGenerationEvidence(snapshot,
        compileWorkspaceTypeScriptProjectInput(snapshot, 'tsconfig.json'));
      expect(snapshot.moduleGraph.unresolvedFiles).toEqual([]);
      expect(snapshot.moduleGraph.directConsumers('examples/input.json')).toEqual(['src/value.ts']);
      expect(snapshot.moduleGraph.directConsumers('src/value.ts')).toEqual(['tests/value.test.ts']);
      expect(snapshot.moduleGraph.directConsumers('examples/adjacent.json')).toEqual([]);
      expect(gateIds(buildLocalAffectedCheckPlan(affectedPlan(
        ['examples/input.json'], ['tests/value.test.ts']
      ), evidence))).toEqual(['typecheck', 'docs:doctor', 'test:affected']);
      const adjacent = buildLocalAffectedCheckPlan(affectedPlan(['examples/adjacent.json']), evidence);
      expect(gateIds(adjacent)).not.toContain('typecheck');
      expect(adjacent.resolved).toBe(true);

      unlinkSync(path.join(root, 'src/global.d.ts'));
      unlinkSync(path.join(root, 'src/package.json'));
      const ambientDeleted = await acquireWorkingTreeWorkspaceSourceSnapshot({ session });
      const ambientEvidence = issueWorkspaceTypeScriptProjectGenerationEvidence(ambientDeleted,
        compileWorkspaceTypeScriptProjectInput(ambientDeleted, 'tsconfig.json'));
      expect(ambientDeleted.moduleGraph.unresolvedFiles).toEqual([]);
      expect(gateIds(buildLocalAffectedCheckPlan(affectedPlan(
        ['src/global.d.ts']
      ), ambientEvidence))).toContain('typecheck');
      expect(ambientEvidence.projectInput.sourceFacts.some(({ path }) => path === 'src/package.json')).toBe(false);
      expect(ambientEvidence.projectInput.resolutionLookupPaths).toContain('src/package.json');
      expect(gateIds(buildLocalAffectedCheckPlan(affectedPlan(
        ['src/package.json'], ['tests/value.test.ts']
      ), ambientEvidence))).toContain('typecheck');

      unlinkSync(path.join(root, 'examples/input.json'));
      const deleted = await acquireWorkingTreeWorkspaceSourceSnapshot({ session });
      const deletedEvidence = issueWorkspaceTypeScriptProjectGenerationEvidence(deleted,
        compileWorkspaceTypeScriptProjectInput(deleted, 'tsconfig.json'));
      expect(deleted.moduleGraph.directConsumers('examples/input.json')).toEqual(['src/value.ts']);
      expect(deleted.moduleGraph.unresolvedFiles).toContain('src/value.ts');
      const removed = buildLocalAffectedCheckPlan(affectedPlan(
        ['examples/input.json'], ['tests/value.test.ts'], true, deleted.moduleGraph.unresolvedFiles
      ), deletedEvidence);
      expect(gateIds(removed)).toContain('typecheck');
      expect(removed.affectedPlan.selectionTrustBoundary).toBe('unresolved-module-graph');
    });
  });
});

test('documentation classification cannot discard semantic tests or claim unknown compiler inputs are unaffected', () => {
  expect(gateIds(buildLocalAffectedCheckPlan(affectedPlan(
    ['docs/运行/保证/要求证据与裁决.md'], ['tests/unit/work-package-contract.test.ts']
  )))).toEqual(['docs:doctor', 'test:affected']);
  expect(buildLocalAffectedCheckPlan(affectedPlan(['examples/input.json'])).resolved).toBe(false);
});

test('local affected plan preserves unresolved authority and selects no invented broad fallback', () => {
  const plan = buildLocalAffectedCheckPlan(affectedPlan(['assets/unowned.bin'], [], false));

  expect(plan.resolved).toBe(false);
  expect(plan.gates).toEqual([]);
  expect(plan.affectedPlan.unresolvedPaths).toEqual(['assets/unowned.bin']);
});
