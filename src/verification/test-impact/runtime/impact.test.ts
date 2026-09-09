import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { compileRepositorySourceProgramCompilation } from '../../../brownfield/source-program-model/repository-compilation.ts';
import { issueTestImpactProjection } from '../../../brownfield/source-program-model/test-impact-projection.ts';
import { acquireExactGitTreeWorkspaceSourceSnapshot } from '../../../brownfield/source-program-model/workspace-source-snapshot.ts';
import { createRepositoryTestImpactSourceProvider, selectTestsForSources } from './impact.ts';

function git(repositoryRoot: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'SEC TestImpact',
      GIT_AUTHOR_EMAIL: 'test-impact@example.invalid',
      GIT_COMMITTER_NAME: 'SEC TestImpact',
      GIT_COMMITTER_EMAIL: 'test-impact@example.invalid'
    }
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

test('observed local program edges continue through test helpers to runnable tests', () => {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'sec-test-impact-observed-edge-'));
  try {
    const sources = {
      'src/value.ts': 'export const value = 1;\n',
      'src/value.json': '{"value":1}\n',
      'tests/helpers/value-child.ts': "import '../../src/value.ts';\n",
      'tests/unit/value.test.ts': [
        "import { spawnSync } from 'node:child_process';",
        "import process from 'node:process';",
        "import { readFileSync } from 'node:fs';",
        "import { readFileSync as unavailableSyncRead } from 'node:fs/promises';",
        "readFileSync('src/value.json', 'utf8');",
        "readFileSync('../outside.json', 'utf8');",
        "readFileSync('src/absent.json', 'utf8');",
        "unavailableSyncRead('src/value.json');",
        "function shadowRead(readFileSync: (path: string) => string) { readFileSync('src/value.json'); }",
        "function shadowBun(Bun: { file(path: string): { text(): string } }) { Bun.file('src/value.json').text(); }",
        "void shadowRead; void shadowBun;",
        "spawnSync(process.execPath, ['tests/helpers/value-child.ts']);",
        ''
      ].join('\n'),
      'tsconfig.json': '{"compilerOptions":{"noEmit":true},"include":["src/**/*.ts","tests/**/*.ts"]}\n'
    } as const;
    for (const [repositoryPath, source] of Object.entries(sources)) {
      const absolutePath = path.join(repositoryRoot, ...repositoryPath.split('/'));
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, source, 'utf8');
    }
    git(repositoryRoot, ['init', '--quiet', '--initial-branch=main']);
    git(repositoryRoot, ['add', '--all']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'fixture']);
    const commitSha = git(repositoryRoot, ['rev-parse', 'HEAD']);
    const workspaceSnapshot = acquireExactGitTreeWorkspaceSourceSnapshot({ repositoryRoot, commitSha });
    const compilation = compileRepositorySourceProgramCompilation({ workspaceSnapshot, repositoryRoot });
    const provider = createRepositoryTestImpactSourceProvider({
      projection: issueTestImpactProjection({
        workspaceSnapshot,
        repositoryModel: compilation.model,
        typeScriptModel: compilation.typeScriptCompilation.model,
        testObservations: compilation.testObservations
      }),
      activeDocumentationPaths: []
    });

    const selection = selectTestsForSources(['src/value.ts'], provider);
    expect(selection.fast).toEqual(['tests/unit/value.test.ts']);
    expect(selection.fast).not.toContain('tests/helpers/value-child.ts');
    expect(provider.projection.observedTestConsumers).toContainEqual({
      targetPath: 'src/value.json', testPath: 'tests/unit/value.test.ts'
    });
    expect(selectTestsForSources(['src/value.json'], provider).fast).toEqual(['tests/unit/value.test.ts']);
    expect(compilation.testObservations.resourceReads.map(({ target }) => target)).toEqual(['src/value.json']);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});
