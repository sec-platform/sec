import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { withAuthorityGitReadSession } from '../../../../providers/git-read/authority.ts';
import { GIT_READ_EXACT_TREE_OPERATION_BUDGET } from '../../../../providers/git-read/runtime/session.ts';
import { compileRepositorySourceProgramCompilation } from '../../../../repository/source-program-model/repository-compilation.ts';
import { issueTestImpactProjection } from '../../../../repository/source-program-model/test-impact-projection.ts';
import { acquireExactGitTreeSnapshot } from '../../../../repository/source-program-model/workspace-source-snapshot.ts';
import { issueTestInventoryProjection } from '../contract/budget.ts';
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

test('observed local program edges continue through test helpers to runnable tests', async () => {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'sec-test-impact-observed-edge-'));
  try {
    const sources = {
      'src/value.ts': 'export const value = 1;\n',
      'src/value.json': '{"value":1}\n',
      'tests/helpers/value-child.ts': "import '../../src/value.ts';\n",
      'tests/unit/tsconfig-excluded.test.ts': 'test("excluded from type project", () => {});\n',
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
      'tsconfig.json': '{"compilerOptions":{"noEmit":true},"files":["src/value.ts","tests/helpers/value-child.ts","tests/unit/value.test.ts"]}\n'
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
    const workspaceSnapshot = await withAuthorityGitReadSession({
      cwd: repositoryRoot,
      budget: GIT_READ_EXACT_TREE_OPERATION_BUDGET
    }, (session) => acquireExactGitTreeSnapshot({ session, commitSha }));
    const compilation = compileRepositorySourceProgramCompilation({ workspaceSnapshot, repositoryRoot });
    const provider = createRepositoryTestImpactSourceProvider({
      projection: issueTestImpactProjection({
        workspaceSnapshot,
        repositoryModel: compilation.model,
        typeScriptModel: compilation.typeScriptCompilation.model,
        testObservations: compilation.testObservations
      }),
      testInventory: issueTestInventoryProjection({ snapshot: workspaceSnapshot }),
      activeDocumentationPaths: []
    });

    const capturedInputs = { projection: 0, testInventory: 0, affectedSource: 0, activeDocumentationPaths: 0 };
    const captureOnceProvider = createRepositoryTestImpactSourceProvider({
      get projection() {
        capturedInputs.projection += 1;
        if (capturedInputs.projection > 1) throw new Error('projection getter was read more than once');
        return provider.projection;
      },
      get testInventory() {
        capturedInputs.testInventory += 1;
        if (capturedInputs.testInventory > 1) throw new Error('inventory getter was read more than once');
        return provider.testInventory;
      },
      get affectedSource() {
        capturedInputs.affectedSource += 1;
        if (capturedInputs.affectedSource > 1) throw new Error('affected source getter was read more than once');
        return undefined;
      },
      get activeDocumentationPaths() {
        capturedInputs.activeDocumentationPaths += 1;
        if (capturedInputs.activeDocumentationPaths > 1) throw new Error('documentation getter was read more than once');
        return [];
      }
    });
    expect(captureOnceProvider.projection).toBe(provider.projection);
    expect(capturedInputs).toEqual({
      projection: 1, testInventory: 1, affectedSource: 1, activeDocumentationPaths: 1
    });
    expect(provider.testInventory.testFiles).toContain('tests/unit/tsconfig-excluded.test.ts');

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
