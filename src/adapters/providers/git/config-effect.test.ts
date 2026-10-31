import { settleWorkspaceCallback } from '../../../../tests/testkit/workspace-cleanup.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { sha256 } from '../../../contracts/canonical.ts';
import { issueOperationRequirementBindingContext } from '../../../execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type OperationDigest
} from '../../../execution/operation/semantic.ts';
import { ResourceCompositeSettlementError, settleResources, type ResourceSettlementFailure } from '../../../execution/resource-settlement.ts';
import { openProcessResourceSession } from '../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  assertGitConfigEffectReceipt,
  closeGitConfigTargetCapability,
  createGitConfigEffectTestActorForTests,
  issueGitConfigTargetCapability,
  replaceAllGitConfigValue
} from './config-effect.ts';
import {
  assertGitPhysicalProviderReceipt,
  closeGitPhysicalProvider,
  openGitPhysicalProvider,
  runGitPhysicalCommandInternal
} from './physical-provider.ts';

test('GitConfigTarget duplicate physical rejection cannot release another live claim', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-git-config-alias-'));
  const cleanup: { label: string; settle(): void }[] = [
    { label: 'Git config root', settle: () => rmSync(root, { recursive: true, force: true }) }
  ];
  await settleWorkspaceCallback(async () => {
    const firstPath = path.join(root, 'first');
    const secondPath = path.join(root, 'second');
    const thirdPath = path.join(root, 'third');
    await fs.writeFile(firstPath, '[core]\n\trepositoryformatversion = 0\n');
    await fs.link(firstPath, secondPath);
    await fs.link(firstPath, thirdPath);
    let first: Awaited<ReturnType<typeof issueGitConfigTargetCapability>> | null = null;
    let successor: Awaited<ReturnType<typeof issueGitConfigTargetCapability>> | null = null;
    cleanup.unshift(
      { label: 'first config target', settle: () => { if (first !== null) closeGitConfigTargetCapability(first); } },
      { label: 'successor config target', settle: () => { if (successor !== null) closeGitConfigTargetCapability(successor); } }
    );
    first = await issueGitConfigTargetCapability({ path: firstPath });
    await expect(issueGitConfigTargetCapability({ path: secondPath })).rejects.toThrow(/physical identity/u);
    await expect(issueGitConfigTargetCapability({ path: thirdPath })).rejects.toThrow(/physical identity/u);
    closeGitConfigTargetCapability(first);
    successor = await issueGitConfigTargetCapability({ path: thirdPath });
    closeGitConfigTargetCapability(first);
    await expect(issueGitConfigTargetCapability({ path: secondPath })).rejects.toThrow(/physical identity/u);
  }, async () => { settleResources({ cleanup }); });
});

const CONTRACT = sha256({ test: 'git-config-effect' }) as OperationDigest;
const REQUIREMENT = 'git.config-effect.process';

function testOperation(input: Readonly<{
  processes?: number;
  outputBytes?: number;
  signal?: AbortSignal;
}> = {}) {
  const plan = compileSemanticOperationPlan({
    operation: 'external-capabilities.git.config-effect.test',
    intentDigest: sha256({ processes: input.processes ?? 2 }) as OperationDigest,
    decisionDigest: CONTRACT,
    deadlineAtUnixMs: Date.now() + 10_000,
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: CONTRACT }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: 10_000 },
      { resource: 'input-bytes', maximum: 0 },
      { resource: 'output-bytes', maximum: input.outputBytes ?? 512 * 1024 },
      { resource: 'processes', maximum: input.processes ?? 2 }
    ],
    requirements: [{
      id: REQUIREMENT,
      contractDigest: CONTRACT,
      effectKinds: ['filesystem', 'process'],
      failureKinds: ['filesystem.identity-drift', 'process.unavailable']
    }]
  });
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: REQUIREMENT,
    contractDigest: CONTRACT,
    providerIdentityDigest: CONTRACT
  })]);
}

function gitExecutable(): string {
  const executable = Bun.which('git');
  if (executable === null) throw new Error('Focused Git config test requires Git.');
  return path.resolve(executable);
}

