import { expect, spyOn, test } from 'bun:test';
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as leafObservation from '../../src/adapters/runtime-state/physical/runtime/physical-leaf-observation.ts';
import * as physical from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import type { VerificationGateEvidence } from '../../src/execution/verification/session.ts';

import { buildCiVerificationActionPlanClosure, ciVerificationGateStep, type CiVerificationActionCandidate } from '../../src/adapters/verification/platform/action/contract/ci.ts';
import { CodexDevelopmentAssertVerificationEvidenceV4, CodexDevelopmentCreateVerificationEvidenceProducer, CodexDevelopmentFinalizeVerificationEvidenceV4, CodexDevelopmentPrepareVerificationEvidenceTarget, CodexDevelopmentWriteVerificationEvidenceV4Atomic } from '../../src/adapters/verification/platform/ci/contract/evidence.ts';
import { buildCiQuickGatePlan } from '../../src/adapters/verification/platform/ci/contract/plan.ts';
import { CI_VERIFICATION_CONTRACT_REVISION } from '../../src/assurance/verification/contract/revision.ts';
import { CodexDevelopmentBuildVerificationGateResult, type VerificationGateResult } from '../../src/assurance/verification/result/contract/result.ts';

const digest = (value: string): `sha256:${string}` => `sha256:${value.repeat(64).slice(0, 64)}`;
const candidate: CiVerificationActionCandidate = {
  baseSha: '1'.repeat(40), baseTreeSha: '2'.repeat(40), headSha: '3'.repeat(40), headTreeSha: '4'.repeat(40),
  manifestPath: 'config/repository/work-packages/example-v1.md', manifestDigest: digest('a'),
  scopeAuthorizationRevision: digest('b'), profile: 'quick',
  toolchainRevision: 'bun@1.3.14', providerRevision: 'github-actions@trusted-default',
  contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
  requiredBlobs: [
    { path: '.bun-version', digest: digest('c') },
    { path: 'bun.lock', digest: digest('d') },
    { path: 'bunfig.toml', digest: digest('e') },
    { path: 'package.json', digest: digest('f') }
  ]
};
const plan = buildCiVerificationActionPlanClosure({
  candidate,
  gates: buildCiQuickGatePlan({ includeImports: false, includeDocs: false })
    .map(ciVerificationGateStep)
});

function gateEvidence(index: number, status: 'passed' | 'failed' | 'not-run' | 'unsupported' | 'invalidated' = 'passed'):
VerificationGateEvidence<VerificationGateResult> {
  const action = plan.actions[index]!.action;
  const executed = status === 'passed' || status === 'failed';
  const reason = status === 'passed' ? 'executed-success'
    : status === 'failed' ? 'executed-failure'
      : status === 'not-run' ? 'not-dispatched'
        : status === 'unsupported' ? 'capability-unsupported'
          : 'input-invalidated';
  return {
    action,
    result: CodexDevelopmentBuildVerificationGateResult({
      gateId: action.operation.identity,
      gateRevision: action.operation.revision,
      owner: 'ci-verification-maintainer',
      requirementKey: `gate:${action.operation.identity}`,
      subjectRevision: candidate.headSha,
      inputDigest: action.actionKey,
      applicability: status === 'invalidated' ? 'unresolved' : 'required',
      status,
      disposition: executed ? 'executed' : 'not-executed',
      reasonCode: reason,
      requiredForClaims: [`gate:${action.operation.identity}`],
      supportedClaims: [`gate:${action.operation.identity}`],
      environment: executed ? {
        runtime: 'bun@1.3.14', os: 'linux', arch: 'x64', filesystem: null,
        capabilities: [], toolchainRevision: 'bun@1.3.14', providerRevisions: ['github-actions@trusted-default']
      } : null,
      execution: executed ? {
        argv: ['bun', 'run', action.operation.identity],
        startedAt: '2026-08-09T00:00:00.000Z', finishedAt: '2026-08-09T00:00:01.000Z',
        durationMs: 1000, exitCode: status === 'passed' ? 0 : 1, outputDigest: digest('d'),
        failureFingerprint: status === 'failed' ? digest('e') : null
      } : null,
      evidenceRefs: [],
      invalidationRules: ['ActionKey changes'],
      diagnostic: status === 'passed' ? null : status
    }),
    cleanup: { status: 'not-required', evidenceRefs: [], diagnostic: null }
  };
}

