import { expect, test } from 'bun:test';

import {
  parseCodeScanningFinding,
  renderCodeScanningProjection
} from '../../src/adapters/verification/platform/ci/runtime/code-scanning-projection.ts';

const HEAD = 'a'.repeat(40);
const ANALYSIS = 'b'.repeat(40);

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
      commit_sha: ANALYSIS,
      message: { text: 'A user-controlled value may bypass this security check.' },
      location: { path: 'src/example.ts', start_line: 41, end_line: 41 }
    },
    ...overrides
  };
}

test('CodeQL projection admits only open findings from the source analysis merge SHA', () => {
  expect(parseCodeScanningFinding(alert(), ANALYSIS)).toEqual({
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
  expect(parseCodeScanningFinding(alert({ state: 'dismissed' }), ANALYSIS)).toBeNull();
  expect(parseCodeScanningFinding(alert({ tool: { name: 'Other' } }), ANALYSIS)).toBeNull();
  expect(parseCodeScanningFinding(alert(), 'c'.repeat(40))).toBeNull();
});

test('CodeQL projection renders the exact PR head and merge analysis separately', () => {
  const finding = parseCodeScanningFinding(alert(), ANALYSIS)!;
  const body = renderCodeScanningProjection({
    repository: 'sec-platform/sec',
    pullRequestNumber: 636,
    headSha: HEAD,
    analysisSha: ANALYSIS,
    sourceRunId: '12345',
    findings: [finding]
  });
  expect(body).toContain('Exact PR head: ' + String.fromCharCode(96) + HEAD + String.fromCharCode(96));
  expect(body).toContain('Analysis merge SHA: ' + String.fromCharCode(96) + ANALYSIS + String.fromCharCode(96));
  expect(body).toContain('Open findings for this analysis: **1**');
  expect(body).toContain('js/user-controlled-bypass');
  expect(body).toContain('src/example.ts:41');
});

test('CodeQL projection explicitly represents a clean analysis', () => {
  const body = renderCodeScanningProjection({
    repository: 'sec-platform/sec',
    pullRequestNumber: 636,
    headSha: HEAD,
    analysisSha: ANALYSIS,
    sourceRunId: '12345',
    findings: []
  });
  expect(body).toContain('Open findings for this analysis: **0**');
  expect(body).toContain('No open CodeQL findings are reported for this exact PR analysis.');
});
