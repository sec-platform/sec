import { expect, test } from 'bun:test';
import { Command } from 'commander';
import { writeJson } from '../../../src/adapters/filesystem/files.ts';
import { resolveWorkspaceArtifactPath } from '../../../src/adapters/workspace-context.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { registerInspectionQuery } from '../../../src/entry/cli/inspection-query.ts';
import { runCliInProcess } from '../../testkit/cli.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';


// Each default alias must resolve a real, independently identifiable report.
// Comparing two "not found" errors alone cannot establish correct routing.
const availableReports = {
  policy: {
    key: 'policyReport',
    contents: {
      status: 'skipped',
      official: { policies: [], sources: [], violations: [] },
      project: { policies: [], sources: [], violations: [] },
      merged: { policies: [] },
      violations: [], diagnostics: []
    },
    witness: 'Policy report skipped'
  },
  acceptance: {
    key: 'acceptanceCoverage',
    contents: { status: 'passed', acceptancePassed: ['mode:acceptance'], blocks: [], uncoveredBlocks: [] },
    witness: 'acceptancePassed=1'
  },
  runtime: {
    key: 'runtimeReport',
    contents: {
      status: 'passed',
      build: { status: 'passed', passed: ['mode:runtime'], failed: [], command: 'fixture-build' },
      unit: { status: 'passed', passed: [], failed: [], command: null },
      acceptance: { status: 'passed', passed: [], failed: [], command: null }
    },
    witness: 'fixture-build'
  },
  verification: {
    key: 'verificationReport',
    contents: {
      summary: { status: 'passed', requestedLane: 'fast', failedLanes: [] },
      fast: {
        status: 'passed', build: { status: 'passed' }, unit: { status: 'passed' },
        acceptance: { status: 'passed' }, policy: { status: 'passed' }
      },
      runtime: {
        status: 'skipped', build: { status: 'skipped' }, unit: { status: 'skipped' },
        acceptance: { status: 'skipped' }
      }
    },
    witness: 'requestedLane=fast'
  },
  provenance: {
    key: 'provenance',
    contents: {
      artifacts: [{
        path: 'src/default-mode.ts', originType: 'generated',
        originId: 'mode:provenance', verifiedBy: [], overrideStatus: 'none'
      }]
    },
    witness: 'src/default-mode.ts'
  }
} as const;

const legacyModes = [
  ['policy', 'report'], ['acceptance', 'coverage'], ['runtime', 'report'],
  ['verification', 'report'], ['provenance', 'registry'], ['demo', 'checklist']
] as const;

for (const [command, mode] of legacyModes) {
  test(`${command} ${mode} preserves default routing for its available result`, async () => {
    await withTempWorkspace(async root => {
      // Missing artifact is independently observed for each reader. The
      // alias itself is verified on available data below: repeating the same
      // missing-file failure through both routes does not add a new oracle.
      if (command === 'demo') {
        // The common inspection registrar owns --json/--compact for default
        // views and tests those transport modes independently. One concrete
        // demo pair proves this domain retains its canonical default alias.
        const implicit = await runCliInProcess(root, [command]);
        const explicit = await runCliInProcess(root, [command, mode]);
        expect(explicit).toEqual(implicit);
        expect(explicit.code).toBe(0);
      } else {
        const missing = await runCliInProcess(root, [command]);
        expect(missing.code).toBe(1);
        expect(missing.stderr).toContain('not found');
        expect(missing.stderr).not.toContain('commander.');
      }
      if (command !== 'demo') {
        const { key, contents, witness } = availableReports[command];
        await writeJson(resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES[key]), contents);
        const implicitAvailable = await runCliInProcess(root, [command]);
        const explicitAvailable = await runCliInProcess(root, [command, mode]);
        expect(implicitAvailable.code).toBe(0);
        expect(explicitAvailable).toEqual(implicitAvailable);
        expect(implicitAvailable.stdout).toContain(witness);
      }
    });
  });
}

test('explicit default mode invokes one read and the registered view', async () => {
  const root = new Command('sec').exitOverride().configureOutput({ writeOut() {}, writeErr() {} });
  const failure = Object.freeze({ kind: 'view-result' });
  const events: string[] = [];
  const definition = {
    defaultMode: 'summary', read: () => { events.push('read'); return 7; },
    view: (value: number) => { expect(value).toBe(7); events.push('view'); throw failure; }
  };
  registerInspectionQuery(root.command('sample'), definition);
  await expect(root.parseAsync(['sample', 'summary'], { from: 'user' })).rejects.toBe(failure);
  expect(events).toEqual(['read', 'view']);
});
