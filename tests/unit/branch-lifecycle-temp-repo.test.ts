import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  preparationFilePath,
  prepareBranchCloseout
} from '../../scripts/codex/branch-closeout.ts';
import {
  createBranchLifecycleGitChildEnvironmentV1,
  createBranchLifecycleGitHubCredentialArgsV1
} from '../../scripts/codex/branch-lifecycle-command.ts';
import { collectBranchLifecycleInventory } from '../../scripts/codex/branch-lifecycle-inventory.ts';

test('canonical Git child environment removes ambient steering and preserves host integration', () => {
  const environment = createBranchLifecycleGitChildEnvironmentV1({
    Path: 'trusted-path',
    PATH: 'duplicate-path',
    HOME: 'trusted-home',
    USERPROFILE: 'trusted-profile',
    SSH_AUTH_SOCK: 'trusted-agent',
    HTTPS_PROXY: 'trusted-proxy',
    Git_Dir: 'forged-git-dir',
    GIT_WORK_TREE: 'forged-worktree',
    GIT_INDEX_FILE: 'forged-index',
    GIT_OBJECT_DIRECTORY: 'forged-objects',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.worktree',
    GIT_CONFIG_VALUE_0: 'forged-worktree',
    git_config_key_19: 'core.fsmonitor',
    git_config_value_19: 'forged-monitor',
    GIT_CONFIG_GLOBAL: 'forged-config',
    git_no_replace_objects: '0',
    GIT_OPTIONAL_LOCKS: '1',
    GIT_TERMINAL_PROMPT: '1'
  });
  expect(Object.keys(environment).filter((name) => name.toUpperCase() === 'PATH'))
    .toHaveLength(1);
  expect(environment.Path).toBe('trusted-path');
  expect(environment.HOME).toBe('trusted-home');
  expect(environment.USERPROFILE).toBe('trusted-profile');
  expect(environment.SSH_AUTH_SOCK).toBe('trusted-agent');
  expect(environment.HTTPS_PROXY).toBe('trusted-proxy');
  expect(environment.GIT_TERMINAL_PROMPT).toBe('0');
  expect(environment.GIT_OPTIONAL_LOCKS).toBe('0');
  expect(environment.GIT_NO_REPLACE_OBJECTS).toBe('1');
  expect(Object.keys(environment).filter((name) => name.toUpperCase() === 'GIT_NO_REPLACE_OBJECTS'))
    .toEqual(['GIT_NO_REPLACE_OBJECTS']);
  for (const name of Object.keys(environment)) {
    const canonicalName = name.toUpperCase();
    expect([
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'GIT_OBJECT_DIRECTORY',
      'GIT_CONFIG_COUNT',
      'GIT_CONFIG_GLOBAL'
    ]).not.toContain(canonicalName);
    expect(canonicalName).not.toMatch(/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/u);
  }
});

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return (result.stdout ?? '').trim();
}

function repositoryFixture(): Readonly<{
  root: string;
  remote: string;
  repository: string;
  branch: string;
  headSha: string;
  mainSha: string;
}> {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-branch-lifecycle-v6-'));
  const remote = path.join(root, 'remote.git');
  const repository = path.join(root, 'repository');
  git(root, ['init', '--bare', remote]);
  git(root, ['clone', remote, repository]);
  git(repository, ['config', 'user.name', 'SEC Test']);
  git(repository, ['config', 'user.email', 'sec-test@example.invalid']);
  git(repository, ['config', '--local', 'fetch.prune', 'true']);
  git(repository, ['config', '--local', 'remote.origin.prune', 'true']);
  git(repository, ['config', '--local', 'fetch.pruneTags', 'true']);
  mkdirSync(path.join(repository, 'scripts/codex'), { recursive: true });
  writeFileSync(
    path.join(repository, 'scripts/codex/document-control-plane.ts'),
    `process.stdout.write(JSON.stringify({activeWorkPackage:{state:'active',manifest:'docs/work-packages/v6-test.md'},workspace:{branch:'feat/v6-closeout'}}));\n`,
    'utf8'
  );
  writeFileSync(path.join(repository, 'README.md'), '# main\n', 'utf8');
  git(repository, ['add', 'README.md', 'scripts/codex/document-control-plane.ts']);
  git(repository, ['commit', '-m', 'initial main']);
  git(repository, ['branch', '-M', 'main']);
  git(repository, ['push', '-u', 'origin', 'main']);
  const mainSha = git(repository, ['rev-parse', 'HEAD']);
  const branch = 'feat/v6-closeout';
  git(repository, ['switch', '-c', branch]);
  writeFileSync(path.join(repository, 'candidate.txt'), 'candidate\n', 'utf8');
  git(repository, ['add', 'candidate.txt']);
  git(repository, ['commit', '-m', 'candidate']);
  const headSha = git(repository, ['rev-parse', 'HEAD']);
  git(repository, ['push', '-u', 'origin', branch]);
  return Object.freeze({ root, remote, repository, branch, headSha, mainSha });
}