function evidence(gates = plan.actions.map((_, index) => gateEvidence(index))) {
  return CodexDevelopmentFinalizeVerificationEvidenceV4({
    contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
    sessionRevision: 'verification-session-v2', sessionProposalDigest: digest('f'),
    scopeAuthorizationRevision: candidate.scopeAuthorizationRevision, scopeAuthorizationDigest: digest('b'), reviewReceiptDigest: digest('1'),
    mainHealthRevision: digest('2'), mainHealthDigest: digest('3'), trustRevision: '5'.repeat(40), profile: 'quick',
    baseSha: candidate.baseSha, baseTreeSha: candidate.baseTreeSha, headSha: candidate.headSha,
    headTreeSha: candidate.headTreeSha, manifestPath: candidate.manifestPath,
    manifestDigest: candidate.manifestDigest,
    producer: CodexDevelopmentCreateVerificationEvidenceProducer({
      sourceTransport: 'github-actions', workflowPath: '.github/workflows/compiler-pr-validation.yml',
      workflowRef: `.github/workflows/compiler-pr-validation.yml@${'5'.repeat(40)}`,
      workflowSha: '5'.repeat(40), runId: '123', runAttempt: 1, actorNodeId: 'MDQ6VXNlcjE='
    }),
    actionPlan: plan,
    status: gates.some((gate) => gate.result.status === 'failed') ? 'failed'
      : gates.some((gate) => gate.result.status === 'invalidated') ? 'invalidated'
        : gates.some((gate) => gate.result.status === 'unsupported') ? 'unsupported'
          : gates.some((gate) => gate.result.status === 'not-run') ? 'not-run' : 'passed',
    startedAt: '2026-08-09T00:00:00.000Z', finishedAt: '2026-08-09T00:00:02.000Z',
    gates, evidenceRefs: [], invalidationRules: ['Action, session, scope, review, main, or trust identity changes']
  });
}

test('Verification evidence binds complete ordered Action snapshots and canonical five-state results', () => {
  for (const status of ['passed', 'failed', 'not-run', 'unsupported', 'invalidated'] as const) {
    const gates = plan.actions.map((_, index) => gateEvidence(index, index === 0 ? status : 'passed'));
    const value = evidence(gates);
    expect(value.status).toBe(status);
    expect(() => CodexDevelopmentAssertVerificationEvidenceV4(value, { actionPlan: plan }, new Date('2026-08-09T00:01:00.000Z')))
      .not.toThrow();
  }
});

test('non-current evidence and forged Action plan/key cannot be promoted to V4 PASS', () => {
  expect(() => CodexDevelopmentAssertVerificationEvidenceV4({ schema: 'codex-development-verification-evidence-v3' }))
    .toThrow('cannot be promoted');
  const forged = structuredClone(evidence()) as ReturnType<typeof evidence>;
  (forged.gates[0]!.action as { actionKey: string }).actionKey = digest('9');
  expect(() => CodexDevelopmentAssertVerificationEvidenceV4(forged, { actionPlan: plan })).toThrow();
});

test('reuse preserves known failure and never promotes non-pass to PASS', () => {
  const failed = gateEvidence(0, 'failed');
  const reusedFailure = structuredClone(failed) as typeof failed;
  (reusedFailure.result as { disposition: string; execution: unknown }).disposition = 'reused';
  (reusedFailure.result as { execution: unknown }).execution = null;
  (reusedFailure.result as { evidenceRefs: string[] }).evidenceRefs = ['artifact://known-failure'];
  const knownFailure = evidence([reusedFailure, gateEvidence(1)]);
  expect(knownFailure.status).toBe('failed');
  expect(knownFailure.gates[0]!.result).toMatchObject({ status: 'failed', disposition: 'reused' });
  expect(() => CodexDevelopmentAssertVerificationEvidenceV4(
    knownFailure,
    { actionPlan: plan },
    new Date('2026-08-09T02:00:00.000Z')
  )).not.toThrow();
  const invalidated = evidence([gateEvidence(0, 'invalidated'), gateEvidence(1)]);
  const promoted = { ...invalidated, status: 'passed' as const };
  expect(() => CodexDevelopmentAssertVerificationEvidenceV4(promoted, { actionPlan: plan })).toThrow();
});

