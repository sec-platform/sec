import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { CodexDevelopmentBuildSanitizedChildEnvironmentV1 } from '../platform/shared/ci-execution-environment.ts';

import {
  CodexDevelopmentRegisteredEvidenceCompositionPolicyV1,
  CodexDevelopmentRequiredEvidenceCompositionPolicyV1,
  CodexDevelopmentSm3P0WorkPackageIdV1
} from '../platform/shared/ci-evidence-composition-policy-registry.ts';
import {
  CodexDevelopmentFinalizeVerificationEvidenceV2,
  CodexDevelopmentFinalizeVerificationEvidenceV3,
  CodexDevelopmentPrepareVerificationEvidenceTarget,
  CodexDevelopmentVerificationArtifactRetentionDays,
  CodexDevelopmentVerificationDigest,
  CodexDevelopmentWriteVerificationEvidenceAtomic,
  CodexDevelopmentWriteVerificationEvidenceV3Atomic,
  type CodexDevelopmentVerificationEvidenceV2,
  type CodexDevelopmentVerificationEvidenceV3,
  type CodexDevelopmentVerificationGateEvidenceV2,
  type CodexDevelopmentVerificationGateEvidenceV3
} from '../platform/shared/ci-evidence-contract.ts';
import {
  CodexDevelopmentBuildEvidenceCompositionPlanV1,
  type CodexDevelopmentEvidenceCompositionGateV1,
  type CodexDevelopmentEvidenceCompositionPlanV1,
  type CodexDevelopmentEvidenceCompositionPolicyV1,
  type CodexDevelopmentExactGitBlobBytesV1,
  type CodexDevelopmentExactGitBlobV1
} from '../platform/shared/ci-evidence-reuse-contract.ts';
import {
  gitChangedFileDiffArgs,
  parseGitChangedFileOutput,
  parseGitChangedRecordsOutput,
  type CodexDevelopmentGitChangedRecordV1
} from '../platform/shared/ci-git-changed-files.ts';
import {
  assertCiExpectedHead,
  CI_VERIFICATION_CONTRACT_REVISION,
  CodexDevelopmentBuildVerificationInputV2,
  CodexDevelopmentBuildVerificationInputV3,
  CodexDevelopmentBuildVerificationPlanV1,
  type CiVerificationGateStep,
  type CodexDevelopmentVerificationPlanProfileV1
} from '../platform/shared/ci-verification-plan.ts';
import { CI_VERIFICATION_COMPOSITION_CONTRACT_REVISION } from '../platform/shared/ci-verification-revision.ts';
import { isTestFile } from '../platform/shared/test-budget-contract.ts';
import { CodexDevelopmentBuildVerificationScopeInventoryV1 } from '../platform/shared/verification-scope-inventory.ts';
import {
  CodexDevelopmentParseWorkPackageManifest,
  CodexDevelopmentWorkPackageManifestDigest,
  CodexDevelopmentWorkPackageSchemaV1,
  CodexDevelopmentWorkPackageSchemaV2,
  type CodexDevelopmentWorkPackageManifest
} from './codex/work-package-contract.ts';

const VERIFICATION_EVIDENCE_PATH = '.tmp/ci-verification-evidence.json';
const FAILURE_TAIL_CHARACTER_LIMIT = 24_000;
function isCompositionProtectedEnvKey(key: string): boolean {
  return key === 'SEC_TEST_WORKSPACE_NAMESPACE' || key.startsWith('SEC_RUN_');
}
const INVALIDATION_RULES = [
  'exact head SHA or tree SHA changes',
  'current PR base SHA or exact affected base SHA changes',
  'CI contract revision, profile, gate plan, or changed paths change',
  'Work Package manifest path or digest changes',
  'tracked worktree is not clean before and after verification',
  'hosted artifact is missing, expired, or has a mismatched digest'
];

type GateProcessResult = {
  code: number;
  rawOutputDigest: string;
  failureTail: string;
};

