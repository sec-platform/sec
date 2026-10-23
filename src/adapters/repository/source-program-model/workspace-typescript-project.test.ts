import { expect, test } from 'bun:test';
import ts from 'typescript';
import { rawSha256 } from '../../../contracts/canonical.ts';
import {
  compileVirtualWorkspaceSourceSnapshot,
  compileWorkspaceTypeScriptProjectInput
} from './workspace-source-snapshot.ts';
import assert from 'node:assert/strict';
import { compileVirtualSnapshot } from './workspace-source-authority.ts';
import {
  compileTypeScriptProjectFactIdentity,
  compileTypeScriptProjectInput,
  projectTypeScriptProjectFactIdentity
} from './workspace-typescript-project.ts';

function projectInput(config: Readonly<Record<string, unknown>>, source = 'export const value = 1;\n') {
  const sources = Object.freeze({
    'src/value.ts': source,
    'tsconfig.json': `${JSON.stringify(config, null, 2)}\n`
  });
  const snapshot = compileVirtualWorkspaceSourceSnapshot({
    subject: Object.freeze({
      kind: 'virtual-mutation' as const,
      provenance: Object.freeze({
        kind: 'source-program-virtual-mutation' as const,
        baseSnapshotDigest: rawSha256('typescript-execution-containment-base'),
        mutationDigest: rawSha256(JSON.stringify(sources))
      })
    }),
    files: Object.entries(sources).map(([path, fileSource]) => Object.freeze({
      path,
      source: fileSource,
      contentDigest: rawSha256(fileSource)
    })),
    moduleMembership: Object.freeze({
      descriptors: Object.freeze([]),
      graphRoots: Object.freeze([]),
      moduleRoots: Object.freeze([]),
      moduleForPath: () => null
    })
  });
  return Object.freeze({
    input: compileWorkspaceTypeScriptProjectInput(snapshot, 'tsconfig.json'),
    snapshot
  });
}

test('ProjectInput signs one exact execution-config containment receipt', () => {
  const config = Object.freeze({
    compilerOptions: Object.freeze({ strict: true }),
    include: Object.freeze(['src/**/*.ts'])
  });
  const first = projectInput(config);
  const equivalent = projectInput(config);
  const changedConfig = projectInput(Object.freeze({
    compilerOptions: Object.freeze({ strict: false }),
    include: Object.freeze(['src/**/*.ts'])
  }));
  const changedClosure = projectInput(config, 'export const value = 2;\n');

  expect(first.input.executionConfigContainment).toMatchObject({
    status: 'contained',
    compilerRevision: ts.version,
    projectConfigPath: 'tsconfig.json',
    projectConfigDigest: first.snapshot.file('tsconfig.json')?.contentDigest,
    workspaceSnapshotIdentityDigest: first.snapshot.identityDigest
  });
  expect(equivalent.input.executionConfigContainment).toEqual(first.input.executionConfigContainment);
  expect(changedConfig.input.executionConfigContainment.containmentDigest)
    .not.toBe(first.input.executionConfigContainment.containmentDigest);
  expect(changedClosure.input.executionConfigContainment.resolvedConfigDigest)
    .not.toBe(first.input.executionConfigContainment.resolvedConfigDigest);
  expect(changedClosure.input.projectInputDigest).not.toBe(first.input.projectInputDigest);
});

test('ProjectInput rejects every configuration escape before execution materialization', () => {
  const escapedConfigurations = Object.freeze([
    Object.freeze({ extends: './base.json', include: Object.freeze(['src/**/*.ts']) }),
    Object.freeze({ references: Object.freeze([]), include: Object.freeze(['src/**/*.ts']) }),
    Object.freeze({
      compilerOptions: Object.freeze({ plugins: Object.freeze([]) }),
      include: Object.freeze(['src/**/*.ts'])
    }),
    Object.freeze({ include: Object.freeze(['../foreign/**/*.ts']) }),
    Object.freeze({ files: Object.freeze(['/absolute.ts']) }),
    Object.freeze({ exclude: Object.freeze(['bad\u0000path']) }),
    Object.freeze({
      compilerOptions: Object.freeze({ rootDirs: Object.freeze(['src', '../foreign']) }),
      include: Object.freeze(['src/**/*.ts'])
    }),
    Object.freeze({
      compilerOptions: Object.freeze({ paths: Object.freeze({ '@/*': Object.freeze(['../foreign/*']) }) }),
      include: Object.freeze(['src/**/*.ts'])
    })
  ]);

  for (const config of escapedConfigurations) {
    expect(() => projectInput(config)).toThrow(/TypeScript ProjectInput/u);
  }
});

/** 同一公开配置必须使 admission 与真实 Program 取得相同的仓库源闭包。 */
test('nested JSONC project admission and Program agree on directory roots and transitive excluded imports', () => {
  const sources = {
    'src/wrong-root.ts': 'export const wrongRoot = true;',
    'packages/a/src/a.ts': 'import { value } from "./excluded/dependency"; export { value };',
    'packages/a/src/excluded/dependency.ts': 'export const value = 1;',
    'packages/a/src/excluded/not-imported.ts': 'export const unused = true;',
    'packages/a/tsconfig.json': `{ // JSONC comments and trailing commas are valid project input.
      "compilerOptions": { "noLib": true, "types": [], "strict": true, },
      "include": ["src"], "exclude": ["src/excluded"],
    }`
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
