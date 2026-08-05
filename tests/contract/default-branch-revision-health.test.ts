import { createHash } from 'node:crypto';

import { expect, test } from 'bun:test';

import * as revisionHealth from '../../platform/shared/default-branch-revision-health.ts';
import {
  CodexDevelopmentProjectDefaultBranchRevisionHealthV2,
  DEFAULT_BRANCH_REVISION_HEALTH_PHYSICAL_EVIDENCE_SCHEMA,
  DEFAULT_BRANCH_REVISION_HEALTH_RECEIPT_SCHEMA,
  type DefaultBranchCheckOutcome,
  type DefaultBranchFailureClass,
  type DefaultBranchRevisionHealthCommandEvidenceV2,
  type DefaultBranchRevisionHealthPhysicalEvidenceV2,
  type DefaultBranchRevisionHealthPolicyCheckV2
} from '../../platform/shared/default-branch-revision-health.ts';

const SUBJECT = 'a'.repeat(40);
const SUCCESSOR = 'b'.repeat(40);
const TREE = 'c'.repeat(40);
const POLICY_DIGEST = `sha256:${'d'.repeat(64)}`;

const REQUIRED_CHECKS: readonly DefaultBranchRevisionHealthPolicyCheckV2[] = [
  { id: 'imports-check', applicability: 'required' },
  { id: 'strict-typecheck', applicability: 'required' },
  { id: 'focused-tests', applicability: 'required' },
  { id: 'repository-audit', applicability: 'required' }
];

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function command(
  checkId: string,
  options: {
    outcome?: DefaultBranchCheckOutcome;
    failureClass?: DefaultBranchFailureClass;
    exitCode?: number | null;
    startedAt?: string | null;
    finishedAt?: string | null;
  } = {}
): DefaultBranchRevisionHealthCommandEvidenceV2 {
  const outcome = options.outcome ?? 'passed';
  const executed = !['not-run', 'environment-blocked', 'unsupported'].includes(outcome)
    || options.exitCode !== undefined;
  const exitCode = options.exitCode !== undefined
    ? options.exitCode
    : outcome === 'passed'
      ? 0
      : outcome === 'failed'
        ? 1
        : null;
  const startedAt = executed
    ? options.startedAt ?? '2026-01-01T00:00:00.000Z'
    : null;
  const finishedAt = executed
    ? options.finishedAt ?? '2026-01-01T00:00:01.000Z'
    : null;
  return {
    checkId,
    argv: ['bun', 'run', checkId],
    outcome,
    failureClass: options.failureClass !== undefined
      ? options.failureClass
      : outcome === 'failed'
        ? 'deterministic'
        : outcome === 'environment-blocked'
          ? 'environment'
          : outcome === 'unsupported'
            ? 'unsupported'
            : null,
    exitCode,
    startedAt,
    finishedAt,
    outputDigest: executed ? digest(`${checkId}:${outcome}`) : null
  };
}

function physicalEvidence(options: {
  subject?: string;
  tree?: string;
  checks?: readonly DefaultBranchRevisionHealthPolicyCheckV2[];
  commands?: readonly DefaultBranchRevisionHealthCommandEvidenceV2[];
  cleanBefore?: boolean;
  cleanAfter?: boolean;
} = {}): DefaultBranchRevisionHealthPhysicalEvidenceV2 {
  const subject = options.subject ?? SUBJECT;
  const tree = options.tree ?? TREE;
  const checks = options.checks ?? REQUIRED_CHECKS;
  const commands = options.commands
    ?? checks
      .filter(({ applicability }) => applicability === 'required')
      .map(({ id }) => command(id));
  return {
    schema: DEFAULT_BRANCH_REVISION_HEALTH_PHYSICAL_EVIDENCE_SCHEMA,
    subject: {
      repository: 'sec-platform/sec',
      defaultBranch: 'main',
      revision: subject,
      tree
    },
    policy: {
      profile: 'quick',
      revision: 'ci-verification-v19',
      digest: POLICY_DIGEST,
      checks
    },
    producer: {
      identity: 'github-actions:compiler-pr-validation',
      revision: 'compiler-pr-validation-v19',
      runtime: 'bun@1.3.14',
      os: 'linux',
      arch: 'x64',
      toolchain: 'typescript@5'
    },
    workspace: {
      before: {
        revision: subject,
        tree,
        clean: options.cleanBefore ?? true
      },
      after: {
        revision: subject,
        tree,
        clean: options.cleanAfter ?? true
      }
    },
    commands
  };
}

