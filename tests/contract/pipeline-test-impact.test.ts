import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { compileRepositorySourceProgramCompilation } from '../../src/adapters/repository/source-program-model/repository-compilation.ts';
import { issueTestImpactProjection } from '../../src/adapters/repository/source-program-model/test-impact-projection.ts';
import { acquireExactGitTreeWorkspaceSourceSnapshot } from '../../src/adapters/repository/source-program-model/workspace-source-snapshot.ts';
import { currentActiveDocumentationPaths } from '../../src/adapters/self-hosting/control/documentation/active.ts';
import { issueTestInventoryProjection } from '../../src/adapters/verification/platform/test-impact/contract/budget.ts';
import { createRepositoryTestImpactSourceProvider, resolveTestOwnership, selectTestsForSources } from '../../src/adapters/verification/platform/test-impact/runtime/impact.ts';

function git(root: string, args: readonly string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Git fixture command failed: git ${args.join(' ')}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function pipelineProvider(sources: Readonly<Record<string, string>>) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sec-pipeline-test-impact-'));
  try {
    git(root, ['init', '--quiet']);
    git(root, ['config', 'user.email', 'test-impact@sec.invalid']);
    git(root, ['config', 'user.name', 'SEC Test Impact']);
    for (const [repositoryPath, source] of Object.entries(sources)) {
      const filePath = path.join(root, ...repositoryPath.split('/'));
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, source, 'utf8');
    }
    git(root, ['add', '--all']);
    git(root, ['commit', '--quiet', '-m', 'test-impact-fixture']);
    const workspaceSnapshot = acquireExactGitTreeWorkspaceSourceSnapshot({
      repositoryRoot: root,
      commitSha: git(root, ['rev-parse', 'HEAD'])
    });
    const repositoryCompilation = compileRepositorySourceProgramCompilation({ workspaceSnapshot });
    return createRepositoryTestImpactSourceProvider({
      projection: issueTestImpactProjection({
        workspaceSnapshot,
        repositoryModel: repositoryCompilation.model,
        typeScriptModel: repositoryCompilation.typeScriptCompilation.model,
        testObservations: repositoryCompilation.testObservations
      }),
      testInventory: issueTestInventoryProjection({ snapshot: workspaceSnapshot }),
      activeDocumentationPaths: currentActiveDocumentationPaths()
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('pipeline lifecycle binding changes select their real transitive consumers', () => {
  const source = 'src/bootstrap/engineering/pipeline-kernel.ts';
  const consumer = 'tests/integration/pipeline-workspace-write-lease.test.ts';
  const provider = pipelineProvider({
    'src/bootstrap/engineering/sec.module.json':
      '{"importGraph":"runtime","externalEntrypoints":["src/bootstrap/engineering/cli.ts"]}',
    [source]: 'export const kernel = true;',
    [consumer]: "import { kernel } from '../../src/bootstrap/engineering/pipeline-kernel.ts'; void kernel;"
  });
  const selection = selectTestsForSources([source], provider);

  expect(selection.owners).toEqual(['bootstrap.engineering']);
  expect(selection.fast).toEqual([consumer]);
  expect(resolveTestOwnership([source], provider)).toEqual([{
    source,
    owner: 'bootstrap.engineering',
    identity: { kind: 'module', id: 'bootstrap.engineering' }
  }]);
});

test('upgrade changes select upgrade behavior without a central path table', () => {
  const source = 'src/bootstrap/upgrade/upgrade-workspace.ts';
  const fastConsumer = 'tests/unit/upgrade-summary.test.ts';
  const slowConsumer = 'tests/e2e/upgrade.test.ts';
  const provider = pipelineProvider({
    'src/bootstrap/upgrade/sec.module.json': '{"importGraph":"runtime","externalEntrypoints":[]}',
    [source]: 'export const upgradeWorkspace = true;',
    [fastConsumer]: "import { upgradeWorkspace } from '../../src/bootstrap/upgrade/upgrade-workspace.ts'; void upgradeWorkspace;",
    [slowConsumer]: "import { upgradeWorkspace } from '../../src/bootstrap/upgrade/upgrade-workspace.ts'; void upgradeWorkspace;"
  });
  const selection = selectTestsForSources([source], provider);

  expect(selection.owners).toEqual(['bootstrap.upgrade']);
  expect(selection.fast).toEqual([fastConsumer]);
  expect(selection.slow).toEqual([slowConsumer]);
});
