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

    // 2. 生成 RPC 客户端代理桩 (RPC Client Proxies)
    const clientDir = path.join(projectRoot, 'src', 'rpc-clients');
    const clientFile = path.join(clientDir, `${dirName}-client.ts`);
    
    await ensureDir(clientDir);
    
    const rpcClientContent = `// @generated-rpc-client block-id:${block.id}
/**
 * 自动生成的分布式 RPC 客户端代理代理桩
 * 将原本的进程内本地方法调用优雅降级为受控的网络 RPC 调用
 */
export async function callRpc(method: string, params: any[]): Promise<any> {
  const host = process.env[\`SERVICE_HOST_\${'${dirName.toUpperCase().replace(/\./g, '_')}'}\`] || '';
  const response = await fetch(\`\${host}/api/rpc/${dirName}\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params })
  });
  
  const data = await response.json();
  if (data.error) {
    throw new Error(\`[RPC Error - ${block.id}]: \${data.error}\`);
  }
  return data.result;
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
