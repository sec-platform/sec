import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  MicroserviceDeploymentIntent,
  MicroserviceDeploymentRenderer
} from '../../platform/compiler/compose/microservice-deployment-contract.ts';
import { DEFAULT_MICROSERVICE_RESILIENCE_POLICY } from '../../platform/compiler/compose/microservice-deployment-policy.ts';
import {
  lowerToMicroservices,
  lowerToMicroservicesWithRenderer
} from '../../platform/compiler/compose/microservice-lower-pass.ts';
import type { LockFile } from '../../platform/shared/lock-types.ts';
import { readCompilerFile } from '../helpers/compiler-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

describe('Microservice Lowering Compiler Pass', () => {
  const createMockLock = (target: 'monolith' | 'microservices'): LockFile => ({
    formatVersion: '1',
    app: {
      name: 'test-app',
      stack: 'nextjs-ts-prisma-sqlite',
      mode: 'multi-tenant',
      target
    } as any,
    resolvedBlocks: [
      {
        id: 'ticket/basic',
        version: '0.1.0',
        kind: 'capability',
        installOrder: 1,
        manifestPath: 'platform/registry/official/ticket.basic/block.manifest.yaml',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'platform/registry/official'
      }
    ],
    resolvedCapabilities: [],
    installPlan: [],
    slotTasks: [],
    generatedPaths: [],
    acceptancePlan: [],
    passStatus: {
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded',
      compose: 'pending',
      adapt: 'pending',
      verify: 'pending',
      repair: 'pending',
      lock: 'pending',
      emit: 'pending'
    }
  });

  test('silently skips when target is not microservices', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const lock = createMockLock('monolith');

      const results = await lowerToMicroservices(workspaceRoot, lock);
      expect(results).toEqual([]);
    }, 'lower-skip-');
  });

  test('successfully lowers blocks into the existing default RPC, client, and Docker outputs', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const lock = createMockLock('microservices');

      const results = await lowerToMicroservices(workspaceRoot, lock);

      expect(results).toContain('app/api/rpc/ticket.basic/route.ts');
      expect(results).toContain('src/rpc-clients/ticket.basic-client.ts');
      expect(results).toContain('docker/ticket.basic/Dockerfile');

      const rpcPath = path.join(workspaceRoot, 'project', 'app', 'api', 'rpc', 'ticket.basic', 'route.ts');
      const clientPath = path.join(workspaceRoot, 'project', 'src', 'rpc-clients', 'ticket.basic-client.ts');
      const dockerPath = path.join(workspaceRoot, 'project', 'docker', 'ticket.basic', 'Dockerfile');

      const rpcContent = await fs.readFile(rpcPath, 'utf8');
      const clientContent = await fs.readFile(clientPath, 'utf8');
      const dockerContent = await fs.readFile(dockerPath, 'utf8');

      expect(rpcContent).toContain('@generated-rpc-gateway');
      expect(rpcContent).toContain('import * as service from');
      expect(clientContent).toContain('@generated-rpc-client');
      expect(clientContent).toContain('export async function callRpc');
      expect(clientContent).toContain('class CircuitBreaker');
      expect(clientContent).toContain('breaker.checkCall()');
      expect(clientContent).toContain('breaker.recordSuccess()');
      expect(clientContent).toContain('breaker.recordFailure()');
      expect(clientContent).toContain('maxRetries = 3');
      expect(clientContent).toContain("'fallback' in options");
      expect(dockerContent).toContain('@generated-dockerfile');
      expect(dockerContent).toContain('FROM bun:1.3.14-alpine');
    }, 'lower-micro-');
  });

  test('passes a provider-neutral intent to an alternate renderer', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const observed: MicroserviceDeploymentIntent[] = [];
      const renderer: MicroserviceDeploymentRenderer = {
        providerId: 'fake-runtime',
        revision: 'test-v1',
        async render(intent) {
          observed.push(intent);
          return [{
            relativePath: `generated/fake/${intent.blockId.replace('/', '-')}.txt`,
            text: `${intent.transport}:${intent.requestMethod}:${intent.packaging}\n`
          }];
        }
      };

      const results = await lowerToMicroservicesWithRenderer(
        workspaceRoot,
        createMockLock('microservices'),
        renderer,
        DEFAULT_MICROSERVICE_RESILIENCE_POLICY
      );

      expect(observed).toEqual([{
        blockId: 'ticket/basic',
        transport: 'json-rpc',
        requestMethod: 'POST',
        packaging: 'isolated-service',
        resilience: DEFAULT_MICROSERVICE_RESILIENCE_POLICY
      }]);
      expect(results).toEqual(['generated/fake/ticket-basic.txt']);
      await expect(fs.readFile(
        path.join(workspaceRoot, 'project', 'generated', 'fake', 'ticket-basic.txt'),
        'utf8'
      )).resolves.toBe('json-rpc:POST:isolated-service\n');
    }, 'lower-fake-provider-');
  });

  test('rejects duplicate renderer targets before any publication', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const lock = createMockLock('microservices');
      lock.resolvedBlocks.push({
        ...lock.resolvedBlocks[0]!,
        id: 'customer/basic',
        installOrder: 2
      });
      const renderer: MicroserviceDeploymentRenderer = {
        providerId: 'colliding-provider',
        revision: 'test-v1',
        async render() {
          return [{ relativePath: 'generated/collision.txt', text: 'must-not-write\n' }];
        }
      };

      await expect(lowerToMicroservicesWithRenderer(
        workspaceRoot,
        lock,
        renderer,
        DEFAULT_MICROSERVICE_RESILIENCE_POLICY
      )).rejects.toMatchObject({ code: 'COMPOSE-PATH-004' });

      await expect(fs.lstat(
        path.join(workspaceRoot, 'project', 'generated', 'collision.txt')
      )).rejects.toMatchObject({ code: 'ENOENT' });
    }, 'lower-collision-');
  });

  test('core lowering pass no longer embeds default provider implementation details', async () => {
    const source = await readCompilerFile('platform/compiler/compose/microservice-lower-pass.ts');
    for (const providerPrivateText of [
      'next/server',
      'Dockerfile',
      'FROM bun:',
      'SERVICE_HOST_',
      'PORT=3000',
      'NODE_ENV=production',
      'CircuitBreaker',
      'maxRetries'
    ]) {
      expect(source).not.toContain(providerPrivateText);
    }
  });
});
