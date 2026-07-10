import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CI_VERIFICATION_CONTRACT_REVISION } from '../platform/shared/ci-contract.ts';
import { gitChangedFileDiffArgs, parseGitChangedFileOutput } from '../platform/shared/ci-git-changed-files.ts';
import { selectCiPrRiskSlowSuites } from '../platform/shared/ci-pr-risk-selection.ts';
import { uniqueSorted } from '../platform/shared/collections.ts';
import { isFastTestFile } from '../platform/shared/test-budget-contract.ts';
import {
  isTestImpactSourceFile,
  isVerificationInfrastructureFile,
  selectTestsForSources
} from '../platform/shared/test-impact-contract.ts';

const VERIFICATION_EVIDENCE_PATH = '.tmp/ci-verification-evidence.json';
const FAILURE_TAIL_CHARACTER_LIMIT = 24_000;

type VerificationProfile = 'quick' | 'full';
type VerificationStatus = 'passed' | 'failed';

type GateStep = {
  id: string;
  args: string[];
};

type GateResult = {
  id: string;
  code: number;
  durationMs: number;
  failureTail?: string;
};

type VerificationEvidence = {
  contractRevision: typeof CI_VERIFICATION_CONTRACT_REVISION;
  profile: VerificationProfile;
  headSha: string;
  status: VerificationStatus;
  changedFiles: string[] | null;
  failedGate?: string;
  results: GateResult[];
};

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function verificationProfile(): VerificationProfile {
  const value = argumentValue('--profile');
  if (value === 'quick' || value === 'full') return value;
  throw new Error('CI verification requires --profile quick|full.');
}

