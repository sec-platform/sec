import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  DOCUMENT_AUTHORITY_REGISTRY_PATH,
  scanDocumentation,
  type DocsDoctorResult
} from '../../docs/scripts/docs-doctor.ts';
import {
  DOCUMENT_AUTHORITY_REGISTRY_SCHEMA,
  parseDocumentationAuthorityRegistry,
  renderDocumentationIndex,
  type DocumentationAuthorityRegistry
} from '../../platform/shared/documentation-authority-contract.ts';
import { CodexDevelopmentGitBlobSha256 } from '../../scripts/codex/document-control-plane-contract.ts';

const ACTIVE_PACKAGE_ID = 'fixture-active-v1';
const ACTIVE_MANIFEST = `docs/work-packages/${ACTIVE_PACKAGE_ID}.md`;

interface DocumentationFixture {
  dispose: () => Promise<void>;
  docsRoot: string;
  repositoryRoot: string;
  registry: DocumentationAuthorityRegistry;
  scan: () => Promise<DocsDoctorResult>;
  write: (repositoryPath: string, content: string | Uint8Array) => Promise<void>;
}

function document(
  title: string,
  domain: string,
  status: 'active' | 'stable' | 'draft' = 'stable'
): string {
  return `---
title: ${title}
status: ${status}
domain: ${domain}
last-reviewed: 2026-07-28
---

# ${title}

Stable fixture content.
`;
}

function fixtureRegistry(): DocumentationAuthorityRegistry {
  return parseDocumentationAuthorityRegistry(JSON.stringify({
    schema: DOCUMENT_AUTHORITY_REGISTRY_SCHEMA,
    documents: [
      {
        id: 'root-readme',
        path: 'README.md',
        kind: 'navigation',
        domain: 'entry',
        lifecycle: 'active',
        dynamicPolicy: 'forbidden',
        owns: [],
        projects: ['product'],
        audience: ['developer'],
        consumers: ['repository-home'],
        updateTriggers: ['navigation-changed']
      },
      {
        id: 'agents-entry',
        path: 'AGENTS.md',
        kind: 'agent-projection',
        domain: 'development',
        lifecycle: 'active',
        dynamicPolicy: 'forbidden',
        owns: [],
        projects: ['product'],
        audience: ['agent'],
        consumers: ['agent-host'],
        updateTriggers: ['skill-routing-changed']
      },
      {
        id: 'documentation-registry',
        path: 'docs/authority.json',
        kind: 'registry',
        domain: 'documentation',
        lifecycle: 'stable',
        dynamicPolicy: 'forbidden',
        owns: [
          'documentation.identity',
          'documentation.lifecycle',
          'documentation.ownership'
        ],
        projects: [],
        audience: ['developer'],
        consumers: ['docs-doctor'],
        updateTriggers: ['document-created']
      },
      {
        id: 'docs-index',
        path: 'docs/README.md',
        kind: 'navigation',
        domain: 'documentation',
        lifecycle: 'active',
        dynamicPolicy: 'forbidden',
        owns: [],
        projects: ['product'],
        generatedFrom: 'docs/authority.json',
        audience: ['developer'],
        consumers: ['docs-reader'],
        updateTriggers: ['registry-changed']
      },
      {
        id: 'product',
        path: 'docs/product.md',
        kind: 'authority',
        domain: 'product',
        lifecycle: 'stable',
        dynamicPolicy: 'forbidden',
        owns: ['product.boundary'],
        projects: [],
        audience: ['developer'],
        consumers: ['compiler'],
        updateTriggers: ['product-boundary-changed']
      },
      {
        id: 'current-state',
        path: 'docs/work/current-state.yaml',
        kind: 'control',
        domain: 'current-control',
        lifecycle: 'active',
        dynamicPolicy: 'control',
        owns: ['control.resolver-authority'],
        projects: [],
        audience: ['agent'],
        consumers: ['resolver'],
        updateTriggers: ['goal-authority-changed']
      },
      {
        id: 'rolling-plan',
        path: 'docs/work/rolling-plan.md',
        kind: 'control',
        domain: 'current-control',
        lifecycle: 'active',
        dynamicPolicy: 'control',
        owns: ['control.rolling-plan'],
        projects: [],
        audience: ['agent'],
        consumers: ['a0'],
        updateTriggers: ['work-package-changed']
      },
      {
        id: 'active-work-package',
        path: 'docs/work/active-work-package.md',
        kind: 'control',
        domain: 'current-control',
        lifecycle: 'active',
        dynamicPolicy: 'control',
        owns: ['control.active-work-package'],
        projects: [],
        audience: ['agent'],
        consumers: ['resolver'],
        updateTriggers: ['work-package-changed']
      }
    ]
  }));
}

