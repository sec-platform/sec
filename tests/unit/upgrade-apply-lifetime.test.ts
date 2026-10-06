import { expect, test } from 'bun:test';
import { executeUpgradeApplyLifecycle, type UpgradeApplyLifecycleOperations } from '../../src/application/upgrade-apply.ts';
import type { PlanFile } from '../../src/compiler/contract.ts';
import { ResourceCompositeSettlementError } from '../../src/execution/resource-settlement.ts';
import { buildOfficialResolvedBlock } from '../helpers/lock-fixtures.ts';
import { buildSingleTenantPlanApp } from '../helpers/plan-fixtures.ts';
import { buildReviewLock } from '../helpers/review-fixtures.ts';
import { buildUpgradeExecutionTerminalArtifact, buildUpgradePlanArtifact } from '../helpers/upgrade-fixtures.ts';

function fixture() {
  const upgradePlan = buildUpgradePlanArtifact();
  const plan: PlanFile = { app: buildSingleTenantPlanApp(), registry: { sources: [] },
    blocks: [{ id: upgradePlan.blockId, version: upgradePlan.toVersion }], acceptance: [] };
  const existingLock = buildReviewLock({ resolvedBlocks: [buildOfficialResolvedBlock({
    id: upgradePlan.blockId, version: upgradePlan.fromVersion, installOrder: 0
  })] });
  const appliedLock = buildReviewLock({ resolvedBlocks: [buildOfficialResolvedBlock({
    id: upgradePlan.blockId, version: upgradePlan.toVersion, installOrder: 0
  })] });
  const backup = Object.freeze({ identity: 'exact-backup' });
  const calls: string[] = [];
  const retired: Array<{ backup: typeof backup; failure: Error | null }> = [];
  const note = (name: string, receiver: unknown, expected: unknown) => {
    expect(receiver).toBe(expected); calls.push(name);
  };
  const operations: UpgradeApplyLifecycleOperations<typeof backup> = {
    async snapshot() { note('snapshot', this, operations); return backup; },
    recoverySnapshot(selected) {
      note('project', this, operations); expect(selected).toBe(backup);
      return { path: '/backup', device: '1', inode: '2', parentPath: '/', parentDevice: '1', parentInode: '1', status: 'retained-locator-only' };
    },
    async clearExecutionTerminal() { note('clear-terminal', this, operations); },
    async clearDiagnostics() { note('clear-diagnostics', this, operations); },
    async publishPlan(selected) { note('plan', this, operations); expect(selected).toBe(upgradePlan); },
    async apply() { note('apply', this, operations); return appliedLock; },
    terminalReadback: {
      readPersistedPlan() { note('read-plan', this, readback); return upgradePlan; },
      async readWorkspacePlan() { note('read-workspace', this, readback); return plan; }
    },
    terminalPublication: {
      async publish(terminal) { note('applied-terminal', this, publication); return terminal; },
      resolvePublication() { note('resolve-publication', this, publication); return 'absent'; },
      isBeforeEffectFailure() { note('before-effect', this, publication); return true; }
    },
    async recordGeneratedArtifacts(lock) { note('artifacts', this, operations); expect(lock).toBe(appliedLock); },
    async restore(selected) { note('restore', this, operations); expect(selected).toBe(backup); plan.blocks[0]!.version = upgradePlan.fromVersion; },
    async publishExecutionTerminal(terminal) { note(terminal.settlement, this, operations); return terminal; },
    async publishDiagnostics() { note('diagnostics', this, operations); },
    async retireBackup(selected, failure) { note('retire', this, operations); retired.push({ backup: selected, failure }); }
  };
  const readback = operations.terminalReadback;
  const publication = operations.terminalPublication;
  const input = { plan, existingLock, upgradePlan, attempt: buildUpgradeExecutionTerminalArtifact(upgradePlan).attempt };
  return { operations, input, calls, backup, retired, readback, publication };
}

for (const primary of [undefined, null, false, 0, new Error('locator projection failed')]) {
  test(`failed backup projection retires exactly once and preserves ${String(primary)}`, async () => {
    const f = fixture();
    f.operations.recoverySnapshot = () => { throw primary; };
    await expect(executeUpgradeApplyLifecycle(f.input, f.operations)).rejects.toBe(primary);
    expect(f.calls).toEqual(['snapshot', 'retire']);
    expect(f.retired).toEqual([{ backup: f.backup, failure: null }]);
  });
}

test('backup projection plus cleanup failures retain both original reasons', async () => {
  const f = fixture(), primary = Object.freeze({ projection: 'failed' }), cleanup = new Error('retirement failed');
  f.operations.recoverySnapshot = () => { throw primary; };
  f.operations.retireBackup = async function(selected, failure) {
    expect(this).toBe(f.operations); expect(selected).toBe(f.backup); expect(failure).toBeNull(); throw cleanup;
  };
  const failure = await executeUpgradeApplyLifecycle(f.input, f.operations).catch(error => error);
  expect(failure).toBeInstanceOf(ResourceCompositeSettlementError);
  expect(failure.errors).toEqual([primary, cleanup]);
  expect(failure.failures.map((entry: { label: string }) => entry.label)).toEqual(['upgrade-recovery-snapshot', 'upgrade-backup']);
});

test('failed acquisition transfers no backup retirement obligation', async () => {
  const f = fixture(), primary = new Error('acquisition failed');
  f.operations.snapshot = async () => { throw primary; };
  await expect(executeUpgradeApplyLifecycle(f.input, f.operations)).rejects.toBe(primary);
  expect(f.calls).toEqual([]); expect(f.retired).toEqual([]);
});

