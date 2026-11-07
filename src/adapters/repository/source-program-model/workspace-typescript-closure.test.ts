import { expect, test } from 'bun:test';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gitProtocolSuccess, inGitProtocolRepository } from '../../../../tests/testkit/git-protocol.ts';
import { rawSha256 } from '../../../contracts/canonical.ts';
import { withAuthorityGitReadSession } from '../../providers/git-read/authority.ts';
import {
  acquireExactGitTreeSnapshot, acquireExactGitTreeSnapshotFromSession,
  acquireStagedIndexSnapshot, acquireWorkingTreeSnapshot, compileVirtualSnapshot
} from './workspace-source-authority.ts';
import { TypeScriptDeclaredInputConfigurationError } from './workspace-typescript-closure.ts';
import {
  compileTypeScriptProjectFactIdentity, compileTypeScriptProjectInput,
  issueTypeScriptProjectGenerationEvidence, projectTypeScriptProjectFactIdentity
} from './workspace-typescript-project.ts';

test('declared repository JSON is the same captured input in working, index and exact-tree projects', async () => {
  await inGitProtocolRepository(async (root, git) => {
    mkdirSync(path.join(root, 'src'));
    mkdirSync(path.join(root, 'examples'));
    writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');
    writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', resolveJsonModule: true },
      include: ['src/**/*.ts']
    }));
    writeFileSync(path.join(root, 'src/value.ts'),
      'import input from "../examples/input.json" with { type: "json" }; export const value = input.value;\n');
    writeFileSync(path.join(root, 'examples/input.json'), '{"value":1}\n');
    writeFileSync(path.join(root, 'examples/unrelated.json'), '{"unrelated":1}\n');
    gitProtocolSuccess(git(['add', '--all']));
    gitProtocolSuccess(git(['commit', '--quiet', '-m', 'declared input fixture']));
    const commitSha = gitProtocolSuccess(git(['rev-parse', 'HEAD'])).trim();
    await withAuthorityGitReadSession({ cwd: root, budget: { deadlineMs: 120_000 } }, async (session) => {
      const working = await acquireWorkingTreeSnapshot({ session });
      const snapshots = [
        working,
        await acquireStagedIndexSnapshot({ session }),
        acquireExactGitTreeSnapshot({ repositoryRoot: root, commitSha }),
        await acquireExactGitTreeSnapshotFromSession({ session, commitSha })
      ];
      const projectInputs = snapshots.map((snapshot) => {
        expect(snapshot.file('examples/input.json')?.source).toBe('{"value":1}\n');
        expect(snapshot.file('examples/unrelated.json')).toBeNull();
        const project = compileTypeScriptProjectInput(snapshot, 'tsconfig.json');
        expect(project.sourceFacts.some(({ path }) => path === 'examples/input.json')).toBe(true);
        expect(project.sourceFacts.some(({ path }) => path === 'package.json')).toBe(true);
        expect(compileTypeScriptProjectFactIdentity(snapshot, 'tsconfig.json', {
          dependencyGenerationDigest: null
        })).toEqual(projectTypeScriptProjectFactIdentity(project));
        return project;
      });
      expect(new Set(projectInputs.map(({ projectInputDigest }) => projectInputDigest)).size).toBe(1);
      expect(issueTypeScriptProjectGenerationEvidence(working, projectInputs[0]!).sourceFiles
        .some(({ path }) => path === 'examples/input.json')).toBe(true);

      writeFileSync(path.join(root, 'examples/unrelated.json'), '{"unrelated":2}\n');
      const unrelated = await acquireWorkingTreeSnapshot({ session });
      expect(compileTypeScriptProjectInput(unrelated, 'tsconfig.json').projectInputDigest)
        .toBe(projectInputs[0]!.projectInputDigest);

      writeFileSync(path.join(root, 'examples/input.json'), '{"value":2}\n');
      const changed = await acquireWorkingTreeSnapshot({ session });
      expect(compileTypeScriptProjectInput(changed, 'tsconfig.json').projectInputDigest)
        .not.toBe(projectInputs[0]!.projectInputDigest);
      expect(compileTypeScriptProjectFactIdentity(changed, 'tsconfig.json', {
        dependencyGenerationDigest: null
      }).projectFactDigest).not.toBe(projectTypeScriptProjectFactIdentity(projectInputs[0]!).projectFactDigest);
    });
    await withAuthorityGitReadSession({ cwd: root, budget: { deadlineMs: 120_000 } }, async (session) => {
      expect((await acquireStagedIndexSnapshot({ session })).file('examples/input.json')?.source)
        .toBe('{"value":1}\n');
    });
  });
});