export type CodexDevelopmentCiVerificationMainOptions = {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  gitRevision?: (ref: string) => string | null;
  trackedTreeIsClean?: () => boolean;
  changedFiles?: (baseRef: string) => string[] | null;
  changedRecords?: (baseRef: string) => CodexDevelopmentGitChangedRecordV1[] | null;
  gitBlob?: (ref: string, file: string) => CodexDevelopmentExactGitBlobV1 | null;
  readGitBlob?: (ref: string, file: string) => CodexDevelopmentExactGitBlobBytesV1 | null;
  gitFiles?: (ref: string, prefix: string) => string[] | null;
  runGate?: (step: { id: string; argv: string[]; env: NodeJS.ProcessEnv }) => Promise<GateProcessResult>;
  writeEvidence?: (filePath: string, evidence: CodexDevelopmentVerificationEvidenceV2) => void;
  writeEvidenceV3?: (filePath: string, evidence: CodexDevelopmentVerificationEvidenceV3) => void;
  readManifestBytes?: (manifestPath: string) => Uint8Array;
  resolvePolicy?: (policyId: string) => CodexDevelopmentEvidenceCompositionPolicyV1;
};

function parseProfile(argv: string[]): { profile: CodexDevelopmentVerificationPlanProfileV1; expectedHead: string | undefined } {
  let profile: CodexDevelopmentVerificationPlanProfileV1 | null = null;
  let expectedHead: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument !== '--profile' && argument !== '--expected-head') {
      throw new Error(`Unknown CI verification argument: ${argument}.`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`CI verification ${argument} requires a value.`);
    if (argument === '--profile') {
      if (profile !== null) throw new Error('CI verification --profile may only be specified once.');
      if (value !== 'quick' && value !== 'full') throw new Error('CI verification requires --profile quick|full.');
      profile = value;
    } else {
      if (expectedHead !== undefined) throw new Error('CI verification --expected-head may only be specified once.');
      expectedHead = value;
    }
    index += 1;
  }
  if (profile === null) throw new Error('CI verification requires --profile quick|full.');
  return { profile, expectedHead };
}

function defaultGitRevision(ref: string): string | null {
  const result = spawnSync('git', ['rev-parse', ref], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function defaultGitBlob(ref: string, file: string): CodexDevelopmentExactGitBlobV1 | null {
  const result = spawnSync('git', ['ls-tree', '-z', '--full-tree', ref, '--', file], {
    encoding: 'utf8',
    maxBuffer: 1_048_576
  });
  if (result.status !== 0 || !result.stdout.endsWith('\0')) return null;
  const entries = result.stdout.split('\0').filter(Boolean);
  if (entries.length !== 1) return null;
  const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/u.exec(entries[0]!);
  if (!match || match[3] !== file) return null;
  return { mode: match[1] as '100644' | '100755', type: 'blob', blobSha: match[2]! };
}

function defaultReadGitBlob(ref: string, file: string): CodexDevelopmentExactGitBlobBytesV1 | null {
  const entry = defaultGitBlob(ref, file);
  if (!entry) return null;
  const result = spawnSync('git', ['cat-file', 'blob', `${ref}:${file}`], {
    encoding: 'buffer',
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) return null;
  return { ...entry, bytes: new Uint8Array(result.stdout) };
}

function defaultGitFiles(ref: string, prefix: string): string[] | null {
  const result = spawnSync('git', ['ls-tree', '-r', '-z', '--name-only', '--full-tree', ref, '--', prefix], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.status !== 0 || (result.stdout.length > 0 && !result.stdout.endsWith('\0'))) return null;
  return result.stdout.split('\0').filter(Boolean);
}

function defaultTrackedTreeIsClean(): boolean {
  const result = spawnSync('git', [
    '-c', 'core.quotepath=false', 'status', '--porcelain=v1', '--untracked-files=normal', '--ignored=no'
  ], { encoding: 'utf8' });
  return result.status === 0 && result.stdout.length === 0;
}

function defaultChangedFiles(baseRef: string): string[] | null {
  const result = spawnSync('git', gitChangedFileDiffArgs(baseRef), { encoding: 'utf8' });
  if (result.status !== 0) return null;
  try {
    return parseGitChangedFileOutput(result.stdout);
  } catch {
    return null;
  }
}

function defaultRunGate(step: { id: string; argv: string[]; env: NodeJS.ProcessEnv }): Promise<GateProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(step.argv[0]!, step.argv.slice(1), {
      env: step.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const hash = createHash('sha256');
    let boundedTail = '';
    let settled = false;
    const observe = (chunk: Buffer): void => {
      hash.update(chunk);
      boundedTail = `${boundedTail}${chunk.toString('utf8')}`;
      if (boundedTail.length > FAILURE_TAIL_CHARACTER_LIMIT) {
        boundedTail = boundedTail.slice(-FAILURE_TAIL_CHARACTER_LIMIT);
      }
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      observe(chunk);
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      observe(chunk);
      process.stderr.write(chunk);
    });
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      resolve({
        code,
        rawOutputDigest: `sha256:${hash.digest('hex')}`,
        failureTail: boundedTail.trim()
      });
    };
    child.on('error', (error) => {
      const message = `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`;
      observe(Buffer.from(message));
      process.stderr.write(message);
      finish(1);
    });
    child.on('close', (code) => finish(code ?? 1));
  });
}

