import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function moduleHref(repositoryPath: string): string {
  return pathToFileURL(path.resolve(repositoryPath)).href;
}

test('document-control required admission shares one MainHealth session and routes before selection', () => {
  const documentControlHref = moduleHref('src/adapters/self-hosting/control/documentation/document-control-plane.ts');
  const mainHealthHref = moduleHref('src/adapters/self-hosting/control/main-health/work-selection-main-health.ts');
  const selectionHref = moduleHref('src/adapters/self-hosting/control/work-selection/runtime.ts');
  const source = `
import { mock } from 'bun:test';

let routingState = 'ordinary-only';
let sessionDepth = 0;
let sessionCount = 0;
let latestSnapshot = null;

mock.module(${JSON.stringify(mainHealthHref)}, () => ({
  withMainHealthGitHubReadSession: async (input) => {
    if (sessionDepth !== 0) throw new Error('document-control opened a nested owner session');
    sessionCount += 1;
    sessionDepth += 1;
    try {
      return await input.operation();
    } finally {
      sessionDepth -= 1;
    }
  },
  assertMainHealthPublicationAuthorityStable: () => undefined,
  observeCanonicalMainHealthForDocumentControlTesting: async () => {
    throw new Error('Test-only observer used outside its issued actor');
  },
  observeMainHealthGitHubControlInventory: async () => Object.freeze({
    openPullRequests: Object.freeze([]),
    openIssues: Object.freeze([]),
    reviewThreads: Object.freeze([])
  }),
  observeMainHealthGitHubDefaultBranchSha: async () => 'a'.repeat(40),
  observeCanonicalMainHealthForPublication: async (input) => {
    if (sessionDepth !== 1) throw new Error('MainHealth snapshot escaped the shared session');
    latestSnapshot = Object.freeze({});
    return Object.freeze({
      authority: Object.freeze({}),
      stableDigest: 'sha256:' + '1'.repeat(64),
      projection: Object.freeze({ state: 'healthy', ref: 'sha256:' + '2'.repeat(64) }),
      ledger: null,
      repairDecision: Object.freeze({ routingState }),
      supersession: Object.freeze({ kind: 'absent' }),
      workSelectionSnapshot: latestSnapshot
    });
  }
}));

const selectionResult = Object.freeze({
  status: 'resolved',
  marker: 'selection',
  reasonCodes: Object.freeze([]),
  blockerRefs: Object.freeze([])
});

mock.module(${JSON.stringify(selectionHref)}, () => ({
  observeWorkSelectionWithProvider: async () => {
    throw new Error('Test-only selection provider used outside its issued actor');
  },
  observeWorkSelectionLive: async (input) => {
    if (sessionDepth !== 1) throw new Error('selection escaped the shared MainHealth session');
    if (input.mainHealthSnapshot !== latestSnapshot) {
      throw new Error('selection did not consume the exact T2 MainHealth snapshot');
    }
    return selectionResult;
  }
}));

const { observeDocumentControlWorkRouting } = await import(
  ${JSON.stringify(documentControlHref)} + '?main-health-session-contract-v1'
);
const input = Object.freeze({
  repositoryRoot: process.cwd(),
  repository: 'sec-platform/sec',
  defaultBranch: 'main',
  exactMainSha: 'a'.repeat(40),
  exactMainTreeSha: 'b'.repeat(40)
});

const ordinary = await observeDocumentControlWorkRouting(input);
const ordinarySessionCount = sessionCount;
sessionCount = 0;
routingState = 'repair-only';
const repair = await observeDocumentControlWorkRouting(input);

process.stdout.write(JSON.stringify({
  ordinary: {
    selectionMarker: ordinary.selection?.marker ?? null,
    sessionCount: ordinarySessionCount
  },
  repair: {
    selection: repair.selection,
    sessionCount
  },
  finalSessionDepth: sessionDepth
}));
`;
  const result = spawnSync(process.execPath, ['-e', source], {
    cwd: process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 1024 * 1024
  });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    ordinary: {
      selectionMarker: 'selection',
      sessionCount: 1
    },
    repair: {
      selection: null,
      sessionCount: 1
    },
    finalSessionDepth: 0
  });
});