test('declared inputs cannot use an ignored host file, an escaping import or a Git link blob', async () => {
  await inGitProtocolRepository(async (root, git) => {
    mkdirSync(path.join(root, 'src'));
    mkdirSync(path.join(root, 'examples'));
    writeFileSync(path.join(root, 'tsconfig.json'),
      '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","resolveJsonModule":true},"include":["src/**/*.ts"]}\n');
    writeFileSync(path.join(root, '.gitignore'), 'examples/input.json\n');
    writeFileSync(path.join(root, 'examples/input.json'), '{"secret":"host-only"}\n');
    writeFileSync(path.join(root, 'src/value.ts'), 'import input from "../examples/input.json"; export { input };\n');
    gitProtocolSuccess(git(['add', '--all']));
    await withAuthorityGitReadSession({ cwd: root, budget: { deadlineMs: 120_000 } }, async (session) => {
      const missing = await acquireWorkingTreeSnapshot({ session });
      expect(missing.file('examples/input.json')).toBeNull();
      expect(compileTypeScriptProjectInput(missing, 'tsconfig.json').sourceFacts
        .some(({ path }) => path === 'examples/input.json')).toBe(false);

      writeFileSync(path.join(root, 'src/value.ts'), 'import input from "../../outside.json"; export { input };\n');
      await expect(acquireWorkingTreeSnapshot({ session })).rejects.toThrow('escapes its snapshot');
      writeFileSync(path.join(root, 'src/value.ts'), 'import input from "../examples/input.json"; export { input };\n');
      gitProtocolSuccess(git(['add', 'src/value.ts']));
      const blob = gitProtocolSuccess(git(['hash-object', '-w', '--stdin'], undefined, 'elsewhere.json')).trim();
      gitProtocolSuccess(git(['update-index', '--add', '--cacheinfo', `120000,${blob},examples/input.json`]));
      await expect(acquireStagedIndexSnapshot({ session })).rejects.toThrow('not one ordinary blob');
      gitProtocolSuccess(git(['commit', '--quiet', '-m', 'link input fixture']));
      const commitSha = gitProtocolSuccess(git(['rev-parse', 'HEAD'])).trim();
      await expect(acquireExactGitTreeSnapshotFromSession({ session, commitSha }))
        .rejects.toThrow('not one ordinary blob');
    });
    // A tracked ordinary leaf beneath a substituted directory must not become
    // admitted merely because path-following lstat sees an ordinary file.
    gitProtocolSuccess(git(['rm', '--cached', 'examples/input.json']));
    mkdirSync(path.join(root, 'examples/nested'));
    mkdirSync(path.join(root, 'outside'));
    writeFileSync(path.join(root, 'examples/nested/input.json'), '{"value":1}\n');
    writeFileSync(path.join(root, 'outside/input.json'), '{"value":2}\n');
    writeFileSync(path.join(root, 'src/value.ts'), 'import input from "../examples/nested/input.json"; export { input };\n');
    gitProtocolSuccess(git(['add', 'src/value.ts', 'examples/nested/input.json']));
    rmSync(path.join(root, 'examples/nested'), { recursive: true });
    symlinkSync(path.join(root, 'outside'), path.join(root, 'examples/nested'), 'junction');
    await withAuthorityGitReadSession({ cwd: root, budget: { deadlineMs: 120_000 } }, async (session) => {
      await expect(acquireWorkingTreeSnapshot({ session })).rejects.toThrow();
    });
  });
});