function openTestProvider(root: string, processes = 2, outputBytes = 512 * 1024, signal?: AbortSignal) {
  const operation = testOperation({ processes, outputBytes });
  const processSession = openProcessResourceSession({
    operation,
    requirementBindingContext: issueOperationRequirementBindingContext({
      operation,
      requirementId: REQUIREMENT,
      resourceCeilings: operation.plan.execution.aggregateBudgets
    }),
    ...(signal === undefined ? {} : { signal })
  });
  try {
    const resolution = openGitPhysicalProvider({
      cwd: root,
      executablePath: gitExecutable(),
      operation,
      processSession,
      maximumExecutableBytes: 64 * 1024 * 1024
    });
    if (resolution.status !== 'ready') {
      throw new Error(`Focused Git physical provider unavailable: ${resolution.reason}`);
    }
    return { operation, processSession, provider: resolution.capability };
  } catch (error) {
    settleResources({ primary: { label: 'Git provider construction', error }, cleanup: [
      { label: 'process session', settle: () => { processSession.close(); } }
    ] });
    throw error;
  }
}

test('GitConfigEffect rejects target ABA, structural origin copies and invalid key/value before child', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-git-config-negative-'));
  let processSessionSettled = true;
  let nativeTerminalProven = true;
  const cleanup: { label: string; settle(): void }[] = [
    { label: 'Git config root', settle: () => {
      if (!nativeTerminalProven) {
        throw new Error(`Git config fixture retained because native termination is unproven: ${root}`);
      }
      if (processSessionSettled) rmSync(root, { recursive: true, force: true });
    } }
  ];
  await settleWorkspaceCallback(async () => {
    const targetPath = path.join(root, 'config');
    await fs.writeFile(targetPath, '[core]\n\trepositoryformatversion = 0\n', 'utf8');
    const { processSession, provider } = openTestProvider(root);
    processSessionSettled = false;
    const retireProvider = { label: 'Git provider', settle: () => { if (nativeTerminalProven) closeGitPhysicalProvider(provider); } };
    cleanup.unshift(
      retireProvider,
      { label: 'process session', settle: () => { processSession.close(); processSessionSettled = true; } }
    );
    let invalidTarget: Awaited<ReturnType<typeof issueGitConfigTargetCapability>> | null = null;
    let changedTarget: Awaited<ReturnType<typeof issueGitConfigTargetCapability>> | null = null;
    cleanup.unshift(
      { label: 'invalid config target', settle: () => { if (nativeTerminalProven && invalidTarget !== null) closeGitConfigTargetCapability(invalidTarget); } },
      { label: 'changed config target', settle: () => { if (nativeTerminalProven && changedTarget !== null) closeGitConfigTargetCapability(changedTarget); } }
    );
    invalidTarget = await issueGitConfigTargetCapability({ path: targetPath });
    nativeTerminalProven = false;
    await expect(replaceAllGitConfigValue({
      provider,
      target: invalidTarget,
      key: 'invalid',
      value: 'value'
    })).rejects.toThrow(/key is not canonical/u);
    await expect(replaceAllGitConfigValue({
      provider,
      target: { ...invalidTarget },
      key: 'core.hooksPath',
      value: 'value'
    })).rejects.toThrow(/owner-issued target/u);
    await expect(replaceAllGitConfigValue({
      provider: { ...provider },
      target: invalidTarget,
      key: 'core.hooksPath',
      value: 'value'
    })).rejects.toThrow(/owner-issued capability/u);
    closeGitConfigTargetCapability(invalidTarget);
    invalidTarget = null;
    changedTarget = await issueGitConfigTargetCapability({ path: targetPath });
    const replacementPath = path.join(root, 'replacement');
    await fs.writeFile(replacementPath, '[core]\n\trepositoryformatversion = 1\n', 'utf8');
    await expect(replaceAllGitConfigValue({
      provider,
      target: changedTarget,
      key: 'core.hooksPath',
      value: 'value\nwith-newline'
    })).rejects.toThrow(/bounded line/u);
    let replacementSucceeded = false;
    try {
      await fs.rename(replacementPath, targetPath);
      replacementSucceeded = true;
    } catch {
      // A retained Windows target may reject replacement at the physical boundary.
    }
    if (replacementSucceeded) {
      await expect(replaceAllGitConfigValue({
        provider,
        target: changedTarget,
        key: 'core.hooksPath',
        value: 'value'
      })).rejects.toThrow(/changed|current/u);
    } else {
      closeGitConfigTargetCapability(changedTarget);
      changedTarget = null;
    }
    expect(processSession.processCount).toBe(0);
    nativeTerminalProven = true;
    closeGitPhysicalProvider(provider);
    cleanup.splice(cleanup.indexOf(retireProvider), 1);
  }, async () => { settleResources({ cleanup }); });
});