function artifactBytes(evidence: DefaultBranchRevisionHealthPhysicalEvidenceV2): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(evidence, null, 2)}\n`);
}

function project(evidence: DefaultBranchRevisionHealthPhysicalEvidenceV2) {
  return CodexDevelopmentProjectDefaultBranchRevisionHealthV2(
    artifactBytes(evidence),
    {
      artifactRef: 'github-actions://run/1/artifact/revision-health',
      expectedSubjectRevision: evidence.subject.revision,
      recorder: evidence.producer,
      now: () => new Date('2026-01-01T00:00:02.000Z')
    }
  );
}

function cloneEvidence(
  evidence: DefaultBranchRevisionHealthPhysicalEvidenceV2
): Record<string, any> {
  return JSON.parse(JSON.stringify(evidence)) as Record<string, any>;
}

test('revision-health source exports a projector but no live receipt', () => {
  expect(revisionHealth.DEFAULT_BRANCH_REVISION_HEALTH_RECEIPT).toBeUndefined();
  expect(revisionHealth.DEFAULT_BRANCH_REVISION_HEALTH).toBeUndefined();
  expect(revisionHealth.CodexDevelopmentProjectDefaultBranchRevisionHealthV2)
    .toBeFunction();
});

test('receipt uses the external physical-Evidence schema and exact subject identity', () => {
  const receipt = project(physicalEvidence());
  expect(receipt.schema).toBe(DEFAULT_BRANCH_REVISION_HEALTH_RECEIPT_SCHEMA);
  expect(receipt.subject).toEqual({
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    revision: SUBJECT,
    tree: TREE
  });
  expect(receipt.workspace.before.revision).toBe(SUBJECT);
  expect(receipt.workspace.after.tree).toBe(TREE);
});

test('Evidence for one revision cannot authorize a successor revision', () => {
  const evidence = physicalEvidence();
  expect(() => CodexDevelopmentProjectDefaultBranchRevisionHealthV2(
    artifactBytes(evidence),
    {
      artifactRef: 'github-actions://run/1/artifact/revision-health',
      expectedSubjectRevision: SUCCESSOR,
      recorder: evidence.producer,
      now: () => new Date('2026-01-01T00:00:02.000Z')
    }
  )).toThrow('expected exact subject revision');
});

test('receipt preserves physical argv, exit code, timestamps, output digest, producer and workspace', () => {
  const evidence = physicalEvidence();
  const receipt = project(evidence);
  const imports = receipt.checks.find(({ id }) => id === 'imports-check')!;
  expect(imports.command?.argv).toEqual(['bun', 'run', 'imports-check']);
  expect(imports.command?.exitCode).toBe(0);
  expect(imports.command?.startedAt).toBe('2026-01-01T00:00:00.000Z');
  expect(imports.command?.finishedAt).toBe('2026-01-01T00:00:01.000Z');
  expect(imports.command?.outputDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(receipt.producer).toEqual(evidence.producer);
  expect(receipt.verifiedAt).toBe('2026-01-01T00:00:01.000Z');
  expect(receipt.recordedAt).toBe('2026-01-01T00:00:02.000Z');
});

test('artifact digest is computed from the external raw bytes', () => {
  const evidence = physicalEvidence();
  const bytes = artifactBytes(evidence);
  const receipt = CodexDevelopmentProjectDefaultBranchRevisionHealthV2(bytes, {
    artifactRef: 'github-actions://run/1/artifact/revision-health',
    expectedSubjectRevision: SUBJECT,
    recorder: evidence.producer,
    now: () => new Date('2026-01-01T00:00:02.000Z')
  });
  expect(receipt.artifact.digest).toBe(
    `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  );
  expect(receipt.artifact.byteLength).toBe(bytes.byteLength);
});

test('one required deterministic failure produces verification-failed', () => {
  const evidence = physicalEvidence({
    commands: [
      command('imports-check', {
        outcome: 'failed',
        failureClass: 'deterministic',
        exitCode: 1
      }),
      command('strict-typecheck'),
      command('focused-tests'),
      command('repository-audit')
    ]
  });
  const receipt = project(evidence);
  expect(receipt.verificationHealth).toBe('verification-failed');
  expect(receipt.trustEligibility).toBe('repair-only');
});