function installGitHubObservationShim(fixture: ReturnType<typeof repositoryFixture>): () => void {
  const shimRoot = path.join(fixture.root, 'command-shims');
  mkdirSync(shimRoot, { recursive: true });
  const program = path.join(shimRoot, 'gh-shim.ts');
  writeFileSync(program, `
const args = process.argv.slice(2);
if (args[0] === 'pr' && args[1] === 'list') {
  process.stdout.write('[]');
  process.exit(0);
}
if (args[0] === 'api' && args[1] === '/repos/sec-platform/sec') {
  process.stdout.write('true');
  process.exit(0);
}
process.stderr.write('unsupported test gh observation: ' + args.join(' '));
process.exit(1);
`, 'utf8');
  if (process.platform === 'win32') {
    const compiled = spawnSync('bun', [
      'build',
      '--compile',
      program,
      '--outfile',
      path.join(shimRoot, 'gh.exe')
    ], { encoding: 'utf8', windowsHide: true });
    if (compiled.status !== 0) {
      throw new Error(`cannot compile bounded gh.exe test shim: ${compiled.stderr || compiled.stdout}`);
    }
  } else {
    const shellShim = path.join(shimRoot, 'gh');
    writeFileSync(shellShim, `#!/usr/bin/env sh\nexec bun "$(dirname "$0")/gh-shim.ts" "$@"\n`, 'utf8');
    chmodSync(shellShim, 0o755);
  }
  const priorPath = process.env.PATH;
  process.env.PATH = `${shimRoot}${path.delimiter}${priorPath ?? ''}`;
  return () => {
    if (priorPath === undefined) delete process.env.PATH;
    else process.env.PATH = priorPath;
  };
}

test('V6 branch preparation is recovery-only and leaves exact local/remote refs intact', () => {
  const fixture = repositoryFixture();
  const restorePath = installGitHubObservationShim(fixture);
  try {
    const scope = {
      repositoryRoot: fixture.repository,
      repositoryFullName: 'sec-platform/sec',
      defaultBranch: 'main',
      recoveryRoot: path.join(fixture.root, 'recovery')
    };
    const prepared = prepareBranchCloseout(scope, {
      branch: fixture.branch,
      expectedHeadSha: fixture.headSha
    });
    expect(prepared.preparation.expectedHeadSha).toBe(fixture.headSha);
    expect(existsSync(preparationFilePath(prepared.preparation))).toBe(true);
    expect(git(fixture.repository, ['rev-parse', `refs/heads/${fixture.branch}`]))
      .toBe(fixture.headSha);
    expect(git(fixture.repository, ['ls-remote', '--heads', 'origin', `refs/heads/${fixture.branch}`]))
      .toContain(fixture.headSha);
  } finally {
    restorePath();
    rmSync(fixture.root, { recursive: true, force: true });
  }
}, 180_000);