function rollingPlan(): string {
  return `---
title: Fixture rolling plan
status: active
domain: current-control
last-reviewed: 2026-07-28
---

# Fixture rolling plan

## 当前唯一 Work Package

### ${ACTIVE_PACKAGE_ID}

- 结果：fixture。

## 候选 Work Package

### 1. candidate-one-v1

- 依赖：当前包。

### 2. candidate-two-v1

- 依赖：前一包。

## Gate、单写者与重算

- A0 owns the fixture gate.
`;
}

async function createFixture(): Promise<DocumentationFixture> {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-docs-doctor-v7-'));
  const docsRoot = path.join(repositoryRoot, 'docs');
  const registry = fixtureRegistry();
  const manifestBytes = Buffer.from(`---
schema: codex-development-work-package-v1
id: ${ACTIVE_PACKAGE_ID}
tracking: issue-173
base: "${'1'.repeat(40)}"
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v17
tasks:
  - id: fixture-task
    owner: a0
    ownedPaths:
      - ${ACTIVE_MANIFEST}
forbiddenPaths:
  - platform/compiler/
acceptance:
  - "Registry-backed docs fixture passes."
tests:
  - "bun run docs:doctor"
---

# ${ACTIVE_PACKAGE_ID}
`, 'utf8');

  const write = async (
    repositoryPath: string,
    content: string | Uint8Array
  ): Promise<void> => {
    const file = path.join(repositoryRoot, ...repositoryPath.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  };

  await write('README.md', '# Fixture\n');
  await write('AGENTS.md', '# Fixture Agent Entry\n');
  await write(DOCUMENT_AUTHORITY_REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
  await write('docs/README.md', renderDocumentationIndex(registry));
  await write('docs/product.md', document('Fixture Product', 'product'));
  await write('docs/work/current-state.yaml', `schema: sec-current-state-live-v1
resolver:
  command: bun scripts/codex/document-control-plane.ts status --json
  repository: sec-platform/sec
  remote: origin
  defaultBranch: main
  defaultRef: refs/remotes/origin/main
  requireRemoteMatch: true
stableFacts: {}
`);
  await write('docs/work/rolling-plan.md', rollingPlan());
  await write('docs/work/active-work-package.md', `---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-07-28
---

# Fixture active Work Package

\`\`\`yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: ${ACTIVE_MANIFEST}
manifestDigest: ${CodexDevelopmentGitBlobSha256(manifestBytes)}
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
\`\`\`
`);
  await write(ACTIVE_MANIFEST, manifestBytes);

  return {
    dispose: () => rm(repositoryRoot, { recursive: true, force: true }),
    docsRoot,
    repositoryRoot,
    registry,
    scan: () => scanDocumentation({
      docsRoot,
      repositoryRoot,
      readCandidateManifestBlob: async (manifestPath) =>
        readFile(path.join(repositoryRoot, ...manifestPath.split('/')))
    }),
    write
  };
}

test('registry-backed documentation fixture passes', async () => {
  const fixture = await createFixture();
  try {
    expect(await fixture.scan()).toMatchObject({ errors: [], warnings: [] });
  } finally {
    await fixture.dispose();
  }
});

test('unregistered active documents fail closed', async () => {
  const fixture = await createFixture();
  try {
    await fixture.write('docs/unknown-owner.md', document('Unknown', 'unknown'));
    expect((await fixture.scan()).errors.map((issue) => issue.code))
      .toContain('unregistered-active-document');
  } finally {
    await fixture.dispose();
  }
});

test('duplicate canonical ownership is rejected', () => {
  const raw = JSON.parse(JSON.stringify(fixtureRegistry())) as {
    documents: Array<Record<string, unknown>>;
  };
  (raw.documents[4]!.owns as string[]) = ['documentation.identity'];
  expect(() => parseDocumentationAuthorityRegistry(JSON.stringify(raw)))
    .toThrow(/Canonical ownership documentation\.identity is duplicated/u);
});

test('generated index content drift is rejected', async () => {
  const fixture = await createFixture();
  try {
    await fixture.write('docs/README.md', document('Hand edited index', 'documentation', 'active'));
    expect((await fixture.scan()).errors.map((issue) => issue.code))
      .toContain('generated-index-drift');
  } finally {
    await fixture.dispose();
  }
});

test('dynamic Git and PR identities are rejected in stable authorities', async () => {
  const fixture = await createFixture();
  try {
    await fixture.write(
      'docs/product.md',
      `${document('Fixture Product', 'product')}main@${'a'.repeat(40)} and PR #173\n`
    );
    expect((await fixture.scan()).errors.map((issue) => issue.code))
      .toContain('dynamic-fact-in-stable-document');
  } finally {
    await fixture.dispose();
  }
});

test('registry lifecycle and frontmatter domain must match', async () => {
  const fixture = await createFixture();
  try {
    await fixture.write('docs/product.md', document('Fixture Product', 'wrong-domain', 'active'));
    expect((await fixture.scan()).errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['registry-domain-mismatch', 'registry-lifecycle-mismatch'])
    );
  } finally {
    await fixture.dispose();
  }
});

test('pointer digest and rolling-plan binding remain fail-closed', async () => {
  const fixture = await createFixture();
  try {
    await fixture.write(
      'docs/work/active-work-package.md',
      (await readFile(path.join(fixture.repositoryRoot, 'docs/work/active-work-package.md'), 'utf8'))
        .replace(/sha256:[0-9a-f]{64}/u, `sha256:${'0'.repeat(64)}`)
    );
    expect((await fixture.scan()).errors.map((issue) => issue.code))
      .toContain('control-plane-invalid');
  } finally {
    await fixture.dispose();
  }
});

test('machine ledger version drift is rejected against package authority', async () => {
  const fixture = await createFixture();
  try {
    const raw = JSON.parse(await readFile(
      path.join(fixture.repositoryRoot, DOCUMENT_AUTHORITY_REGISTRY_PATH),
      'utf8'
    )) as { documents: Array<Record<string, unknown>>; schema: string };
    raw.documents.push({
      id: 'external-provider-ledger',
      path: 'docs/governance/external-capability-ledger.yaml',
      kind: 'machine-ledger',
      domain: 'external-provider',
      lifecycle: 'active',
      dynamicPolicy: 'machine-state',
      owns: ['provider.state'],
      projects: ['product'],
      audience: ['machine'],
      consumers: ['provider-governance'],
      updateTriggers: ['provider-observation']
    });
    const registry = parseDocumentationAuthorityRegistry(JSON.stringify(raw));
    await fixture.write(DOCUMENT_AUTHORITY_REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
    await fixture.write('docs/README.md', renderDocumentationIndex(registry));
    await fixture.write('package.json', JSON.stringify({ devDependencies: { gitnexus: '1.6.3' } }));
    await fixture.write('docs/governance/external-capability-ledger.yaml', `schema: sec-external-capability-ledger-v2
status: revalidation-required
binding:
  repository: sec-platform/sec
  packageAuthority: package.json
  lockAuthority: bun.lock
providers:
  - id: gitnexus
    observedVersion: 1.6.9
    versionAuthority: package.json#devDependencies.gitnexus
    surfaces:
      cli: [analyze, status]
      standingMcp: []
`);
    expect((await fixture.scan()).errors.map((issue) => issue.code))
      .toContain('machine-ledger-invalid');
  } finally {
    await fixture.dispose();
  }
});

test('Nexus ledger cannot claim completion without materialized coverage', async () => {
  const fixture = await createFixture();
  try {
    const raw = JSON.parse(await readFile(
      path.join(fixture.repositoryRoot, DOCUMENT_AUTHORITY_REGISTRY_PATH),
      'utf8'
    )) as { documents: Array<Record<string, unknown>>; schema: string };
    raw.documents.push({
      id: 'nexus-ledger',
      path: 'docs/governance/nexus-absorption-ledger.yaml',
      kind: 'machine-ledger',
      domain: 'nexus-corpus',
      lifecycle: 'active',
      dynamicPolicy: 'machine-state',
      owns: ['corpus.nexus.state'],
      projects: ['product'],
      audience: ['machine'],
      consumers: ['repository-audit'],
      updateTriggers: ['nexus-census']
    });
    const registry = parseDocumentationAuthorityRegistry(JSON.stringify(raw));
    await fixture.write(DOCUMENT_AUTHORITY_REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
    await fixture.write('docs/README.md', renderDocumentationIndex(registry));
    await fixture.write('docs/governance/nexus-absorption-ledger.yaml', `schema: sec-nexus-corpus-ledger-v2
status: complete
coverage:
  pathClassification: { materialized: false, classified: 0, total: null }
  eprBindings: { bound: 29, expected: 29 }
  skillBindings: { bound: 17, expected: 17 }
  acceptedParity: { proven: 1, accepted: 1 }
  unexplainedDeltaCount: 0
completion:
  censusComplete: true
  parityComplete: true
  retirementComplete: true
  noOmissionProven: true
`);
    expect((await fixture.scan()).errors.map((issue) => issue.code))
      .toContain('machine-ledger-invalid');
  } finally {
    await fixture.dispose();
  }
});

test('portable link and deprecated-token diagnostics remain available', async () => {
  const fixture = await createFixture();
  try {
    await fixture.write(
      'docs/product.md',
      `${document('Fixture Product', 'product')}\nfile:///Z:/missing.md\n\`docs/missing.md\`\nCompilerPass\n`
    );
    expect((await fixture.scan()).issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['deprecated-token', 'file-uri-reference', 'unresolved-inline-path'])
    );
  } finally {
    await fixture.dispose();
  }
});

test('machine-local absolute inline paths fail closed without flagging plain filenames', async () => {
  const fixture = await createFixture();
  try {
    await fixture.write(
      'docs/product.md',
      `${document('Fixture Product', 'product')}\n\`C:\\Users\\fixture\\sec\\local.md\`\n\`example.ts\`\n`
    );
    const result = await fixture.scan();
    const localPathIssues = result.errors.filter(
      (issue) => issue.code === 'hardcoded-local-repository-path'
    );
    expect(result.errors).toHaveLength(1);
    expect(localPathIssues).toHaveLength(1);
    expect(result.issues.some((issue) => issue.message.includes('example.ts'))).toBe(false);
  } finally {
    await fixture.dispose();
  }
});

test('incremental mode skips unchanged per-document diagnostics', async () => {
  const fixture = await createFixture();
  try {
    await fixture.write(
      'docs/product.md',
      `${document('Fixture Product', 'product')}\nCompilerPass\n`
    );
    expect((await fixture.scan()).issues.map((issue) => issue.code)).toContain('deprecated-token');
    const incrementalScan = await scanDocumentation({
      docsRoot: fixture.docsRoot,
      repositoryRoot: fixture.repositoryRoot,
      readCandidateManifestBlob: async (manifestPath) =>
        readFile(path.join(fixture.repositoryRoot, ...manifestPath.split('/'))),
      changedDocumentPaths: new Set(['platform/shared/some-unrelated-file.ts'])
    });
    expect(incrementalScan.issues.map((issue) => issue.code)).not.toContain('deprecated-token');
  } finally {
    await fixture.dispose();
  }
});

test('incremental mode always runs global control-plane invariants', async () => {
  const fixture = await createFixture();
  try {
    await fixture.write(
      'docs/work/active-work-package.md',
      (await readFile(path.join(fixture.repositoryRoot, 'docs/work/active-work-package.md'), 'utf8'))
        .replace(/sha256:[0-9a-f]{64}/u, `sha256:${'0'.repeat(64)}`)
    );
    const result = await scanDocumentation({
      docsRoot: fixture.docsRoot,
      repositoryRoot: fixture.repositoryRoot,
      readCandidateManifestBlob: async (manifestPath) =>
        readFile(path.join(fixture.repositoryRoot, ...manifestPath.split('/'))),
      changedDocumentPaths: new Set(['docs/product.md'])
    });
    expect(result.issues.map((issue) => issue.code)).toContain('control-plane-invalid');
  } finally {
    await fixture.dispose();
  }
});

test('registry or index changes force a full per-document scan', async () => {
  const fixture = await createFixture();
  try {
    await fixture.write(
      'docs/product.md',
      `${document('Fixture Product', 'product')}\nCompilerPass\n`
    );
    const result = await scanDocumentation({
      docsRoot: fixture.docsRoot,
      repositoryRoot: fixture.repositoryRoot,
      readCandidateManifestBlob: async (manifestPath) =>
        readFile(path.join(fixture.repositoryRoot, ...manifestPath.split('/'))),
      changedDocumentPaths: new Set(['docs/authority.json'])
    });
    expect(result.issues.map((issue) => issue.code)).toContain('deprecated-token');
  } finally {
    await fixture.dispose();
  }
});
