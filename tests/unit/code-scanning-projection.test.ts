import { expect, test } from 'bun:test';

import {
  parseCodeScanningFinding,
  renderCodeScanningProjection
} from '../../src/adapters/verification/platform/ci/runtime/code-scanning-projection.ts';

const HEAD = 'a'.repeat(40);
const MERGE = 'b'.repeat(40);
const REF = 'refs/pull/636/merge';

function alert(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 17,
    state: 'open',
    html_url: 'https://github.com/sec-platform/sec/security/code-scanning/17',
    tool: { name: 'CodeQL' },
    rule: {
      id: 'js/user-controlled-bypass',
      name: 'User-controlled bypass of security check',
      severity: 'error',
      security_severity_level: 'high'
    },
    most_recent_instance: {
      ref: REF,
      commit_sha: MERGE,
      message: { text: 'A user-controlled value may bypass this security check.' },
      location: { path: 'src/example.ts', start_line: 41, end_line: 41 }
    },
    ...overrides
  };
}

test('CodeQL projection admits only open findings from the exact PR merge analysis', () => {
  expect(parseCodeScanningFinding(alert(), REF, MERGE)).toEqual({
    alertNumber: 17,
    ruleId: 'js/user-controlled-bypass',
    ruleName: 'User-controlled bypass of security check',
    severity: 'high',
    message: 'A user-controlled value may bypass this security check.',
    path: 'src/example.ts',
    startLine: 41,
    endLine: 41,
    htmlUrl: 'https://github.com/sec-platform/sec/security/code-scanning/17'
  });
  expect(parseCodeScanningFinding(alert({ state: 'dismissed' }), REF, MERGE)).toBeNull();
  expect(parseCodeScanningFinding(alert({ tool: { name: 'Other' } }), REF, MERGE)).toBeNull();
  expect(parseCodeScanningFinding(alert(), REF, 'c'.repeat(40))).toBeNull();
  expect(parseCodeScanningFinding(alert(), 'refs/pull/637/merge', MERGE)).toBeNull();
});

test('CodeQL projection renders exact head, merge analysis, and final check identity', () => {
  const finding = parseCodeScanningFinding(alert(), REF, MERGE)!;
  const body = renderCodeScanningProjection({
    repository: 'sec-platform/sec',
    pullRequestNumber: 636,
    headSha: HEAD,
    mergeSha: MERGE,
    codeQlCheckId: 108424693203,
    findings: [finding]
  });
  expect(body).toContain('Exact PR head: ' + String.fromCharCode(96) + HEAD + String.fromCharCode(96));
  expect(body).toContain('PR merge analysis: ' + String.fromCharCode(96) + MERGE + String.fromCharCode(96));
  expect(body).toContain('CodeQL check: ' + String.fromCharCode(96) + '108424693203' + String.fromCharCode(96));
  expect(body).toContain('Open findings for this exact analysis: **1**');
  expect(body).toContain('js/user-controlled-bypass');
  expect(body).toContain('src/example.ts:41');
});

test('CodeQL projection explicitly represents a clean exact analysis', () => {
  const body = renderCodeScanningProjection({
    repository: 'sec-platform/sec',
    pullRequestNumber: 636,
    headSha: HEAD,
    mergeSha: MERGE,
    codeQlCheckId: 108424693203,
    findings: []
  });
  expect(body).toContain('Open findings for this exact analysis: **0**');
  expect(body).toContain('No open CodeQL findings are reported for this exact PR analysis.');
});