test('dirty workspace before or after verification produces verification-failed', () => {
  expect(project(physicalEvidence({ cleanBefore: false })).verificationHealth)
    .toBe('verification-failed');
  expect(project(physicalEvidence({ cleanAfter: false })).verificationHealth)
    .toBe('verification-failed');
});

test('environment-blocked or unsupported required checks produce verification-partial', () => {
  const environmentBlocked = physicalEvidence({
    commands: [
      command('imports-check'),
      command('strict-typecheck', {
        outcome: 'environment-blocked',
        failureClass: 'environment',
        exitCode: null
      }),
      command('focused-tests'),
      command('repository-audit')
    ]
  });
  expect(project(environmentBlocked).verificationHealth)
    .toBe('verification-partial');

  const unsupported = physicalEvidence({
    commands: [
      command('imports-check'),
      command('strict-typecheck'),
      command('focused-tests'),
      command('repository-audit', {
        outcome: 'unsupported',
        failureClass: 'unsupported',
        exitCode: null
      })
    ]
  });
  expect(project(unsupported).verificationHealth)
    .toBe('verification-partial');
});

test('an executed failure without a canonical failure classification remains partial', () => {
  const evidence = physicalEvidence({
    commands: [
      command('imports-check', {
        outcome: 'failed',
        failureClass: 'unresolved',
        exitCode: 1
      }),
      command('strict-typecheck'),
      command('focused-tests'),
      command('repository-audit')
    ]
  });
  expect(project(evidence).verificationHealth).toBe('verification-partial');
});

test('missing Evidence for one applicable required check produces verification-partial', () => {
  const evidence = physicalEvidence({
    commands: [
      command('imports-check'),
      command('strict-typecheck'),
      command('focused-tests')
    ]
  });
  const receipt = project(evidence);
  expect(receipt.verificationHealth).toBe('verification-partial');
  expect(receipt.checks.find(({ id }) => id === 'repository-audit')).toMatchObject({
    outcome: 'not-run',
    command: null
  });
});

test('only all applicable required checks passed produces verification-passed', () => {
  const receipt = project(physicalEvidence());
  expect(receipt.verificationHealth).toBe('verification-passed');
  expect(receipt.trustEligibility).toBe('trust-transition-required');
  expect(receipt.trustEligibility).not.toBe('trusted');
});

test('not-applicable checks are excluded from required coverage only by policy', () => {
  const checks: readonly DefaultBranchRevisionHealthPolicyCheckV2[] = [
    ...REQUIRED_CHECKS,
    { id: 'windows-only', applicability: 'not-applicable' }
  ];
  const receipt = project(physicalEvidence({ checks }));
  expect(receipt.verificationHealth).toBe('verification-passed');
  expect(receipt.checks.find(({ id }) => id === 'windows-only')).toMatchObject({
    applicability: 'not-applicable',
    outcome: 'not-run',
    command: null
  });
});

test('self-declared trust fields in physical Evidence are rejected', () => {
  const evidence = cloneEvidence(physicalEvidence());
  evidence.trustEligibility = 'trusted';
  expect(() => project(evidence as DefaultBranchRevisionHealthPhysicalEvidenceV2))
    .toThrow('must contain exactly');
});

test('malformed command execution metadata is rejected', () => {
  const evidence = cloneEvidence(physicalEvidence());
  evidence.commands[0].outcome = 'passed';
  evidence.commands[0].exitCode = 1;
  expect(() => project(evidence as DefaultBranchRevisionHealthPhysicalEvidenceV2))
    .toThrow('passed outcome is inconsistent');
});

test('not-applicable policy cannot be bypassed with hidden command Evidence', () => {
  const evidence = physicalEvidence({
    checks: [
      ...REQUIRED_CHECKS,
      { id: 'windows-only', applicability: 'not-applicable' }
    ],
    commands: [
      ...REQUIRED_CHECKS.map(({ id }) => command(id)),
      command('windows-only')
    ]
  });
  expect(() => project(evidence)).toThrow('must not carry command Evidence');
});

test('recorder time cannot precede the physical verification finish time', () => {
  const evidence = physicalEvidence();
  expect(() => CodexDevelopmentProjectDefaultBranchRevisionHealthV2(
    artifactBytes(evidence),
    {
      artifactRef: 'github-actions://run/1/artifact/revision-health',
      expectedSubjectRevision: SUBJECT,
      recorder: evidence.producer,
      now: () => new Date('2025-12-31T23:59:59.000Z')
    }
  )).toThrow('recorder time precedes physical verification');
});
