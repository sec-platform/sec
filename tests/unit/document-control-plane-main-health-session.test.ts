import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  CodexDevelopmentDocumentControlCliAdmissionError,
  resolveLiveControlPlane
} from '../../src/control/documentation/document-control-plane.ts';

function moduleHref(repositoryPath: string): string {
  return pathToFileURL(path.resolve(repositoryPath)).href;
}

test('document-control required admission shares one MainHealth session and routes before selection', () => {
  const documentControlHref = moduleHref('src/control/documentation/document-control-plane.ts');
  const mainHealthHref = moduleHref('src/control/main-health/work-selection-main-health.ts');
  const selectionHref = moduleHref('src/control/main-health/work-selection.ts');
  const source = `
import { mock } from 'bun:test';

let routingState = 'ordinary-only';
let sessionDepth = 0;
let sessionCount = 0;
let calls = [];

mock.module(${JSON.stringify(mainHealthHref)}, () => ({
  withMainHealthGitHubReadSessionV2: async (input) => {
    if (sessionDepth !== 0) throw new Error('document-control opened a nested owner session');
    sessionCount += 1;
    calls.push('session:start');
    sessionDepth += 1;
    try {
      return await input.operation();
    } finally {
      sessionDepth -= 1;
      calls.push('session:end');
    }
  },
  assertMainHealthPublicationAuthorityStableV2: () => undefined,
  observeCanonicalMainHealthForPublicationV2: async (input) => {
    if (sessionDepth !== 1) throw new Error('MainHealth snapshot escaped the shared session');
    calls.push('repair:' + input.mainSha);
    return Object.freeze({
      authority: Object.freeze({}),
      stableDigest: 'sha256:' + '1'.repeat(64),
      projection: Object.freeze({ state: 'healthy', ref: 'sha256:' + '2'.repeat(64) }),
      ledger: null,
      repairDecision: Object.freeze({ routingState, marker: 'repair-' + routingState }),
      supersession: Object.freeze({ kind: 'absent' })
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
  observeSecWorkSelectionLiveV1: async (input) => {
    if (sessionDepth !== 1) throw new Error('selection escaped the shared MainHealth session');
    calls.push('selection:' + input.exactMain);
    return selectionResult;
  }
}));

const { observeDocumentControlWorkRoutingV1 } = await import(
  ${JSON.stringify(documentControlHref)} + '?main-health-session-contract-v1'
);
const input = Object.freeze({
  repositoryRoot: process.cwd(),
  repository: 'sec-platform/sec',
  defaultBranch: 'main',
  exactMainSha: 'a'.repeat(40),
  exactMainTreeSha: 'b'.repeat(40)
});

const ordinary = await observeDocumentControlWorkRoutingV1(input);
const ordinaryCalls = calls;
const ordinarySessionCount = sessionCount;
calls = [];
sessionCount = 0;
routingState = 'repair-only';
const repair = await observeDocumentControlWorkRoutingV1(input);

process.stdout.write(JSON.stringify({
  ordinary: {
    repairMarker: ordinary.repairDecision.marker,
    selectionMarker: ordinary.selection?.marker ?? null,
    calls: ordinaryCalls,
    sessionCount: ordinarySessionCount
  },
  repair: {
    repairMarker: repair.repairDecision.marker,
    selection: repair.selection,
    calls,
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
      repairMarker: 'repair-ordinary-only',
      selectionMarker: 'selection',
      calls: [
        'session:start',
        `repair:${'a'.repeat(40)}`,
        `repair:${'a'.repeat(40)}`,
        `selection:${'a'.repeat(40)}`,
        'session:end'
      ],
      sessionCount: 1
    },
    repair: {
      repairMarker: 'repair-repair-only',
      selection: null,
      calls: [
        'session:start',
        `repair:${'a'.repeat(40)}`,
        `repair:${'a'.repeat(40)}`,
        'session:end'
      ],
      sessionCount: 1
    },
    finalSessionDepth: 0
  });
});

test.skipIf(process.platform !== 'win32')(
  'document-control Windows admission fails before PATH lookup or any child process',
  async () => {
    const originalWhich = Bun.which;
    let whichCalls = 0;
    Bun.which = (command: string) => {
      whichCalls += 1;
      return originalWhich(command);
    };
    try {
      const failure = await resolveLiveControlPlane(process.cwd(), { observeGitHub: false }).then(
        () => undefined,
        (error: unknown) => error
      );
      expect(failure).toBeInstanceOf(CodexDevelopmentDocumentControlCliAdmissionError);
      expect(failure).toMatchObject({
        code: 'DOCUMENT-CONTROL-CLI-ADMISSION-001',
        command: 'git',
        operation: 'git-read',
        status: 'unknown',
        reason: 'installed-executable-capability-unproven'
      });
      expect((failure as CodexDevelopmentDocumentControlCliAdmissionError).detailDigest)
        .toMatch(/^sha256:[0-9a-f]{64}$/u);
      expect(whichCalls).toBe(0);
    } finally {
      Bun.which = originalWhich;
    }
  }
);