for (const group of ['root', 'terminalReadback', 'terminalPublication'] as const) {
  test(`invalid ${group} callback rejects before backup acquisition`, async () => {
    const prototype = fixture();
    const keys = Object.keys(group === 'root' ? prototype.operations : prototype.operations[group])
      .filter(key => key !== 'terminalReadback' && key !== 'terminalPublication');
    for (const key of keys) {
      const f = fixture();
      const target = group === 'root' ? f.operations : f.operations[group];
      Object.assign(target, { [key]: null });
      await expect(executeUpgradeApplyLifecycle(f.input, f.operations)).rejects.toBeInstanceOf(TypeError);
      expect(f.calls).toEqual([]);
    }
  });
}

test('null terminal method tables reject before acquiring a backup', async () => {
  for (const key of ['terminalReadback', 'terminalPublication']) {
    const f = fixture(); Object.assign(f.operations, { [key]: null });
    await expect(executeUpgradeApplyLifecycle(f.input, f.operations)).rejects.toBeInstanceOf(TypeError);
    expect(f.calls).toEqual([]);
  }
});

for (const mode of ['success', 'apply-failure', 'publication-failure'] as const) {
  test(`selected callbacks and receivers survive table replacement during ${mode}`, async () => {
    const f = fixture(), primary = new Error(mode);
    if (mode === 'apply-failure') f.operations.apply = async function() {
      expect(this).toBe(f.operations); f.calls.push('apply'); throw primary;
    };
    if (mode === 'publication-failure') f.publication.publish = async function() {
      expect(this).toBe(f.publication); f.calls.push('applied-terminal'); throw primary;
    };
    const snapshot = f.operations.snapshot;
    f.operations.snapshot = async function() {
      const value = await Reflect.apply(snapshot, this, []);
      const replaced = () => { throw new Error('late callback replacement'); };
      for (const key of Object.keys(f.readback)) Object.assign(f.readback, { [key]: replaced });
      for (const key of Object.keys(f.publication)) Object.assign(f.publication, { [key]: replaced });
      for (const key of Object.keys(f.operations)) Object.assign(f.operations, { [key]: replaced });
      return value;
    };
    if (mode === 'success') {
      const result = await executeUpgradeApplyLifecycle(f.input, f.operations);
      expect(result.resultKind).toBe('applied');
      expect(result.upgradeExecutionTerminal.settlement).toBe('applied');
      expect(f.calls).toEqual(['snapshot', 'project', 'clear-terminal', 'clear-diagnostics', 'plan', 'apply',
        'read-plan', 'read-workspace', 'applied-terminal', 'artifacts', 'retire']);
      expect(f.retired[0]?.failure).toBeNull();
    } else {
      await expect(executeUpgradeApplyLifecycle(f.input, f.operations)).rejects.toMatchObject({ code: 'UPGRADE-BLOCKED-005', cause: primary });
      expect(f.calls).toContain('restore'); expect(f.calls).toContain('rolled-back');
      if (mode === 'publication-failure') {
        expect(f.calls).toContain('resolve-publication'); expect(f.calls).toContain('before-effect');
      }
      expect(f.calls.at(-1)).toBe('retire'); expect(f.retired).toHaveLength(1);
      expect(f.retired[0]?.backup).toBe(f.backup);
    }
  });
}

test('restore failure keeps the acquired backup for recovery', async () => {
  const f = fixture();
  f.operations.apply = async () => { throw new Error('partial apply'); };
  f.operations.restore = async () => { throw new Error('authority lost'); };
  await expect(executeUpgradeApplyLifecycle(f.input, f.operations)).rejects.toMatchObject({
    code: 'UPGRADE-BLOCKED-005', details: { rollbackStatus: 'recovery-required' }
  });
  expect(f.calls).toContain('recovery-required'); expect(f.retired).toEqual([]);
});

for (const stage of ['apply', 'restore'] as const) {
  test(`a throwing ${stage} diagnostic accessor cannot retire an unrecovered backup`, async () => {
    const f = fixture();
    let accessorCalls = 0;
    const hostile = new Error('untrusted diagnostic');
    Object.defineProperty(hostile, 'message', { get() {
      accessorCalls++;
      throw new Error('diagnostic accessor failed');
    } });
    f.operations.apply = async () => { throw stage === 'apply' ? hostile : new Error('partial apply'); };
    f.operations.restore = async () => { throw stage === 'restore' ? hostile : new Error('restore failed'); };
    const failure = await executeUpgradeApplyLifecycle(f.input, f.operations).catch(error => error);
    expect(f.retired).toEqual([]);
    expect(failure).toMatchObject({ code: 'UPGRADE-BLOCKED-005', details: { rollbackStatus: 'recovery-required' } });
    expect(f.calls).toContain('recovery-required');
    expect(accessorCalls).toBe(0);
  });
}

test('diagnostic construction failure leaves an unrecovered backup owned for recovery', async () => {
  const f = fixture();
  const diagnosticFailure = new Error('typed failure details cannot be read');
  const { CompilerError } = await import('../../src/compiler/errors.ts');
  const primary = new CompilerError('UPGRADE-BLOCKED-005', 'partial apply');
  Object.defineProperty(primary, 'details', { get() { throw diagnosticFailure; } });
  f.operations.apply = async () => { throw primary; };
  f.operations.restore = async () => { throw new Error('restore failed'); };
  const failure = await executeUpgradeApplyLifecycle(f.input, f.operations).catch(error => error);
  expect(f.retired).toEqual([]);
  expect(failure).toBe(diagnosticFailure);
});
