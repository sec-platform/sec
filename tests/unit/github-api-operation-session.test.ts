import { expect, test } from 'bun:test';

import { compileSecRepositoryModuleGraph } from '../../src/brownfield/source-program-model/typescript.ts';
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
  effect: 'read' | 'status-write' | 'merge-write' | 'runner-admin';
  transport: GitHubApiTransport;
  principal?: GitHubApiPrincipal;
}>): GitHubApiCapability {
  return issueGitHubApiTestCapability({
    repository: 'sec-platform/sec',
    token: TOKEN,
    principal: input.principal ?? PRINCIPAL,
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

test('read authority cannot register or delete runners', async () => {
  let transportCalls = 0;
  const api = capability({
    effect: 'read',
    transport: async () => {
      transportCalls += 1;
      return Response.json({});
    }
  });
  await expect(withGitHubApiTestSession({
    capability: api,
    operation: async () => await executeGitHubApiOperation(api, {
      kind: 'create-runner-registration-token'
    })
  })).rejects.toThrow('requires runner-admin authority');
  await expect(withGitHubApiTestSession({
    capability: api,
    operation: async () => await executeGitHubApiOperation(api, {
      kind: 'delete-repository-runner',
      runnerId: 42
    })
  })).rejects.toThrow('requires runner-admin authority');
  expect(transportCalls).toBe(0);
});

test('read authority compiles the bounded repository runner inventory page', async () => {
  const targets: string[] = [];
  const api = capability({
    effect: 'read',
    transport: async (target) => {
      targets.push(String(target));
      return Response.json({ total_count: 0, runners: [] });
    }
  });
  await expect(withGitHubApiTestSession({
    capability: api,
    operation: async () => await executeGitHubApiOperation(api, {
      kind: 'repository-runners',
      page: 2
    })
  })).resolves.toEqual({ total_count: 0, runners: [] });
  expect(targets).toEqual([
    'https://api.github.com/repos/sec-platform/sec/actions/runners?per_page=100&page=2'
  ]);
});

test('runner-admin capability requires repository admin permission before transport', () => {
  let transportCalls = 0;
  for (const permission of ['maintain', 'read'] as const) {
    expect(() => issueGitHubApiTestCapability({
      repository: 'sec-platform/sec',
      token: TOKEN,
      principal: Object.freeze({ ...PRINCIPAL, permission }),
      effect: 'runner-admin',
      transport: async () => {
        transportCalls += 1;
        return Response.json({});
      }
    })).toThrow('requires admin permission');
  }
  expect(transportCalls).toBe(0);
});

test('runner-admin enrollment rejects maintain and accepts admin repository permission', async () => {
  const enroll = async (permission: 'admin' | 'maintain') => {
    const operations: string[] = [];
    const result = await withGitHubApiTestEnrollmentSession({
      repository: 'sec-platform/sec',
      effect: 'runner-admin',
      readToken: async () => TOKEN,
      transport: async (target) => {
        operations.push(new URL(String(target)).pathname);
        return String(target).endsWith('/user')
          ? Response.json({ login: 'maintainer', node_id: 'MDQ6VXNlcjE=', id: 900001 })
          : Response.json({ permission });
      },
      operation: async (api) => inspectGitHubApiCapability(api).principal.permission
    });
    return Object.freeze({ result, operations });
  };
  await expect(enroll('maintain')).rejects.toThrow('requires admin permission');
  await expect(enroll('admin')).resolves.toEqual({
    result: 'admin',
    operations: [
      '/user',
      '/repos/sec-platform/sec/collaborators/maintainer/permission'
    ]
  });
});

test('runner-admin compiles fixed runner effects and accepts DELETE 204 empty success', async () => {
  const observations: Array<Readonly<{ url: string; method: string | undefined; body: string | null }>> = [];
  const api = capability({
    effect: 'runner-admin',
    principal: Object.freeze({ ...PRINCIPAL, permission: 'admin' }),
    transport: async (target, init) => {
      observations.push(Object.freeze({
        url: String(target),
        method: init?.method,
        body: init?.body === undefined ? null : String(init.body)
      }));
      return init?.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : Response.json({ token: 'transient-registration-token' });
    }
  });
  await withGitHubApiTestSession({
    capability: api,
    operation: async () => {
      expect(await executeGitHubApiOperation(api, {
        kind: 'create-runner-registration-token'
      })).toEqual({ token: 'transient-registration-token' });
      expect(await executeGitHubApiOperation(api, {
        kind: 'delete-repository-runner',
        runnerId: 42
      })).toBeNull();
    }
  });
  expect(observations).toEqual([
    {
      url: 'https://api.github.com/repos/sec-platform/sec/actions/runners/registration-token',
      method: 'POST',
      body: null
    },
    {
      url: 'https://api.github.com/repos/sec-platform/sec/actions/runners/42',
      method: 'DELETE',
      body: null
    }
  ]);
});

test('runner-admin authority cannot invoke unrelated read or write operations', async () => {
  let transportCalls = 0;
  const api = capability({
    effect: 'runner-admin',
    principal: Object.freeze({ ...PRINCIPAL, permission: 'admin' }),
    transport: async () => {
      transportCalls += 1;
      return Response.json({});
    }
  });
  for (const operation of [
    { kind: 'repository' as const },
    {
      kind: 'create-commit-status' as const,
      sha: SHA,
      status: {
        state: 'success' as const,
        context: 'ci/security',
        description: 'passed',
        targetUrl: 'https://github.com/sec-platform/sec/actions/runs/1'
      }
    }
  ]) {
    await expect(withGitHubApiTestSession({
      capability: api,
      operation: async () => await executeGitHubApiOperation(api, operation)
    })).rejects.toThrow('permits only fixed runner lifecycle effects');
  }
  expect(transportCalls).toBe(0);
});

test('non-delete 204 cannot impersonate a successful JSON operation', async () => {
  const api = capability({
    effect: 'read',
    transport: async () => new Response(null, { status: 204 })
  });
  await expect(withGitHubApiTestSession({
    capability: api,
    operation: async () => await executeGitHubApiOperation(api, { kind: 'repository' })
  })).rejects.toThrow('returned an invalid 204 response');
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
