import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  createIssueDispositionPlanV1,
  renderPullRequestBodyV1,
  type IssueDispositionDigestV1,
  type IssueDispositionModeV1
} from '../../platform/shared/issue-disposition-contract.ts';
import { encodeVerificationActionDataV2 } from '../../platform/shared/verification-action-contract.ts';
import {
  observeGitHubPullRequestClosingFactsV1
} from './issue-disposition-github.ts';
import {
  CodexDevelopmentParseCurrentWorkPackageManifestV1,
  CodexDevelopmentWorkPackageManifestDigest
} from './work-package-contract.ts';

const USAGE = `Usage:
  bun scripts/codex/issue-disposition.ts render-pr --manifest <path> --summary-file <path> --mode <progress-only|close-tracking-after-readback> --output <path>
  bun scripts/codex/issue-disposition.ts plan-live --repository <owner/name> --pr <n> --manifest <path> --output <path>
`;

const FLAGS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  'render-pr': new Set(['--manifest', '--summary-file', '--mode', '--output']),
  'plan-live': new Set(['--repository', '--pr', '--manifest', '--output'])
});

function fail(message: string): never {
  throw new Error(`IssueDispositionCli ${message}\n${USAGE}`);
}

function parseArgs(argv: readonly string[]): Readonly<{ command: string; args: ReadonlyMap<string, string> }> {
  const command = argv[0];
  if (command === undefined || FLAGS[command] === undefined) return fail(`unknown command ${command ?? '<missing>'}.`);
  const allowed = FLAGS[command]!;
  const args = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || !allowed.has(flag) || value === undefined || value.startsWith('--')) {
      return fail(`invalid argument near ${flag ?? '<missing>'}.`);
    }
    if (args.has(flag)) return fail(`duplicate argument ${flag}.`);
    args.set(flag, value);
  }
  if (args.size !== allowed.size || [...allowed].some((flag) => !args.has(flag))) {
    return fail(`command ${command} requires exactly: ${[...allowed].join(', ')}.`);
  }
  return Object.freeze({ command, args });
}

function required(args: ReadonlyMap<string, string>, flag: string): string {
  return args.get(flag) ?? fail(`missing ${flag}.`);
}

function positiveInteger(value: string, label: string): number {
  if (!/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(Number(value))) {
    return fail(`${label} must be one positive integer.`);
  }
  return Number(value);
}

function readManifest(manifestPath: string) {
  const normalized = manifestPath.replaceAll('\\', '/');
  if (!/^docs\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(normalized)) {
    return fail('manifest must be one canonical repository path.');
  }
  const sourceBytes = readFileSync(path.resolve(normalized));
  const source = sourceBytes.toString('utf8');
  if (!Buffer.from(source, 'utf8').equals(sourceBytes)) return fail('manifest must be valid UTF-8 bytes.');
  return Object.freeze({ path: normalized, sourceBytes, source,
    digest: CodexDevelopmentWorkPackageManifestDigest(sourceBytes) as IssueDispositionDigestV1,
    manifest: CodexDevelopmentParseCurrentWorkPackageManifestV1(source, normalized) });
}

function writeDurable(outputPath: string, source: string): void {
  const target = path.resolve(outputPath);
  if (existsSync(target)) {
    if (readFileSync(target, 'utf8') !== source) return fail(`output already exists with different bytes: ${target}.`);
    return;
  }
  writeFileSync(target, source, { encoding: 'utf8', flag: 'wx' });
  if (readFileSync(target, 'utf8') !== source) return fail(`output readback differs: ${target}.`);
}

export function issueDispositionCli(argv: readonly string[]): string {
  const { command, args } = parseArgs(argv);
  if (command === 'render-pr') {
    const manifest = readManifest(required(args, '--manifest'));
    const mode = required(args, '--mode');
    if (mode !== 'progress-only' && mode !== 'close-tracking-after-readback') {
      return fail('render mode is invalid.');
    }
    if (mode === 'close-tracking-after-readback' && manifest.manifest.tracking === 'none') {
      return fail('close-tracking mode requires a tracked Issue.');
    }
    const body = renderPullRequestBodyV1({ summary: readFileSync(path.resolve(required(args, '--summary-file')), 'utf8'),
      manifestPath: manifest.path, mode: mode as IssueDispositionModeV1 });
    writeDurable(required(args, '--output'), body);
    return encodeVerificationActionDataV2({ status: 'rendered', output: path.resolve(required(args, '--output')),
      manifestPath: manifest.path, manifestDigest: manifest.digest, mode });
  }
  const manifest = readManifest(required(args, '--manifest'));
  const repository = required(args, '--repository');
  const prNumber = positiveInteger(required(args, '--pr'), 'pr');
  const pullRequest = observeGitHubPullRequestClosingFactsV1(repository, prNumber);
  const plan = createIssueDispositionPlanV1({ repository, prNumber,
    manifestPath: manifest.path, manifestDigest: manifest.digest,
    tracking: manifest.manifest.tracking, title: pullRequest.title, body: pullRequest.body,
    linkedClosingIssues: pullRequest.closingIssues });
  const source = `${encodeVerificationActionDataV2(plan)}\n`;
  writeDurable(required(args, '--output'), source);
  return source.trimEnd();
}

if (import.meta.main) {
  try {
    process.stdout.write(`${issueDispositionCli(process.argv.slice(2))}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