function notRunGate(step: CiVerificationGateStep): CodexDevelopmentVerificationGateEvidenceV2 {
  return {
    id: step.id,
    argv: ['bun', ...step.args],
    status: 'not-run',
    exitCode: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    failureTail: null,
    rawOutputDigest: null,
    notRunReason: 'Gate was not reached because preflight or an earlier fail-fast gate did not complete.'
  };
}

function tail(output: string, fallback: string): string {
  const combined = output.trim() || fallback;
  return combined.length > FAILURE_TAIL_CHARACTER_LIMIT
    ? combined.slice(-FAILURE_TAIL_CHARACTER_LIMIT)
    : combined;
}

type ManifestBinding = {
  manifestPath: string | null;
  manifestDigest: string | null;
  manifest: CodexDevelopmentWorkPackageManifest | null;
};

function manifestBinding(
  env: NodeJS.ProcessEnv,
  readManifestBytes: (manifestPath: string) => Uint8Array = (manifestPath) => readFileSync(path.resolve(manifestPath))
): ManifestBinding {
  const manifestPath = env.SEC_WORK_PACKAGE_MANIFEST_PATH;
  if (!manifestPath) return { manifestPath: null, manifestDigest: null, manifest: null };
  if (!/^docs\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(manifestPath)) {
    throw new Error('SEC_WORK_PACKAGE_MANIFEST_PATH must be a canonical repository-relative Work Package path.');
  }
  const source = readManifestBytes(manifestPath);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(source);
  const manifest = CodexDevelopmentParseWorkPackageManifest(text, manifestPath);
  if (manifest.schema === CodexDevelopmentWorkPackageSchemaV1
    && manifest.ciRevision !== CI_VERIFICATION_CONTRACT_REVISION) {
    throw new Error('Work Package manifest does not target the current CI verification revision.');
  }
  return {
    manifestPath,
    manifestDigest: CodexDevelopmentWorkPackageManifestDigest(source),
    manifest
  };
}

function defaultChangedRecords(baseRef: string): CodexDevelopmentGitChangedRecordV1[] | null {
  const result = spawnSync('git', gitChangedFileDiffArgs(baseRef), { encoding: 'utf8' });
  if (result.status !== 0) return null;
  try {
    return parseGitChangedRecordsOutput(result.stdout);
  } catch {
    return null;
  }
}

function afterRetention(date: Date): string {
  return new Date(
    date.getTime() + CodexDevelopmentVerificationArtifactRetentionDays * 24 * 60 * 60 * 1000
  ).toISOString();
}

