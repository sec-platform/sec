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
import { openProcessResourceSession } from '../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  assertGitConfigEffectReceipt,
  closeGitConfigTargetCapability,
  issueGitConfigTargetCapability,
  replaceAllGitConfigValue
} from './config-effect.ts';
import {
  assertGitPhysicalProviderReceipt,
  closeGitPhysicalProvider,
  openGitPhysicalProvider,
  runGitPhysicalCommandInternal
} from './physical-provider.ts';

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

function openTestProvider(root: string, processes = 2, outputBytes = 512 * 1024) {
  const operation = testOperation({ processes, outputBytes });
  const processSession = openProcessResourceSession({
    operation,
    requirementBindingContext: issueOperationRequirementBindingContext({
      operation,
      requirementId: REQUIREMENT,
      resourceCeilings: operation.plan.execution.aggregateBudgets
    })
  });
  const resolution = openGitPhysicalProvider({
    cwd: root,
    executablePath: gitExecutable(),
    operation,
    processSession,
    maximumExecutableBytes: 64 * 1024 * 1024
  });
  if (resolution.status !== 'ready') {
    processSession.close();
    throw new Error(`Focused Git physical provider unavailable: ${resolution.reason}`);
  }
  return { operation, processSession, provider: resolution.capability };
}

test('GitConfigEffect performs exact replace-all readback and leaves the borrowed parent live', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-git-config-effect-'));
  const targetPath = path.join(root, 'config');
  await fs.writeFile(targetPath, '[core]\n\trepositoryformatversion = 0\n', 'utf8');
  const { processSession, provider } = openTestProvider(root);
  try {
    const target = await issueGitConfigTargetCapability({ path: targetPath });
    const receipt = await replaceAllGitConfigValue({
      provider,
      target,
      key: 'core.hooksPath',
      value: 'D:/canonical-hooks'
    });
    assertGitConfigEffectReceipt(receipt);
    expect(receipt.writeOrdinal).toBe(1);
    expect(receipt.readbackOrdinal).toBe(2);
    expect(await fs.readFile(targetPath, 'utf8')).toContain('hooksPath = D:/canonical-hooks');
    const providerReceipt = closeGitPhysicalProvider(provider);
    assertGitPhysicalProviderReceipt(providerReceipt, provider);
    expect(providerReceipt.processCount).toBe(2);
    expect(() => processSession.cooperativeDeadlineAtUnixMs()).not.toThrow();
  } finally {
    processSession.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('GitConfigEffect rejects target ABA, structural origin copies and invalid key/value before child', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-git-config-negative-'));
  const targetPath = path.join(root, 'config');
  await fs.writeFile(targetPath, '[core]\n\trepositoryformatversion = 0\n', 'utf8');
  const { processSession, provider } = openTestProvider(root);
  let invalidTarget: Awaited<ReturnType<typeof issueGitConfigTargetCapability>> | null = null;
  let changedTarget: Awaited<ReturnType<typeof issueGitConfigTargetCapability>> | null = null;
  try {
    invalidTarget = await issueGitConfigTargetCapability({ path: targetPath });
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
    closeGitPhysicalProvider(provider);
  } finally {
    if (invalidTarget !== null) closeGitConfigTargetCapability(invalidTarget);
    if (changedTarget !== null) closeGitConfigTargetCapability(changedTarget);
    processSession.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('GitConfigEffect rejects insufficient parent process budget and cancelled provider admission with zero child', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-git-config-budget-'));
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
    closeGitPhysicalProvider(limited.provider);
  } finally {
    if (limitedTarget !== null) closeGitConfigTargetCapability(limitedTarget);
    limited.processSession.close();
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
    closeGitPhysicalProvider(outputLimited.provider);
  } finally {
    if (outputLimitedTarget !== null) closeGitConfigTargetCapability(outputLimitedTarget);
    outputLimited.processSession.close();
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
  cancelled.close();
  rmSync(root, { recursive: true, force: true });
});

test('GitConfigEffect uses a provider-local process delta inside one borrowed parent aggregate', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-git-config-borrowed-'));
  const targetPath = path.join(root, 'config');
  await fs.writeFile(targetPath, '[core]\n\trepositoryformatversion = 0\n', 'utf8');
  const first = openTestProvider(root, 3);
  let secondProvider: Parameters<typeof closeGitPhysicalProvider>[0] | null = null;
  let target: Awaited<ReturnType<typeof issueGitConfigTargetCapability>> | null = null;
  try {
    const firstResult = await runGitPhysicalCommandInternal(first.provider, ['--version'], {
      env: first.provider.environment,
      envMode: 'replace',
      maxStdoutBytes: 64 * 1024,
      maxStderrBytes: 64 * 1024
    });
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
    const receipt = await replaceAllGitConfigValue({
      provider: secondProvider,
      target,
      key: 'core.hooksPath',
      value: 'D:/canonical-hooks'
    });
    assertGitConfigEffectReceipt(receipt);
    const providerReceipt = closeGitPhysicalProvider(secondProvider);
    expect(providerReceipt.processCount).toBe(2);
    expect(first.processSession.processCount).toBe(3);
  } finally {
    if (target !== null) closeGitConfigTargetCapability(target);
    if (secondProvider !== null) closeGitPhysicalProvider(secondProvider);
    closeGitPhysicalProvider(first.provider);
    first.processSession.close();
    rmSync(root, { recursive: true, force: true });
  }
});