test('legacy branch-lifecycle finalize CLI is rejected before any ref mutation', () => {
  const fixture = repositoryFixture();
  try {
    const result = spawnSync('bun', [
      path.resolve('scripts/codex/branch-lifecycle.ts'),
      'finalize',
      '--preparation', 'forged.json',
      '--disposition', 'merged',
      '--durable-goal-kind', 'main',
      '--durable-goal', `main@${fixture.headSha}`
    ], {
      cwd: fixture.repository,
      encoding: 'utf8',
      windowsHide: true
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout ?? ''}${result.stderr ?? ''}`).toContain('Usage:');
    expect(git(fixture.repository, ['rev-parse', `refs/heads/${fixture.branch}`]))
      .toBe(fixture.headSha);
    expect(git(fixture.repository, ['ls-remote', '--heads', 'origin', `refs/heads/${fixture.branch}`]))
      .toContain(fixture.headSha);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}, 180_000);

test('branch lifecycle command module exposes no executable or authentic capability mint', async () => {
  const source = readFileSync(path.resolve('scripts/codex/branch-lifecycle-command.ts'), 'utf8');
  const exports = Object.keys(await import('../../scripts/codex/branch-lifecycle-command.ts')).sort();
  expect(exports).toEqual([
    'createBranchLifecycleGitChildEnvironmentV1',
    'createBranchLifecycleGitHubCredentialArgsV1',
    'decodeBranchLifecycleChildErrorV1',
    'decodeBranchLifecycleChildStdoutV1'
  ]);
  for (const executable of ["spawnSync('bun'", "spawnSync('gh'", "spawnSync('git'"]) {
    expect(source).not.toContain(executable);
  }
  for (const symbol of [
    'BranchLifecycleContext',
    'createBranchLifecycleContext',
    'BranchLifecycleCommandResult',
    'runBranchCommand',
    'requireBranchCommandText',
    'optionalBranchCommandText'
  ]) {
    expect(source).not.toContain(symbol);
    expect(exports).not.toContain(symbol);
  }
});

test('canonical GitHub credential prefix masks checkout HTTP authorization before gh lookup', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-branch-credential-'));
  try {
    git(root, ['init']);
    git(root, ['config', 'http.https://github.com/.extraheader', 'AUTHORIZATION: ambient-checkout-token']);
    const observed = spawnSync('git', [
      ...createBranchLifecycleGitHubCredentialArgsV1(),
      'config', '--get-urlmatch', 'http.extraheader', 'https://github.com/sec-platform/sec.git'
    ], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true
    });
    expect(observed.status).toBe(0);
    expect(String(observed.stdout ?? '')).toBe('\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('typed inventory boundary ignores ambient repository and index steering without refreshing target index', () => {
  const fixture = repositoryFixture();
  const restorePath = installGitHubObservationShim(fixture);
  const decoy = path.join(fixture.root, 'decoy');
  const isolatedHome = path.join(fixture.root, 'home');
  mkdirSync(isolatedHome, { recursive: true });
  git(fixture.root, ['init', decoy]);
  git(decoy, ['config', 'user.name', 'SEC Decoy']);
  git(decoy, ['config', 'user.email', 'sec-decoy@example.invalid']);
  writeFileSync(path.join(decoy, 'decoy.txt'), 'decoy\n', 'utf8');
  git(decoy, ['add', 'decoy.txt']);
  git(decoy, ['commit', '-m', 'decoy']);
  const decoyGitDirectory = git(decoy, [
    'rev-parse', '--path-format=absolute', '--absolute-git-dir'
  ]);
  const decoyIndex = git(decoy, [
    'rev-parse', '--path-format=absolute', '--git-path', 'index'
  ]);
  const targetIndex = git(fixture.repository, [
    'rev-parse', '--path-format=absolute', '--git-path', 'index'
  ]);
  const targetIndexBytes = readFileSync(targetIndex);
  const targetIndexStat = statSync(targetIndex);
  const trackedPath = path.join(fixture.repository, 'candidate.txt');
  const future = new Date(Date.now() + 5_000);
  utimesSync(trackedPath, future, future);

  const hostileEnvironment: Readonly<Record<string, string>> = {
    GIT_DIR: decoyGitDirectory,
    GIT_WORK_TREE: decoy,
    GIT_COMMON_DIR: decoyGitDirectory,
    GIT_INDEX_FILE: decoyIndex,
    GIT_OBJECT_DIRECTORY: path.join(decoyGitDirectory, 'objects'),
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.worktree',
    GIT_CONFIG_VALUE_0: decoy,
    HOME: isolatedHome
  };
  const priorEnvironment = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(hostileEnvironment)) {
    priorEnvironment.set(name, process.env[name]);
    process.env[name] = value;
  }
  try {
    const inventory = collectBranchLifecycleInventory({
      repositoryRoot: fixture.repository,
      repositoryFullName: 'sec-platform/sec',
      defaultBranch: 'main'
    });
    expect(inventory.localBranches.find(({ branch }) => branch === fixture.branch)?.sha)
      .toBe(fixture.headSha);
    expect(inventory.remoteBranches.find(({ branch }) => branch === fixture.branch)?.sha)
      .toBe(fixture.headSha);
    expect(readFileSync(targetIndex)).toEqual(targetIndexBytes);
    const after = statSync(targetIndex);
    expect({ dev: after.dev, ino: after.ino, size: after.size, mtimeMs: after.mtimeMs })
      .toEqual({
        dev: targetIndexStat.dev,
        ino: targetIndexStat.ino,
        size: targetIndexStat.size,
        mtimeMs: targetIndexStat.mtimeMs
      });
  } finally {
    restorePath();
    for (const [name, value] of priorEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(fixture.root, { recursive: true, force: true });
  }
}, 180_000);

test('only VerificationSession source retains integrated ref mutation commands', () => {
  const lifecycle = readFileSync(
    path.resolve('scripts/codex/branch-lifecycle.ts'),
    'utf8'
  );
  const closeout = readFileSync(
    path.resolve('scripts/codex/branch-closeout.ts'),
    'utf8'
  );
  const session = readFileSync(
    path.resolve('scripts/codex/verification-session.ts'),
    'utf8'
  );
  const command = readFileSync(
    path.resolve('scripts/codex/branch-lifecycle-command.ts'),
    'utf8'
  );
  expect(lifecycle).not.toContain('finalizeBranchCloseout');
  expect(lifecycle).not.toContain("command: 'finalize'");
  expect(lifecycle).not.toContain("export * from './branch-closeout");
  expect(closeout).not.toContain("'push',\n    '--porcelain'");
  expect(closeout).not.toContain('finalizeIntegratedBranchCloseout');
  expect(command).not.toContain('spawnSync');
  expect(command).not.toContain('runBranchCommand');
  expect(closeout).not.toContain("'update-ref'");
  expect(closeout).not.toContain("'worktree', 'remove'");
  expect(session).toContain('function finalizeHostedBranchCloseoutV1');
  expect(session).toContain('function deleteHostedRemoteRefCas');
});