test('GitConfigEffect rejects insufficient parent process budget and cancelled provider admission with zero child', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-git-config-budget-'));
  try {
    const targetPath = path.join(root, 'config');
    await fs.writeFile(targetPath, '[core]\n\trepositoryformatversion = 0\n', 'utf8');
    const limited = openTestProvider(root, 1);
    let limitedTarget: Awaited<ReturnType<typeof issueGitConfigTargetCapability>> | null = null;
    try {
      limitedTarget = await issueGitConfigTargetCapability({ path: targetPath });
      await expect(replaceAllGitConfigValue({
        provider: limited.provider,
        target: limitedTarget,
        key: 'core.hooksPath',
        value: 'value'
      })).rejects.toThrow(/insufficient aggregate resources/u);
      expect(limited.processSession.processCount).toBe(0);
    } finally {
      try {
        if (limitedTarget !== null) closeGitConfigTargetCapability(limitedTarget);
      } finally {
        try {
          closeGitPhysicalProvider(limited.provider);
        } finally {
          limited.processSession.close();
        }
      }
    }

    const outputLimited = openTestProvider(root, 2, 1);
    let outputLimitedTarget: Awaited<ReturnType<typeof issueGitConfigTargetCapability>> | null = null;
    try {
      outputLimitedTarget = await issueGitConfigTargetCapability({ path: targetPath });
      await expect(replaceAllGitConfigValue({
        provider: outputLimited.provider,
        target: outputLimitedTarget,
        key: 'core.hooksPath',
        value: 'value'
      })).rejects.toThrow(/insufficient aggregate resources/u);
      expect(outputLimited.processSession.processCount).toBe(0);
    } finally {
      try {
        if (outputLimitedTarget !== null) closeGitConfigTargetCapability(outputLimitedTarget);
      } finally {
        try {
          closeGitPhysicalProvider(outputLimited.provider);
        } finally {
          outputLimited.processSession.close();
        }
      }
    }

    const operation = testOperation();
    const controller = new AbortController();
    const cancelled = openProcessResourceSession({
      operation,
      requirementBindingContext: issueOperationRequirementBindingContext({
        operation,
        requirementId: REQUIREMENT,
        resourceCeilings: operation.plan.execution.aggregateBudgets
      }),
      signal: controller.signal
    });
    try {
      controller.abort();
      const resolution = openGitPhysicalProvider({
        cwd: root,
        executablePath: gitExecutable(),
        operation,
        processSession: cancelled,
        maximumExecutableBytes: 64 * 1024 * 1024
      });
      expect(resolution).toEqual({ status: 'unavailable', reason: 'deadline' });
      expect(cancelled.processCount).toBe(0);
    } finally {
      cancelled.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('GitConfigEffect uses a provider-local process delta inside one borrowed parent aggregate', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-git-config-borrowed-'));
  let processSessionSettled = true;
  let nativeTerminalProven = true;
  const cleanup: { label: string; settle(): void }[] = [
    { label: 'Git config root', settle: () => {
      if (!nativeTerminalProven) {
        throw new Error(`Git config fixture retained because native termination is unproven: ${root}`);
      }
      if (processSessionSettled) rmSync(root, { recursive: true, force: true });
    } }
  ];
  await settleWorkspaceCallback(async () => {
    const targetPath = path.join(root, 'config');
    await fs.writeFile(targetPath, '[core]\n\trepositoryformatversion = 0\n', 'utf8');
    const first = openTestProvider(root, 3);
    processSessionSettled = false;
    cleanup.unshift(
      { label: 'first Git provider', settle: () => { if (nativeTerminalProven) closeGitPhysicalProvider(first.provider); } },
      { label: 'process session', settle: () => { first.processSession.close(); processSessionSettled = true; } }
    );
    let secondProvider: Parameters<typeof closeGitPhysicalProvider>[0] | null = null;
    let target: Awaited<ReturnType<typeof issueGitConfigTargetCapability>> | null = null;
    cleanup.unshift(
      { label: 'config target', settle: () => { if (nativeTerminalProven && target !== null) closeGitConfigTargetCapability(target); } },
      { label: 'second Git provider', settle: () => { if (nativeTerminalProven && secondProvider !== null) closeGitPhysicalProvider(secondProvider); } }
    );
    nativeTerminalProven = false;
    const firstResult = await runGitPhysicalCommandInternal(first.provider, ['--version'], {
      env: first.provider.environment,
      envMode: 'replace',
      maxStdoutBytes: 64 * 1024,
      maxStderrBytes: 64 * 1024
    });
    nativeTerminalProven = true;
    expect(firstResult.result.code).toBe(0);
    closeGitPhysicalProvider(first.provider);

    const secondResolution = openGitPhysicalProvider({
      cwd: root,
      executablePath: gitExecutable(),
      operation: first.operation,
      processSession: first.processSession,
      maximumExecutableBytes: 64 * 1024 * 1024
    });
    if (secondResolution.status !== 'ready') {
      throw new Error(`Second borrowed Git provider unavailable: ${secondResolution.reason}`);
    }
    secondProvider = secondResolution.capability;
    target = await issueGitConfigTargetCapability({ path: targetPath });
    nativeTerminalProven = false;
    const receipt = await replaceAllGitConfigValue({
      provider: secondProvider,
      target,
      key: 'core.hooksPath',
      value: 'D:/canonical-hooks'
    });
    nativeTerminalProven = true;
    assertGitConfigEffectReceipt(receipt);
    expect(receipt.writeOrdinal).toBe(2);
    expect(receipt.readbackOrdinal).toBe(3);
    expect(await fs.readFile(targetPath, 'utf8')).toContain('hooksPath = D:/canonical-hooks');
    const providerReceipt = closeGitPhysicalProvider(secondProvider);
    assertGitPhysicalProviderReceipt(providerReceipt, secondProvider);
    expect(providerReceipt.processCount).toBe(2);
    expect(first.processSession.processCount).toBe(3);
    expect(() => first.processSession.cooperativeDeadlineAtUnixMs()).not.toThrow();
  }, async () => { settleResources({ cleanup }); });
});

test('GitConfigEffect claims one capability before await and rejects active close', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-git-config-single-claim-'));
  let processSessionSettled = true;
  let nativeTerminalProven = true;
  const cleanup: { label: string; settle(): void }[] = [
    { label: 'Git config root', settle: () => {
      if (!nativeTerminalProven) {
        throw new Error(`Git config fixture retained because native termination is unproven: ${root}`);
      }
      if (processSessionSettled) rmSync(root, { recursive: true, force: true });
    } }
  ];
  await settleWorkspaceCallback(async () => {
    const targetPath = path.join(root, 'config');
    await fs.writeFile(targetPath, '[core]\n\trepositoryformatversion = 0\n');
    const { processSession, provider } = openTestProvider(root);
    processSessionSettled = false;
    cleanup.unshift(
      { label: 'Git provider', settle: () => { if (nativeTerminalProven) closeGitPhysicalProvider(provider); } },
      { label: 'process session', settle: () => { processSession.close(); processSessionSettled = true; } }
    );
    const target = await issueGitConfigTargetCapability({ path: targetPath });
    cleanup.unshift({ label: 'config target', settle: () => { if (nativeTerminalProven) closeGitConfigTargetCapability(target); } });
    nativeTerminalProven = false;
    const first = replaceAllGitConfigValue({ provider, target, key: 'core.hooksPath', value: 'accepted' });
    const second = replaceAllGitConfigValue({ provider, target, key: 'core.hooksPath', value: 'rejected' })
      .then(() => null, (error: unknown) => error);
    const joined = Promise.allSettled([first, second]);
    let primary: ResourceSettlementFailure | undefined;
    try {
      expect(() => closeGitConfigTargetCapability(target)).toThrow(/active effect/u);
      expect(String(await second)).toMatch(/unused owner-issued/u);
    } catch (error) {
      primary = { label: 'active config claim assertions', error };
    }
    const outcomes = await joined;
    nativeTerminalProven = outcomes[0]!.status === 'fulfilled';
    settleResources({ primary, cleanup: outcomes.map((outcome, index) => ({
      label: `config effect ${index}`,
      settle() { if (outcome.status === 'rejected') throw outcome.reason; }
    })) });
    const firstOutcome = outcomes[0]!;
    if (firstOutcome.status !== 'fulfilled') throw firstOutcome.reason;
    assertGitConfigEffectReceipt(firstOutcome.value);
    expect(await fs.readFile(targetPath, 'utf8')).toContain('hooksPath = accepted');
    expect(processSession.processCount).toBe(2);
    expect(await fs.readdir(root)).toEqual(['config']);
  }, async () => { settleResources({ cleanup }); });
});

test('GitConfigEffect respects an existing real Git lock without children or foreign cleanup', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-git-config-foreign-lock-'));
  let processSessionSettled = true;
  let nativeTerminalProven = true;
  const cleanup: { label: string; settle(): void }[] = [
    { label: 'Git config root', settle: () => {
      if (!nativeTerminalProven) {
        throw new Error(`Git config fixture retained because native termination is unproven: ${root}`);
      }
      if (processSessionSettled) rmSync(root, { recursive: true, force: true });
    } }
  ];
  await settleWorkspaceCallback(async () => {
    const targetPath = path.join(root, 'config');
    const original = '[core]\n\trepositoryformatversion = 0\n';
    await fs.writeFile(targetPath, original);
    await fs.writeFile(`${targetPath}.lock`, 'foreign lock\n');
    const { processSession, provider } = openTestProvider(root);
    processSessionSettled = false;
    cleanup.unshift(
      { label: 'Git provider', settle: () => { if (nativeTerminalProven) closeGitPhysicalProvider(provider); } },
      { label: 'process session', settle: () => { processSession.close(); processSessionSettled = true; } }
    );
    const target = await issueGitConfigTargetCapability({ path: targetPath });
    cleanup.unshift({ label: 'config target', settle: () => { if (nativeTerminalProven) closeGitConfigTargetCapability(target); } });
    nativeTerminalProven = false;
    await expect(replaceAllGitConfigValue({ provider, target, key: 'core.hooksPath', value: 'new' }))
      .rejects.toMatchObject({ code: 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED' });
    expect(processSession.processCount).toBe(0);
    nativeTerminalProven = true;
    expect(await fs.readFile(targetPath, 'utf8')).toBe(original);
    expect(await fs.readFile(`${targetPath}.lock`, 'utf8')).toBe('foreign lock\n');
    expect((await fs.readdir(root)).sort()).toEqual(['config', 'config.lock']);
  }, async () => { settleResources({ cleanup }); });
});

test('GitConfigEffect holds the actual target lock while real Git validates the private output', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-git-config-cooperative-writer-'));
  let processSessionSettled = true;
  let nativeTerminalProven = true;
  const cleanup: { label: string; settle(): void }[] = [
    { label: 'Git config root', settle: () => {
      if (!nativeTerminalProven) {
        throw new Error(`Git config fixture retained because native termination is unproven: ${root}`);
      }
      if (processSessionSettled) rmSync(root, { recursive: true, force: true });
    } }
  ];
  await settleWorkspaceCallback(async () => {
    const targetPath = path.join(root, 'config');
    const original = '[core]\n\trepositoryformatversion = 0\n';
    await fs.writeFile(targetPath, original);
    const { processSession, provider } = openTestProvider(root);
    processSessionSettled = false;
    cleanup.unshift(
      { label: 'Git provider', settle: () => { if (nativeTerminalProven) closeGitPhysicalProvider(provider); } },
      { label: 'process session', settle: () => { processSession.close(); processSessionSettled = true; } }
    );
    const target = await issueGitConfigTargetCapability({ path: targetPath });
    cleanup.unshift({ label: 'config target', settle: () => { if (nativeTerminalProven) closeGitConfigTargetCapability(target); } });
    const actor = createGitConfigEffectTestActorForTests({
      async beforePublication() {
        expect(await fs.readFile(targetPath, 'utf8')).toBe(original);
        const concurrent = Bun.spawnSync([gitExecutable(), 'config', '--file', targetPath,
          '--replace-all', 'core.foreign', 'unadmitted']);
        expect(concurrent.exitCode).not.toBe(0);
        expect(Buffer.from(concurrent.stderr).toString()).toMatch(/lock|File exists/u);
        expect(await fs.readFile(targetPath, 'utf8')).toBe(original);
      }
    });
    nativeTerminalProven = false;
    assertGitConfigEffectReceipt(await replaceAllGitConfigValue({
      provider, target, key: 'core.hooksPath', value: 'accepted', testOnlyActor: actor
    }));
    nativeTerminalProven = true;
    const result = await fs.readFile(targetPath, 'utf8');
    expect(result).toContain('hooksPath = accepted');
    expect(result).not.toContain('unadmitted');
    expect(processSession.processCount).toBe(2);
    expect(await fs.readdir(root)).toEqual(['config']);
  }, async () => { settleResources({ cleanup }); });
});

test('GitConfigEffect preserves primary preimage failure and independent cleanup residue', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-git-config-composite-'));
  let processSessionSettled = true;
  let nativeTerminalProven = true;
  const cleanup: { label: string; settle(): void }[] = [
    { label: 'Git config root', settle: () => {
      if (!nativeTerminalProven) {
        throw new Error(`Git config fixture retained because native termination is unproven: ${root}`);
      }
      if (processSessionSettled) rmSync(root, { recursive: true, force: true });
    } }
  ];
  await settleWorkspaceCallback(async () => {
    const targetPath = path.join(root, 'config');
    await fs.writeFile(targetPath, '[core]\n\trepositoryformatversion = 0\n');
    const replacement = '[core]\n\tforeign = preserved\n';
    const { processSession, provider } = openTestProvider(root);
    processSessionSettled = false;
    cleanup.unshift(
      { label: 'Git provider', settle: () => { if (nativeTerminalProven) closeGitPhysicalProvider(provider); } },
      { label: 'process session', settle: () => { processSession.close(); processSessionSettled = true; } }
    );
    const target = await issueGitConfigTargetCapability({ path: targetPath });
    cleanup.unshift({ label: 'config target', settle: () => { if (nativeTerminalProven) closeGitConfigTargetCapability(target); } });
    const actor = createGitConfigEffectTestActorForTests({
      async beforePublication() {
        nativeTerminalProven = true;
        await fs.writeFile(targetPath, replacement);
        await fs.writeFile(`${targetPath}.lock`, 'foreign lock replacement\n');
      }
    });
    nativeTerminalProven = false;
    const failure = await replaceAllGitConfigValue({
      provider, target, key: 'core.hooksPath', value: 'unpublished', testOnlyActor: actor
    }).then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(ResourceCompositeSettlementError);
    const failures = (failure as ResourceCompositeSettlementError).failures;
    expect(failures.map(({ label }) => label)).toEqual(['git-config-effect', 'git-config-target-lock']);
    expect(String(failures[0]!.error)).toMatch(/bytes changed|preimage/u);
    expect(processSession.processCount).toBe(2);
    expect(await fs.readFile(targetPath, 'utf8')).toBe(replacement);
    expect(await fs.readFile(`${targetPath}.lock`, 'utf8')).toBe('foreign lock replacement\n');
    expect((await fs.readdir(root)).sort()).toEqual(['config', 'config.lock']);
  }, async () => { settleResources({ cleanup }); });
});

