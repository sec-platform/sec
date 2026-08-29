import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { scanDocumentation } from '../../src/control/documentation/doctor/cli.ts';
import {
  parseDocumentationAuthorityRegistry,
  renderDocumentationIndex
} from '../../src/control/documentation/authority.ts';
import { CodexDevelopmentWorkPackageManifestDigest } from '../../src/control/agent/work-package-contract.ts';

const PACKAGE_ID = 'docs-byte-exact-v1';
const MANIFEST_PATH = `docs/work-packages/${PACKAGE_ID}.md`;

function registrySource(): string {
  return JSON.stringify({
    documents: [
      {
        id: 'root-readme', path: 'README.md', kind: 'navigation', domain: 'entry',
        lifecycle: 'active', dynamicPolicy: 'forbidden', owns: [], projects: ['product'],
        audience: ['developer'], consumers: ['repository-home'], updateTriggers: ['navigation-change']
      },
      {
        id: 'agents-entry', path: 'AGENTS.md', kind: 'agent-projection', domain: 'development',
        lifecycle: 'active', dynamicPolicy: 'forbidden', owns: [], projects: ['product'],
        audience: ['agent'], consumers: ['agent-host'], updateTriggers: ['routing-change']
      },
      {
        id: 'documentation-registry', path: 'docs/authority.json', kind: 'registry',
        domain: 'documentation', lifecycle: 'stable', dynamicPolicy: 'forbidden',
        owns: ['documentation.identity', 'documentation.lifecycle', 'documentation.ownership'],
        projects: [], audience: ['developer'], consumers: ['docs-doctor'],
        updateTriggers: ['document-change']
      },
      {
        id: 'docs-index', path: 'docs/README.md', kind: 'navigation', domain: 'documentation',
        lifecycle: 'active', dynamicPolicy: 'forbidden', owns: [], projects: ['product'],
        generatedFrom: 'docs/authority.json', audience: ['developer'], consumers: ['reader'],
        updateTriggers: ['registry-change']
      },
      {
        id: 'product', path: 'docs/product.md', kind: 'authority', domain: 'product',
        lifecycle: 'stable', dynamicPolicy: 'forbidden', owns: ['product.boundary'], projects: [],
        audience: ['developer'], consumers: ['compiler'], updateTriggers: ['product-change']
      },
      {
        id: 'current-state', path: 'docs/work/current-state.yaml', kind: 'control',
        domain: 'current-control', lifecycle: 'active', dynamicPolicy: 'control',
        owns: ['control.resolver-authority'], projects: [], audience: ['agent'],
        consumers: ['resolver'], updateTriggers: ['goal-change']
      },
      {
        id: 'rolling-plan', path: 'docs/work/rolling-plan.md', kind: 'control',
        domain: 'current-control', lifecycle: 'active', dynamicPolicy: 'control',
        owns: ['control.rolling-plan'], projects: [], audience: ['agent'], consumers: ['a0'],
        updateTriggers: ['package-change']
      },
      {
        id: 'active-work-package', path: 'docs/work/active-work-package.md', kind: 'control',
        domain: 'current-control', lifecycle: 'active', dynamicPolicy: 'control',
        owns: ['control.active-work-package'], projects: [], audience: ['agent'],
        consumers: ['resolver'], updateTriggers: ['package-change']
      }
    ]
  });
}

async function write(root: string, repositoryPath: string, content: string | Uint8Array): Promise<void> {
  const file = path.join(root, ...repositoryPath.split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

test('docs-doctor rejects CRLF-only drift in the generated navigation bytes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-docs-byte-exact-'));
  try {
    const registry = parseDocumentationAuthorityRegistry(registrySource());
    const manifest = Buffer.from(`---
schema: codex-development-work-package-v1
id: ${PACKAGE_ID}
tracking: issue-235
base: "${'1'.repeat(40)}"
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: docs-byte-exact
    owner: docs-worker
    ownedPaths:
      - ${MANIFEST_PATH}
forbiddenPaths:
  - src/compiler/
acceptance:
  - "Generated documentation bytes remain exact."
tests:
  - tests/contract/docs-doctor-byte-exact.test.ts
---

# ${PACKAGE_ID}
`, 'utf8');

    await write(root, 'README.md', '# Fixture\n');
    await write(root, 'AGENTS.md', '# Fixture agents\n');
    await write(root, 'docs/authority.json', JSON.stringify(registry, null, 2) + '\n');
    await write(root, 'docs/README.md', renderDocumentationIndex(registry).replaceAll('\n', '\r\n'));
    await write(root, 'docs/product.md', `---
title: Product
status: stable
domain: product
last-reviewed: 2026-08-03
---

# Product
`);
    await write(root, 'docs/work/current-state.yaml', `schema: sec-current-state-live-v1
resolver:
  command: bun src/control/documentation/document-control-plane.ts status --json
  repository: sec-platform/sec
  remote: origin
  defaultBranch: main
  defaultRef: refs/remotes/origin/main
  requireRemoteMatch: true
stableFacts: {}
`);
    await write(root, 'docs/work/rolling-plan.md', `---
title: Rolling
status: active
domain: current-control
last-reviewed: 2026-08-03
---

# Rolling

## 当前唯一 Work Package

### ${PACKAGE_ID}

- 结果：fixture。

## 候选 Work Package

### 1. candidate-one-v1

- 依赖：当前包。

### 2. candidate-two-v1

- 依赖：前一包。

## Gate、单写者与重算

- A0 owns the fixture gate.
`);
    await write(root, 'docs/work/active-work-package.md', `---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-08-03
---

# Active

\`\`\`yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: ${MANIFEST_PATH}
manifestDigest: ${CodexDevelopmentWorkPackageManifestDigest(manifest)}
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
\`\`\`
`);
    await write(root, MANIFEST_PATH, manifest);

    const result = await scanDocumentation({
      repositoryRoot: root,
      docsRoot: path.join(root, 'docs'),
      readCandidateManifestBlob: async (manifestPath) =>
        readFile(path.join(root, ...manifestPath.split('/')))
    });
    expect(result.errors.map((issue) => issue.code)).toContain('generated-index-drift');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
