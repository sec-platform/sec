import {
  access,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { expect, test } from 'bun:test';

import {
  runFormatCheck,
  runStagedFormatter
} from '../../platform/dev-runner/formatter.ts';

function git(root: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout;
}

function formatterConfig(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $schema: 'https://json.schemastore.org/prettierrc',
    arrowParens: 'always',
    bracketSpacing: true,
    endOfLine: 'lf',
    printWidth: 140,
    semi: true,
    singleQuote: true,
    tabWidth: 2,
    trailingComma: 'none',
    useTabs: false,
    ...extra
  };
}

async function repository(): Promise<{ readonly root: string; readonly base: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-format-'));
  git(root, ['init']);
  git(root, ['config', 'user.email', 'formatter@example.com']);
  git(root, ['config', 'user.name', 'Formatter Test']);
  await writeFile(
    path.join(root, '.prettierrc.json'),
    `${JSON.stringify(formatterConfig(), null, 2)}\n`
  );
  await writeFile(path.join(root, 'base.ts'), 'export const base = 1;\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'base']);
  return { root, base: git(root, ['rev-parse', 'HEAD']).trim() };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

test('format freeze rewrites the Git index and matching worktree exactly once', async () => {
  const { root, base } = await repository();
  try {
    const filePath = path.join(root, 'sample.ts');
    await writeFile(filePath, 'export const value={a:1}\n\n\n');
    git(root, ['add', 'sample.ts']);

    const env = { ...process.env, SEC_CHANGED_BASE: base };
    expect(await runStagedFormatter(root, {}, env)).toBe(0);
    expect(git(root, ['show', ':sample.ts'])).toBe('export const value = { a: 1 };\n');
    expect(await readFile(filePath, 'utf8')).toBe('export const value = { a: 1 };\n');

    const firstObject = git(root, ['rev-parse', ':sample.ts']).trim();
    expect(await runStagedFormatter(root, {}, env)).toBe(0);
    expect(git(root, ['rev-parse', ':sample.ts']).trim()).toBe(firstObject);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('format freeze preserves unstaged worktree bytes during partial staging', async () => {
  const { root, base } = await repository();
  try {
    const filePath = path.join(root, 'partial.ts');
    const staged = 'export const staged={a:1}\n\n';
    const unstaged = 'export const unstaged={b:2}\n\n\n';
    await writeFile(filePath, staged);
    git(root, ['add', 'partial.ts']);
    await writeFile(filePath, unstaged);

    expect(await runStagedFormatter(root, {}, {
      ...process.env,
      SEC_CHANGED_BASE: base
    })).toBe(0);
    expect(git(root, ['show', ':partial.ts'])).toBe('export const staged = { a: 1 };\n');
    expect(await readFile(filePath, 'utf8')).toBe(unstaged);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('frozen check reads committed blobs and rejects formatting drift', async () => {
  const { root, base } = await repository();
  try {
    await writeFile(path.join(root, 'valid.json'), '{"value":1}\n\n');
    git(root, ['add', 'valid.json']);
    expect(await runStagedFormatter(root, {}, {
      ...process.env,
      SEC_CHANGED_BASE: base
    })).toBe(0);
    git(root, ['commit', '-m', 'formatted']);
    expect(await runFormatCheck(root, {
      ...process.env,
      SEC_CHANGED_BASE: base
    })).toBe(0);

    await writeFile(path.join(root, 'drift.ts'), 'export const drift={value:1}\n\n');
    git(root, ['add', 'drift.ts']);
    git(root, ['commit', '-m', 'drift', '--no-verify']);
    expect(await runFormatCheck(root, {
      ...process.env,
      SEC_CHANGED_BASE: base
    })).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('immutable evidence paths are not rewritten by the formatter', async () => {
  const { root, base } = await repository();
  try {
    const evidencePath = path.join(root, 'docs', 'evidence', 'raw.json');
    await mkdir(path.dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, '{"value":1}\n\n');
    git(root, ['add', 'docs/evidence/raw.json']);
    expect(await runStagedFormatter(root, {}, {
      ...process.env,
      SEC_CHANGED_BASE: base
    })).toBe(0);
    expect(git(root, ['show', ':docs/evidence/raw.json'])).toBe('{"value":1}\n\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('candidate formatter config cannot load plugins or select executable extensions', async () => {
  const { root, base } = await repository();
  try {
    const markerPath = path.join(root, 'plugin-executed.txt');
    await writeFile(
      path.join(root, 'formatter-plugin.mjs'),
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(markerPath)}, 'executed'); export default {};\n`
    );
    await writeFile(
      path.join(root, '.prettierrc.json'),
      `${JSON.stringify(formatterConfig({ plugins: ['./formatter-plugin.mjs'] }), null, 2)}\n`
    );
    await writeFile(path.join(root, 'plugin-target.ts'), 'export const target={value:1}\n');
    git(root, ['add', '.prettierrc.json', 'formatter-plugin.mjs', 'plugin-target.ts']);

    expect(await runStagedFormatter(root, {}, {
      ...process.env,
      SEC_CHANGED_BASE: base
    })).toBe(1);
    expect(await exists(markerPath)).toBe(false);
    expect(git(root, ['show', ':plugin-target.ts'])).toBe('export const target={value:1}\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('symlink file candidates are rejected without rewriting their external target', async () => {
  if (process.platform === 'win32') return;
  const { root, base } = await repository();
  const externalRoot = await mkdtemp(path.join(tmpdir(), 'sec-format-external-'));
  try {
    const externalPath = path.join(externalRoot, 'outside.ts');
    const externalBytes = 'export const outside={value:1}\n\n';
    await writeFile(externalPath, externalBytes);
    await symlink(externalPath, path.join(root, 'alias.ts'));
    git(root, ['add', 'alias.ts']);

    expect(await runStagedFormatter(root, {}, {
      ...process.env,
      SEC_CHANGED_BASE: base
    })).toBe(1);
    expect(await readFile(externalPath, 'utf8')).toBe(externalBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(externalRoot, { recursive: true, force: true });
  }
});

test('ancestor symlink or junction cannot redirect worktree synchronization outside the repository', async () => {
  const { root, base } = await repository();
  const externalRoot = await mkdtemp(path.join(tmpdir(), 'sec-format-parent-external-'));
  try {
    const aliasDirectory = path.join(root, 'alias-dir');
    const repositoryFile = path.join(aliasDirectory, 'outside.ts');
    const externalFile = path.join(externalRoot, 'outside.ts');
    const stagedBytes = 'export const outside={value:1}\n\n';
    await mkdir(aliasDirectory);
    await writeFile(repositoryFile, stagedBytes);
    git(root, ['add', 'alias-dir/outside.ts']);
    await rm(aliasDirectory, { recursive: true, force: true });
    await writeFile(externalFile, stagedBytes);

    try {
      await symlink(
        externalRoot,
        aliasDirectory,
        process.platform === 'win32' ? 'junction' : 'dir'
      );
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) return;
      throw error;
    }

    expect(await runStagedFormatter(root, {}, {
      ...process.env,
      SEC_CHANGED_BASE: base
    })).toBe(1);
    expect(await readFile(externalFile, 'utf8')).toBe(stagedBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(externalRoot, { recursive: true, force: true });
  }
});

test('hard-linked worktree files are not rewritten through an external alias', async () => {
  const { root, base } = await repository();
  const externalRoot = await mkdtemp(path.join(tmpdir(), 'sec-format-hardlink-external-'));
  try {
    const externalFile = path.join(externalRoot, 'outside.ts');
    const repositoryFile = path.join(root, 'hardlink.ts');
    const bytes = 'export const hardlink={value:1}\n\n';
    await writeFile(externalFile, bytes);
    try {
      await link(externalFile, repositoryFile);
    } catch (error) {
      if (['EPERM', 'EACCES', 'EXDEV', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) return;
      throw error;
    }
    git(root, ['add', 'hardlink.ts']);

    expect(await runStagedFormatter(root, {}, {
      ...process.env,
      SEC_CHANGED_BASE: base
    })).toBe(1);
    expect(await readFile(externalFile, 'utf8')).toBe(bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(externalRoot, { recursive: true, force: true });
  }
});
