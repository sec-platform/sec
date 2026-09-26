import { expect, test } from 'bun:test';

import {
  executeGitHubApiOperation,
  inspectGitHubApiCapability,
  type GitHubApiCapability,
  type GitHubApiPrincipal
} from '../../src/adapters/providers/github-api/operation-session.ts';
import {
  issueGitHubApiTestCapability,
  withGitHubApiTestEnrollmentSession,
  withGitHubApiTestSession,
  type GitHubApiTransport
} from '../../src/adapters/providers/github-api/test/operation-session.ts';
import { compileSecRepositoryModuleGraph } from '../../src/adapters/repository/source-program-model/typescript.ts';

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
  effect: 'read' | 'status-write' | 'merge-write' | 'runner-admin' | 'branch-closeout-write';
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
  const production = await import('../../src/adapters/providers/github-api/operation-session.ts');
  expect(Object.keys(production).sort()).not.toContain('issueGitHubApiTestCapability');
  expect(Object.keys(production).sort()).not.toContain('withGitHubApiTestSession');
  expect(() => compileSecRepositoryModuleGraph({
    files: [
      'src/adapters/providers/github-api/production-consumer.ts',
      'src/adapters/providers/github-api/test/operation-session.ts'
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

for (const effect of ['read', 'status-write', 'merge-write', 'runner-admin'] as const) {
  for (const reason of [undefined, null, false, 0, '', new Error('operation failed')] as const) {
    test(`${effect} session distinguishes failure occurrence from ${String(reason)} payload`, async () => {
      const api = capability({
        effect,
        principal: Object.freeze({ ...PRINCIPAL, permission: 'admin' }),
        transport: async () => Response.json({})
      });
      const outcome = await withGitHubApiTestSession({
        capability: api,
        operation: async () => { throw reason; }
      }).then(
        (value) => ({ status: 'succeeded' as const, value }),
        (error: unknown) => ({ status: 'failed' as const, error })
      );
      expect(outcome.status).toBe('failed');
      if (outcome.status === 'failed') expect(outcome.error).toBe(reason);
    });
  }
}

for (const value of [undefined, null, false, 0, ''] as const) {
  test(`normal ${String(value)} results are distinct from thrown payloads`, async () => {
    const api = capability({ effect: 'read', transport: async () => Response.json({}) });
    const result = await withGitHubApiTestSession({ capability: api, operation: async () => value });
    expect(result).toBe(value);
  });
}

for (const reason of [undefined, null, false, 0, new Error('primary failure')] as const) {
  test(`primary ${String(reason)} failure and unjoined work both survive terminal closure`, async () => {
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    let dangling: Promise<unknown> | undefined;
    const observed: { requestSignal: AbortSignal | null } = { requestSignal: null };
    const api = capability({
      effect: 'read',
      transport: async (_target, init) => await new Promise<Response>((_resolve, reject) => {
        observed.requestSignal = init?.signal ?? null;
        observed.requestSignal?.addEventListener('abort', () => reject(new Error('terminal cancellation')), { once: true });
        notifyStarted();
      })
    });
    const outcome = await withGitHubApiTestSession({
      capability: api,
      operation: async () => {
        dangling = executeGitHubApiOperation(api, { kind: 'repository' }).catch((error: unknown) => error);
        await started;
        throw reason;
      }
    }).then(
      (value) => ({ status: 'succeeded' as const, value }),
      (error: unknown) => ({ status: 'failed' as const, error })
    );
    await dangling;
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error).toBeInstanceOf(AggregateError);
      if (outcome.error instanceof AggregateError) {
        expect(outcome.error.errors).toHaveLength(2);
        expect(outcome.error.errors[0]).toBe(reason);
        expect(outcome.error.errors[1]).toBeInstanceOf(Error);
        expect((outcome.error.errors[1] as Error).message).toContain('requests remain in flight');
      }
    }
    expect(observed.requestSignal?.aborted).toBe(true);
  });
}

for (const reason of [undefined, null] as const) {
  test(`enrollment and nested reuse preserve ${String(reason)} rejection through the common owner`, async () => {
    const outcome = await withGitHubApiTestEnrollmentSession({
      repository: 'sec-platform/sec',
      effect: 'read',
      readToken: async () => TOKEN,
      transport: async (target) => String(target).endsWith('/user')
        ? Response.json({ login: 'maintainer', node_id: 'MDQ6VXNlcjE=', id: 900001 })
        : Response.json({ permission: 'maintain' }),
      operation: async (api) => await withGitHubApiTestSession({
        capability: api,
        operation: () => { throw reason; }
      })
    }).then(
      (value) => ({ status: 'succeeded' as const, value }),
      (error: unknown) => ({ status: 'failed' as const, error })
    );
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.error).toBe(reason);
  });
}

function deferredResponse<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}
const responseTick = () => new Promise<void>((resolve) => setImmediate(resolve));

