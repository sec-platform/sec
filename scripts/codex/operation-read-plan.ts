#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  compileSecOperationReadPlanV1,
  parseSecOperationReadPlanV1,
  SEC_OPERATION_MANDATORY_FORBIDDEN_SOURCES,
  SEC_OPERATION_READ_CLOSURE_REQUEST_SCHEMA,
  SEC_OPERATION_READ_PLAN_INPUT_SCHEMA,
  SEC_TASK_CAPSULE_AUTHORITY_REVISION,
  SEC_TASK_CAPSULE_AUTHORITY_SCHEMA,
  type SecDigestV1,
  type SecOperationReadPlanInputV1,
  type SecTaskCapsuleBindingV1
} from '../../platform/shared/agent-operation-read-plan-contract.ts';
import { compareCodeUnits, sha256 } from '../../platform/shared/canonical-primitives.ts';
import {
  CodexDevelopmentAssertControlPlaneBindingV1,
  CodexDevelopmentParseActivePointerV2,
  CodexDevelopmentParseCurrentStateSpecV1,
  CodexDevelopmentParseRollingPlanV1
} from './document-control-plane-contract.ts';
import { resolveLiveControlPlane } from './document-control-plane.ts';
import {
  CodexDevelopmentAssertWorkPackageOwnership,
  CodexDevelopmentParseWorkPackageManifest,
  CodexDevelopmentWorkPackageManifestDigest,
  type CodexDevelopmentWorkPackageManifest
} from './work-package-contract.ts';

function fail(message: string): never {
  console.error(`operation-read-plan: ${message}`);
  process.exit(2);
}