test('declared file assets retain actual bytes beside type views without parsing asset code', async () => {
  await inGitProtocolRepository(async (root, git) => {
    mkdirSync(path.join(root, 'src'));
    mkdirSync(path.join(root, 'examples'));
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      type: 'module', imports: { '#text': './examples/payload.txt' }
    }));
    writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', allowJs: false, resolveJsonModule: true },
      files: ['src/main.ts']
    }));
    writeFileSync(path.join(root, 'src/main.ts'), [
      "import resource from '../examples/program.mjs' with { type: 'file' };",
      "void import('#text', { with: { type: 'file' } });",
      'export const resourcePath = resource;'
    ].join('\n'));
    writeFileSync(path.join(root, 'examples/program.d.mts'), 'declare const resource: string; export default resource;');
    const assetSource = "import hidden from './hidden.json'; throw new Error(hidden);";
    writeFileSync(path.join(root, 'examples/program.mjs'), assetSource);
    writeFileSync(path.join(root, 'examples/hidden.json'), '"must not be acquired through file loading"');
    writeFileSync(path.join(root, 'examples/payload.txt'), 'exact asset bytes');
    gitProtocolSuccess(git(['add', '--all']));
    gitProtocolSuccess(git(['commit', '--quiet', '-m', 'file asset input fixture']));
    const commitSha = gitProtocolSuccess(git(['rev-parse', 'HEAD'])).trim();
    await withAuthorityGitReadSession({ cwd: root, budget: { deadlineMs: 120_000 } }, async (session) => {
      const snapshots = [
        await acquireWorkingTreeSnapshot({ session }),
        await acquireStagedIndexSnapshot({ session }),
        acquireExactGitTreeSnapshot({ repositoryRoot: root, commitSha }),
        await acquireExactGitTreeSnapshotFromSession({ session, commitSha })
      ];
      for (const snapshot of snapshots) {
        expect(snapshot.file('examples/program.mjs')?.source).toBe(assetSource);
        expect(snapshot.file('examples/program.d.mts')?.source).toContain('string');
        expect(snapshot.file('examples/payload.txt')?.source).toBe('exact asset bytes');
        expect(snapshot.file('examples/hidden.json')).toBeNull();
        expect(snapshot.moduleGraph.directRuntimeDependencies('src/main.ts')).toEqual([]);
        expect(snapshot.moduleGraph.references.find(({ from, specifier }) => from === 'src/main.ts'
          && specifier === '../examples/program.mjs')?.runtime)
          .toEqual({ kind: 'asset', target: 'examples/program.mjs' });
        const admitted = compileTypeScriptProjectFactIdentity(snapshot, 'tsconfig.json', { dependencyGenerationDigest: null });
        const project = compileTypeScriptProjectInput(snapshot, 'tsconfig.json');
        expect(projectTypeScriptProjectFactIdentity(project)).toEqual(admitted);
        expect(project.sourceFacts.find(({ path }) => path === 'examples/program.mjs')?.contentDigest)
          .toBe(rawSha256(assetSource));
        expect(project.sourceFacts.some(({ path }) => path === 'examples/hidden.json')).toBe(false);
      }
      const originalProject = compileTypeScriptProjectInput(snapshots[0]!, 'tsconfig.json');
      const evidence = issueTypeScriptProjectGenerationEvidence(snapshots[0]!, originalProject);
      expect(evidence.sourceFiles.find(({ path }) => path === 'examples/program.mjs')?.source).toBe(assetSource);
      const changedAsset = assetSource.replace('Error', 'Other');
      expect(Buffer.byteLength(changedAsset)).toBe(Buffer.byteLength(assetSource));
      writeFileSync(path.join(root, 'examples/program.mjs'), changedAsset);
      writeFileSync(path.join(root, 'examples/payload.txt'), 'other asset bytes');
      const changed = await acquireWorkingTreeSnapshot({ session });
      expect(changed.sourceRevision).not.toBe(snapshots[0]!.sourceRevision);
      expect(changed.file('examples/payload.txt')?.source).toBe('other asset bytes');
      const changedAdmitted = compileTypeScriptProjectFactIdentity(changed, 'tsconfig.json', { dependencyGenerationDigest: null });
      const changedProject = compileTypeScriptProjectInput(changed, 'tsconfig.json');
      expect(projectTypeScriptProjectFactIdentity(changedProject)).toEqual(changedAdmitted);
      expect(changedAdmitted.projectFactDigest).not.toBe(projectTypeScriptProjectFactIdentity(originalProject).projectFactDigest);
      expect(changedProject.sourceFacts.find(({ path }) => path === 'examples/program.mjs')?.contentDigest)
        .toBe(rawSha256(changedAsset));
      expect(changedProject.sourceFacts.find(({ path }) => path === 'examples/program.d.mts')?.contentDigest)
        .toBe(originalProject.sourceFacts.find(({ path }) => path === 'examples/program.d.mts')?.contentDigest);
      expect(changedProject.sourceFacts.some(({ path }) => path === 'examples/hidden.json')).toBe(false);
      const replayedOriginal = compileTypeScriptProjectInput(snapshots[0]!, 'tsconfig.json');
      expect(projectTypeScriptProjectFactIdentity(replayedOriginal))
        .toEqual(projectTypeScriptProjectFactIdentity(originalProject));
      expect(issueTypeScriptProjectGenerationEvidence(snapshots[0]!, replayedOriginal).sourceFiles
        .find(({ path }) => path === 'examples/program.mjs')?.source).toBe(assetSource);
    });
  });
});