for (const [body, status, succeeds] of [['{"ok":true}', 200, true], ['{"failed":true}', 500, false], ['{', 200, false]] as const) {
  test(`response reader lock is released after status ${status} and body ${body}`, async () => {
    const response = new Response(body, { status });
    const api = capability({ effect: 'read', transport: async () => response });
    const outcome = await withGitHubApiTestSession({ capability: api,
      operation: () => executeGitHubApiOperation(api, { kind: 'repository' })
    }).then(() => 'succeeded', () => 'failed');
    expect(outcome).toBe(succeeds ? 'succeeded' : 'failed');
    expect(response.body!.locked).toBe(false);
  });
}

test('a failed response joins cancellation before releasing its reader and returning', async () => {
  const gate = deferredResponse<void>();
  let cancellations = 0;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array([255])); },
    cancel() { cancellations += 1; return gate.promise; }
  }));
  const api = capability({ effect: 'read', transport: async () => response });
  let settled = false;
  const outcome = withGitHubApiTestSession({ capability: api,
    operation: () => executeGitHubApiOperation(api, { kind: 'repository' })
  }).then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
  try {
    await responseTick();
    expect(cancellations).toBe(1);
    expect(settled).toBe(false);
  } finally { gate.resolve(); await outcome; }
  expect(response.body!.locked).toBe(false);
});

test('response failure and a rejected cancellation both remain observable', async () => {
  const cleanupFailure = Object.freeze({ cleanup: 'rejected' });
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array([255])); },
    cancel() { throw cleanupFailure; }
  }));
  const api = capability({ effect: 'read', transport: async () => response });
  const outcome = await withGitHubApiTestSession({ capability: api,
    operation: () => executeGitHubApiOperation(api, { kind: 'repository' })
  }).then(value => ({ value }), error => ({ error }));
  expect('error' in outcome).toBe(true);
  if ('error' in outcome) {
    expect(outcome.error).toBeInstanceOf(AggregateError);
    if (outcome.error instanceof AggregateError) {
      expect(outcome.error.errors[0]).toBeInstanceOf(Error);
      expect(outcome.error.errors[1]).toBe(cleanupFailure);
    }
  }
  expect(response.body!.locked).toBe(false);
});

test('observer deadline retains unfinished transport responsibility and cancels a late response', async () => {
  const delivery = deferredResponse<Response>();
  let cancellations = 0;
  const response = new Response(new ReadableStream<Uint8Array>({ cancel() { cancellations += 1; } }));
  const api = capability({ effect: 'read', transport: async () => delivery.promise });
  try {
    const outcome = await withGitHubApiTestSession({ capability: api, timeoutMs: 30,
      operation: async () => {
        try { await executeGitHubApiOperation(api, { kind: 'repository' }); }
        catch { return 'the caller handled the deadline'; }
      }
    }).then(value => ({ value }), error => ({ error }));
    expect('error' in outcome).toBe(true);
    if ('error' in outcome) {
      expect(outcome.error).toBeInstanceOf(AggregateError);
      expect(outcome.error.errors.some((error: unknown) => String(error).includes('requests remain in flight'))).toBe(true);
    }
  } finally {
    delivery.resolve(response);
    await responseTick();
  }
  expect(cancellations).toBe(1);
  expect(response.body!.locked).toBe(false);
});

function containsError(root: unknown, predicate: (error: unknown) => boolean): boolean {
  return predicate(root) || root instanceof AggregateError && root.errors.some(error => containsError(error, predicate));
}

test('a caught response cleanup error closes future request admission and cannot become session success', async () => {
  const cleanup = Object.freeze({ cleanup: 'not acknowledged' });
  let requests = 0;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new Uint8Array([255])); }, cancel() { throw cleanup; }
  }));
  const api = capability({ effect: 'read', transport: async () => { requests++; return response; } });
  const outcome = await withGitHubApiTestSession({ capability: api, operation: async () => {
    try { await executeGitHubApiOperation(api, { kind: 'repository' }); } catch { /* recovery is not settlement */ }
    await expect(executeGitHubApiOperation(api, { kind: 'repository' })).rejects.toThrow('unresolved settlement');
    return 'handled';
  } }).then(value => ({ value }), error => ({ error }));
  expect('error' in outcome).toBe(true);
  if ('error' in outcome) expect(containsError(outcome.error, error => error === cleanup)).toBe(true);
  expect(requests).toBe(1);
  expect(response.body!.locked).toBe(false);
});

