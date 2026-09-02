import { expect, test } from 'bun:test';

import {
  executeGitHubApiOperation,
  inspectGitHubApiCapability,
  type GitHubApiCapability,
  type GitHubApiPrincipal
} from '../../src/external-capabilities/github-api/operation-session.ts';
import {
  issueGitHubApiTestCapability,
  withGitHubApiTestEnrollmentSession,
  withGitHubApiTestSession,
  type GitHubApiTransport
} from '../../src/external-capabilities/github-api/test/operation-session.ts';
import { compileSecRepositoryModuleGraph } from '../../src/system-architecture/repository-modules/contract.ts';

const TOKEN = 'test-token-0123456789';
const SHA = '1'.repeat(40);
const PRINCIPAL: GitHubApiPrincipal = Object.freeze({
  transport: 'github-rest-token',
  login: 'maintainer',
  nodeId: 'MDQ6VXNlcjE=',
  userId: 900001,
  permission: 'maintain'
});

function capability(input: Readonly<{
  effect: 'read' | 'status-write' | 'merge-write';
  transport: GitHubApiTransport;
}>): GitHubApiCapability {
  return issueGitHubApiTestCapability({
    repository: 'sec-platform/sec',
    token: TOKEN,
    principal: PRINCIPAL,
    effect: input.effect,
    transport: input.transport
  });
}

test('production surface excludes test issuers and the repository graph rejects their import', async () => {
  const production = await import('../../src/external-capabilities/github-api/operation-session.ts');
  expect(Object.keys(production).sort()).not.toContain('issueGitHubApiTestCapability');
  expect(Object.keys(production).sort()).not.toContain('withGitHubApiTestSession');
  expect(() => compileSecRepositoryModuleGraph({
    files: [
      'src/external-capabilities/github-api/production-consumer.ts',
      'src/external-capabilities/github-api/test/operation-session.ts'
    ],
    readSource: (file) => file.endsWith('/production-consumer.ts')
      ? "import { issueGitHubApiTestCapability } from './test/operation-session.ts';"
      : 'export const issueGitHubApiTestCapability = true;'
  })).toThrow('production repository module imports test-only module');
});

