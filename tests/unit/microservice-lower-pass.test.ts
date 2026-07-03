import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { lowerToMicroservices } from '../../platform/compiler/compose/microservice-lower-pass.ts';
import type { LockFile } from '../../platform/shared/lock-types.ts';
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

  test('successfully lowers blocks into RPC Gateways, Clients, and Dockerfiles', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const lock = createMockLock('microservices');

      const results = await lowerToMicroservices(workspaceRoot, lock);

      // 验证返回的文件路径集合
      expect(results).toContain('app/api/rpc/ticket.basic/route.ts');
      expect(results).toContain('src/rpc-clients/ticket.basic-client.ts');
      expect(results).toContain('docker/ticket.basic/Dockerfile');

      // 验证物理文件确实存在且包含期望的生成签名
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
      expect(dockerContent).toContain('FROM bun:1.3.6-alpine');
    }, 'lower-micro-');
  });
});