test('GitConfigEffect cleanup failure after publication preserves the committed value and lock residue', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-git-config-committed-cleanup-'));
  let processSessionSettled = true;
  let nativeTerminalProven = true;
  const cleanup: { label: string; settle(): void }[] = [
    { label: 'Git config root', settle: () => {
      if (!nativeTerminalProven) {
        throw new Error(`Git config fixture retained because native termination is unproven: ${root}`);
      }
      if (processSessionSettled) rmSync(root, { recursive: true, force: true });
    } }
  ];
  await settleWorkspaceCallback(async () => {
    const targetPath = path.join(root, 'config');
    await fs.writeFile(targetPath, '[core]\n\trepositoryformatversion = 0\n');
    const { processSession, provider } = openTestProvider(root);
    processSessionSettled = false;
    cleanup.unshift(
      { label: 'Git provider', settle: () => { if (nativeTerminalProven) closeGitPhysicalProvider(provider); } },
      { label: 'process session', settle: () => { processSession.close(); processSessionSettled = true; } }
    );
    const target = await issueGitConfigTargetCapability({ path: targetPath });
    cleanup.unshift({ label: 'config target', settle: () => { if (nativeTerminalProven) closeGitConfigTargetCapability(target); } });
    const actor = createGitConfigEffectTestActorForTests({
      async beforePublication() { nativeTerminalProven = true; await fs.writeFile(`${targetPath}.lock`, 'changed cleanup preimage\n'); }
    });
    nativeTerminalProven = false;
    const failure = await replaceAllGitConfigValue({
      provider, target, key: 'core.hooksPath', value: 'committed', testOnlyActor: actor
    }).then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(ResourceCompositeSettlementError);
    expect((failure as ResourceCompositeSettlementError).failures.map(({ label }) => label))
      .toEqual(['git-config-target-lock']);
    expect(await fs.readFile(targetPath, 'utf8')).toContain('hooksPath = committed');
    expect(await fs.readFile(`${targetPath}.lock`, 'utf8')).toBe('changed cleanup preimage\n');
    expect((await fs.readdir(root)).sort()).toEqual(['config', 'config.lock']);
    await expect(replaceAllGitConfigValue({ provider, target, key: 'core.hooksPath', value: 'retry' }))
      .rejects.toThrow(/unused owner-issued/u);
  }, async () => { settleResources({ cleanup }); });
});

