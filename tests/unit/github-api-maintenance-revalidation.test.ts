import { expect, test } from 'bun:test';
import { assertGitHubApiMaintenanceRequest, revalidateGitHubApiMaintenanceRequest } from '../../src/adapters/providers/github-api/operation-session.ts';
import { issueGitHubApiTestCapability, revalidateGitHubApiMaintenanceTestRequest, withGitHubApiTestSession } from '../../src/adapters/providers/github-api/test/operation-session.ts';

const context = Object.freeze({ requestDigest: `sha256:${'1'.repeat(64)}` as const,
  executionDigest: `sha256:${'2'.repeat(64)}` as const, resumeReceiptDigest: null,
  actor: 'original-maintainer', runId: '10', runAttempt: 1 as const, workflowSha: 'a'.repeat(40),
  refs: Object.freeze([{ branch: 'transport/old', expectedHeadSha: 'b'.repeat(40) }]) });
function run() {
  return { id: 10, run_attempt: 1, event: 'workflow_dispatch', status: 'in_progress', conclusion: null,
    path: '.github/workflows/repository-maintenance.yml', head_sha: context.workflowSha, head_branch: 'main',
    repository: { full_name: 'sec-platform/sec' }, head_repository: { full_name: 'sec-platform/sec' },
    actor: { login: context.actor as string, type: 'User' }, triggering_actor: { login: context.actor as string, type: 'User' },
    display_title: `maintenance/${context.executionDigest}` };
}

test.serial('the original live authority observer rereads permission and captured run on the same capability', async () => {
  const requests: string[] = [];
  let permission = 'maintain'; let currentRun = run();
  const api = issueGitHubApiTestCapability({ repository: 'sec-platform/sec', token: 'test-token-0123456789', effect: 'read',
    principal: { transport: 'github-rest-token', login: 'fixture-viewer', nodeId: 'test-user', userId: 1, permission: 'admin' },
    transport: async (target) => {
      const url = String(target); requests.push(url);
      if (url.endsWith('/collaborators/original-maintainer/permission')) return Response.json({ permission });
      if (url.endsWith('/actions/runs/10')) return Response.json(currentRun);
      if (url.endsWith('/repos/sec-platform/sec')) return Response.json({ full_name: 'sec-platform/sec', default_branch: 'main' });
      throw new Error(`Unexpected request ${url}`);
    } });
  const oldActor = process.env.GITHUB_ACTOR; const oldRun = process.env.GITHUB_RUN_ID;
  try {
    await withGitHubApiTestSession({ capability: api, operation: async () => {
      await revalidateGitHubApiMaintenanceTestRequest(api, context);
      process.env.GITHUB_ACTOR = 'substituted-actor'; process.env.GITHUB_RUN_ID = '999';
      await revalidateGitHubApiMaintenanceTestRequest(api, context);
      permission = 'read';
      await expect(revalidateGitHubApiMaintenanceTestRequest(api, context)).rejects.toThrow('current maintain/admin');
      permission = 'maintain'; currentRun = { ...run(), run_attempt: 2 };
      await expect(revalidateGitHubApiMaintenanceTestRequest(api, context)).rejects.toThrow('captured dispatch');
      currentRun = { ...run(), triggering_actor: { login: 'different-maintainer', type: 'User' } };
      await expect(revalidateGitHubApiMaintenanceTestRequest(api, context)).rejects.toThrow('captured dispatch');
      currentRun = { ...run(), status: 'completed' };
      await expect(revalidateGitHubApiMaintenanceTestRequest(api, context)).rejects.toThrow('captured dispatch');
      expect(() => assertGitHubApiMaintenanceRequest(api, context.requestDigest)).toThrow('authenticated exact');
      await expect(revalidateGitHubApiMaintenanceRequest(api, context.requestDigest)).rejects.toThrow('authenticated exact');
    } });
    expect(requests.filter((url) => url.includes('/collaborators/'))).toHaveLength(6);
    expect(requests.some((url) => url.includes('substituted-actor') || url.endsWith('/999'))).toBe(false);
  } finally {
    if (oldActor === undefined) delete process.env.GITHUB_ACTOR; else process.env.GITHUB_ACTOR = oldActor;
    if (oldRun === undefined) delete process.env.GITHUB_RUN_ID; else process.env.GITHUB_RUN_ID = oldRun;
  }
});