test('verification evidence preserves configured ordinary output paths and invalidates the old artifact before execution', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-verification-evidence-output-'));
  try {
    const parent = path.join(root, 'configured output 雪', 'nested');
    const target = path.join(parent, 'evidence.json');
    expect(CodexDevelopmentPrepareVerificationEvidenceTarget(target)).toBe(path.resolve(target));
    expect(existsSync(parent)).toBe(true);
    expect(existsSync(target)).toBe(false);
    writeFileSync(target, '{"stale":true}\n');
    expect(CodexDevelopmentPrepareVerificationEvidenceTarget(target)).toBe(path.resolve(target));
    expect(existsSync(target)).toBe(false);

    const passed = evidence();
    CodexDevelopmentWriteVerificationEvidenceV4Atomic(target, passed);
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual(passed);
    expect(readFileSync(target, 'utf8').endsWith('\n')).toBe(false);
    const failed = evidence(plan.actions.map((_, index) => gateEvidence(index, index === 0 ? 'failed' : 'passed')));
    CodexDevelopmentWriteVerificationEvidenceV4Atomic(target, failed);
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual(failed);
    expect(readdirSync(parent)).toEqual(['evidence.json']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const kind of ['symlink', 'hardlink'] as const) {
  test(`verification evidence preparation and publication preserve a ${kind} output and its source`, () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sec-verification-evidence-alias-'));
    try {
      const source = path.join(root, 'source.json');
      const target = path.join(root, 'evidence.json');
      const original = '{"owner":"outside output"}\n';
      writeFileSync(source, original);
      if (kind === 'symlink') symlinkSync(source, target, 'file');
      else linkSync(source, target);
      const identity = lstatSync(target, { bigint: true });
      const originalNames = readdirSync(root).sort();
      for (const operation of [
        () => CodexDevelopmentPrepareVerificationEvidenceTarget(target),
        () => CodexDevelopmentWriteVerificationEvidenceV4Atomic(target, evidence())
      ]) {
        expect(operation).toThrow(physical.PhysicalNoFollowError);
        expect(readFileSync(source, 'utf8')).toBe(original);
        expect(readFileSync(target, 'utf8')).toBe(original);
        const current = lstatSync(target, { bigint: true });
        expect(current.dev).toBe(identity.dev);
        expect(current.ino).toBe(identity.ino);
        expect(readdirSync(root).sort()).toEqual(originalNames);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('verification evidence rejects a symlink parent before creating missing output directories', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-verification-evidence-parent-'));
  try {
    const outside = path.join(root, 'outside');
    const alias = path.join(root, 'alias');
    mkdirSync(outside);
    symlinkSync(outside, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const target = path.join(alias, 'missing', 'evidence.json');
    expect(() => CodexDevelopmentPrepareVerificationEvidenceTarget(target)).toThrow(physical.PhysicalNoFollowError);
    expect(() => CodexDevelopmentWriteVerificationEvidenceV4Atomic(target, evidence())).toThrow(physical.PhysicalNoFollowError);
    expect(readdirSync(outside)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'linux')('verification evidence readback failure reports failure and preserves the already published effect', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-verification-evidence-readback-'));
  const target = path.join(root, 'evidence.json');
  writeFileSync(target, '{"stale":true}\n');
  const next = evidence();
  const originalRead = leafObservation.readNoFollowOrdinaryFile;
  let finalReadbackObserved = false;
  const spy = spyOn(leafObservation, 'readNoFollowOrdinaryFile').mockImplementation((...args) => {
    const bytes = originalRead(...args);
    if (args[0].path === root && args[1] === 'evidence.json') {
      finalReadbackObserved = true;
      return Buffer.from('{"readback":"corrupt"}\n');
    }
    return bytes;
  });
  try {
    expect(() => CodexDevelopmentWriteVerificationEvidenceV4Atomic(target, next)).toThrow(physical.PhysicalNoFollowError);
    expect(finalReadbackObserved).toBe(true);
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual(next);
    expect(readdirSync(root)).toEqual(['evidence.json']);
  } finally {
    spy.mockRestore();
    rmSync(root, { recursive: true, force: true });
  }
});
