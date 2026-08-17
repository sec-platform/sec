import { loadCanonicalBunRuntimeVersion } from '../../shared/bun-runtime-version.ts';
import { blockDirName } from '../../shared/paths.ts';
import { CodeBuilder } from '../codegen/code-builder.ts';
import type {
  MicroserviceDeploymentIntent,
  MicroserviceDeploymentRenderer,
  RenderedMicroserviceArtifact
} from './microservice-deployment-contract.ts';

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

function buildCallRpcBody(
  intent: MicroserviceDeploymentIntent,
  dirName: string,
  envVarName: string
): string {
  const policy = intent.resilience;
  return `const host = process.env["${envVarName}"] || '';
  const timeout = options?.timeoutMs ?? ${policy.timeoutMs};

  try {
    breaker.checkCall();
  } catch (err: any) {
    if (options && 'fallback' in options) {
      return options.fallback;
    }
    throw err;
  }

  let lastError: any;
  let currentDelay = ${policy.initialRetryDelayMs};
  const maxRetries = ${policy.maxRetries};

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(\`\${host}/api/rpc/${dirName}\`, {
        method: '${intent.requestMethod}',
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
  throw new Error(\`[RPC Error - ${intent.blockId}] Call failed after \${maxRetries + 1} attempts. Last error: \${lastError.message}\`);`;
}

async function renderNextBunDockerArtifacts(
  intent: MicroserviceDeploymentIntent
): Promise<readonly RenderedMicroserviceArtifact[]> {
  const dirName = blockDirName(intent.blockId);
  const bunRuntimeVersion = await loadCanonicalBunRuntimeVersion();
  const rpcRouteRelativePath = `app/api/rpc/${dirName}/route.ts`;
  const clientRelativePath = `src/rpc-clients/${dirName}-client.ts`;
  const dockerRelativePath = `docker/${dirName}/Dockerfile`;

  const rpcRouteBuilder = new CodeBuilder(rpcRouteRelativePath)
    .addFileComment(`@generated-rpc-gateway block-id:${intent.blockId}`)
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
      name: intent.requestMethod,
      isAsync: true,
      isExported: true,
      parameters: [{ name: 'request', type: 'Request' }],
      body: buildRpcRouteBody(intent.blockId)
    });

  const envVarName = `SERVICE_HOST_${dirName.toUpperCase().replace(/\./g, '_')}`;
  const clientBuilder = new CodeBuilder(clientRelativePath)
    .addFileComment(`@generated-rpc-client block-id:${intent.blockId}`)
    .addClass({
      name: 'CircuitBreaker',
      properties: [
        { name: 'state', type: "'CLOSED' | 'OPEN' | 'HALF_OPEN'", initializer: "'CLOSED'", scope: 'private' },
        { name: 'failureThreshold', initializer: String(intent.resilience.failureThreshold), scope: 'private' },
        { name: 'cooldownPeriodMs', initializer: String(intent.resilience.cooldownPeriodMs), scope: 'private' },
        { name: 'failureCount', initializer: '0', scope: 'private' },
        { name: 'lastStateChanged', initializer: '0', scope: 'private' }
      ],
      methods: [
        {
          name: 'checkCall',
          scope: 'public',
          returnType: 'void',
          body: buildCheckCallBody(intent.blockId)
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
      body: buildCallRpcBody(intent, dirName, envVarName)
    });

  const dockerfileContent = `# @generated-dockerfile block-id:${intent.blockId}
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

  return Object.freeze([
    Object.freeze({ relativePath: rpcRouteRelativePath, text: rpcRouteBuilder.getText() }),
    Object.freeze({ relativePath: clientRelativePath, text: clientBuilder.getText() }),
    Object.freeze({ relativePath: dockerRelativePath, text: dockerfileContent })
  ]);
}

export const nextBunDockerMicroserviceRenderer: MicroserviceDeploymentRenderer = Object.freeze({
  providerId: 'next-bun-docker',
  revision: '1',
  render: renderNextBunDockerArtifacts
});
