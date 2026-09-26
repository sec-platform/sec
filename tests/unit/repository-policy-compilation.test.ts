import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { compileRepositoryModuleMembershipSnapshot } from '../../src/adapters/repository/architecture/contract.ts';
import { compileSourceProgramFindingDelta } from '../../src/adapters/repository/source-program-model/reconciliation-findings.ts';
import {
  assertRepositorySourceProgramCompilationReceipt,
  compileVirtualRepositorySourceProgramCompilation as compile
} from '../../src/adapters/repository/source-program-model/repository-compilation.ts';
import { compileVirtualSnapshot } from '../../src/adapters/repository/source-program-model/workspace-source-snapshot.ts';
import { rawSha256, sha256 } from '../../src/contracts/canonical.ts';

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
  return compileVirtualSnapshot({ files, moduleMembership,
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
  assert.ok(before.model.candidates.some(candidate => candidate.code === 'production-mirrors-source-path'
    && candidate.subject === 'src/example/target.ts'));
  assert.equal(after.model.candidates.some(candidate => candidate.code === 'production-mirrors-source-path'
    && candidate.subject === 'src/example/target.ts'), false);
  const finding = compileSourceProgramFindingDelta(before, after).entries.find(candidate =>
    candidate.code === 'production-mirrors-source-path' && candidate.subject === 'src/example/target.ts');
  assert.equal(finding?.status, 'unobserved');
  assert.equal(before.projectGeneration.generationDigest, after.projectGeneration.generationDigest);
  assert.notEqual(before.analysisPolicy.policyDigest, after.analysisPolicy.policyDigest);
  assert.notEqual(before.receiptDigest, after.receiptDigest);
});

test('equivalent review sets leave actual compiler outputs and receipt identity unchanged', () => {
  const workspaceSnapshot = snapshot('set-equivalence'), other = 'src/example/left.ts::locateLeft';
  const before = compile({ workspaceSnapshot, reviewedProcessDispatchers: [review, other] });
  const after = compile({ workspaceSnapshot, reviewedProcessDispatchers: [other, review, review] });
  assert.equal(before.model.modelDigest, after.model.modelDigest);
  assert.equal(before.receiptDigest, after.receiptDigest);
  assert.equal(compileSourceProgramFindingDelta(before, after).contextComparable, true);
});

test('a compiled receipt and its policy are detached from the caller review list', () => {
  const workspaceSnapshot = snapshot('caller-change'), reviewedProcessDispatchers = [review];
  const receipt = compile({ workspaceSnapshot, reviewedProcessDispatchers });
  const identity = receipt.receiptDigest;
  reviewedProcessDispatchers.length = 0;
  assert.deepEqual(receipt.analysisPolicy.reviewedProcessDispatchers, [review]);
  assert.equal(receipt.receiptDigest, identity);
  assertRepositorySourceProgramCompilationReceipt(receipt);
  assert.throws(() => (receipt.analysisPolicy.reviewedProcessDispatchers as string[]).push('other'), TypeError);
});

test('the virtual entrypoint validates and compiles the same single snapshot observation', () => {
  const first = snapshot('first'), second = snapshot('second'); let reads = 0;
  const receipt = compile({ get workspaceSnapshot() { return ++reads === 1 ? first : second; } });
  assert.equal(reads, 1);
  assert.equal(receipt.workspaceSnapshot, first);
  assertRepositorySourceProgramCompilationReceipt(receipt);
});
