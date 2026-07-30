import path from 'node:path';
import { loadCanonicalBunRuntimeVersion } from '../../shared/bun-runtime-version.ts';
import { createConcurrencyLimit } from '../../shared/concurrency.ts';
import { ensureDir, writeText, type CommitFence } from '../../shared/fs.ts';
import type { LockFile, ResolvedBlock } from '../../shared/lock-types.ts';
import { blockDirName, getWorkspacePaths } from '../../shared/paths.ts';
import { CodeBuilder } from '../codegen/code-builder.ts';

/**
 * 微服务降级编译器 Pass (Microservice Lowering Pass)
 * 在编译发布期，自动将模块化单体降级拆分为分布式的 RPC API 网关与独立的微服务 Docker 容器包
 *
 * 生成代码采用 LLVM IRBuilder 风格的 CodeBuilder 程序化构造，避免大段模板字符串拼接。
 */
export async function lowerToMicroservices(
  workspaceRoot: string,
  lock: LockFile,
  commitFence?: CommitFence
): Promise<string[]> {
  // 如果编译目标不是微服务，则静默跳过
  if (lock.app.target !== 'microservices') {
    return [];
  }

  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const bunRuntimeVersion = await loadCanonicalBunRuntimeVersion();

  // 各 block 的 RPC Gateway / Client / Dockerfile 生成互相独立，可并行执行。
  // 使用 createConcurrencyLimit 限制并发文件写入数量，避免同时打开过多文件句柄。
  const limit = createConcurrencyLimit(8);
  const blockGeneratedPaths = await Promise.all(
    lock.resolvedBlocks.map((block) =>
      limit(() => lowerBlock(block, projectRoot, bunRuntimeVersion, commitFence))
    )
  );
  return blockGeneratedPaths.flat();
}

