import { settleResources } from '../../../../execution/resource-settlement.ts';
import { afterAll } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sha256 } from '../../../../contracts/canonical.ts';
import { issueOperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import { bindSemanticOperation, compileCapabilityBinding, compileSemanticOperationPlan, issueSemanticOperationAttemptContext, type OperationDigest } from '../../../../execution/operation/semantic.ts';
import { openProcessResourceSession } from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import { closeGitPhysicalProvider, openGitPhysicalProvider } from '../physical-provider.ts';
import { MAXIMUM_LOCAL_REF_DELETE_AGGREGATE_INPUT_BYTES, MAXIMUM_LOCAL_REF_DELETE_AGGREGATE_OUTPUT_BYTES, MAXIMUM_LOCAL_REF_DELETE_PROCESS_COUNT } from '../ref-effect.ts';

const CONTRACT = sha256({ test: 'git-ref-effect' }) as OperationDigest;
const REQUIREMENT = 'git.ref-effect.process';

export function git(root: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

// The seed has only an immutable tracked base commit. Its refs, index,
// worktree and object store are cloned into each independent test root.
// PATH, HOME and Git configuration variables distinguish initialization inputs.
const refEffectSeeds = new Map<string, string>();

function currentGitSeedKey(): string {
  const keys = Object.keys(process.env).filter(key =>
    ['PATH', 'HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'SystemRoot'].includes(key)
    || key.startsWith('GIT_')
  ).sort();
  return JSON.stringify(keys.map(key => [key, process.env[key]]));
}

function immutableRefEffectSeed(): string {
  const key = currentGitSeedKey();
  const existing = refEffectSeeds.get(key);
  if (existing !== undefined) return existing;
  const root = mkdtempSync(path.join(tmpdir(), 'sec-git-ref-effect-base-'));
  try {
    git(root, ['init', '--quiet', '--initial-branch=current']);
    git(root, ['config', 'user.name', 'SEC Tests']);
    git(root, ['config', 'user.email', 'tests@example.com']);
    writeFileSync(path.join(root, 'base.txt'), 'base\n', 'utf8');
    git(root, ['add', 'base.txt']);
    git(root, ['commit', '--quiet', '-m', 'base']);
    refEffectSeeds.set(key, root);
    return root;
  } catch (primary) {
    try { rmSync(root, { recursive: true, force: true }); }
    catch (cleanup) {
      throw new AggregateError([primary, cleanup], 'Git ref baseline setup and cleanup both failed');
    }
    throw primary;
  }
}

afterAll(() => {
  const failures: unknown[] = [];
  for (const [key, root] of refEffectSeeds) {
    try {
      rmSync(root, { recursive: true, force: true });
      refEffectSeeds.delete(key);
    } catch (failure) {
      failures.push(failure);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Git ref baseline cleanup failed');
});

export function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-git-ref-effect-'));
  try {
    const seed = immutableRefEffectSeed();
    cpSync(path.join(seed, '.git'), path.join(root, '.git'), {
      recursive: true, force: false, errorOnExist: true
    });
    copyFileSync(path.join(seed, 'base.txt'), path.join(root, 'base.txt'));
    return root;
  } catch (primary) {
    try { rmSync(root, { recursive: true, force: true }); }
    catch (cleanup) {
      throw new AggregateError([primary, cleanup], 'Git ref fixture setup and cleanup both failed');
    }
    throw primary;
  }
}

function testOperation() {
  const plan = compileSemanticOperationPlan({
    operation: 'external-capabilities.git.ref-effect.test',
    intentDigest: CONTRACT,
    decisionDigest: CONTRACT,
    deadlineAtUnixMs: Date.now() + 10_000,
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: CONTRACT }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: 10_000 },
      { resource: 'input-bytes', maximum: MAXIMUM_LOCAL_REF_DELETE_AGGREGATE_INPUT_BYTES },
      { resource: 'output-bytes', maximum: MAXIMUM_LOCAL_REF_DELETE_AGGREGATE_OUTPUT_BYTES },
      { resource: 'processes', maximum: MAXIMUM_LOCAL_REF_DELETE_PROCESS_COUNT }
    ],
    requirements: [{
      id: REQUIREMENT,
      contractDigest: CONTRACT,
      effectKinds: ['filesystem', 'process'],
      failureKinds: ['filesystem.write-failed', 'process.unavailable']
    }]
  });
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: REQUIREMENT,
    contractDigest: CONTRACT,
    providerIdentityDigest: CONTRACT
  })]);
}

export function openProvider(root: string) {
  const operation = testOperation();
  const processSession = openProcessResourceSession({
    operation,
    requirementBindingContext: issueOperationRequirementBindingContext({
      operation,
      requirementId: REQUIREMENT,
      resourceCeilings: operation.plan.execution.aggregateBudgets
    })
  });
  try {
    const executablePath = Bun.which('git');
    if (executablePath === null) throw new Error('Focused Git ref test requires Git.');
    const resolution = openGitPhysicalProvider({
      cwd: root,
      executablePath: path.resolve(executablePath),
      operation,
      processSession,
      maximumExecutableBytes: 64 * 1024 * 1024
    });
    if (resolution.status !== 'ready') throw new Error(`Git provider unavailable: ${resolution.reason}`);
    return { processSession, provider: resolution.capability };
  } catch (error) {
    settleResources({
      primary: { label: 'Git ref provider fixture construction', error },
      cleanup: [{ label: 'Git ref fixture process session', settle: () => { processSession.close(); } }]
    });
    throw error;
  }
}

export function closeProvider(value: ReturnType<typeof openProvider>): void {
  closeGitPhysicalProvider(value.provider);
  value.processSession.close();
}
