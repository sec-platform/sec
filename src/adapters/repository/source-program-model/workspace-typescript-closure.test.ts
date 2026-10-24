import { expect, test } from 'bun:test';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gitProtocolSuccess, inGitProtocolRepository } from '../../../../tests/testkit/git-protocol.ts';
import { withAuthorityGitReadSession } from '../../providers/git-read/authority.ts';
import {
  acquireExactGitTreeSnapshot, acquireExactGitTreeSnapshotFromSession,
  acquireStagedIndexSnapshot, acquireWorkingTreeSnapshot
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
    gitProtocolSuccess(git(['update-index', '--chmod=+x', 'src/value.ts']));
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
      const exact = snapshots[3]!;
      expect(working.subjectDigest).not.toBe(exact.subjectDigest);
      expect(working.physicalObservationReceipt?.kind).toBe('working-tree-observation');
      expect(exact.physicalObservationReceipt).toMatchObject({ kind: 'git-tree', commitSha });
      const projectInputs = snapshots.map((snapshot) => {
        expect(() => snapshot.assertMatches({ sourceRevision: snapshot.sourceRevision,
          files: snapshot.files, moduleMembership: snapshot.moduleMembership })).not.toThrow();
        expect(snapshot.sourceRevision).toBe(exact.sourceRevision);
        expect(snapshot.files.map(({ path, mode, contentDigest }) => ({ path, mode, contentDigest })))
          .toEqual(exact.files.map(({ path, mode, contentDigest }) => ({ path, mode, contentDigest })));
        expect(snapshot.file('src/value.ts')?.mode).toBe('100755');
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
      expect(compileTypeScriptProjectFactIdentity(unrelated, 'tsconfig.json', {
        dependencyGenerationDigest: null
      })).toEqual(projectTypeScriptProjectFactIdentity(projectInputs[0]!));
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

      for (const specifier of ['/foreign.ts', '../../outside.json']) {
        writeFileSync(path.join(root, 'src/value.ts'), `import input from ${JSON.stringify(specifier)}; export { input };\n`);
        await expect(acquireWorkingTreeSnapshot({ session })).rejects.toThrow('escapes its snapshot');
      }
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
