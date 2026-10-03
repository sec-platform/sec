import { expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CodexDevelopmentWorkPackageManifestDigest } from '../../src/adapters/self-hosting/control/task/contract/work-package.ts';
import type { VerificationActionKeyDigest } from '../../src/adapters/verification/platform/action/contract/action.ts';
import { SOURCE_PROGRAM_TRANSITION_GATE_ID, SOURCE_PROGRAM_TRANSITION_OUTPUT_FILE, buildCiVerificationActionPlanClosure, ciVerificationGateStep, createCiVerificationLocalExecutionEnvironment, sourceProgramTransitionGate, type CiVerificationActionCandidate } from '../../src/adapters/verification/platform/action/contract/ci.ts';
import { CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS } from '../../src/adapters/verification/platform/action/contract/environment.ts';
import { CI_VERIFICATION_SESSION_CONTRACT_REVISION } from '../../src/adapters/verification/platform/ci/contract/revision.ts';
import { CodexDevelopmentRunGateProcess } from '../../src/adapters/verification/platform/ci/runtime/ci-orchestration-core.ts';
import { CodexDevelopmentCiVerificationMainForTests } from '../../src/adapters/verification/platform/ci/verification-cli.ts';
import { CI_VERIFICATION_CONTRACT_REVISION } from '../../src/assurance/verification/contract/revision.ts';
import { BASE, BASE_TREE, HEAD, MANIFEST_PATH, TREE, baseOptions, exactManifest } from '../helpers/ci-verification-fixtures.ts';

const digest = (value: string): VerificationActionKeyDigest => `sha256:${value.repeat(64)}`;

function transitionOutputOptions(root: string, stdout: Buffer, beforeReturn: () => void = () => {}) {
  const options = baseOptions(root);
  const transitionBinding = {
    baseSha: BASE, headSha: HEAD,
    payloadDigest: null, approvalObservationDigest: null, approvalDigest: null
  };
  const gate = sourceProgramTransitionGate(transitionBinding);
  const gates = [...options.testVerificationPlan.gates, gate];
  let transitionRuns = 0;
  const environment = createCiVerificationLocalExecutionEnvironment({
    os: process.platform, arch: process.arch, bunVersion: Bun.version
  });
  const candidate: CiVerificationActionCandidate = {
    baseSha: BASE, baseTreeSha: BASE_TREE, headSha: HEAD, headTreeSha: TREE,
    manifestPath: MANIFEST_PATH, scopeAuthorizationRevision: digest('c'),
    profile: 'quick', contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
    requiredBlobs: CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS.map((dependencyPath, index) => ({
      path: dependencyPath, digest: digest(String(index + 1))
    })),
    manifestDigest: CodexDevelopmentWorkPackageManifestDigest(exactManifest(root).bytes) as VerificationActionKeyDigest,
    toolchainRevision: environment.toolchainRevision,
    providerRevision: environment.executionEnvironmentRevision
  };
  const plan = buildCiVerificationActionPlanClosure({ candidate, gates: gates.map(ciVerificationGateStep) });
  return {
    ...options,
    env: {
      ...options.env,
      SEC_CI_VERIFICATION_EVIDENCE_PATH: path.join(root, 'configured-output', 'evidence.json'),
      SEC_FORMAL_TRUSTED_RUNTIME_MODE: '1',
      SEC_TRUSTED_RUNTIME_EXECUTION_ID: 'transition-output-test',
      SEC_TRUSTED_RUNTIME_ACTOR_NODE_ID: 'transition-output-test',
      SEC_SESSION_REVISION: CI_VERIFICATION_SESSION_CONTRACT_REVISION,
      SEC_SESSION_PROPOSAL_DIGEST: digest('1'),
      SEC_SCOPE_AUTHORIZATION_REVISION: candidate.scopeAuthorizationRevision,
      SEC_SCOPE_AUTHORIZATION_DIGEST: digest('2'),
      SEC_REVIEW_RECEIPT_DIGEST: digest('3'),
      SEC_MAIN_HEALTH_REVISION: digest('4'),
      SEC_MAIN_HEALTH_DIGEST: digest('5'),
      SEC_TRUST_REVISION: BASE,
      SEC_BASE_TREE_SHA: BASE_TREE,
      SEC_ACTION_PLAN_DIGEST: plan.actionPlanDigest,
      SEC_REQUIRED_BLOB_CLOSURE_JSON: JSON.stringify(candidate.requiredBlobs),
      SEC_EXECUTION_ENVIRONMENT_REVISION: environment.executionEnvironmentRevision,
      SEC_SOURCE_PROGRAM_TRANSITION_BINDING: JSON.stringify(transitionBinding)
    },
    testVerificationPlan: { ...options.testVerificationPlan, gates },
    transitionRuns: () => transitionRuns,
    runGate: async (descriptor: Parameters<typeof options.runGate>[0], execution: Parameters<typeof options.runGate>[1]) => {
      if (descriptor.id !== SOURCE_PROGRAM_TRANSITION_GATE_ID) return options.runGate(descriptor, execution);
      transitionRuns += 1;
      const settled = await CodexDevelopmentRunGateProcess(root, {
        ...descriptor,
        argv: [process.execPath, '-e', `process.stdout.write(Buffer.from('${stdout.toString('hex')}', 'hex'));`]
      }, execution);
      beforeReturn();
      return settled;
    },
    writeEvidence: () => {}
  };
}

