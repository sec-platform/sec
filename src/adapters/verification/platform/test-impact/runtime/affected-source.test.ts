import { expect, test } from 'bun:test';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { gitProtocolSuccess, inGitProtocolRepository } from '../../../../../../tests/testkit/git-protocol.ts';
import { AUTHOR_KERNEL_GRAMMAR_MANIFEST } from '../../../../../contracts/author-kernel-verification.ts';
import { withAuthorityGitReadSession } from '../../../../providers/git-read/authority.ts';
import { createSourceProgramCompilationOperation } from '../../../../repository/source-program-model/compilation-operation.ts';
import { issueAffectedTestImpactSource, readIssuedAffectedTestImpactBinding } from './affected-source.ts';
import { createRepositoryTestImpactSourceProvider, resolveTestOwnership, testImpactNativeDeclarationUnresolvedInputs } from './impact.ts';

const retiredInput = 'native-resources/old-schema.ts';
function manifest(paths: readonly string[]): string {
  return JSON.stringify({ schema: 'gift.design-codec-parameters/2', scope: 'complete-candidate-structure-only',
    resources: [], externals: paths.map(resourcePath => ({ path: resourcePath })), extensions: [] });
}

test('removed native declarations retain their original consumer through the issued working-tree Git binding', async () => {
  await inGitProtocolRepository(async (root, git) => {
    const write = (repositoryPath: string, source: string) => {
      const target = path.join(root, ...repositoryPath.split('/'));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, source, 'utf8');
    };
    write('tsconfig.json', JSON.stringify({ compilerOptions: { noEmit: true, strict: true }, include: ['src/**/*.ts'] }));
    write('src/adapters/compilation/module.json', JSON.stringify({ importGraph: 'runtime', externalEntrypoints: [] }));
    write('src/adapters/compilation/fixture.ts', 'export const fixture = true;');
    write('crates/gift-author-kernel/Cargo.toml', '[package]\nname="fixture"\nversion="0.0.0"\n');
    write(AUTHOR_KERNEL_GRAMMAR_MANIFEST, manifest([retiredInput]));
    write(retiredInput, 'export const oldSchema = true;');
    gitProtocolSuccess(git(['add', '--all']));
    gitProtocolSuccess(git(['commit', '--quiet', '-m', 'native declaration source']));
    const baseSha = gitProtocolSuccess(git(['rev-parse', 'HEAD'])).trim();
    write(AUTHOR_KERNEL_GRAMMAR_MANIFEST, manifest([]));
    unlinkSync(path.join(root, ...retiredInput.split('/')));
    gitProtocolSuccess(git(['add', '--all']));

    const observe = async (baseRef: string | null) => withAuthorityGitReadSession({
      cwd: root, budget: { deadlineMs: 120_000 }
    }, session => issueAffectedTestImpactSource({
      session, baseRef, repositoryRoot: root,
      compilationOperation: createSourceProgramCompilationOperation({ deadlineAtUnixMs: Date.now() + 120_000 })
    }));
    const check = (source: Awaited<ReturnType<typeof observe>>) => {
      expect(source).not.toBeNull();
      if (source === null) throw new Error('Expected physical affected source.');
      const binding = readIssuedAffectedTestImpactBinding(source);
      expect(binding?.priorNativeDeclarationPaths).toContain(retiredInput);
      expect(binding?.nativeDeclarationUnresolvedInputs).toEqual([]);
      expect(source.projection.nativeDeclarationPaths).not.toContain(retiredInput);
      const provider = createRepositoryTestImpactSourceProvider({
        projection: source.projection, testInventory: source.testInventory,
        activeDocumentationPaths: [], affectedSource: source
      });
      expect(resolveTestOwnership([retiredInput], provider).map(({ identity }) => identity.id)).toContain('adapters.compilation');
      expect(testImpactNativeDeclarationUnresolvedInputs(provider)).toEqual([]);
      // A caller-created copy cannot supply the historical declaration capability.
      expect(readIssuedAffectedTestImpactBinding({ ...source })).toBeNull();
    };
    const working = await observe(null);
    expect(working === null ? undefined : readIssuedAffectedTestImpactBinding(working)?.transition).toBeNull();
    check(working);
    gitProtocolSuccess(git(['commit', '--quiet', '-m', 'retire native declaration']));
    check(await observe(baseSha));
  });
}, 120_000);
