import path from 'node:path';
import { ensureDir, writeText } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { getWorkspacePaths, blockDirName } from '../../shared/paths.ts';

/**
 * 微服务降级编译器 Pass (Microservice Lowering Pass)
 * 在编译发布期，自动将模块化单体降级拆分为分布式的 RPC API 网关与独立的微服务 Docker 容器包
 */
export async function lowerToMicroservices(
  workspaceRoot: string,
  lock: LockFile
): Promise<string[]> {
  // 如果编译目标不是微服务，则静默跳过
  if (lock.app.target !== 'microservices') {
    return [];
  }

  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const generatedPaths: string[] = [];

  for (const block of lock.resolvedBlocks) {
    const dirName = blockDirName(block.id);
    
    // 1. 生成高内聚的反射型 JSON-RPC Route Gateway (Next.js API Route)
    const rpcRouteDir = path.join(projectRoot, 'app', 'api', 'rpc', dirName);
    const rpcRouteFile = path.join(rpcRouteDir, 'route.ts');
    
    await ensureDir(rpcRouteDir);
    
    const rpcRouteContent = `// @generated-rpc-gateway block-id:${block.id}
import { NextResponse } from 'next/server';
// 动态缝合引入被安装的模块化业务服务实体
import * as service from '../../../../src/installed/${dirName}/index.ts';

export async function POST(request: Request) {
  try {
    const { method, params } = await request.json();
    
    if (typeof (service as any)[method] !== 'function') {
      return NextResponse.json(
        { error: \`Method "\${method}" not found in block service "${block.id}"\` },
        { status: 404 }
      );
    }
    
    // 通过反射动态分发 RPC 调用，零硬编码业务逻辑
    const result = await (service as any)[method](...(params || []));
    return NextResponse.json({ result });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal RPC execution error' },
      { status: 500 }
    );
  }
}
`;
    await writeText(rpcRouteFile, rpcRouteContent);
    generatedPaths.push(`app/api/rpc/${dirName}/route.ts`);

    // 2. 生成 RPC 客户端代理桩 (RPC Client Proxies)，注入熔断重试韧性机制
    const clientDir = path.join(projectRoot, 'src', 'rpc-clients');
    const clientFile = path.join(clientDir, `${dirName}-client.ts`);
    
    await ensureDir(clientDir);
    
    const rpcClientContent = `// @generated-rpc-client block-id:${block.id}
/**
 * 自动生成的分布式 RPC 客户端代理代理桩
 * 将原本的进程内本地方法调用优雅降级为受控的网络 RPC 调用。
 * 注入了工业级的分布式韧性架构：指数退避重试 (Exponential Backoff) 与熔断器 (Circuit Breaker)。
 */

class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureThreshold = 3;
  private cooldownPeriodMs = 5000;
  private failureCount = 0;
  private lastStateChanged = 0;

  public checkCall(): void {
    const now = Date.now();
    if (this.state === 'OPEN') {
      if (now - this.lastStateChanged > this.cooldownPeriodMs) {
        this.state = 'HALF_OPEN';
        this.lastStateChanged = now;
      } else {
        throw new Error('[Circuit Breaker] Service "${block.id}" is currently offline (Circuit Breaker OPEN). Fast-failing.');
      }
    }
  }

  public recordSuccess(): void {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  public recordFailure(): void {
    this.failureCount++;
    if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.lastStateChanged = Date.now();
    }
  }
}

const breaker = new CircuitBreaker();

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function callRpc(
  method: string, 
  params: any[], 
  options?: { fallback?: any; timeoutMs?: number }
): Promise<any> {
  const host = process.env[\`SERVICE_HOST_\${'${dirName.toUpperCase().replace(/\./g, '_')}'}\`] || '';
  const timeout = options?.timeoutMs ?? 5000;
  
  try {
    breaker.checkCall();
  } catch (err: any) {
    if (options && 'fallback' in options) {
      return options.fallback;
    }
    throw err;
  }

  let lastError: any;
  let currentDelay = 100;
  const maxRetries = 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(\`\${host}/api/rpc/${dirName}\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, params }),
        signal: controller.signal
      });
      clearTimeout(id);

      if (!response.ok) {
        throw new Error(\`HTTP status \${response.status}\`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }

      breaker.recordSuccess();
      return data.result;
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries) {
        await delay(currentDelay);
        currentDelay *= 2;
      }
    }
  }

  breaker.recordFailure();
  if (options && 'fallback' in options) {
    return options.fallback;
  }
  throw new Error(\`[RPC Error - ${block.id}] Call failed after \${maxRetries + 1} attempts. Last error: \${lastError.message}\`);
}
`;
    await writeText(clientFile, rpcClientContent);
    generatedPaths.push(`src/rpc-clients/${dirName}-client.ts`);

    // 3. 生成物理隔离部署的 Dockerfile 容器定义 (Containerization)
    const dockerDir = path.join(projectRoot, 'docker', dirName);
    const dockerFile = path.join(dockerDir, 'Dockerfile');
    
    await ensureDir(dockerDir);
    
    const dockerfileContent = `# @generated-dockerfile block-id:${block.id}
FROM bun:1.3.6-alpine

WORKDIR /app

# 物理载入公共共享依赖
COPY package.json bun.lock ./
RUN bun install

# 复制微服务拆分后的代码
COPY . .

# 动态设定微服务环境变量
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

CMD ["bun", "run", "dev"]
`;
    await writeText(dockerFile, dockerfileContent);
    generatedPaths.push(`docker/${dirName}/Dockerfile`);
  }

  return generatedPaths;
}