test('observer deadline retains an earlier decoder error while cancellation acknowledgement is pending', async () => {
  const gate = deferredResponse<void>();
  const entered = deferredResponse<void>();
  const response = new Response(new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new Uint8Array([255])); }, cancel() { entered.resolve(); return gate.promise; }
  }));
  const api = capability({ effect: 'read', transport: async () => response });
  try {
    const outcome = await withGitHubApiTestSession({ capability: api, timeoutMs: 30,
      operation: () => executeGitHubApiOperation(api, { kind: 'repository' })
    }).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    expect('error' in outcome).toBe(true);
    if ('error' in outcome) {
      expect(containsError(outcome.error, error => String(error).includes('encoded data'))).toBe(true);
      expect(containsError(outcome.error, error => String(error).includes('deadline exceeded'))).toBe(true);
      expect(containsError(outcome.error, error => String(error).includes('requests remain in flight'))).toBe(true);
    }
    expect(response.body!.locked).toBe(true);
  } finally { gate.resolve(); await responseTick(); }
  expect(response.body!.locked).toBe(false);
});

test('cancellation-induced EOF cannot be published as a normal response after the deadline', async () => {
  const response = new Response(new ReadableStream<Uint8Array>());
  const api = capability({ effect: 'read', transport: async () => response });
  const error = await withGitHubApiTestSession({ capability: api, timeoutMs: 30,
    operation: () => executeGitHubApiOperation(api, { kind: 'repository' })
  }).then(() => null, error => error);
  expect(containsError(error, error => String(error).includes('deadline'))).toBe(true);
  await responseTick();
  expect(response.body!.locked).toBe(false);
});

test('a fired native deadline stays expired when the supplied wall clock does not advance', async () => {
  const response = new Response(new ReadableStream<Uint8Array>());
  const api = capability({ effect: 'read', transport: async () => response });
  const result = await withGitHubApiTestSession({ capability: api, now: () => 1_000, timeoutMs: 30,
    operation: async () => {
      try { await executeGitHubApiOperation(api, { kind: 'repository' }); } catch { /* keep processing locally */ }
      return 'not a fresh request window';
    }
  }).then(value => ({ value }), error => ({ error }));
  expect('error' in result).toBe(true);
  if ('error' in result) expect(containsError(result.error, error => String(error).includes('deadline'))).toBe(true);
  await responseTick();
  expect(response.body!.locked).toBe(false);
});

test('request discriminator is captured once for permission, route and response interpretation', async () => {
  let reads = 0;
  const operation = Object.defineProperty({}, 'kind', {
    get() { reads++; return reads === 1 ? 'current-user' : 'repository'; }
  }) as Parameters<typeof executeGitHubApiOperation>[1];
  const targets: string[] = [];
  const api = capability({ effect: 'runner-admin', principal: { ...PRINCIPAL, permission: 'admin' },
    transport: async target => { targets.push(String(target)); return Response.json({ login: 'admin' }); }
  });
  expect(await withGitHubApiTestSession({ capability: api,
    operation: () => executeGitHubApiOperation(api, operation)
  })).toEqual({ login: 'admin' });
  expect(reads).toBe(1);
  expect(targets).toEqual(['https://api.github.com/user']);
});

test('a validated workflow locator is not re-read while compiling its request route', async () => {
  let reads = 0;
  const operation = Object.defineProperty({ kind: 'workflow-run' as const }, 'runId', {
    get() { reads++; return reads === 1 ? '123' : '../../different-resource'; }
  }) as Parameters<typeof executeGitHubApiOperation>[1];
  const targets: string[] = [];
  const api = capability({ effect: 'read', transport: async target => { targets.push(String(target)); return Response.json({ id: 123 }); } });
  await withGitHubApiTestSession({ capability: api, operation: () => executeGitHubApiOperation(api, operation) });
  expect(reads).toBe(1);
  expect(targets).toEqual(['https://api.github.com/repos/sec-platform/sec/actions/runs/123']);
});

test('caller mutation cannot revoke or reinterpret an already admitted DELETE response', async () => {
  const operation = { kind: 'delete-repository-runner', runnerId: 42 };
  const api = capability({ effect: 'runner-admin', principal: { ...PRINCIPAL, permission: 'admin' },
    transport: async () => { operation.kind = 'repository'; return new Response(null, { status: 204 }); }
  });
  expect(await withGitHubApiTestSession({ capability: api, operation: () => executeGitHubApiOperation(
    api, operation as Parameters<typeof executeGitHubApiOperation>[1]
  ) })).toBeNull();
});