function gitOutput(args: string[]): string | null {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function currentHeadSha(): string {
  const sha = gitOutput(['rev-parse', 'HEAD']);
  if (!sha) throw new Error('Unable to resolve current HEAD SHA.');
  return sha;
}

function assertExpectedHead(actualHeadSha: string): void {
  const expectedHeadSha = argumentValue('--expected-head') ?? process.env.SEC_EXPECTED_HEAD_SHA;
  if (!expectedHeadSha) {
    throw new Error('CI verification requires an exact expected head SHA.');
  }
  if (actualHeadSha !== expectedHeadSha) {
    throw new Error(`CI verification head mismatch: expected ${expectedHeadSha}, actual ${actualHeadSha}.`);
  }
}

function changedFiles(): string[] | null {
  const baseRef = process.env.SEC_CHANGED_BASE ?? process.env.SEC_AFFECTED_TESTS_BASE ?? 'HEAD^1';
  const output = gitOutput(gitChangedFileDiffArgs(baseRef));
  return output === null ? null : parseGitChangedFileOutput(output);
}

function hasTypeScriptChange(files: string[] | null): boolean {
  return files === null || files.some((file) => /\.[cm]?tsx?$/u.test(file));
}

function hasActiveDocumentationChange(files: string[] | null): boolean {
  return files === null || files.some((file) => /^docs\/.+\.md$/u.test(file));
}

function quickFastGate(files: string[] | null): GateStep | null {
  if (files === null) {
    return { id: 'full-fast-fallback', args: ['run', 'test:fast'] };
  }

  const impactSourceFiles = files.filter(isTestImpactSourceFile);
  const impact = selectTestsForSources(impactSourceFiles);
  const selectedFastTests = uniqueSorted([
    ...files.filter(isFastTestFile),
    ...impact.fast
  ]);

  if (files.some(isVerificationInfrastructureFile)) {
    console.log('CI verification: verification infrastructure changed; running full fast correctness backstop.');
    return { id: 'full-fast-verification-infrastructure', args: ['run', 'test:fast'] };
  }

  if (selectedFastTests.length > 0) {
    console.log(`CI verification: mapped fast tests [${selectedFastTests.join(', ')}]`);
    return { id: 'mapped-fast-tests', args: ['run', 'test:fast', '--', ...selectedFastTests] };
  }

  if (impactSourceFiles.length > 0) {
    console.log('CI verification: unmapped impact source changed; running full fast fallback instead of silently skipping coverage.');
    return { id: 'full-fast-unmapped-impact', args: ['run', 'test:fast'] };
  }

  console.log('CI verification: no fast test impact detected.');
  return null;
}

function quickGateSteps(files: string[] | null): GateStep[] {
  const steps: GateStep[] = [];
  if (hasTypeScriptChange(files)) {
    steps.push({ id: 'imports', args: ['run', 'imports:check'] });
  }
  if (hasActiveDocumentationChange(files)) {
    steps.push({ id: 'docs-doctor', args: ['run', 'docs:doctor'] });
  }

  steps.push({ id: 'typecheck', args: ['run', 'typecheck'] });
  const fastGate = quickFastGate(files);
  if (fastGate) steps.push(fastGate);

  const riskSelection = selectCiPrRiskSlowSuites(files);
  const verificationInfrastructureChanged = files === null || files.some(isVerificationInfrastructureFile);
  if (verificationInfrastructureChanged || riskSelection.reason !== 'none') {
    console.log(`CI verification: risk gate required; reason=${riskSelection.reason}; owners=[${riskSelection.owners.join(', ')}]`);
    steps.push({ id: 'impact-risk', args: ['scripts/ci-pr-risk.ts'] });
  } else {
    console.log('CI verification: no slow/workspace risk impact detected; risk gate skipped.');
  }

  return steps;
}

function fullGateSteps(): GateStep[] {
  return [
    { id: 'imports', args: ['run', 'imports:check'] },
    { id: 'typecheck', args: ['run', 'typecheck'] },
    { id: 'docs-doctor', args: ['run', 'docs:doctor'] },
    { id: 'full-fast', args: ['run', 'test:fast'] },
    { id: 'test-budget', args: ['run', 'sec', '--', 'test', 'budget', '--json', '--compact'] },
    { id: 'all-slow-risk', args: ['scripts/ci-pr-risk.ts', '--all-slow'] },
    { id: 'benchmark-task-suite', args: ['run', 'sec', '--', 'benchmark', 'suite', '--json', '--compact'] },
    { id: 'deps-warmup', args: ['run', 'sec', '--', 'deps', 'warmup'] },
    { id: 'resolve', args: ['run', 'sec', '--', 'resolve'] },
    { id: 'compose', args: ['run', 'sec', '--', 'compose'] },
    { id: 'adapt', args: ['run', 'sec', '--', 'adapt'] },
    { id: 'verify-all', args: ['run', 'sec', '--', 'verify', '--lane', 'all', '--json', '--compact'] },
    { id: 'lock', args: ['run', 'sec', '--', 'lock'] },
    { id: 'explain', args: ['run', 'sec', '--', 'explain'] },
    { id: 'reference-check', args: ['run', 'sec', '--', 'reference', 'check', '--json', '--compact'] }
  ];
}

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(2)}s`;
}

function writeEvidence(evidence: VerificationEvidence): void {
  const evidencePath = path.resolve(VERIFICATION_EVIDENCE_PATH);
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`SEC verification evidence: ${VERIFICATION_EVIDENCE_PATH}`);
  console.log(`SEC_VERIFICATION_SUMMARY ${JSON.stringify(evidence)}`);
}

function appendFailureTail(current: string, chunk: Buffer): string {
  const combined = `${current}${chunk.toString('utf8')}`;
  return combined.length > FAILURE_TAIL_CHARACTER_LIMIT
    ? combined.slice(-FAILURE_TAIL_CHARACTER_LIMIT)
    : combined;
}

function runGate(step: GateStep): Promise<GateResult> {
  const startedAt = Date.now();
  console.log(`::group::SEC verification: ${step.id}`);
  console.log(`SEC verification: ${step.id} started`);

  return new Promise((resolve) => {
    const child = spawn('bun', step.args, {
      env: {
        ...process.env,
        SEC_TEST_WORKSPACE_NAMESPACE: `verification-${step.id.replace(/[^a-z0-9]+/giu, '-').toLowerCase()}`
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let failureTail = '';
    let settled = false;

    child.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
      failureTail = appendFailureTail(failureTail, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      failureTail = appendFailureTail(failureTail, chunk);
    });

    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      const durationMs = Date.now() - startedAt;
      console.log(`SEC verification: ${step.id} finished with exit code ${code} in ${formatDuration(durationMs)}`);
      console.log('::endgroup::');
      resolve({
        id: step.id,
        code,
        durationMs,
        ...(code === 0 ? {} : { failureTail })
      });
    };

    child.on('error', (error) => {
      const message = `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`;
      process.stderr.write(message);
      failureTail = appendFailureTail(failureTail, Buffer.from(message));
      finish(1);
    });
    child.on('close', (code) => finish(code ?? 1));
  });
}

const profile = verificationProfile();
const headSha = currentHeadSha();
assertExpectedHead(headSha);
const files = changedFiles();
const steps = profile === 'full' ? fullGateSteps() : quickGateSteps(files);
const startedAt = Date.now();
const results: GateResult[] = [];

console.log(`SEC verification contract revision: ${CI_VERIFICATION_CONTRACT_REVISION}`);
console.log(`SEC verification profile: ${profile}`);
console.log(`SEC verification exact head: ${headSha}`);
console.log(`SEC verification changed files: ${files === null ? 'unavailable' : files.join(', ')}`);

for (const step of steps) {
  const result = await runGate(step);
  results.push(result);
  if (result.code !== 0) {
    console.error(`SEC verification failed at ${result.id} with exit code ${result.code}.`);
    writeEvidence({
      contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
      profile,
      headSha,
      status: 'failed',
      changedFiles: files,
      failedGate: result.id,
      results
    });
    process.exit(result.code);
  }
}

console.log(`SEC verification completed in ${formatDuration(Date.now() - startedAt)}.`);
writeEvidence({
  contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
  profile,
  headSha,
  status: 'passed',
  changedFiles: files,
  results
});