async function runTransitionOutput(options: ReturnType<typeof transitionOutputOptions>) {
  const diagnostics: string[] = [];
  const error = spyOn(console, 'error').mockImplementation((value) => { diagnostics.push(String(value)); });
  try {
    const code = await CodexDevelopmentCiVerificationMainForTests(options);
    expect(options.transitionRuns()).toBe(1);
    return { code, diagnostic: diagnostics.join('\n') };
  } finally {
    error.mockRestore();
  }
}

test('CI transition output publishes exact stdout at the configured destination with read-only permissions', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-ci-output-bytes-'));
  try {
    const stdout = Buffer.from([0x20, 0x7b, 0x0a, 0x00, 0xff, 0xc3, 0x28, 0x0d, 0x0a]);
    const options = transitionOutputOptions(root, stdout);
    expect((await runTransitionOutput(options)).code).toBe(0);
    const output = path.join(path.dirname(options.env.SEC_CI_VERIFICATION_EVIDENCE_PATH), SOURCE_PROGRAM_TRANSITION_OUTPUT_FILE);
    expect(readFileSync(output)).toEqual(stdout);
    if (process.platform !== 'win32') expect(statSync(output).mode & 0o777).toBe(0o400);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const existing of ['same', 'different'] as const) {
  test(`CI transition output rejects an existing ${existing}-byte leaf without replacing it`, async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sec-ci-output-exclusive-'));
    try {
      const stdout = Buffer.from('{"result":"captured"}\n');
      const options = transitionOutputOptions(root, stdout);
      const output = path.join(path.dirname(options.env.SEC_CI_VERIFICATION_EVIDENCE_PATH), SOURCE_PROGRAM_TRANSITION_OUTPUT_FILE);
      mkdirSync(path.dirname(output));
      const original = existing === 'same' ? stdout : Buffer.from('pre-existing output');
      writeFileSync(output, original, { mode: 0o400 });
      const identity = statSync(output, { bigint: true });
      const result = await runTransitionOutput(options);
      expect(result.code).toBe(1);
      expect(result.diagnostic).toContain(existing === 'same'
        ? 'Source Program transition output already exists.'
        : 'Durable publication target conflicts with canonical bytes.');
      expect(readFileSync(output)).toEqual(original);
      expect(statSync(output, { bigint: true }).ino).toBe(identity.ino);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

for (const replacement of ['directory', 'symlink'] as const) {
  test(`CI transition output rejects its parent being replaced by a ${replacement} during execution`, async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sec-ci-output-parent-'));
    try {
      const parent = path.join(root, 'configured-output');
      const saved = path.join(root, 'saved-output');
      const redirected = path.join(root, 'redirected-output');
      mkdirSync(redirected);
      const options = transitionOutputOptions(root, Buffer.from('captured stdout'), () => {
        renameSync(parent, saved);
        if (replacement === 'directory') mkdirSync(parent);
        else symlinkSync(redirected, parent, process.platform === 'win32' ? 'junction' : 'dir');
      });
      const result = await runTransitionOutput(options);
      expect(result.code).toBe(1);
      expect(result.diagnostic).toContain(replacement === 'directory'
        ? 'Source Program transition output lexical root physical identity changed.'
        : 'Source Program transition output lexical root');
      for (const directory of [parent, saved, redirected]) {
        expect(existsSync(path.join(directory, SOURCE_PROGRAM_TRANSITION_OUTPUT_FILE))).toBe(false);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
