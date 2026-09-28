import { expect, test } from 'bun:test';

import {
  assertCodeScanningFindingProjectionConsistent,
  parseCodeScanningFinding,
  renderCodeScanningProjection
} from '../../src/adapters/verification/platform/ci/runtime/code-scanning-projection.ts';

const HEAD = 'a'.repeat(40);
const REF = 'refs/pull/636/head';

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
      commit_sha: HEAD,
      message: { text: 'A user-controlled value may bypass this security check.' },
      location: { path: 'src/example.ts', start_line: 41, end_line: 41 }
    },
    ...overrides
  };
}

test('CodeQL projection admits only open findings from the exact requested PR head analysis', () => {
  expect(parseCodeScanningFinding(alert(), REF, HEAD)).toEqual({
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
  expect(parseCodeScanningFinding(alert({ state: 'dismissed' }), REF, HEAD)).toBeNull();
  expect(parseCodeScanningFinding(alert({ tool: { name: 'Other' } }), REF, HEAD)).toBeNull();
  expect(parseCodeScanningFinding(alert(), 'refs/pull/637/head', HEAD)).toBeNull();
});

test('PR-scoped finding identity rejects an alert instance from a stale head commit', () => {
  const value = alert();
  const instance = value.most_recent_instance as Record<string, unknown>;
  instance.commit_sha = 'c'.repeat(40);
  expect(parseCodeScanningFinding(value, REF, HEAD)).toBeNull();
});

test('projection refuses an empty finding set when final CodeQL reports annotations', () => {
  expect(() => assertCodeScanningFindingProjectionConsistent(3, []))
    .toThrow('PR-scoped finding projection is empty');
  expect(() => assertCodeScanningFindingProjectionConsistent(0, [])).not.toThrow();
});

test('CodeQL projection renders exact head, merge analysis, and final check identity', () => {
  const finding = parseCodeScanningFinding(alert(), REF, HEAD)!;
  const body = renderCodeScanningProjection({
    repository: 'sec-platform/sec',
    pullRequestNumber: 636,
    headSha: HEAD,
    analysisRef: REF,
    codeQlCheckId: 108424693203,
    findings: [finding]
  });
  expect(body).toContain('Exact PR head: ' + String.fromCharCode(96) + HEAD + String.fromCharCode(96));
  expect(body).toContain('CodeQL analysis ref: ' + String.fromCharCode(96) + REF + String.fromCharCode(96));
  expect(body).toContain('CodeQL check: ' + String.fromCharCode(96) + '108424693203' + String.fromCharCode(96));
  expect(body).toContain('Open findings for this exact analysis: **1**');
  expect(body).toContain('js/user-controlled-bypass');
  expect(body).toContain('src/example.ts:41');
  expect(body).toBe(body.trim());
});

test('CodeQL projection explicitly represents a clean exact analysis', () => {
  const body = renderCodeScanningProjection({
    repository: 'sec-platform/sec',
    pullRequestNumber: 636,
    headSha: HEAD,
    analysisRef: REF,
    codeQlCheckId: 108424693203,
    findings: []
  });
  expect(body).toContain('Open findings for this exact analysis: **0**');
  expect(body).toContain('No open CodeQL findings are reported for this exact PR analysis.');
});


test('CodeQL projection is input-order independent and uses code-unit ordering', () => {
  const high = {
    ...parseCodeScanningFinding(alert(), REF, HEAD)!,
    alertNumber: 21,
    path: 'src/Z.ts',
    ruleId: 'js/Z-rule',
    ruleName: 'Z rule'
  };
  const sameSeverityLaterCodeUnit = {
    ...high,
    alertNumber: 22,
    path: 'src/a.ts',
    ruleId: 'js/a-rule',
    ruleName: 'a rule'
  };
  const low = {
    ...high,
    alertNumber: 23,
    severity: 'low',
    path: 'src/0-low.ts',
    ruleId: 'js/0-low-rule',
    ruleName: '0 low rule'
  };
  const projection = {
    repository: 'sec-platform/sec',
    pullRequestNumber: 636,
    headSha: HEAD,
    analysisRef: REF,
    codeQlCheckId: 108424693203
  };
  const first = renderCodeScanningProjection({
    ...projection,
    findings: [low, high, sameSeverityLaterCodeUnit]
  });
  const reversed = renderCodeScanningProjection({
    ...projection,
    findings: [sameSeverityLaterCodeUnit, high, low]
  });
  expect(reversed).toBe(first);
  // UTF-16 code units order "Z" before "a"; locale collation is not authoritative.
  expect(first.indexOf('src/Z.ts')).toBeLessThan(first.indexOf('src/a.ts'));
  // Severity remains the primary key even when the lower-severity path sorts earlier.
  expect(first.indexOf('src/a.ts')).toBeLessThan(first.indexOf('src/0-low.ts'));
});

test('CodeQL projection states that GitHub Code Scanning remains authoritative', () => {
  const body = renderCodeScanningProjection({
    repository: 'sec-platform/sec',
    pullRequestNumber: 636,
    headSha: HEAD,
    analysisRef: REF,
    codeQlCheckId: 108424693203,
    findings: [parseCodeScanningFinding(alert(), REF, HEAD)!]
  });
  expect(body).toContain('SEC projection only.');
  expect(body).toContain('GitHub Code Scanning remains the authoritative security evidence.');
});