async function lowerBlock(
  block: ResolvedBlock,
  projectRoot: string,
  bunRuntimeVersion: string,
  commitFence?: CommitFence
): Promise<string[]> {
  const dirName = blockDirName(block.id);
  const generatedPaths: string[] = [];

  // 1. 生成高内聚的反射型 JSON-RPC Route Gateway (Next.js API Route)
  const rpcRouteDir = path.join(projectRoot, 'app', 'api', 'rpc', dirName);
  const rpcRouteFile = path.join(rpcRouteDir, 'route.ts');

  await ensureDir(rpcRouteDir, commitFence);

  // 使用 CodeBuilder 程序化构造 RPC Gateway，类似 LLVM IRBuilder 的 SSA 构造方式。
  // 顶层声明（import / type alias / const / function）通过 Structure API 构造为 AST，
  // 函数体内部用语句文本（ts-morph 会解析为 AST 节点，语法错误立即抛出）。
  const rpcRouteBuilder = new CodeBuilder(`app/api/rpc/${dirName}/route.ts`)
    .addFileComment(`@generated-rpc-gateway block-id:${block.id}`)
    .addImport({ moduleSpecifier: 'next/server', namedImports: ['NextResponse'] })
    .addImport({
      moduleSpecifier: `../../../../src/installed/${dirName}/index.ts`,
      namespaceImport: 'service'
    })
    .addTypeAlias('RpcHandler', '(...args: unknown[]) => unknown | Promise<unknown>')
    .addVariable({
      name: 'handlers',
      initializer: 'service as unknown as Record<string, RpcHandler>'
    })
    .addFunction({
      name: 'POST',
      isAsync: true,
      isExported: true,
      parameters: [{ name: 'request', type: 'Request' }],
      body: buildRpcRouteBody(block.id)
    });

  await writeText(rpcRouteFile, rpcRouteBuilder.getText(), commitFence);
  generatedPaths.push(`app/api/rpc/${dirName}/route.ts`);

  // 2. 生成 RPC 客户端代理桩 (RPC Client Proxies)，注入熔断重试韧性机制
  const clientDir = path.join(projectRoot, 'src', 'rpc-clients');
  const clientFile = path.join(clientDir, `${dirName}-client.ts`);

  await ensureDir(clientDir, commitFence);

  // 使用 CodeBuilder 程序化构造 RPC Client。
  // CircuitBreaker 类的属性与方法通过 Structure API 构造为 AST 节点，
  // 方法体与 callRpc 函数体用语句文本（ts-morph 解析为 AST 节点，语法错误立即抛出）。
  const envVarName = `SERVICE_HOST_${dirName.toUpperCase().replace(/\./g, '_')}`;
  const rpcClientBuilder = new CodeBuilder(`src/rpc-clients/${dirName}-client.ts`)
    .addFileComment(`@generated-rpc-client block-id:${block.id}`)
    .addClass({
      name: 'CircuitBreaker',
      properties: [
        { name: 'state', type: "'CLOSED' | 'OPEN' | 'HALF_OPEN'", initializer: "'CLOSED'", scope: 'private' },
        { name: 'failureThreshold', initializer: '3', scope: 'private' },
        { name: 'cooldownPeriodMs', initializer: '5000', scope: 'private' },
        { name: 'failureCount', initializer: '0', scope: 'private' },
        { name: 'lastStateChanged', initializer: '0', scope: 'private' }
      ],
      methods: [
        {
          name: 'checkCall',
          scope: 'public',
          returnType: 'void',
          body: buildCheckCallBody(block.id)
        },
        {
          name: 'recordSuccess',
          scope: 'public',
          returnType: 'void',
          body: 'this.failureCount = 0;\nthis.state = "CLOSED";'
        },
        {
          name: 'recordFailure',
          scope: 'public',
          returnType: 'void',
          body: 'this.failureCount++;\nif (this.state === "HALF_OPEN" || this.failureCount >= this.failureThreshold) {\n  this.state = "OPEN";\n  this.lastStateChanged = Date.now();\n}'
        }
      ]
    })
    .addVariable({ name: 'breaker', initializer: 'new CircuitBreaker()' })
    .addFunction({
      name: 'delay',
      isAsync: true,
      parameters: [{ name: 'ms', type: 'number' }],
      returnType: 'Promise<void>',
      body: 'return new Promise(resolve => setTimeout(resolve, ms));'
    })
    .addFunction({
      name: 'callRpc',
      isAsync: true,
      isExported: true,
      parameters: [
        { name: 'method', type: 'string' },
        { name: 'params', type: 'any[]' },
        { name: 'options', type: '{ fallback?: any; timeoutMs?: number }', isOptional: true }
      ],
      returnType: 'Promise<any>',
      body: buildCallRpcBody(block.id, dirName, envVarName)
    });

  await writeText(clientFile, rpcClientBuilder.getText(), commitFence);
  generatedPaths.push(`src/rpc-clients/${dirName}-client.ts`);

  // 3. 生成物理隔离部署的 Dockerfile 容器定义 (Containerization)
  const dockerDir = path.join(projectRoot, 'docker', dirName);
  const dockerFile = path.join(dockerDir, 'Dockerfile');

  await ensureDir(dockerDir, commitFence);

  const dockerfileContent = `# @generated-dockerfile block-id:${block.id}
FROM bun:${bunRuntimeVersion}-alpine

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
  await writeText(dockerFile, dockerfileContent, commitFence);
  generatedPaths.push(`docker/${dirName}/Dockerfile`);

  return generatedPaths;
}

/**
 * 构造 RPC Gateway 的 POST 函数体语句。
 * 类似 LLVM IRBuilder 构造指令序列：函数体内部用语句文本（ts-morph 会解析为 AST 节点）。
 * blockId 在构造期被插值进字符串；${method} 等模板字面量保留在生成代码中。
 */
function buildRpcRouteBody(blockId: string): string {
  return `try {
    const { method, params } = await request.json();
    const handler = handlers[method];
    if (typeof handler !== 'function') {
      return NextResponse.json(
        { error: \`Method "\${method}" not found in block service "${blockId}"\` },
        { status: 404 }
      );
    }
    const result = await handler(...(params || []));
    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal RPC execution error';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }`;
}

/**
 * 构造 CircuitBreaker.checkCall 方法体。
 */
function buildCheckCallBody(blockId: string): string {
  return `const now = Date.now();
    if (this.state === 'OPEN') {
      if (now - this.lastStateChanged > this.cooldownPeriodMs) {
        this.state = 'HALF_OPEN';
        this.lastStateChanged = now;
      } else {
        throw new Error('[Circuit Breaker] Service "${blockId}" is currently offline (Circuit Breaker OPEN). Fast-failing.');
      }
    }`;
}

/**
 * 构造 callRpc 函数体，注入熔断、超时、指数退避重试与降级 fallback。
 * blockId 与 dirName 在构造期被插值；${host}、${response.status} 等模板字面量保留在生成代码中。
 */
function buildCallRpcBody(blockId: string, dirName: string, envVarName: string): string {
  return `const host = process.env["${envVarName}"] || '';
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
  throw new Error(\`[RPC Error - ${blockId}] Call failed after \${maxRetries + 1} attempts. Last error: \${lastError.message}\`);`;
}