test('owner-issued operation compiles one fixed api.github.com request and keeps credential internal', async () => {
  const observations: Array<Readonly<{ url: string; init: RequestInit | undefined }>> = [];
  const settlement = { operationSignal: null as AbortSignal | null };
  const api = capability({
    effect: 'read',
    transport: async (target, init) => {
      observations.push(Object.freeze({ url: String(target), init }));
      settlement.operationSignal = init?.signal ?? null;
      return Response.json({ full_name: 'sec-platform/sec', default_branch: 'main' });
    }
  });
  const result = await withGitHubApiTestSession({
    capability: api,
    operation: async () => await executeGitHubApiOperation(
      api,
      { kind: 'repository' }
    )
  });
  expect(result).toMatchObject({ full_name: 'sec-platform/sec' });
  expect(observations).toHaveLength(1);
  expect(observations[0]!.url).toBe('https://api.github.com/repos/sec-platform/sec');
  expect(observations[0]!.init).toMatchObject({ method: 'GET', redirect: 'error' });
  expect(observations[0]!.init?.headers).toMatchObject({
    Authorization: `Bearer ${TOKEN}`
  });
  expect(observations[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  expect(settlement.operationSignal?.aborted).toBe(true);
});

test('credential enrollment binds the live numeric principal and repository permission', async () => {
  const operations: string[] = [];
  const principal = await withGitHubApiTestEnrollmentSession({
    repository: 'sec-platform/sec',
    effect: 'read',
    readToken: async () => TOKEN,
    transport: async (target) => {
      operations.push(new URL(String(target)).pathname);
      return String(target).endsWith('/user')
        ? Response.json({ login: 'maintainer', node_id: 'MDQ6VXNlcjE=', id: 900001 })
        : Response.json({ permission: 'maintain' });
    },
    operation: async (api) => inspectGitHubApiCapability(api).principal
  });
  expect(principal).toEqual(PRINCIPAL);
  expect(operations).toEqual([
    '/user',
    '/repos/sec-platform/sec/collaborators/maintainer/permission'
  ]);
});

test('structural clones and read capabilities cannot elevate into status effects', async () => {
  let transportCalls = 0;
  const api = capability({
    effect: 'read',
    transport: async () => {
      transportCalls += 1;
      return Response.json({});
    }
  });
  const clone = Object.freeze({ ...api }) as GitHubApiCapability;
  await expect(withGitHubApiTestSession({
    capability: clone,
    operation: async () => undefined
  })).rejects.toThrow('forged or was not issued by this owner');
  await expect(withGitHubApiTestSession({
    capability: api,
    operation: async () => await executeGitHubApiOperation(api, {
      kind: 'create-commit-status',
      sha: SHA,
      status: {
        state: 'success',
        context: 'sec/test',
        description: 'test status',
        targetUrl: 'https://github.com/sec-platform/sec/commit/test'
      }
    })
  })).rejects.toThrow('requires status-write authority');
  expect(transportCalls).toBe(0);
});

test('status-write authority remains unable to merge a pull request', async () => {
  let transportCalls = 0;
  const api = capability({
    effect: 'status-write',
    transport: async () => {
      transportCalls += 1;
      return Response.json({});
    }
  });
  await expect(withGitHubApiTestSession({
    capability: api,
    operation: async () => await executeGitHubApiOperation(api, {
      kind: 'merge-pull',
      pullRequestNumber: 570,
      headSha: SHA,
      title: 'Verified integration',
      message: 'Exact authorized merge'
    })
  })).rejects.toThrow('requires merge-write authority');
  expect(transportCalls).toBe(0);
});

test('status and merge authorities compile only their fixed repository method and path', async () => {
  const observations: Array<Readonly<{
    effect: 'status-write' | 'merge-write';
    url: string;
    method: string | undefined;
    body: unknown;
  }>> = [];
  const transport = (effect: 'status-write' | 'merge-write'): GitHubApiTransport =>
    async (target, init) => {
      observations.push(Object.freeze({
        effect,
        url: String(target),
        method: init?.method,
        body: init?.body === undefined ? null : JSON.parse(String(init.body))
      }));
      return effect === 'status-write'
        ? Response.json({ id: 1 })
        : Response.json({ merged: true, message: 'merged', sha: SHA });
    };
  const statusApi = capability({ effect: 'status-write', transport: transport('status-write') });
  await withGitHubApiTestSession({
    capability: statusApi,
    operation: async () => await executeGitHubApiOperation(statusApi, {
      kind: 'create-commit-status',
      sha: SHA,
      status: {
        state: 'success',
        context: 'sec/test',
        description: 'terminal status',
        targetUrl: 'https://github.com/sec-platform/sec/commit/test'
      }
    })
  });
  const mergeApi = capability({ effect: 'merge-write', transport: transport('merge-write') });
  await withGitHubApiTestSession({
    capability: mergeApi,
    operation: async () => await executeGitHubApiOperation(mergeApi, {
      kind: 'merge-pull',
      pullRequestNumber: 570,
      headSha: SHA,
      title: 'Verified integration',
      message: 'Exact authorized merge\n\nRead back terminal state.'
    })
  });
  expect(observations).toEqual([
    {
      effect: 'status-write',
      url: `https://api.github.com/repos/sec-platform/sec/statuses/${SHA}`,
      method: 'POST',
      body: {
        state: 'success',
        context: 'sec/test',
        description: 'terminal status',
        target_url: 'https://github.com/sec-platform/sec/commit/test'
      }
    },
    {
      effect: 'merge-write',
      url: 'https://api.github.com/repos/sec-platform/sec/pulls/570/merge',
      method: 'PUT',
      body: {
        sha: SHA,
        merge_method: 'squash',
        commit_title: 'Verified integration',
        commit_message: 'Exact authorized merge\n\nRead back terminal state.'
      }
    }
  ]);
});

test('session settlement rejects an unjoined request and aborts its transport', async () => {
  let aborted = false;
  let dangling: Promise<unknown> | undefined;
  const api = capability({
    effect: 'read',
    transport: async (_target, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('aborted by terminal settlement'));
      }, { once: true });
    })
  });
  await expect(withGitHubApiTestSession({
    capability: api,
    operation: async () => {
      dangling = executeGitHubApiOperation(api, { kind: 'repository' }).catch((error) => error);
    }
  })).rejects.toThrow('requests remain in flight');
  await dangling;
  expect(aborted).toBe(true);
});

test('aggregate request-byte budget terminates repeated merge payloads before transport can exceed it', async () => {
  let transportCalls = 0;
  let budgetError: unknown;
  const api = capability({
    effect: 'merge-write',
    transport: async () => {
      transportCalls += 1;
      return Response.json({ merged: true, message: 'merged', sha: SHA });
    }
  });
  await withGitHubApiTestSession({
    capability: api,
    operation: async () => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
          await executeGitHubApiOperation(api, {
            kind: 'merge-pull',
            pullRequestNumber: 570,
            headSha: SHA,
            title: 'Verified integration',
            message: 'x'.repeat(65_536)
          });
        } catch (error) {
          budgetError = error;
          break;
        }
      }
    }
  });
  expect(budgetError).toBeInstanceOf(Error);
  expect((budgetError as Error).message).toContain('request-byte budget exceeded');
  expect(transportCalls).toBeGreaterThan(0);
  expect(transportCalls).toBeLessThan(100);
});

test('aggregate response-byte budget cancels a bounded stream once its ceiling is crossed', async () => {
  const megabyte = 1024 * 1024;
  const api = capability({
    effect: 'read',
    transport: async () => {
      let chunks = 0;
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          if (chunks === 33) {
            controller.close();
            return;
          }
          chunks += 1;
          controller.enqueue(new Uint8Array(megabyte));
        }
      }));
    }
  });
  await expect(withGitHubApiTestSession({
    capability: api,
    operation: async () => await executeGitHubApiOperation(api, { kind: 'repository' })
  })).rejects.toThrow('response-byte budget exceeded');
});