function notRunCompositionGate(
  gate: CodexDevelopmentEvidenceCompositionGateV1
): CodexDevelopmentVerificationGateEvidenceV3 {
  return {
    id: gate.gateId,
    argv: [...gate.argv],
    runtime: gate.runtime,
    envAllowlistRevision: gate.envAllowlistRevision,
    envDigest: gate.envDigest,
    disposition: gate.disposition,
    coveredScopeIds: [...gate.coveredScopeIds],
    status: 'not-run',
    exitCode: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    failureTail: null,
    rawOutputDigest: null,
    notRunReason: 'Gate was not reached because preflight or an earlier fail-fast gate did not complete.'
  };
}

export async function CodexDevelopmentCiVerificationMain(
  options: CodexDevelopmentCiVerificationMainOptions = {}
): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const gitRevision = options.gitRevision ?? defaultGitRevision;
  const trackedTreeIsClean = options.trackedTreeIsClean ?? defaultTrackedTreeIsClean;
  const changedFileResolver = options.changedFiles ?? defaultChangedFiles;
  const changedRecordResolver = options.changedRecords ?? defaultChangedRecords;
  const gitBlob = options.gitBlob ?? defaultGitBlob;
  const readGitBlob = options.readGitBlob ?? defaultReadGitBlob;
  const gitFiles = options.gitFiles ?? defaultGitFiles;
  const runGate = options.runGate ?? defaultRunGate;
  const writeEvidence = options.writeEvidence;
  const writeEvidenceV3 = options.writeEvidenceV3;
  const evidencePath = path.resolve(env.SEC_CI_VERIFICATION_EVIDENCE_PATH ?? VERIFICATION_EVIDENCE_PATH);
  let started = new Date();
  let startedAt = started.toISOString();
  let headSha: string | null = null;
  let treeSha: string | null = null;
  const prBaseRef = env.SEC_CHANGED_BASE ?? 'HEAD^1';
  const affectedBaseRef = env.SEC_AFFECTED_TESTS_BASE ?? 'HEAD^1';
  let prBaseSha: string | null = null;
  let affectedBaseSha: string | null = null;
  let directParentSha: string | null = null;
  let cleanBefore: boolean | null = null;
  let cleanAfter: boolean | null = null;
  let profile: CodexDevelopmentVerificationPlanProfileV1 = 'quick';
  let files: string[] | null = null;
  let selectionResolved = false;
  let steps: CiVerificationGateStep[] = [];
  let gates: CodexDevelopmentVerificationGateEvidenceV2[] = [];
  let compositionPlan: CodexDevelopmentEvidenceCompositionPlanV1 | null = null;
  let compositionGates: CodexDevelopmentVerificationGateEvidenceV3[] = [];
  let failure: CodexDevelopmentVerificationEvidenceV2['failure'] = null;
  let exitCode = 0;
  let stage = 'argv';
  let binding: ManifestBinding = { manifestPath: null, manifestDigest: null, manifest: null };
  let initializationFailure: string | null = null;

  try {
    CodexDevelopmentPrepareVerificationEvidenceTarget(evidencePath);
  } catch (error) {
    initializationFailure = error instanceof Error ? error.stack ?? error.message : String(error);
  }
  if (initializationFailure === null) {
    try {
      started = now();
      startedAt = started.toISOString();
      headSha = gitRevision('HEAD');
      treeSha = gitRevision('HEAD^{tree}');
      prBaseSha = gitRevision(prBaseRef);
      affectedBaseSha = gitRevision(affectedBaseRef);
      directParentSha = gitRevision('HEAD^1');
      cleanBefore = trackedTreeIsClean();
    } catch (error) {
      initializationFailure = error instanceof Error ? error.stack ?? error.message : String(error);
    }
  }

  try {
    if (initializationFailure) throw new Error(`CI verification initialization failed: ${initializationFailure}`);
    const parsed = parseProfile(argv);
    profile = parsed.profile;
    stage = 'preflight';
    if (!headSha || !treeSha || !prBaseSha || !affectedBaseSha || !directParentSha) {
      throw new Error('CI verification cannot resolve exact head/tree/two bases.');
    }
    assertCiExpectedHead(headSha, parsed.expectedHead ?? env.SEC_EXPECTED_HEAD_SHA);
    if (!cleanBefore) throw new Error('CI verification requires a clean complete worktree before execution.');
    binding = manifestBinding(env, options.readManifestBytes);
    if (binding.manifest !== null && binding.manifest.base !== prBaseSha) {
      throw new Error('Work Package manifest base does not match the exact PR base.');
    }
    if (binding.manifestPath !== null && (prBaseSha !== affectedBaseSha || directParentSha !== prBaseSha)) {
      throw new Error('Frozen verification requires affected base = HEAD^1 = current PR base.');
    }
    const changedRecords = options.changedRecords
      ? changedRecordResolver(prBaseRef)
      : options.changedFiles
        ? changedFileResolver(prBaseRef)?.map((file) => ({ status: 'changed' as const, path: file })) ?? null
        : changedRecordResolver(prBaseRef);
    const requiredPolicyId = changedRecords === null
      ? null
      : CodexDevelopmentRequiredEvidenceCompositionPolicyV1({
        records: changedRecords,
        baseHead: prBaseSha,
        currentHead: headSha,
        gitBlob
      });
    if (requiredPolicyId !== null && (
      binding.manifest?.schema !== CodexDevelopmentWorkPackageSchemaV2
      || binding.manifest.id !== CodexDevelopmentSm3P0WorkPackageIdV1
      || binding.manifest.evidenceComposition.policyId !== requiredPolicyId
    )) {
      throw new Error(`Protected SM3 P0 inputs require Work Package V2 policy ${requiredPolicyId}.`);
    }
    if (binding.manifest?.schema === CodexDevelopmentWorkPackageSchemaV2) {
      if (profile !== 'quick') throw new Error('CI verification V7 composition revision supports --profile quick only.');
      const rawChangedFiles = changedRecords === null ? null : [...new Set(changedRecords.flatMap((record) => (
        'previousPath' in record && record.previousPath !== undefined
          ? [record.previousPath, record.path]
          : [record.path]
      )))].sort();
      if (!rawChangedFiles) throw new Error('CI verification V7 cannot resolve the complete changed-path set.');
      const testFiles = gitFiles(headSha, 'tests');
      if (!testFiles) throw new Error('CI verification V7 cannot enumerate exact-head test files.');
      const testImpactSourceProvider = {
        testFiles: testFiles.filter(isTestFile),
        readTestSource: (testFile: string): string | null => {
          const entry = readGitBlob(headSha!, testFile);
          if (!entry) throw new Error(`CI verification V7 cannot read exact-head test source: ${testFile}.`);
          try {
            return new TextDecoder('utf-8', { fatal: true }).decode(entry.bytes);
          } catch (error) {
            throw new Error(`CI verification V7 exact-head test source is not UTF-8: ${testFile}.`, { cause: error });
          }
        }
      };
      const inventory = CodexDevelopmentBuildVerificationScopeInventoryV1({
        profile,
        changedFiles: rawChangedFiles,
        runtime: `bun@${Bun.version}`,
        currentHead: headSha,
        baseHead: prBaseSha,
        changedRecords: changedRecords!,
        gitBlob,
        testImpactSourceProvider
      });
      files = inventory.fullChangedFiles;
      selectionResolved = true;
      compositionPlan = CodexDevelopmentBuildEvidenceCompositionPlanV1({
        policyId: binding.manifest.evidenceComposition.policyId,
        workPackageId: binding.manifest.id,
        ciRevision: CI_VERIFICATION_COMPOSITION_CONTRACT_REVISION,
        profile,
        inventory,
        runtime: `bun@${Bun.version}`,
        currentHead: headSha,
        currentTree: treeSha,
        gitBlob,
        gitTree: gitRevision,
        readEvidence: readGitBlob,
        resolvePolicy: options.resolvePolicy ?? ((policyId) => (
          CodexDevelopmentRegisteredEvidenceCompositionPolicyV1({
            policyId,
            workPackageId: binding.manifest!.id,
            inventory,
            runtime: `bun@${Bun.version}`,
            currentHead: headSha!,
            gitBlob
          })
        )),
        executionEnvironment: env
      });
      compositionGates = compositionPlan.gates.map(notRunCompositionGate);
      for (const gate of compositionPlan.gates) {
        for (const [key, value] of Object.entries(gate.env)) {
          if (
            !isCompositionProtectedEnvKey(key)
            && env[key] !== undefined
            && env[key] !== value
          ) {
            throw new Error(`CI verification V7 inherited environment conflicts with ${gate.gateId}:${key}.`);
          }
        }
      }
    } else {
      const rawChangedFiles = changedFileResolver(prBaseRef);
      const plan = CodexDevelopmentBuildVerificationPlanV1(profile, rawChangedFiles);
      files = plan.changedFiles;
      selectionResolved = plan.selectionResolved;
      steps = plan.gates;
      gates = steps.map(notRunGate);
      if (steps.some((step) => step.id === 'impact-risk')) {
        console.log(`CI verification: risk gate required; reasons=[${plan.selectionReasons.join(', ')}]; owners=[${plan.affectedOwners.join(', ')}]`);
      } else {
        console.log('CI verification: no slow/workspace risk impact detected; risk gate skipped.');
      }
      if (!plan.selectionResolved) throw new Error('CI verification changed-file selection is unresolved.');
    }

    console.log(`SEC verification contract revision: ${compositionPlan ? CI_VERIFICATION_COMPOSITION_CONTRACT_REVISION : CI_VERIFICATION_CONTRACT_REVISION}`);
    console.log(`SEC verification profile: ${profile}`);
    console.log(`SEC verification exact head: ${headSha}`);
    console.log(`SEC verification tree: ${treeSha}`);
    console.log(`SEC verification PR base: ${prBaseSha}`);
    console.log(`SEC verification affected base: ${affectedBaseSha}`);

    stage = 'gates';
    if (compositionPlan) {
      for (let index = 0; index < compositionPlan.gates.length; index += 1) {
        const gate = compositionPlan.gates[index]!;
        const gateStarted = now();
        console.log(`::group::SEC verification: ${gate.gateId}`);
        let result: GateProcessResult;
        try {
          const childEnvironment = CodexDevelopmentBuildSanitizedChildEnvironmentV1(env, gate.env, gate.gateId);
          if (
            childEnvironment.binding.allowlistRevision !== gate.envAllowlistRevision
            || childEnvironment.binding.digest !== gate.envDigest
          ) throw new Error(`CI verification V7 execution environment drifted for ${gate.gateId}.`);
          result = await runGate({
            id: gate.gateId,
            argv: [...gate.argv],
            env: childEnvironment.environment
          });
        } finally {
          console.log('::endgroup::');
        }
        const gateFinished = now();
        const gateEvidence: CodexDevelopmentVerificationGateEvidenceV3 = {
          id: gate.gateId,
          argv: [...gate.argv],
          runtime: gate.runtime,
          envAllowlistRevision: gate.envAllowlistRevision,
          envDigest: gate.envDigest,
          disposition: gate.disposition,
          coveredScopeIds: [...gate.coveredScopeIds],
          status: result.code === 0 ? 'passed' : 'failed',
          exitCode: result.code,
          startedAt: gateStarted.toISOString(),
          finishedAt: gateFinished.toISOString(),
          durationMs: Math.max(0, gateFinished.getTime() - gateStarted.getTime()),
          failureTail: result.code === 0 ? null : tail(result.failureTail, `${gate.gateId} exited ${result.code}`),
          rawOutputDigest: result.rawOutputDigest,
          notRunReason: null
        };
        compositionGates[index] = gateEvidence;
        if (result.code !== 0) {
          exitCode = result.code;
          failure = { stage: `gate:${gate.gateId}`, tail: gateEvidence.failureTail ?? `${gate.gateId} failed.` };
          break;
        }
      }
    } else for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index]!;
      const gateStarted = now();
      console.log(`::group::SEC verification: ${step.id}`);
      let result: GateProcessResult;
      try {
        result = await runGate({
          id: step.id,
          argv: ['bun', ...step.args],
          env: {
            ...env,
            SEC_TEST_WORKSPACE_NAMESPACE: `verification-${step.id.replace(/[^a-z0-9]+/giu, '-').toLowerCase()}`
          }
        });
      } finally {
        console.log('::endgroup::');
      }
      const gateFinished = now();
      const gateEvidence: CodexDevelopmentVerificationGateEvidenceV2 = {
        id: step.id,
        argv: ['bun', ...step.args],
        status: result.code === 0 ? 'passed' : 'failed',
        exitCode: result.code,
        startedAt: gateStarted.toISOString(),
        finishedAt: gateFinished.toISOString(),
        durationMs: Math.max(0, gateFinished.getTime() - gateStarted.getTime()),
        failureTail: result.code === 0 ? null : tail(result.failureTail, `${step.id} exited ${result.code}`),
        rawOutputDigest: result.rawOutputDigest,
        notRunReason: null
      };
      gates[index] = gateEvidence;
      if (result.code !== 0) {
        exitCode = result.code;
        failure = { stage: `gate:${step.id}`, tail: gateEvidence.failureTail ?? `${step.id} failed.` };
        break;
      }
    }
  } catch (error) {
    exitCode = exitCode || 1;
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    failure ??= { stage, tail: tail(message, 'CI verification failed.') };
    console.error(message);
  } finally {
    if (headSha !== null && treeSha !== null) {
      try {
        const finalHead = gitRevision('HEAD');
        const finalTree = gitRevision('HEAD^{tree}');
        if (finalHead !== headSha || finalTree !== treeSha) {
          exitCode = 1;
          failure ??= { stage: 'exact-identity', tail: 'CI verification exact head or tree changed during execution.' };
        }
      } catch (error) {
        exitCode = 1;
        failure ??= {
          stage: 'exact-identity',
          tail: tail(error instanceof Error ? error.stack ?? error.message : String(error), 'Exact identity recheck failed.')
        };
      }
    }
    try {
      cleanAfter = trackedTreeIsClean();
    } catch (error) {
      cleanAfter = null;
      exitCode = 1;
      failure = {
        stage: 'clean-state',
        tail: tail(error instanceof Error ? error.stack ?? error.message : String(error), 'Clean-state probe failed.')
      };
    }
    if (cleanAfter !== true && exitCode === 0) {
      exitCode = 1;
      failure = { stage: 'clean-state', tail: 'CI verification left the complete worktree dirty or unresolved.' };
    }
    let finished = new Date(Math.max(Date.now(), started.getTime()));
    try {
      finished = now();
    } catch (error) {
      exitCode = 1;
      failure = {
        stage: 'clock',
        tail: tail(error instanceof Error ? error.stack ?? error.message : String(error), 'Clock probe failed.')
      };
    }
    try {
      let evidence: CodexDevelopmentVerificationEvidenceV2 | CodexDevelopmentVerificationEvidenceV3;
      if (binding.manifest?.schema === CodexDevelopmentWorkPackageSchemaV2) {
        const unresolvedDigest = CodexDevelopmentVerificationDigest({
          profile,
          files,
          policyId: binding.manifest.evidenceComposition.policyId,
          failure: failure?.stage ?? null
        });
        evidence = CodexDevelopmentFinalizeVerificationEvidenceV3({
          contractRevision: CI_VERIFICATION_COMPOSITION_CONTRACT_REVISION,
          kind: 'verification',
          profile,
          policyId: binding.manifest.evidenceComposition.policyId,
          workPackageId: binding.manifest.id,
          headSha,
          treeSha,
          prBaseSha,
          affectedBaseSha,
          manifestPath: binding.manifestPath!,
          manifestDigest: binding.manifestDigest!,
          inputDigest: compositionPlan
            ? CodexDevelopmentVerificationDigest(CodexDevelopmentBuildVerificationInputV3({
              headSha,
              treeSha,
              prBaseSha,
              affectedBaseSha,
              manifestPath: binding.manifestPath!,
              manifestDigest: binding.manifestDigest!,
              workPackageId: binding.manifest.id,
              plan: compositionPlan
            }))
            : unresolvedDigest,
          argv: ['bun', 'scripts/ci-verification.ts', ...argv],
          status: exitCode === 0 && compositionPlan ? 'passed' : 'failed',
          startedAt,
          finishedAt: finished.toISOString(),
          durationMs: Math.max(0, finished.getTime() - started.getTime()),
          fullChangedFiles: compositionPlan?.fullChangedFiles ?? files ?? [],
          fullChangedInputDigest: compositionPlan?.fullChangedInputDigest ?? unresolvedDigest,
          fullSelectionDigest: compositionPlan?.fullSelectionDigest ?? unresolvedDigest,
          refinedSelectionDigest: compositionPlan?.refinedSelectionDigest ?? unresolvedDigest,
          cleanState: { before: cleanBefore, after: cleanAfter },
          failure: exitCode === 0 && compositionPlan ? null : failure ?? {
            stage: 'composition',
            tail: 'CI verification V7 composition plan was not constructed.'
          },
          gates: compositionGates,
          coverageLedger: compositionPlan?.coverageLedger ?? [],
          reusedEvidence: compositionPlan?.reusedEvidence ?? [],
          uncoveredScopes: compositionPlan?.uncoveredScopes ?? [],
          invalidation: {
            expiresAt: afterRetention(finished),
            rules: [
              ...INVALIDATION_RULES,
  'composition policy, original/refined selection, runtime, immutable evidence, Git entry mode/type/blob, argv, or env changes'
            ]
          }
        });
        if (writeEvidenceV3) writeEvidenceV3(evidencePath, evidence);
        else CodexDevelopmentWriteVerificationEvidenceV3Atomic(evidencePath, evidence);
      } else {
        const inputDigest = CodexDevelopmentVerificationDigest(CodexDevelopmentBuildVerificationInputV2({
          profile,
          headSha,
          treeSha,
          prBaseSha,
          affectedBaseSha,
          manifestPath: binding.manifestPath,
          manifestDigest: binding.manifestDigest,
          changedFiles: files,
          selectionResolved,
          gates: steps
        }));
        evidence = CodexDevelopmentFinalizeVerificationEvidenceV2({
          contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
          kind: 'verification',
          profile,
          headSha,
          treeSha,
          prBaseSha,
          affectedBaseSha,
          manifestPath: binding.manifestPath,
          manifestDigest: binding.manifestDigest,
          inputDigest,
          argv: ['bun', 'scripts/ci-verification.ts', ...argv],
          status: exitCode === 0 ? 'passed' : 'failed',
          startedAt,
          finishedAt: finished.toISOString(),
          durationMs: Math.max(0, finished.getTime() - started.getTime()),
          changedFiles: files,
          selectionResolved,
          cleanState: { before: cleanBefore, after: cleanAfter },
          failure,
          gates,
          invalidation: {
            expiresAt: afterRetention(finished),
            rules: INVALIDATION_RULES
          }
        });
        if (writeEvidence) writeEvidence(evidencePath, evidence);
        else CodexDevelopmentWriteVerificationEvidenceAtomic(evidencePath, evidence);
      }
      console.log(`SEC verification evidence: ${evidencePath}`);
      console.log(`SEC_VERIFICATION_SUMMARY ${JSON.stringify(evidence)}`);
    } catch (error) {
      exitCode = 1;
      console.error(`SEC verification evidence write failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    }
  }
  return exitCode;
}

async function main(): Promise<number> {
  return CodexDevelopmentCiVerificationMain();
}

if (import.meta.main) {
  process.exitCode = await main();
}
