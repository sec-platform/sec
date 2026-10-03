import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { rawSha256 } from '../../../contracts/canonical.ts';
import { compileVirtualSnapshot } from './workspace-source-authority.ts';
import { compileTypeScriptProjectFactIdentity, compileTypeScriptProjectInput, projectTypeScriptProjectFactIdentity } from './workspace-typescript-project.ts';

/** 同一公开配置必须使 admission 与真实 Program 取得相同的仓库源闭包。 */
test('nested project admission and Program agree on directory roots and transitive excluded imports', () => {
  const sources = {
    'src/wrong-root.ts': 'export const wrongRoot = true;',
    'packages/a/src/a.ts': 'import { value } from "./excluded/dependency"; export { value };',
    'packages/a/src/excluded/dependency.ts': 'export const value = 1;',
    'packages/a/src/excluded/not-imported.ts': 'export const unused = true;',
    'packages/a/tsconfig.json': JSON.stringify({
      compilerOptions: { noLib: true, types: [], strict: true },
      include: ['src'], exclude: ['src/excluded']
    })
  };
  const snapshot = compileVirtualSnapshot({
    subject: { kind: 'virtual-mutation', provenance: {
      kind: 'source-program-virtual-mutation', baseSnapshotDigest: rawSha256('project-root-base'),
      mutationDigest: rawSha256(JSON.stringify(sources))
    } },
    files: Object.entries(sources).map(([path, source]) => ({ path, source, contentDigest: rawSha256(source) })),
    moduleMembership: { descriptors: [], graphRoots: [], moduleRoots: [], moduleForPath: () => null }
  });
  const admission = compileTypeScriptProjectFactIdentity(snapshot, 'packages/a/tsconfig.json', { dependencyGenerationDigest: null });
  const input = compileTypeScriptProjectInput(snapshot, 'packages/a/tsconfig.json');
  assert.deepEqual(admission.rootSourceFacts.map(file => file.path), [
    'packages/a/src/a.ts', 'packages/a/src/excluded/dependency.ts'
  ]);
  assert.deepEqual(projectTypeScriptProjectFactIdentity(input), admission);
});