test('exact ref deletion captures branch and old SHA before repository identity observation', async () => {
  const fields = { branch: 'stable-branch', expectedOldSha: SHA };
  const reads = { branch: 0, expectedOldSha: 0 };
  const operation = Object.defineProperties({ kind: 'delete-ref-cas' as const }, {
    branch: { get() { reads.branch++; return fields.branch; } },
    expectedOldSha: { get() { reads.expectedOldSha++; return fields.expectedOldSha; } }
  }) as Parameters<typeof executeGitHubApiOperation>[1];
  let requests = 0;
  let variables: Record<string, unknown> | null = null;
  const api = capability({ effect: 'branch-closeout-write', transport: async (_target, init) => {
    requests++;
    if (requests === 1) {
      fields.branch = 'changed-branch';
      fields.expectedOldSha = '2'.repeat(40);
      return Response.json({ full_name: 'sec-platform/sec', node_id: 'repository-node' });
    }
    variables = (JSON.parse(String(init?.body)) as { variables: Record<string, unknown> }).variables;
    return Response.json({ data: { updateRefs: { clientMutationId: null } } });
  } });
  await withGitHubApiTestSession({ capability: api,
    operation: () => executeGitHubApiOperation(api, operation)
  });
  expect(requests).toBe(2);
  expect(reads).toEqual({ branch: 1, expectedOldSha: 1 });
  expect(variables).toMatchObject({
    name: 'refs/heads/stable-branch', beforeOid: SHA
  });
});

test('request grammar rejects coercible identifiers and unsupported status states before transport', async () => {
  let coerced = 0, requests = 0;
  const text = { toString() { coerced++; return '123'; } };
  const api = capability({ effect: 'status-write', transport: async () => { requests++; return Response.json({}); } });
  const requestsToReject: unknown[] = [
    { kind: 'workflow-run', runId: text }, { kind: 'workflow-run', runId: 123 },
    { kind: 'commit-statuses', sha: { toString() { coerced++; return 'a'.repeat(40); } }, page: 1 },
    { kind: 'branch', branch: new String('main') }, { kind: 'unsupported' },
    { kind: 'create-commit-status', sha: 'a'.repeat(40), status: {
      state: 'failure', context: 'CI', description: 'different meaning', targetUrl: 'https://github.com/sec-platform/sec/actions'
    } }
  ];
  await withGitHubApiTestSession({ capability: api, operation: async () => {
    for (const request of requestsToReject) {
      await expect(executeGitHubApiOperation(api, request as Parameters<typeof executeGitHubApiOperation>[1]))
        .rejects.toBeInstanceOf(Error);
    }
  } });
  expect(coerced).toBe(0);
  expect(requests).toBe(0);
});


test('code scanning alert inventory is one bounded fixed read', async () => {
  const urls: string[] = [];
  const api = capability({
    effect: 'read',
    transport: async (target) => {
      urls.push(String(target));
      return Response.json([]);
    }
  });
  expect(await withGitHubApiTestSession({
    capability: api,
    operation: () => executeGitHubApiOperation(api, {
      kind: 'code-scanning-alerts', pullRequestNumber: 636, page: 2
    })
  })).toEqual([]);
  expect(urls).toEqual([
    'https://api.github.com/repos/sec-platform/sec/code-scanning/alerts?state=open&tool_name=CodeQL&ref=refs%2Fpull%2F636%2Fmerge&per_page=100&page=2'
  ]);
});

test('issue comment update uses the bounded comment write authority', async () => {
  const observed: Array<{ target: string; method: string; body: unknown }> = [];
  const api = capability({
    effect: 'issue-comment-write',
    transport: async (target, init) => {
      observed.push({
        target: String(target),
        method: init?.method ?? 'GET',
        body: init?.body === undefined ? null : JSON.parse(String(init.body))
      });
      return Response.json({ id: 91, body: 'updated' });
    }
  });
  expect(await withGitHubApiTestSession({
    capability: api,
    operation: () => executeGitHubApiOperation(api, {
      kind: 'update-issue-comment', commentId: 91, body: 'updated'
    })
  })).toEqual({ id: 91, body: 'updated' });
  expect(observed).toEqual([{
    target: 'https://api.github.com/repos/sec-platform/sec/issues/comments/91',
    method: 'PATCH',
    body: { body: 'updated' }
  }]);
});
