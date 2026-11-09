import { expect, test } from 'bun:test';
import { expectRecord, recordFields } from '../../helpers/assertion-helpers.ts';
import { writeJson } from '../../../src/adapters/filesystem/files.ts';

import { resolveWorkspaceArtifactPath } from '../../../src/adapters/workspace-context.ts';
import { projectPolicyReportInspection } from '../../../src/application/policy-report-inspection.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { formatPolicyReport } from '../../../src/entry/cli/policy-report-inspection.ts';
import type { PolicyReport } from '../../../src/semantics/policies/types.ts';
import { expectCliJson, expectCliSuccess, runCliInProcess } from '../../testkit/cli.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

// Fixed semantic oracle for the real CLI JSON.
// Never compute a route's expected result with its own production projection.
const EXPECTED_POLICY_SOURCES = {
  status: 'passed',
  sourceCount: 3,
  policyCount: 4,
  sources: [
    { scope: 'official', path: 'a', policyCount: 2, policyIds: ['official:a', 'official:b'] },
    { scope: 'official', path: 'z', policyCount: 1, policyIds: ['official:z'] },
    { scope: 'project', path: 'b', policyCount: 1, policyIds: ['project:b'] }
  ]
};


test('policy inspection routes retained report through application summary projection and entry rendering while preserving JSON', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const missing = await runCliInProcess(workspaceRoot, ['policy']);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('not found');
    expect(missing.stderr).not.toContain('commander.');

    const report: PolicyReport = {
      status: 'skipped',
      official: { policies: [], sources: [], violations: [] },
      project: { policies: [], sources: [], violations: [] },
      merged: { policies: [] },
      violations: [],
      diagnostics: []
    };

    const reportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.policyReport);
    await writeJson(reportPath, report);

    const emptyLines = formatPolicyReport(projectPolicyReportInspection(report)).split('\n');
    expect(emptyLines).toHaveLength(3);
    expectRecord(emptyLines[0], ['Policy report skipped', 'official=0', 'project=0', 'merged=0', 'violations=0']);
    expectRecord(emptyLines[1], ['Sources: 0']);
    expectRecord(emptyLines[2], ['Severity: none']);

    const json = await expectCliJson(workspaceRoot, ['policy', 'report', '--json']);
    expect(json).toEqual(report);

    // Use the same canonical report contract as the real reader: private
    // summary counts, severity spellings and ordering cannot self-authorize.
    const sourcePath = 'catalog/policies/official/example.policy.yaml';
    const projectSourcePath = 'model/policies/example.policy.yaml';
    const policies = ['p1', 'p2', 'p3', 'p4'];
    const violations: PolicyReport['violations'] = policies.map((id, index) => ({
      id, severity: index % 2 === 0 ? 'warn' : 'error',
      appliesTo: [], rule: 'tenant_context_must_flow_to_query',
      files: index === 2 ? [] : [`src/${id}.ts`], message: `finding ${id}`,
      sourceScope: id === 'p2' ? 'project' : 'official',
      sourcePath: id === 'p2' ? projectSourcePath : sourcePath
    }));
    const populated: PolicyReport = {
      status: 'failed',
      official: { policies: ['p1', 'p3', 'p4'], sources: [{ path: sourcePath, policyIds: ['p1', 'p3', 'p4'] }],
        violations: violations.filter(entry => entry.sourceScope === 'official') },
      project: { policies: ['p2'], sources: [{ path: projectSourcePath, policyIds: ['p2'] }],
        violations: violations.filter(entry => entry.sourceScope === 'project') },
      merged: { policies: policies.map(id => ({
        id, sourceScope: id === 'p2' ? 'project' : 'official',
        sourcePath: id === 'p2' ? projectSourcePath : sourcePath, targets: id === 'p3' ? [] : [`src/${id}.ts`]
      })) },
      violations, diagnostics: [],
      evaluation: { providerId: 'policy-reader-fixture', providerRevision: 'v1',
        assurance: 'source-structure', requiredSemanticPredicates: ['FLOWS_TO'],
        unsupportedSemanticPredicates: ['FLOWS_TO'] }
    };
    await writeJson(reportPath, populated);
    const { stdout } = await expectCliSuccess(workspaceRoot, ['policy']);
    const lines = stdout.trimEnd().split(/\r?\n/u);
    expect(lines).toHaveLength(9);
    expectRecord(lines[0], ['Policy report attention', 'official=3', 'project=1', 'merged=4', 'violations=4']);
    expectRecord(lines[1], ['Sources: 2']);
    expectRecord(lines[2], ['Severity: error=2, warn=2']);
    const expectedRows = [
      ['Policy p1', 'scope=official', `source=${sourcePath}`, 'targets=src/p1.ts'],
      ['Policy p2', 'scope=project', `source=${projectSourcePath}`, 'targets=src/p2.ts'],
      ['Policy p3', 'scope=official', `source=${sourcePath}`, 'targets=none'],
      ['Violation p1', 'severity=warn', 'files=src/p1.ts', 'finding p1'],
      ['Violation p2', 'severity=error', 'files=src/p2.ts', 'finding p2'],
      ['Violation p3', 'severity=warn', 'files=none', 'finding p3']
    ];
    for (const [index, fields] of expectedRows.entries()) expectRecord(lines[index + 3], fields);

  });

  // The source-ordering route has its own physical read preimage and cleanup window.
  await withTempWorkspace(async (workspaceRoot) => {
    const report = {
      status: 'passed',
      official: {
        sources: [
          { path: 'z', policyIds: ['official:z'] },
          { path: 'a', policyIds: ['official:a', 'official:b'] }
        ]
      },
      project: {
        sources: [{ path: 'b', policyIds: ['project:b'] }]
      }
    };
    const reportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.policyReport);
    await writeJson(reportPath, report);

    const { stdout } = await expectCliSuccess(workspaceRoot, ['policy', 'sources']);
    const lines = stdout.trimEnd().split(/\r?\n/u);
    expect(lines).toHaveLength(5);
    const header = lines.find(line => line.startsWith('Policy sources '));
    expectRecord(header, ['Policy sources passed']);
    const counts = lines.find(line => recordFields(line).includes('sources=3'));
    expectRecord(counts, ['sources=3', 'policies=4']);
    const rows = lines.filter(line => line.startsWith('Source '));
    const expected = [
      ['official', 'a', ['official:a', 'official:b']],
      ['official', 'z', ['official:z']],
      ['project', 'b', ['project:b']]
    ] as const;
    expect(rows).toHaveLength(expected.length);
    for (const [scope, sourcePath, policyIds] of expected) {
      const matches = rows.filter(line => recordFields(line).includes(`Source ${scope}`) && recordFields(line).includes(`path=${sourcePath}`));
      expect(matches).toHaveLength(1);
      expectRecord(matches[0], [`Source ${scope}`, `path=${sourcePath}`, `policies=${policyIds.join(', ')}`]);
    }

    const json = await expectCliJson(workspaceRoot, ['policy', 'sources', '--json']);
    expect(json).toEqual(EXPECTED_POLICY_SOURCES);
  });
});
