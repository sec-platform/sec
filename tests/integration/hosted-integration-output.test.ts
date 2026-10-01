import { expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import { runObservedCommand, type ObservedCommandOutcome } from '../../src/adapters/runtime-state/physical/runtime/observed-process-stdin.ts';
import { createRawTestExecutableFixture } from '../testkit/raw-process.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';
const workflow = parseYaml(readFileSync(new URL('../../.github/workflows/merge-gate.yml', import.meta.url), 'utf8'));
const authorize = workflow.jobs.authorize;
const projection = authorize.steps.find((step: { id?: string }) => step.id === 'projection');
const schema = 'sec-verification-session-hosted-integration-route-v1';
const digest = `sha256:${'a'.repeat(64)}`;

async function publish(route: unknown, stallProjection = false): Promise<{
  status: number | null; output: string; stderr: string; outcome: ObservedCommandOutcome; descendantPid: number | null;
}> {
  return withTempWorkspace(async root => {
    const routeFile = path.join(root, 'integration-projection.json');
    const outputFile = path.join(root, 'github-output');
    const descendantFile = path.join(root, 'descendant-pid');
    writeFileSync(routeFile, JSON.stringify(route));
    writeFileSync(outputFile, 'prior-output=preserved\n');
    const executable = createRawTestExecutableFixture();
    let settled = false;
    try {
      // Bind Bun to the retained runtime and exercise the actual shell body.
      // The existing process-tree owner settles descendants even on timeout.
      const bunFunction = stallProjection
        ? `bun() { "$SEC_TEST_BUN" -e 'require("node:fs").writeFileSync(process.env.DESCENDANT_FILE, String(process.pid)); setInterval(() => {}, 1000)'; }\n`
        : 'bun() { "$SEC_TEST_BUN" "$@"; }\n';
      const stderr: Buffer[] = [];
      const outcome = await runObservedCommand('bash', ['-e', '-o', 'pipefail', '-c', bunFunction + projection.run], {
        cwd: root,
        envMode: 'replace',
        env: {
          PATH: process.env.PATH,
          SEC_TEST_BUN: executable.command,
          ROUTE_FILE: routeFile,
          GITHUB_OUTPUT: outputFile,
          DESCENDANT_FILE: descendantFile
        },
        timeoutMs: stallProjection ? 1_500 : 10_000,
        terminationGraceMs: 100,
        terminationDeadlineMs: 2_000,
        maxObservedOutputBytes: 64 * 1024,
        onOutput: (stream, chunk) => { if (stream === 'stderr') stderr.push(Buffer.from(chunk)); }
      });
      settled = outcome.termination.treeClosed && outcome.termination.childCloseObserved
        && outcome.termination.streamsDrained;
      if (!settled) throw new Error(`Workflow fixture process tree remains unsettled at ${root}: ${outcome.status}`);
      return { status: outcome.exitCode, outcome, output: readFileSync(outputFile, 'utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        descendantPid: stallProjection ? Number(readFileSync(descendantFile, 'utf8')) : null };
    } finally {
      // An unproven descendant lifetime must retain both the executable and workspace.
      if (settled) executable.dispose();
    }
  }, 'sec-hosted-output-', { retainOnCallbackFailure: true });
}

test.skipIf(process.platform !== 'linux')('trusted workflow publishes the validated lane and only its open-lane preflight digest', async () => {
  for (const lane of ['open-first-effect', 'merged-recovery', 'blocked']) {
    const result = await publish({ schema, lane, preflightResultDigest: digest,
      recoveryArtifact: { artifactName: 'unconsumed\ninjected=true', artifactFilePath: '/unconsumed' } });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.output).toBe(`prior-output=preserved\nintegration-lane=${lane}\n`
      + `preflight-result-digest=${lane === 'open-first-effect' ? digest : ''}\n`);
  }
});

test.skipIf(process.platform !== 'linux')('trusted workflow validates the complete output set before appending any lane', async () => {
  for (const route of [
    { schema: 'untrusted', lane: 'open-first-effect', preflightResultDigest: digest },
    { schema, lane: 'open-first-effect\ninjected=true', preflightResultDigest: digest },
    { schema, lane: 'unknown', preflightResultDigest: digest },
    { schema, lane: 'open-first-effect' },
    { schema, lane: 'open-first-effect', preflightResultDigest: `${digest}\ninjected=true` }
  ]) {
    const result = await publish(route);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Hosted authorization');
    expect(result.output).toBe('prior-output=preserved\n');
  }
});

test.skipIf(process.platform !== 'linux')('workflow projection timeout settles its Bun descendant before fixture retirement', async () => {
  const result = await publish({ schema, lane: 'open-first-effect', preflightResultDigest: digest }, true);
  expect(result.outcome.status).toBe('timed-out');
  expect(result.outcome.termination).toMatchObject({
    requested: true, treeClosed: true, childCloseObserved: true, streamsDrained: true
  });
  expect(result.output).toBe('prior-output=preserved\n');
  expect(result.descendantPid).toBeGreaterThan(0);
  let code: string | undefined;
  try { process.kill(result.descendantPid!, 0); }
  catch (error) { code = (error as NodeJS.ErrnoException).code; }
  expect(code).toBe('ESRCH');
}, 10_000);

test('workflow consumers use the successful trusted projection and retain fixed recovery upload identity', () => {
  const preparationIndex = authorize.steps.findIndex((step: { run?: string }) =>
    step.run?.includes('verification-session.ts prepare-integration-hosted'));
  expect(preparationIndex).toBeGreaterThan(-1);
  expect(authorize.steps.indexOf(projection)).toBe(preparationIndex + 1);
  expect(projection.if).toBeUndefined();
  expect(projection['continue-on-error']).toBeUndefined();
  expect(authorize.steps[preparationIndex]['continue-on-error']).toBeUndefined();
  expect(authorize.outputs['integration-lane']).toBe('${{ steps.projection.outputs.integration-lane }}');
  const laneConsumers = authorize.steps.filter((step: { if?: string }) => step.if?.includes('integration-lane'));
  expect(laneConsumers.map((step: { if: string }) => step.if)).toEqual([
    "${{ steps.projection.outputs.integration-lane == 'blocked' }}",
    ...Array(4).fill("${{ steps.projection.outputs.integration-lane == 'open-first-effect' }}")
  ]);
  const upload = authorize.steps.find((step: { id?: string }) => step.id === 'upload-branch-closeout-recovery');
  const readback = authorize.steps.find((step: { env?: Record<string, string> }) => step.env?.EXPECTED_ARTIFACT_NAME);
  const artifactName = 'sec-branch-closeout-recovery-v1-pr-${{ needs.plan.outputs.pr-number }}'
    + '-session-${{ needs.plan.outputs.session-revision }}-run-${{ github.run_id }}-attempt-${{ github.run_attempt }}';
  expect(upload.with.name).toBe(artifactName);
  expect(readback.env.EXPECTED_ARTIFACT_NAME).toBe(artifactName);
  expect(upload.with.path).toBe('.tmp/codex/branch-closeout-recovery.json\n.tmp/codex/integration-preflight-result-v2.json\n');
});