test('GitConfigEffect cancellation after Git validation prevents publication and settles owned files', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-git-config-cancel-publication-'));
  let processSessionSettled = true;
  let nativeTerminalProven = true;
  const cleanup: { label: string; settle(): void }[] = [
    { label: 'Git config root', settle: () => {
      if (!nativeTerminalProven) {
        throw new Error(`Git config fixture retained because native termination is unproven: ${root}`);
      }
      if (processSessionSettled) rmSync(root, { recursive: true, force: true });
    } }
  ];
  await settleWorkspaceCallback(async () => {
    const targetPath = path.join(root, 'config');
    const original = '[core]\n\trepositoryformatversion = 0\n';
    await fs.writeFile(targetPath, original);
    const controller = new AbortController();
    const { processSession, provider } = openTestProvider(root, 2, 512 * 1024, controller.signal);
    processSessionSettled = false;
    cleanup.unshift(
      { label: 'Git provider', settle: () => { if (nativeTerminalProven) closeGitPhysicalProvider(provider); } },
      { label: 'process session', settle: () => { processSession.close(); processSessionSettled = true; } }
    );
    const target = await issueGitConfigTargetCapability({ path: targetPath });
    cleanup.unshift({ label: 'config target', settle: () => { if (nativeTerminalProven) closeGitConfigTargetCapability(target); } });
    const actor = createGitConfigEffectTestActorForTests({ beforePublication() { nativeTerminalProven = true; controller.abort(); } });
    nativeTerminalProven = false;
    const failure = await replaceAllGitConfigValue({
      provider, target, key: 'core.hooksPath', value: 'unpublished', testOnlyActor: actor
    }).then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(await fs.readFile(targetPath, 'utf8')).toBe(original);
    expect(processSession.processCount).toBe(2);
    expect(await fs.readdir(root)).toEqual(['config']);
  }, async () => { settleResources({ cleanup }); });
});
