import { spawnSync } from 'node:child_process';
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
  decodeGitPathOutput,
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
  CodexDevelopmentChangedFilesFromRecordsV1,
  CodexDevelopmentCreateNotRunGateV2,
  CodexDevelopmentDefaultChangedPathsV1,
  CodexDevelopmentDefaultGitRevisionV1,
  CodexDevelopmentDefaultTrackedTreeIsCleanV1,
  CodexDevelopmentFailureTailV1,
  CodexDevelopmentRunGateProcessV1,
  type CodexDevelopmentGateProcessResultV1
} from './codex/ci-orchestration-core.ts';
import {
  CodexDevelopmentReadExactGitBlobEntryV1,
  CodexDevelopmentReadExactGitBlobV1,
  type CodexDevelopmentExactGitBlobReadOptionsV1
} from './codex/exact-git-blob.ts';
import {
  CodexDevelopmentParseWorkPackageManifest,
  CodexDevelopmentWorkPackageManifestDigest,
  CodexDevelopmentWorkPackageSchemaV1,
  CodexDevelopmentWorkPackageSchemaV2,
  type CodexDevelopmentWorkPackageManifest
} from './codex/work-package-contract.ts';

const VERIFICATION_EVIDENCE_PATH = '.tmp/ci-verification-evidence.json';
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

