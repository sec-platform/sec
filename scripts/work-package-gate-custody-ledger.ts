import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { normalizeNewlines } from '../platform/shared/collections.ts';
import { WORK_PACKAGE_GATE_CUSTODY_LEDGER_V4 } from './work-package-gate-contract.ts';

type Command = 'check' | 'render';

interface CliOptions {
  readonly command: Command;
  readonly revision: string;
}

function usage(): never {
  throw new Error(
    'Usage: bun scripts/work-package-gate-custody-ledger.ts <check|render> --revision <revision>'
  );
}

function parseOptions(argv: readonly string[]): CliOptions {
  if (argv.length !== 3 || (argv[0] !== 'check' && argv[0] !== 'render') ||
    argv[1] !== '--revision' || argv[2]!.length === 0) {
    return usage();
  }
  return Object.freeze({ command: argv[0], revision: argv[2]! });
}

function git(repoRoot: string, args: readonly string[], encoding: 'buffer' | 'utf8'): Buffer | string {
  const result = spawnSync('git', [...args], {
    cwd: repoRoot,
    encoding,
    timeout: 30_000,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : result.stderr;
    throw new Error(`git ${args.join(' ')} failed${stderr ? `: ${stderr.trim()}` : ''}`);
  }
  return result.stdout;
}

function resolveCommit(repoRoot: string, revision: string): string {
  const value = String(git(
    repoRoot,
    ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`],
    'utf8'
  )).trim();
  if (!/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`Revision did not resolve to one full commit SHA: ${revision}`);
  }
  return value;
}

function custodyDigest(bytes: Uint8Array): `sha256:${string}` {
  const canonical = normalizeNewlines(Buffer.from(bytes).toString('utf8'));
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

function renderLedger(ledger: Readonly<Record<string, string>>, revision: string): string {
  const lines = Object.entries(ledger).map(
    ([relativePath, digest]) => `  '${relativePath}': '${digest}',`
  );
  return [
    `// Candidate custody ledger rendered from Git commit ${revision}.`,
    'Object.freeze({',
    ...lines,
    '} as const);'
  ].join('\n');
}

export function workPackageGateCustodyLedgerForRevision(
  repoRoot: string,
  revision: string
): Readonly<Record<string, `sha256:${string}`>> {
  const commit = resolveCommit(repoRoot, revision);
  const ledger = Object.fromEntries(Object.keys(WORK_PACKAGE_GATE_CUSTODY_LEDGER_V4).map((relativePath) => {
    const bytes = git(repoRoot, ['cat-file', 'blob', `${commit}:${relativePath}`], 'buffer');
    if (!Buffer.isBuffer(bytes)) throw new Error('git cat-file did not return blob bytes');
    return [relativePath, custodyDigest(bytes)] as const;
  }));
  return Object.freeze(ledger);
}

export function workPackageGateCustodyLedgerMain(argv: readonly string[] = process.argv.slice(2)): number {
  const options = parseOptions(argv);
  const repoRoot = path.resolve(import.meta.dir, '..');
  const commit = resolveCommit(repoRoot, options.revision);
  const candidate = workPackageGateCustodyLedgerForRevision(repoRoot, commit);
  if (options.command === 'render') {
    console.log(renderLedger(candidate, commit));
    return 0;
  }

  const drift = Object.entries(candidate).filter(
    ([relativePath, digest]) => WORK_PACKAGE_GATE_CUSTODY_LEDGER_V4[
      relativePath as keyof typeof WORK_PACKAGE_GATE_CUSTODY_LEDGER_V4
    ] !== digest
  );
  if (drift.length > 0) {
    console.error(`Work Package custody ledger drifted at ${commit}:`);
    for (const [relativePath, digest] of drift) {
      const expected = WORK_PACKAGE_GATE_CUSTODY_LEDGER_V4[
        relativePath as keyof typeof WORK_PACKAGE_GATE_CUSTODY_LEDGER_V4
      ];
      console.error(`- ${relativePath}: expected ${expected}, Git blob ${digest}`);
    }
    return 1;
  }
  console.log(`Work Package custody ledger matches ${commit} (${Object.keys(candidate).length} Git blobs).`);
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = workPackageGateCustodyLedgerMain();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
