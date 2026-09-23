import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { sha256 } from '../../../contracts/canonical.ts';
import { issueSecOperationRequirementBindingContext } from '../../../execution/operation/requirement-binding-context.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext,
  type SecOperationDigest
} from '../../../execution/operation/semantic.ts';
import { openProcessResourceSession } from '../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  closeGitPhysicalProvider,
  openGitPhysicalProvider,
  type GitPhysicalProviderCapability
} from './physical-provider.ts';
import {
  assertGitRefDeleteReceipt,
  deleteExactGitRef,
  GitLocalRefDeleteAtomicityUnavailableError,
  GitRefDeleteOutcomeUnknownError
} from './ref-effect.ts';

const CONTRACT = sha256({ test: 'git-ref-effect' }) as SecOperationDigest;
const REQUIREMENT = 'git.ref-effect.process';

function git(root: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-git-ref-effect-'));
  git(root, ['init', '--quiet', '--initial-branch=current']);
  git(root, ['config', 'user.name', 'SEC Tests']);
  git(root, ['config', 'user.email', 'tests@example.com']);
  writeFileSync(path.join(root, 'base.txt'), 'base\n', 'utf8');
  git(root, ['add', 'base.txt']);
  git(root, ['commit', '--quiet', '-m', 'base']);
  return root;
}

function testOperation() {
  const plan = compileSecSemanticOperationPlan({
    operation: 'external-capabilities.git.ref-effect.test',
    intentDigest: CONTRACT,
    decisionDigest: CONTRACT,
    deadlineAtUnixMs: Date.now() + 10_000,
    attempt: issueSecSemanticOperationAttemptContext({ authorityGrantDigest: CONTRACT }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: 10_000 },
      { resource: 'input-bytes', maximum: 0 },
      { resource: 'output-bytes', maximum: 1024 * 1024 },
      { resource: 'processes', maximum: 3 }
    ],
    requirements: [{
      id: REQUIREMENT,
      contractDigest: CONTRACT,
      effectKinds: ['filesystem', 'process'],
      failureKinds: ['filesystem.write-failed', 'process.unavailable']
    }]
  });
  return bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
    requirementId: REQUIREMENT,
    contractDigest: CONTRACT,
    providerIdentityDigest: CONTRACT
  })]);
}

function openProvider(root: string) {
  const operation = testOperation();
  const processSession = openProcessResourceSession({
    operation,
    requirementBindingContext: issueSecOperationRequirementBindingContext({
      operation,
      requirementId: REQUIREMENT,
      resourceCeilings: operation.plan.execution.aggregateBudgets
    })
  });
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
}

function closeProvider(value: ReturnType<typeof openProvider>): void {
  closeGitPhysicalProvider(value.provider);
  value.processSession.close();
}

test('GitRefEffect CAS-deletes an exact remote-tracking ref with absence readback', async () => {
  const root = fixture();
  try {
    const sha = git(root, ['rev-parse', 'HEAD']);
    git(root, ['update-ref', 'refs/remotes/origin/topic', sha]);
    const ref = 'refs/remotes/origin/topic';
    const opened = openProvider(root);
    try {
      const receipt = await deleteExactGitRef({ provider: opened.provider, ref, expectedOldSha: sha });
      assertGitRefDeleteReceipt(receipt);
      expect(receipt.ref).toBe(ref);
      expect(receipt.disposition).toBe('deleted');
      expect(spawnSync('git', ['show-ref', '--verify', '--quiet', ref], { cwd: root }).status).toBe(1);
    } finally {
      closeProvider(opened);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('GitRefEffect binds an already-absent receipt to the final ref observation', async () => {
  const root = fixture();
  try {
    const sha = git(root, ['rev-parse', 'HEAD']);
    const opened = openProvider(root);
    try {
      const receipt = await deleteExactGitRef({
        provider: opened.provider,
        ref: 'refs/remotes/origin/absent-topic',
        expectedOldSha: sha
      });
      assertGitRefDeleteReceipt(receipt);
      expect(receipt.disposition).toBe('already-absent');
      expect(receipt.updateOrdinal).toBeNull();
      // Only the second native observation can witness absence at issuance.
      expect(receipt.readbackOrdinal).toBe(2);
    } finally {
      closeProvider(opened);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('GitRefEffect refuses local deletion before consuming its Effect capability', async () => {
  const root = fixture();
  try {
    const sha = git(root, ['rev-parse', 'HEAD']);
    git(root, ['branch', 'topic']);
    git(root, ['update-ref', 'refs/remotes/origin/topic', sha]);
    const opened = openProvider(root);
    try {
      await expect(deleteExactGitRef({
        provider: opened.provider,
        ref: 'refs/heads/topic',
        expectedOldSha: sha
      })).rejects.toBeInstanceOf(GitLocalRefDeleteAtomicityUnavailableError);
      expect(opened.processSession.processCount).toBe(0);
      expect(git(root, ['rev-parse', 'refs/heads/topic'])).toBe(sha);
      const receipt = await deleteExactGitRef({
        provider: opened.provider,
        ref: 'refs/remotes/origin/topic',
        expectedOldSha: sha
      });
      expect(receipt.disposition).toBe('deleted');
    } finally {
      closeProvider(opened);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('GitRefEffect rejects wrong-preimage, symbolic, and foreign targets', async () => {
  const root = fixture();
  const linked = path.join(path.dirname(root), `${path.basename(root)}-linked`);
  try {
    const sha = git(root, ['rev-parse', 'HEAD']);
    git(root, ['branch', 'bound']);
    git(root, ['worktree', 'add', '--quiet', linked, 'bound']);
    git(root, ['update-ref', 'refs/remotes/origin/topic', sha]);
    git(root, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/topic']);

    const foreign = openProvider(root);
    try {
      await expect(deleteExactGitRef({
        provider: { ...foreign.provider } as GitPhysicalProviderCapability,
        ref: 'refs/remotes/origin/topic',
        expectedOldSha: sha
      })).rejects.toThrow(/owner-issued physical provider/u);
    } finally {
      closeProvider(foreign);
    }

    for (const [ref, expectedOldSha] of [
      ['refs/remotes/origin/HEAD', sha],
      ['refs/remotes/origin/topic', '0'.repeat(40)],
      ['refs/heads/bound', sha]
    ] as const) {
      const opened = openProvider(root);
      try {
        await expect(deleteExactGitRef({ provider: opened.provider, ref, expectedOldSha })).rejects.toThrow();
      } finally {
        closeProvider(opened);
      }
    }
  } finally {
    try { git(root, ['worktree', 'remove', '--force', linked]); } catch {}
    rmSync(linked, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('GitRefEffect reports ambiguous native failure and never replays the same provider capability', async () => {
  const root = fixture();
  try {
    const sha = git(root, ['rev-parse', 'HEAD']);
    git(root, ['update-ref', 'refs/remotes/origin/topic', sha]);
    writeFileSync(path.join(root, '.git', 'refs', 'remotes', 'origin', 'topic.lock'), 'contended\n', 'utf8');
    const opened = openProvider(root);
    try {
      await expect(deleteExactGitRef({
        provider: opened.provider,
        ref: 'refs/remotes/origin/topic',
        expectedOldSha: sha
      })).rejects.toBeInstanceOf(GitRefDeleteOutcomeUnknownError);
      await expect(deleteExactGitRef({
        provider: opened.provider,
        ref: 'refs/remotes/origin/topic',
        expectedOldSha: sha
      })).rejects.toThrow(/already attempted/u);
    } finally {
      closeProvider(opened);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
