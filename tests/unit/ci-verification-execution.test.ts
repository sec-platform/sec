import { createHash } from 'node:crypto';
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

function manifestSource(ciRevision = 'ci-verification-v19'): string {
  return `---
schema: codex-development-work-package-v1
id: exact-verification-v1
tracking: none
base: "${BASE}"
manifestState: frozen
requiredProfile: quick
ciRevision: ${ciRevision}
tasks:
  - id: exact-verification
    owner: verification-writer
    ownedPaths:
      - scripts/ci-verification.ts
forbiddenPaths:
  - platform/compiler/
acceptance:
  - exact-verification
tests:
  - focused-verification
---

# Exact Verification
`;
}

function exactManifest(source: Uint8Array | string) {
  const bytes = typeof source === 'string' ? new TextEncoder().encode(source) : source;
  return {
    blobSha: '4'.repeat(40),
    bytes,
    mode: '100644' as const,
    type: 'blob' as const
  };
}

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
    contractRevision: 'ci-verification-v19',
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

test('CI verification resolves changed paths against the immutable PR base SHA', async () => {
  const symbolicBase = 'refs/remotes/origin/main';
  const observedChangedBases: string[] = [];
  const code = await CodexDevelopmentCiVerificationMain({
    argv: ['--profile', 'quick', '--expected-head', HEAD],
    env: {
      SEC_CHANGED_BASE: symbolicBase,
      SEC_AFFECTED_TESTS_BASE: symbolicBase
    },
    now: clock(),
    gitRevision: (ref) => ref === symbolicBase ? BASE : gitRevision(ref),
    trackedTreeIsClean: () => true,
    changedFiles: (baseRef) => {
      observedChangedBases.push(baseRef);
      return [];
    },
    runGate: async () => ({
      code: 0,
      rawOutputDigest: `sha256:${'0'.repeat(64)}`,
      failureTail: ''
    }),
    writeEvidence: () => undefined
  });

  expect(code).toBe(0);
  expect(observedChangedBases).toEqual([BASE]);
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
    contractRevision: 'ci-verification-v19',
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
      contractRevision: 'ci-verification-v19',
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
    failure: { stage: 'manifest' }
  });
  expect(captured.evidence?.failure?.tail).toContain('SEC_WORK_PACKAGE_MANIFEST_PATH');
});

test('CI verification binds the manifest from captured HEAD before the first gate', async () => {
  const captured: { evidence?: CodexDevelopmentVerificationEvidenceV2 } = {};
  const manifest = manifestSource();
  let capturedCommit: string | undefined;
  let gateCalls = 0;
  const code = await CodexDevelopmentCiVerificationMain({
    argv: ['--profile', 'quick', '--expected-head', HEAD],
    env: {
      SEC_CHANGED_BASE: BASE,
      SEC_AFFECTED_TESTS_BASE: BASE,
      SEC_WORK_PACKAGE_MANIFEST_PATH: 'docs/work-packages/exact-verification-v1.md'
    },
    now: clock(),
    gitRevision,
    trackedTreeIsClean: () => true,
    changedFiles: () => [],
    readExactGitBlob: (options) => {
      capturedCommit = options.commitSha;
      return exactManifest(manifest);
    },
    runGate: async () => {
      gateCalls += 1;
      return { code: 0, rawOutputDigest: `sha256:${'0'.repeat(64)}`, failureTail: '' };
    },
    writeEvidence: (_path, value) => { captured.evidence = value; }
  });

  expect(code).toBe(0);
  expect(capturedCommit).toBe(HEAD);
  expect(gateCalls).toBeGreaterThan(0);
  expect(captured.evidence?.manifestDigest).toBe(
    `sha256:${createHash('sha256').update(manifest).digest('hex')}`
  );
});

test('CI verification exact manifest failures execute zero gates', async () => {
  for (const [name, readExactGitBlob] of [
    ['missing', () => { throw new Error('exact manifest missing'); }],
    ['invalid UTF-8', () => exactManifest(Uint8Array.from([0xc3, 0x28]))]
  ] as const) {
    const captured: { evidence?: CodexDevelopmentVerificationEvidenceV2 } = {};
    let gateCalls = 0;
    const code = await CodexDevelopmentCiVerificationMain({
      argv: ['--profile', 'quick', '--expected-head', HEAD],
      env: {
        SEC_CHANGED_BASE: BASE,
        SEC_AFFECTED_TESTS_BASE: BASE,
        SEC_WORK_PACKAGE_MANIFEST_PATH: 'docs/work-packages/exact-verification-v1.md'
      },
      now: clock(),
      gitRevision,
      trackedTreeIsClean: () => true,
      changedFiles: () => [],
      readExactGitBlob,
      runGate: async () => {
        gateCalls += 1;
        return { code: 0, rawOutputDigest: `sha256:${'0'.repeat(64)}`, failureTail: '' };
      },
      writeEvidence: (_path, value) => { captured.evidence = value; }
    });

    expect({ code, gateCalls, name }).toMatchObject({ code: 1, gateCalls: 0, name });
    expect(captured.evidence).toMatchObject({ status: 'failed' });
  }
});

test('CI verification rejects clean-to-clean HEAD drift after gate execution', async () => {
  let headReads = 0;
  const captured: { evidence?: CodexDevelopmentVerificationEvidenceV2 } = {};
  const code = await CodexDevelopmentCiVerificationMain({
    argv: ['--profile', 'quick', '--expected-head', HEAD],
    env: { SEC_CHANGED_BASE: BASE, SEC_AFFECTED_TESTS_BASE: BASE },
    now: clock(),
    gitRevision: (ref) => {
      if (ref === 'HEAD') return headReads++ === 0 ? HEAD : '5'.repeat(40);
      return gitRevision(ref);
    },
    trackedTreeIsClean: () => true,
    changedFiles: () => [],
    runGate: async () => ({
      code: 0,
      rawOutputDigest: `sha256:${'0'.repeat(64)}`,
      failureTail: ''
    }),
    writeEvidence: (_path, value) => { captured.evidence = value; }
  });

  expect(code).toBe(1);
  expect(captured.evidence).toMatchObject({
    status: 'failed',
    cleanState: { before: true, after: true },
    failure: { stage: 'exact-identity' }
  });
});

test('CI verification rejects a parseable historical Work Package revision', async () => {
  const captured: { evidence?: CodexDevelopmentVerificationEvidenceV2 } = {};
  let writes = 0;
  const code = await CodexDevelopmentCiVerificationMain({
    argv: ['--profile', 'quick', '--expected-head', HEAD],
    env: {
      SEC_CHANGED_BASE: BASE,
      SEC_AFFECTED_TESTS_BASE: BASE,
      SEC_WORK_PACKAGE_MANIFEST_PATH: 'docs/work-packages/exact-verification-v1.md'
    },
    now: clock(),
    gitRevision,
    trackedTreeIsClean: () => true,
    changedFiles: () => [],
    readExactGitBlob: () => exactManifest(manifestSource('ci-verification-v18')),
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
    failure: { stage: 'manifest' }
  });
  expect(captured.evidence?.failure?.tail).toContain('current CI verification revision');
});
