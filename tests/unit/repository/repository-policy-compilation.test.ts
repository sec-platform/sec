import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compileRepositoryModuleMembershipSnapshot } from '../../../src/adapters/repository/architecture/contract.ts';
import {
  compileSourceProgramFindingDelta,
  sourceProgramFindingDeltaIsUnresolved
} from '../../../src/adapters/repository/source-program-model/reconciliation-findings.ts';
import {
  assertRepositorySourceProgramCompilationReceipt,
  compileVirtualRepositorySourceProgramCompilation as compile
} from '../../../src/adapters/repository/source-program-model/repository-compilation.ts';
import { compileVirtualWorkspaceSourceSnapshot } from '../../../src/adapters/repository/source-program-model/workspace-source-snapshot.ts';
import { rawSha256, sha256 } from '../../../src/contracts/canonical.ts';

// These integration cases require the actual compiler and virtual snapshot
// issuers. No fixture can stand in for a source model or a compilation receipt.
// Virtual source input does not authorize physical reads, execution or review.
function snapshot(label: string) {
  const sources = {
    'src/example/target.ts': 'export function run() { return 1; }\n',
    'src/example/left.ts': "export function locateLeft() { return 'src/example/target.ts'; }\n",
    'src/example/right.ts': "export function locateRight() { return 'src/example/target.ts'; }\n"
  };
  const files = Object.entries(sources).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([path, source]) => ({ path, source, contentDigest: rawSha256(source) }));
  const descriptorPath = 'src/example/module.json';
  const moduleMembership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles: [...files.map(file => file.path), descriptorPath],
    descriptorSources: [{ descriptorPath, source: JSON.stringify({
      importGraph: 'runtime', externalEntrypoints: [], capabilityProviders: [], preDependencyBootstrap: false
    }) }]
  });
  return compileVirtualWorkspaceSourceSnapshot({ files, moduleMembership,
    subject: { kind: 'virtual-mutation', provenance: { kind: 'source-program-virtual-mutation',
      baseSnapshotDigest: sha256('policy-fixture-base') as `sha256:${string}`,
      mutationDigest: sha256(label) as `sha256:${string}` } }
  });
}
const review = 'src/example/target.ts::function-declaration:run::spawn#1';

test('actual source-path finding suppression remains distinguishable from a source fix', () => {
  const workspaceSnapshot = snapshot('comparison');
  const before = compile({ workspaceSnapshot });
  const after = compile({ workspaceSnapshot, reviewedProcessDispatchers: [review] });
  assertRepositorySourceProgramCompilationReceipt(before);
  assertRepositorySourceProgramCompilationReceipt(after);
  const emptyPolicy = JSON.stringify({ reviewedProcessDispatchers: [], schema: 'sec-repository-analysis-policy-v1' });
  assert.deepEqual(before.analysisPolicy.reviewedProcessDispatchers, []);
  assert.equal(before.analysisPolicy.policyDigest, `sha256:${createHash('sha256').update(emptyPolicy).digest('hex')}`);
  assert.ok(before.model.candidates.some(candidate => candidate.code === 'production-mirrors-source-path'
    && candidate.subject === 'src/example/target.ts'));
  assert.equal(after.model.candidates.some(candidate => candidate.code === 'production-mirrors-source-path'
    && candidate.subject === 'src/example/target.ts'), false);
  const delta = compileSourceProgramFindingDelta(before, after);
  const finding = delta.entries.find(candidate =>
    candidate.code === 'production-mirrors-source-path' && candidate.subject === 'src/example/target.ts');
  assert.equal(finding?.status, 'unobserved');
  assert.equal(delta.contextComparable, false);
  assert.deepEqual(delta.changedContextFields, ['analysisPolicyDigest']);
  assert.equal(delta.counts.absent, 0);
  assert.equal(sourceProgramFindingDeltaIsUnresolved(delta), true);
  assert.equal(before.projectGeneration.generationDigest, after.projectGeneration.generationDigest);
  assert.notEqual(before.analysisPolicy.policyDigest, after.analysisPolicy.policyDigest);
  assert.notEqual(before.receiptDigest, after.receiptDigest);
});

test('equivalent review sets leave actual compiler outputs and receipt identity unchanged', () => {
  const workspaceSnapshot = snapshot('set-equivalence'), other = 'src/example/left.ts::locateLeft';
  const addresses = ['', './src/a.ts::run', 'src\\a.ts::run', 'arbitrary-observation'];
  const reviewedProcessDispatchers = [review, other, ...addresses];
  const before = compile({ workspaceSnapshot, reviewedProcessDispatchers });
  const after = compile({ workspaceSnapshot, reviewedProcessDispatchers: [...addresses, other, review, review] });
  reviewedProcessDispatchers.length = 0;
  assert.deepEqual(before.analysisPolicy.reviewedProcessDispatchers, [
    '', './src/a.ts::run', 'arbitrary-observation', other, review, 'src\\a.ts::run'
  ]);
  assert.equal(before.model.modelDigest, after.model.modelDigest);
  assert.equal(before.receiptDigest, after.receiptDigest);
  assert.equal(compileSourceProgramFindingDelta(before, after).contextComparable, true);
  assertRepositorySourceProgramCompilationReceipt(before);
  assert.ok(Object.isFrozen(before.analysisPolicy));
  assert.throws(() => (before.analysisPolicy.reviewedProcessDispatchers as string[]).push('other'), TypeError);
});
