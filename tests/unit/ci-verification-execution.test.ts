import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  CodexDevelopmentAssertVerificationEvidenceV2,
  type CodexDevelopmentVerificationEvidenceV2
} from '../../platform/shared/ci-evidence-contract.ts';
import { CodexDevelopmentCiVerificationMain } from '../../scripts/ci-verification.ts';

const HEAD = '1'.repeat(40);
const TREE = '2'.repeat(40);
const BASE = '3'.repeat(40);

function clock(): () => Date {
  let time = Date.parse('2026-07-14T00:00:00.000Z');
  return () => {
    const value = new Date(time);
    time += 10;
    return value;
  };
}

function gitRevision(ref: string): string | null {
  if (ref === 'HEAD') return HEAD;
  if (ref === 'HEAD^{tree}') return TREE;
  if (ref === BASE || ref === 'HEAD^1') return BASE;
  return null;
}

test('CI verification writes one exact-head passed Evidence V2 after all focused gates pass', async () => {
  const captured: { evidence?: CodexDevelopmentVerificationEvidenceV2 } = {};
  const calls: string[] = [];
  const code = await CodexDevelopmentCiVerificationMain({
    argv: ['--profile', 'quick', '--expected-head', HEAD],
    env: { SEC_CHANGED_BASE: BASE, SEC_AFFECTED_TESTS_BASE: BASE },
    now: clock(),
    gitRevision,
    trackedTreeIsClean: () => true,
    changedFiles: () => [],
    runGate: async ({ id }) => {
      calls.push(id);
      return { code: 0, rawOutputDigest: `sha256:${'0'.repeat(64)}`, failureTail: '' };
    },
    writeEvidence: (_path, value) => { captured.evidence = value; }
  });

  expect(code).toBe(0);
  expect(calls).toEqual(['typecheck', 'affected-tests']);
  expect(captured.evidence).toMatchObject({
    schema: 'codex-development-verification-evidence-v2',
    contractRevision: 'ci-verification-v10',
    kind: 'verification',
    profile: 'quick',
    headSha: HEAD,
    treeSha: TREE,
    prBaseSha: BASE,
    affectedBaseSha: BASE,
    status: 'passed',
    selectionResolved: true,
    cleanState: { before: true, after: true },
    failure: null
  });
  expect(captured.evidence?.gates.map((gate) => gate.status)).toEqual(['passed', 'passed']);
  expect(captured.evidence?.evidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
});

test('CI verification reaches focused gates for repository and governed control-plane documentation', async () => {
  const captured: { evidence?: CodexDevelopmentVerificationEvidenceV2 } = {};
  const calls: string[] = [];
  const code = await CodexDevelopmentCiVerificationMain({
    argv: ['--profile', 'quick', '--expected-head', HEAD],
    env: { SEC_CHANGED_BASE: BASE, SEC_AFFECTED_TESTS_BASE: BASE },
    now: clock(),
    gitRevision,
    trackedTreeIsClean: () => true,
    changedFiles: () => [
      'README.md',
      'docs/03-MVP实施计划与路线图.md',
      'docs/work/current-state.yaml',
      'docs/governance/nexus-absorption-ledger.yaml'
    ],
    runGate: async ({ id }) => {
      calls.push(id);
      return { code: 0, rawOutputDigest: `sha256:${'0'.repeat(64)}`, failureTail: '' };
    },
    writeEvidence: (_path, value) => { captured.evidence = value; }
  });

  expect(code).toBe(0);
  expect(calls).toEqual(['docs-doctor', 'typecheck', 'affected-tests']);
  expect(captured.evidence).toMatchObject({
    contractRevision: 'ci-verification-v10',
    status: 'passed',
    selectionResolved: true,
    failure: null
  });
});

test('CI verification default writer publishes one canonical file without temporary residue', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sec-ci-verification-'));
  const evidencePath = path.join(directory, 'evidence.json');
  try {
    const code = await CodexDevelopmentCiVerificationMain({
      argv: ['--profile', 'quick', '--expected-head', HEAD],
      env: {
        SEC_CHANGED_BASE: BASE,
        SEC_AFFECTED_TESTS_BASE: BASE,
        SEC_CI_VERIFICATION_EVIDENCE_PATH: evidencePath
      },
      now: clock(),
      gitRevision,
      trackedTreeIsClean: () => true,
      changedFiles: () => [],
      runGate: async () => ({
        code: 0,
        rawOutputDigest: `sha256:${'0'.repeat(64)}`,
        failureTail: ''
      })
    });

    expect(code).toBe(0);
    expect(readdirSync(directory)).toEqual(['evidence.json']);
    expect(readdirSync(directory).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as unknown;
    CodexDevelopmentAssertVerificationEvidenceV2(evidence, {
      kind: 'verification',
      profile: 'quick',
      headSha: HEAD,
      treeSha: TREE,
      prBaseSha: BASE,
      affectedBaseSha: BASE
    }, new Date('2026-07-14T00:00:00.000Z'));
    expect(evidence.status).toBe('passed');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CI verification clears stale passed evidence before an injected writer failure', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sec-ci-verification-stale-'));
  const evidencePath = path.join(directory, 'evidence.json');
  try {
    writeFileSync(evidencePath, JSON.stringify({ status: 'passed', stale: true }), 'utf8');
    const code = await CodexDevelopmentCiVerificationMain({
      argv: ['--profile', 'quick', '--expected-head', HEAD],
      env: {
        SEC_CHANGED_BASE: BASE,
        SEC_AFFECTED_TESTS_BASE: BASE,
        SEC_CI_VERIFICATION_EVIDENCE_PATH: evidencePath
      },
      now: clock(),
      gitRevision,
      trackedTreeIsClean: () => true,
      changedFiles: () => [],
      runGate: async () => ({
        code: 0,
        rawOutputDigest: `sha256:${'0'.repeat(64)}`,
        failureTail: ''
      }),
      writeEvidence: () => { throw new Error('injected writer failure'); }
    });

    expect(code).toBe(1);
    expect(existsSync(evidencePath)).toBe(false);
    expect(readdirSync(directory)).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const scenario of [
  {
    name: 'clock',
    overrides: {
      now: () => { throw new Error('clock probe sentinel'); }
    }
  },
  {
    name: 'git revision',
    overrides: {
      gitRevision: () => { throw new Error('git revision probe sentinel'); }
    }
  },
  {
    name: 'clean-state',
    overrides: {
      trackedTreeIsClean: () => { throw new Error('clean-state probe sentinel'); }
    }
  },
  {
    name: 'changed-file resolver',
    overrides: {
      changedFiles: () => { throw new Error('changed-file resolver sentinel'); }
    }
  }
] as const) {
  test(`CI verification ${scenario.name} probe exceptions still write exactly one failed Evidence V2`, async () => {
    const captured: { evidence?: CodexDevelopmentVerificationEvidenceV2 } = {};
    let writes = 0;
    const code = await CodexDevelopmentCiVerificationMain({
      argv: ['--profile', 'quick', '--expected-head', HEAD],
      env: { SEC_CHANGED_BASE: BASE, SEC_AFFECTED_TESTS_BASE: BASE },
      now: clock(),
      gitRevision,
      trackedTreeIsClean: () => true,
      changedFiles: () => [],
      runGate: async () => ({ code: 0, rawOutputDigest: `sha256:${'0'.repeat(64)}`, failureTail: '' }),
      ...scenario.overrides,
      writeEvidence: (_path, value) => {
        writes += 1;
        captured.evidence = value;
      }
    });

    expect(code).toBe(1);
    expect(writes).toBe(1);
    expect(captured.evidence).toMatchObject({
      schema: 'codex-development-verification-evidence-v2',
      contractRevision: 'ci-verification-v10',
      kind: 'verification',
      status: 'failed'
    });
    expect(captured.evidence?.failure?.tail).toContain('sentinel');
    expect(captured.evidence?.evidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });
}

test('CI verification manifest binding failure writes exactly one failed Evidence V2', async () => {
  const captured: { evidence?: CodexDevelopmentVerificationEvidenceV2 } = {};
  let writes = 0;
  const code = await CodexDevelopmentCiVerificationMain({
    argv: ['--profile', 'quick', '--expected-head', HEAD],
    env: {
      SEC_CHANGED_BASE: BASE,
      SEC_AFFECTED_TESTS_BASE: BASE,
      SEC_WORK_PACKAGE_MANIFEST_PATH: '../not-canonical.md'
    },
    now: clock(),
    gitRevision,
    trackedTreeIsClean: () => true,
    changedFiles: () => [],
    runGate: async () => ({ code: 0, rawOutputDigest: `sha256:${'0'.repeat(64)}`, failureTail: '' }),
    writeEvidence: (_path, value) => {
      writes += 1;
      captured.evidence = value;
    }
  });

  expect(code).toBe(1);
  expect(writes).toBe(1);
  expect(captured.evidence).toMatchObject({
    schema: 'codex-development-verification-evidence-v2',
    kind: 'verification',
    status: 'failed',
    failure: { stage: 'preflight' }
  });
  expect(captured.evidence?.failure?.tail).toContain('SEC_WORK_PACKAGE_MANIFEST_PATH');
});

test('CI verification rejects a parseable historical Work Package revision', async () => {
  const captured: { evidence?: CodexDevelopmentVerificationEvidenceV2 } = {};
  let writes = 0;
  const code = await CodexDevelopmentCiVerificationMain({
    argv: ['--profile', 'quick', '--expected-head', HEAD],
    env: {
      SEC_CHANGED_BASE: BASE,
      SEC_AFFECTED_TESTS_BASE: BASE,
      SEC_WORK_PACKAGE_MANIFEST_PATH: 'docs/work-packages/b0-bootstrap-v1.md'
    },
    now: clock(),
    gitRevision,
    trackedTreeIsClean: () => true,
    changedFiles: () => [],
    runGate: async () => ({ code: 0, rawOutputDigest: `sha256:${'0'.repeat(64)}`, failureTail: '' }),
    writeEvidence: (_path, value) => {
      writes += 1;
      captured.evidence = value;
    }
  });

  expect(code).toBe(1);
  expect(writes).toBe(1);
  expect(captured.evidence).toMatchObject({
    kind: 'verification',
    status: 'failed',
    failure: { stage: 'preflight' }
  });
  expect(captured.evidence?.failure?.tail).toContain('current CI verification revision');
});