test('one snapshot keeps config and dependency fact keys distinct when callers switch back', () => {
  const sources = {
    'tsconfig.json': JSON.stringify({ compilerOptions: { noLib: true, types: [] }, files: ['src/left.ts'] }),
    'tsconfig.right.json': JSON.stringify({ compilerOptions: { noLib: true, types: [] }, files: ['src/right.ts'] }),
    'src/left.ts': 'export const side = "left";\n',
    'src/right.ts': 'export const side = "right";\n'
  };
  const snapshot = compileVirtualSnapshot({
    subject: { kind: 'virtual-mutation', provenance: { kind: 'source-program-virtual-mutation',
      baseSnapshotDigest: rawSha256('fact-key-base'), mutationDigest: rawSha256(JSON.stringify(sources)) } },
    files: Object.entries(sources).map(([path, source]) => ({ path, source, contentDigest: rawSha256(source) })),
    moduleMembership: { descriptors: [], graphRoots: [], moduleRoots: [], moduleForPath: () => null }
  });
  const left = compileTypeScriptProjectFactIdentity(snapshot, 'tsconfig.json', { dependencyGenerationDigest: null });
  const right = compileTypeScriptProjectFactIdentity(snapshot, 'tsconfig.right.json', { dependencyGenerationDigest: null });
  expect(left.rootSourceFacts.map(({ path }) => path)).toEqual(['src/left.ts']);
  expect(right.rootSourceFacts.map(({ path }) => path)).toEqual(['src/right.ts']);
  expect(projectTypeScriptProjectFactIdentity(compileTypeScriptProjectInput(snapshot, 'tsconfig.json'))).toEqual(left);
  expect(projectTypeScriptProjectFactIdentity(compileTypeScriptProjectInput(snapshot, 'tsconfig.right.json'))).toEqual(right);
  const firstDependency = compileTypeScriptProjectFactIdentity(snapshot, 'tsconfig.json', { dependencyGenerationDigest: rawSha256('dependency-one') });
  const secondDependency = compileTypeScriptProjectFactIdentity(snapshot, 'tsconfig.json', { dependencyGenerationDigest: rawSha256('dependency-two') });
  expect(firstDependency.projectFactDigest).not.toBe(secondDependency.projectFactDigest);
  expect(firstDependency.projectFactDigest).not.toBe(left.projectFactDigest);
  expect(secondDependency.rootSourceFacts).toEqual(left.rootSourceFacts);
  expect(compileTypeScriptProjectFactIdentity(snapshot, 'tsconfig.json', { dependencyGenerationDigest: rawSha256('dependency-one') })).toEqual(firstDependency);
  expect(projectTypeScriptProjectFactIdentity(compileTypeScriptProjectInput(snapshot, 'tsconfig.json'))).toEqual(left);
});

test('invalid TypeScript config preserves raw repository observations but cannot issue compiler facts', async () => {
  await inGitProtocolRepository(async (root, git) => {
    mkdirSync(path.join(root, 'src'));
    writeFileSync(path.join(root, 'src/value.ts'), 'export const value = 1;\n');
    await withAuthorityGitReadSession({ cwd: root, budget: { deadlineMs: 120_000 } }, async (session) => {
      for (const config of [
        '{"extends":"../external.json"}\n',
        '{"compilerOptions":{"module":"not-a-module"}}\n'
      ]) {
        writeFileSync(path.join(root, 'tsconfig.json'), config);
        const snapshot = await acquireWorkingTreeSnapshot({ session });
        expect(snapshot.file('tsconfig.json')?.source).toBe(config);
        expect(snapshot.file('src/value.ts')?.source).toBe('export const value = 1;\n');
        expect(() => compileTypeScriptProjectFactIdentity(snapshot, 'tsconfig.json', {
          dependencyGenerationDigest: null
        })).toThrow(TypeScriptDeclaredInputConfigurationError);
        expect(() => compileTypeScriptProjectInput(snapshot, 'tsconfig.json')).toThrow();
      }
      gitProtocolSuccess(git(['add', '--all']));
      gitProtocolSuccess(git(['commit', '--quiet', '-m', 'raw invalid config fixture']));
      const commitSha = gitProtocolSuccess(git(['rev-parse', 'HEAD'])).trim();
      for (const snapshot of [
        await acquireStagedIndexSnapshot({ session }),
        await acquireExactGitTreeSnapshotFromSession({ session, commitSha })
      ]) {
        expect(snapshot.file('src/value.ts')?.source).toBe('export const value = 1;\n');
        expect(() => compileTypeScriptProjectFactIdentity(snapshot, 'tsconfig.json', {
          dependencyGenerationDigest: null
        })).toThrow(TypeScriptDeclaredInputConfigurationError);
      }
    });
  });
});