function gitOutput(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function requireGitOutput(cwd: string, args: string[], label: string): string {
  const result = gitOutput(cwd, args);
  if (result.status !== 0) fail(`${label}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function requireGitRaw(cwd: string, args: string[], label: string): string {
  const result = gitOutput(cwd, args);
  if (result.status !== 0) fail(`${label}: ${result.stderr.trim()}`);
  return result.stdout;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be one object.`);
  return value as Record<string, unknown>;
}

function changedPathsBetween(cwd: string, base: string, head: string): string[] {
  const result = gitOutput(cwd, ['diff', '--name-status', base, head]);
  if (result.status !== 0) fail(`exact Git change observation failed: ${result.stderr.trim()}`);
  return [...new Set(result.stdout.split(/\r?\n/u).filter(Boolean)
    .flatMap((line) => line.split('\t').slice(1).filter(Boolean)))].sort(compareCodeUnits);
}

function requireBlobRevision(cwd: string, revision: string, repositoryPath: string): string {
  const value = requireGitOutput(
    cwd,
    ['rev-parse', '--verify', `${revision}:${repositoryPath}`],
    `exact blob revision for ${repositoryPath}`
  );
  if (!/^[0-9a-f]{40,64}$/u.test(value)) fail(`exact blob revision is malformed for ${repositoryPath}.`);
  return value;
}

export type SecTrustedReadClosureV1 = Omit<SecOperationReadPlanInputV1, 'schema' | 'taskCapsule'>;

function deriveTrustedWorkerCapsule(input: {
  readonly manifest: CodexDevelopmentWorkPackageManifest;
  readonly manifestPath: string;
  readonly manifestDigest: SecDigestV1;
  readonly trustedRevision: string;
  readonly targetCandidate: string;
  readonly changedPaths: readonly string[];
  readonly readPaths: readonly string[];
}): SecTaskCapsuleBindingV1 {
  const verificationRevision = sha256(input.manifest.schema === 'codex-development-work-package-v1'
    ? {
        requiredProfile: input.manifest.requiredProfile,
        ciRevision: input.manifest.ciRevision,
        tests: input.manifest.tests
      }
    : { evidenceComposition: input.manifest.evidenceComposition });
  const authority = {
    operationId: `work-package-${input.manifest.id}`,
    role: 'worker' as const,
    operationKind: 'implement' as const,
    goalDigest: sha256({ tracking: input.manifest.tracking, acceptance: input.manifest.acceptance }) as SecDigestV1,
    trustedRevision: input.trustedRevision,
    targetCandidate: input.targetCandidate,
    workPackageAuthorizationRef: input.manifestPath,
    workPackageAuthorizationDigest: input.manifestDigest,
    ownerFacts: [...input.manifest.tasks]
      .sort((left, right) => compareCodeUnits(left.id, right.id))
      .map((task) => ({ id: task.id, ref: input.manifestPath, owner: task.owner, revision: input.manifestDigest })),
    scope: {
      readPaths: [...input.readPaths].sort(compareCodeUnits),
      writePaths: input.manifest.tasks.flatMap((task) => task.ownedPaths).sort(compareCodeUnits),
      forbiddenPaths: [...input.manifest.forbiddenPaths].sort(compareCodeUnits),
      availableCapabilities: ['git'],
      authorizedResources: [],
      authorizedGates: [],
      changedPaths: [...input.changedPaths].sort(compareCodeUnits)
    },
    verificationObligations: [{
      id: 'frozen-work-package-verification',
      revision: verificationRevision,
      reasonCode: 'frozen-work-package-verification'
    }],
    skillCandidateIds: ['sec-worker-development'] as const
  };
  const projection = {
    schema: SEC_TASK_CAPSULE_AUTHORITY_SCHEMA,
    ref: `urn:sec:task-capsule:work-package/${input.manifest.id}`,
    revision: SEC_TASK_CAPSULE_AUTHORITY_REVISION,
    authority
  };
  return { ...projection, digest: sha256(projection) as SecDigestV1 };
}

export interface SecTrustedWorkerOperationObservationV1 {
  readonly taskCapsule: SecTaskCapsuleBindingV1;
  readonly readClosure: SecTrustedReadClosureV1;
  readonly runtimeRoot: string;
  readonly candidateRoot: string;
  readonly trustedRevision: string;
  readonly targetCandidate: string;
  readonly changedPaths: readonly string[];
}

/** Trusted adapter: caller supplies only a candidate location, never authority fields. */
export async function resolveTrustedWorkerOperationV1(
  runtimeRootInput: string,
  candidateRootInput: string
): Promise<SecTrustedWorkerOperationObservationV1> {
  const runtimeRoot = path.resolve(runtimeRootInput);
  const candidateRoot = path.resolve(requireGitOutput(
    path.resolve(candidateRootInput),
    ['rev-parse', '--show-toplevel'],
    'candidate repository discovery'
  ));
  const runtime = await resolveLiveControlPlane(runtimeRoot, { observeGitHub: false });
  const repository = object(runtime.repository, 'trusted resolver repository');
  const workspace = object(runtime.workspace, 'trusted resolver workspace');
  if (repository.defaultRefState !== 'fresh'
      || typeof repository.liveDefaultSha !== 'string'
      || workspace.headSha !== repository.liveDefaultSha
      || requireGitOutput(runtimeRoot, ['status', '--porcelain=v1'], 'trusted runtime cleanliness') !== '') {
    fail('operation authority runtime must be a clean exact live-default TCB.');
  }
  const trustedRevision = repository.liveDefaultSha;
  const targetCandidate = requireGitOutput(candidateRoot, ['rev-parse', 'HEAD'], 'candidate HEAD observation');
  if (requireGitOutput(candidateRoot, ['rev-parse', '--verify', `${targetCandidate}^{commit}`],
    'candidate commit observation') !== targetCandidate) {
    fail('candidate HEAD is not one exact commit.');
  }
  if (targetCandidate !== trustedRevision) {
    const ancestry = requireGitOutput(candidateRoot, ['rev-list', '--parents', '-n', '1', targetCandidate],
      'candidate parent observation').split(/\s+/u);
    if (ancestry.length !== 2 || ancestry[0] !== targetCandidate || ancestry[1] !== trustedRevision) {
      fail('candidate must be one exact one-parent commit over the live trusted default.');
    }
  }
  const changedPaths = changedPathsBetween(candidateRoot, trustedRevision, targetCandidate);
  const stateSource = requireGitRaw(candidateRoot, ['show', `${trustedRevision}:docs/work/current-state.yaml`],
    'trusted current-state observation');
  const pointerSource = requireGitRaw(candidateRoot, ['show', `${targetCandidate}:docs/work/active-work-package.md`],
    'candidate active pointer observation');
  const rollingSource = requireGitRaw(candidateRoot, ['show', `${targetCandidate}:docs/work/rolling-plan.md`],
    'candidate rolling-plan observation');
  const spec = CodexDevelopmentParseCurrentStateSpecV1(stateSource);
  const pointer = CodexDevelopmentParseActivePointerV2(pointerSource);
  CodexDevelopmentAssertControlPlaneBindingV1({ spec, pointer });
  const rolling = CodexDevelopmentParseRollingPlanV1(rollingSource);
  if (rolling.activePackageId !== path.posix.basename(pointer.manifest, '.md')) {
    fail('candidate pointer and rolling plan select different Work Packages.');
  }
  const manifestSource = requireGitRaw(candidateRoot, ['show', `${targetCandidate}:${pointer.manifest}`],
    'candidate Work Package observation');
  const manifestDigest = CodexDevelopmentWorkPackageManifestDigest(manifestSource) as SecDigestV1;
  if (manifestDigest !== pointer.manifestDigest) fail('candidate pointer does not bind exact manifest bytes.');
  const manifest = CodexDevelopmentParseWorkPackageManifest(manifestSource, pointer.manifest);
  if (manifest.base !== trustedRevision) fail('Work Package base does not match live trusted default.');
  if (changedPaths.length > 0) CodexDevelopmentAssertWorkPackageOwnership(manifest, changedPaths);
  const taskOwners = [...new Set(manifest.tasks.map((task) => task.owner))].sort(compareCodeUnits);
  const taskOwner = taskOwners[0];
  if (taskOwners.length !== 1 || taskOwner !== 'development-governance-owner') {
    fail('bounded worker/implement projection requires one development-governance owner.');
  }
  const requiredRefs = Object.freeze([
    Object.freeze({
      id: 'agents-entry',
      ref: 'AGENTS.md',
      owner: taskOwner,
      revision: requireBlobRevision(candidateRoot, trustedRevision, 'AGENTS.md'),
      reasonCode: 'agent-entry-route'
    }),
    Object.freeze({
      id: 'development-governance',
      ref: 'docs/development-governance.md',
      owner: taskOwner,
      revision: requireBlobRevision(candidateRoot, trustedRevision, 'docs/development-governance.md'),
      reasonCode: 'operation-governance-owner'
    }),
    Object.freeze({
      id: 'documentation-authority',
      ref: 'docs/authority.json',
      owner: taskOwner,
      revision: requireBlobRevision(candidateRoot, trustedRevision, 'docs/authority.json'),
      reasonCode: 'document-authority-registry'
    }),
    Object.freeze({
      id: 'work-package-manifest',
      ref: pointer.manifest,
      owner: taskOwner,
      revision: manifestDigest,
      reasonCode: 'bind-operation-scope'
    })
  ]);
  const readPaths = [...new Set([
    ...manifest.tasks.flatMap((task) => task.ownedPaths),
    ...requiredRefs.map((reference) => reference.ref),
    '.agents/skills/sec-worker-development/SKILL.md'
  ])].sort(compareCodeUnits);
  const readClosure: SecTrustedReadClosureV1 = Object.freeze({
    requiredRefs,
    conditionalRefs: Object.freeze([]),
    forbiddenSources: SEC_OPERATION_MANDATORY_FORBIDDEN_SOURCES,
    maxSkillBodies: 1,
    unresolvedFrontier: Object.freeze([]),
    readReceipts: Object.freeze([]),
    invalidationInputs: Object.freeze([])
  });
  return Object.freeze({
    taskCapsule: deriveTrustedWorkerCapsule({
      manifest,
      manifestPath: pointer.manifest,
      manifestDigest,
      trustedRevision,
      targetCandidate,
      changedPaths,
      readPaths
    }),
    readClosure,
    runtimeRoot,
    candidateRoot,
    trustedRevision,
    targetCandidate,
    changedPaths: Object.freeze(changedPaths)
  });
}

async function readJsonArgument(raw: string, cwd: string, label: string): Promise<unknown> {
  let source = raw;
  try {
    source = await readFile(path.resolve(cwd, raw), 'utf8');
  } catch {
    // A non-file argument is treated as inline JSON. No directory census or
    // fallback source discovery is performed.
  }
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    fail(`${label} must be inline JSON or one readable JSON file: ${
      error instanceof Error ? error.message : String(error)
    }`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args.shift();
  const options: { input?: string; plan?: string; candidateRoot?: string } = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument !== '--input' && argument !== '--plan' && argument !== '--candidate-root') {
      fail(`unknown argument: ${argument}`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`${argument} requires a value.`);
    const key = argument === '--candidate-root' ? 'candidateRoot' : argument.slice(2) as 'input' | 'plan';
    if (options[key] !== undefined) fail(`duplicate argument: ${argument}`);
    options[key] = value;
    index += 1;
  }
  const runtimeRoot = path.resolve(import.meta.dir, '../..');
  if (command === 'compile') {
    if (options.input === undefined || options.plan !== undefined || options.candidateRoot === undefined) {
      fail('compile requires --input <inline-json|file> --candidate-root <path> and does not accept --plan.');
    }
    const raw = object(await readJsonArgument(options.input, runtimeRoot, '--input'), 'read closure');
    if (Object.hasOwn(raw, 'taskCapsule')) {
      fail('compile input cannot provide taskCapsule authority.');
    }
    if (raw.schema !== SEC_OPERATION_READ_CLOSURE_REQUEST_SCHEMA || Object.keys(raw).length !== 1) {
      fail('compile input must be an authority-free read closure request; refs, receipts, and policy are trusted-derived.');
    }
    const observation = await resolveTrustedWorkerOperationV1(runtimeRoot, options.candidateRoot);
    const input: SecOperationReadPlanInputV1 = {
      ...observation.readClosure,
      schema: SEC_OPERATION_READ_PLAN_INPUT_SCHEMA,
      taskCapsule: observation.taskCapsule
    };
    const plan = compileSecOperationReadPlanV1(input);
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  if (command === 'verify') {
    if (options.plan === undefined || options.input !== undefined) {
      fail('verify requires --plan <inline-json|file> and does not accept --input.');
    }
    const raw = await readJsonArgument(options.plan, runtimeRoot, '--plan');
    const plan = parseSecOperationReadPlanV1(raw);
    process.stdout.write(`${JSON.stringify({
      schema: 'sec-operation-read-plan-verification-v1',
      status: 'content-valid',
      authorityStatus: 'requires-trusted-consumer-live-binding',
      taskCapsuleRef: plan.taskCapsule.ref,
      taskCapsuleDigest: plan.taskCapsule.digest,
      taskCapsuleRevision: plan.taskCapsule.revision,
      readPlanDigest: plan.readPlanDigest
    }, null, 2)}\n`);
    return;
  }
  fail('usage: operation-read-plan <compile --input ... --candidate-root ... | verify --plan ...>');
}

void main();