export type CodexDevelopmentCiVerificationMainOptions = {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  repositoryRoot?: string;
  gitRevision?: (ref: string) => string | null;
  trackedTreeIsClean?: () => boolean;
  changedFiles?: (baseRef: string) => string[] | null;
  changedRecords?: (baseRef: string) => CodexDevelopmentGitChangedRecordV1[] | null;
  gitBlob?: (ref: string, file: string) => CodexDevelopmentExactGitBlobV1 | null;
  readGitBlob?: (ref: string, file: string) => CodexDevelopmentExactGitBlobBytesV1 | null;
  gitFiles?: (ref: string, prefix: string) => string[] | null;
  runGate?: (
    step: { id: string; argv: string[]; env: NodeJS.ProcessEnv }
  ) => Promise<CodexDevelopmentGateProcessResultV1>;
  writeEvidence?: (filePath: string, evidence: CodexDevelopmentVerificationEvidenceV2) => void;
  writeEvidenceV3?: (filePath: string, evidence: CodexDevelopmentVerificationEvidenceV3) => void;
  readExactGitBlob?: typeof CodexDevelopmentReadExactGitBlobV1;
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

function defaultGitBlob(
  repositoryRoot: string,
  ref: string,
  file: string
): CodexDevelopmentExactGitBlobV1 | null {
  try {
    const entry = CodexDevelopmentReadExactGitBlobEntryV1({
      repositoryRoot,
      commitSha: ref,
      repositoryPath: file
    });
    return { mode: entry.mode, type: entry.type, blobSha: entry.blobSha };
  } catch {
    return null;
  }
}

function defaultReadGitBlob(
  repositoryRoot: string,
  readExactGitBlob: (
    options: CodexDevelopmentExactGitBlobReadOptionsV1
  ) => ReturnType<typeof CodexDevelopmentReadExactGitBlobV1>,
  ref: string,
  file: string
): CodexDevelopmentExactGitBlobBytesV1 | null {
  try {
    return readExactGitBlob({
      repositoryRoot,
      commitSha: ref,
      repositoryPath: file
    });
  } catch {
    return null;
  }
}

function defaultGitFiles(repositoryRoot: string, ref: string, prefix: string): string[] | null {
  const result = spawnSync('git', ['ls-tree', '-r', '-z', '--name-only', '--full-tree', ref, '--', prefix], {
    cwd: repositoryRoot,
    encoding: 'buffer',
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) return null;
  let output: string;
  try {
    output = decodeGitPathOutput(result.stdout, 'tree-path');
  } catch {
    return null;
  }
  if (output.length > 0 && !output.endsWith('\0')) return null;
  return output.split('\0').filter(Boolean);
}

function notRunGate(step: CiVerificationGateStep): CodexDevelopmentVerificationGateEvidenceV2 {
  return CodexDevelopmentCreateNotRunGateV2({
    id: step.id,
    argv: ['bun', ...step.args]
  });
}

type ManifestBinding = {
  manifestPath: string | null;
  manifestDigest: string | null;
  manifest: CodexDevelopmentWorkPackageManifest | null;
};

function manifestBinding(
  env: NodeJS.ProcessEnv,
  repositoryRoot: string,
  headSha: string,
  readExactGitBlob: (
    options: CodexDevelopmentExactGitBlobReadOptionsV1
  ) => ReturnType<typeof CodexDevelopmentReadExactGitBlobV1>
): ManifestBinding {
  const manifestPath = env.SEC_WORK_PACKAGE_MANIFEST_PATH;
  if (!manifestPath) return { manifestPath: null, manifestDigest: null, manifest: null };
  if (!/^docs\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(manifestPath)) {
    throw new Error('SEC_WORK_PACKAGE_MANIFEST_PATH must be a canonical repository-relative Work Package path.');
  }
  const source = readExactGitBlob({
    repositoryRoot,
    commitSha: headSha,
    maxBytes: 1024 * 1024,
    repositoryPath: manifestPath
  }).bytes;
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
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const readExactGitBlob = options.readExactGitBlob ?? CodexDevelopmentReadExactGitBlobV1;
  const gitRevision = options.gitRevision
    ?? ((ref: string) => CodexDevelopmentDefaultGitRevisionV1(repositoryRoot, ref));
  const trackedTreeIsClean = options.trackedTreeIsClean
    ?? (() => CodexDevelopmentDefaultTrackedTreeIsCleanV1(repositoryRoot));
  const changedFileResolver = options.changedFiles;
  const changedRecordResolver = options.changedRecords;
  const gitBlob = options.gitBlob
    ?? ((ref: string, file: string) => defaultGitBlob(repositoryRoot, ref, file));
  const readGitBlob = options.readGitBlob
    ?? ((ref: string, file: string) =>
      defaultReadGitBlob(repositoryRoot, readExactGitBlob, ref, file));
  const gitFiles = options.gitFiles
    ?? ((ref: string, prefix: string) => defaultGitFiles(repositoryRoot, ref, prefix));
  const runGate = options.runGate
    ?? ((step) => CodexDevelopmentRunGateProcessV1(repositoryRoot, step));
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
  let compositionExecutionEnvironment: NodeJS.ProcessEnv | null = null;
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
    stage = 'manifest';
    binding = manifestBinding(env, repositoryRoot, headSha, readExactGitBlob);
    stage = 'preflight';
    if (binding.manifest !== null && binding.manifest.base !== prBaseSha) {
      throw new Error('Work Package manifest base does not match the exact PR base.');
    }
    if (binding.manifestPath !== null && (prBaseSha !== affectedBaseSha || directParentSha !== prBaseSha)) {
      throw new Error('Frozen verification requires affected base = HEAD^1 = current PR base.');
    }
    let changedRecords: CodexDevelopmentGitChangedRecordV1[] | null;
    let rawChangedFiles: string[] | null;
    if (changedRecordResolver) {
      changedRecords = changedRecordResolver(prBaseSha);
      rawChangedFiles = changedRecords === null
        ? null
        : CodexDevelopmentChangedFilesFromRecordsV1(changedRecords);
    } else if (changedFileResolver) {
      rawChangedFiles = changedFileResolver(prBaseSha);
      changedRecords = rawChangedFiles?.map((file) => ({ status: 'changed' as const, path: file })) ?? null;
    } else {
      const snapshot = CodexDevelopmentDefaultChangedPathsV1(repositoryRoot, prBaseSha);
      changedRecords = snapshot?.records ?? null;
      rawChangedFiles = snapshot?.files ?? null;
    }
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
      if (profile !== 'quick') throw new Error('Composition verification supports --profile quick only.');
      if (!rawChangedFiles) throw new Error('Composition verification cannot resolve the complete changed-path set.');
      const testFiles = gitFiles(headSha, 'tests');
      if (!testFiles) throw new Error('Composition verification cannot enumerate exact-head test files.');
      const testImpactSourceProvider = {
        testFiles: testFiles.filter(isTestFile),
        readTestSource: (testFile: string): string | null => {
          const entry = readGitBlob(headSha!, testFile);
          if (!entry) throw new Error(`Composition verification cannot read exact-head test source: ${testFile}.`);
          try {
            return new TextDecoder('utf-8', { fatal: true }).decode(entry.bytes);
          } catch (error) {
            throw new Error(`Composition verification exact-head test source is not UTF-8: ${testFile}.`, { cause: error });
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
      compositionExecutionEnvironment = { ...env, SEC_CHANGED_BASE: prBaseSha };
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
        gitTree: (ref) => gitRevision(`${ref}^{tree}`),
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
        executionEnvironment: compositionExecutionEnvironment
      });
      compositionGates = compositionPlan.gates.map(notRunCompositionGate);
      for (const gate of compositionPlan.gates) {
        for (const [key, value] of Object.entries(gate.env)) {
          if (
            !isCompositionProtectedEnvKey(key)
            && env[key] !== undefined
            && env[key] !== value
          ) {
            throw new Error(`Composition verification inherited environment conflicts with ${gate.gateId}:${key}.`);
          }
        }
      }
    } else {
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
        let result: CodexDevelopmentGateProcessResultV1;
        try {
          if (!compositionExecutionEnvironment) {
            throw new Error('Composition verification execution environment was not initialized.');
          }
          const childEnvironment = CodexDevelopmentBuildSanitizedChildEnvironmentV1(
            compositionExecutionEnvironment,
            gate.env,
            gate.gateId
          );
          if (
            childEnvironment.binding.allowlistRevision !== gate.envAllowlistRevision
            || childEnvironment.binding.digest !== gate.envDigest
          ) throw new Error(`Composition verification execution environment drifted for ${gate.gateId}.`);
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
          failureTail: result.code === 0
            ? null
            : CodexDevelopmentFailureTailV1(result.failureTail, `${gate.gateId} exited ${result.code}`),
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
      let result: CodexDevelopmentGateProcessResultV1;
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
        failureTail: result.code === 0
          ? null
          : CodexDevelopmentFailureTailV1(result.failureTail, `${step.id} exited ${result.code}`),
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
    failure ??= { stage, tail: CodexDevelopmentFailureTailV1(message, 'CI verification failed.') };
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
          tail: CodexDevelopmentFailureTailV1(
            error instanceof Error ? error.stack ?? error.message : String(error),
            'Exact identity recheck failed.'
          )
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
        tail: CodexDevelopmentFailureTailV1(
          error instanceof Error ? error.stack ?? error.message : String(error),
          'Clean-state probe failed.'
        )
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
        tail: CodexDevelopmentFailureTailV1(
          error instanceof Error ? error.stack ?? error.message : String(error),
          'Clock probe failed.'
        )
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
            tail: 'Composition verification plan was not constructed.'
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
