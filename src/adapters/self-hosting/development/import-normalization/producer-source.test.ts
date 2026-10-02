import { expect, test } from 'bun:test';

import { rawSha256, sha256 } from '../../../../contracts/canonical.ts';
import { compileSecRepositoryModuleMembershipSnapshot } from '../../../repository/architecture/contract.ts';
import { requireSourceProgramOperationProducerClosure } from '../../../repository/source-program-model/producer-closure.ts';
import { compileVirtualWorkspaceSourceSnapshot } from '../../../repository/source-program-model/workspace-source-snapshot.ts';
import { compileCandidateNormalizationProducer, IMPORT_NORMALIZATION_OPERATION } from './contract.ts';
import { checkImmutableImportSnapshot } from './kernel.ts';

const root = 'src/adapters/self-hosting/development/import-normalization';

function sourceSnapshot(implementation: string) {
  const descriptor = JSON.stringify({
    importGraph: 'runtime', externalEntrypoints: [`${root}/runtime.ts`],
    capabilityProviders: [{ capability: IMPORT_NORMALIZATION_OPERATION.capability, operations: [IMPORT_NORMALIZATION_OPERATION.operation] }]
  });
  const sources = new Map([
    [`${root}/module.json`, descriptor],
    [`${root}/runtime.ts`, "export { normalize as verifyCandidateImportNormalization } from './kernel.ts';\n"],
    [`${root}/kernel.ts`, implementation],
    ['tsconfig.json', '{"compilerOptions":{"noEmit":true}}\n']
  ]);
  const files = [...sources].map(([path, source]) => ({ path, source, mode: '100644' as const, contentDigest: rawSha256(source) }));
  return compileVirtualWorkspaceSourceSnapshot({
    subject: { kind: 'virtual-mutation', provenance: {
      kind: 'source-program-virtual-mutation', baseSnapshotDigest: sha256('base'), mutationDigest: sha256(files)
    } },
    files,
    moduleMembership: compileSecRepositoryModuleMembershipSnapshot({
      repositoryFiles: files.map(({ path }) => path),
      descriptorSources: [{ descriptorPath: `${root}/module.json`, source: descriptor }]
    })
  });
}

test('normalization producer evidence comes from the selected tool source, independently of candidate bytes', () => {
  const tool = sourceSnapshot('export function normalize(): void {}\n');
  const candidate = sourceSnapshot('throw new Error("candidate runtime must never execute");\nexport function normalize(): void {}\n');
  const producer = compileCandidateNormalizationProducer(tool);
  expect(requireSourceProgramOperationProducerClosure(producer)).toBe(producer);
  expect(producer.authority).toBe('source-evidence-only');
  expect(producer.closureDigest).not.toBe(compileCandidateNormalizationProducer(candidate).closureDigest);
  expect(producer.implementationFiles.some(({ source }) => source.includes('candidate runtime'))).toBe(false);
  const files = candidate.files.map(({ path, source, contentDigest }) => ({
    relativePath: path, source, contentDigest: contentDigest as `sha256:${string}`
  }));
  expect(checkImmutableImportSnapshot({
    projectRoot: '/immutable-candidate', files,
    targetPaths: [`${root}/kernel.ts`],
    expectedInputClosure: files.map(({ relativePath, contentDigest }) => ({ path: relativePath, digest: contentDigest }))
  }).status).toBe('canonical');
  expect(() => requireSourceProgramOperationProducerClosure({ ...producer })).toThrow('not Source Program compiler-issued');
});
