import path from 'node:path';
import { CI_ARTIFACT_FILES } from '../../shared/ci-artifact-contract.ts';
import { defaultLimit } from '../../shared/concurrency.ts';
import { CompilerError } from '../../shared/errors.ts';
import { ensureDir, pathExists, writeJson, writeText } from '../../shared/fs.ts';
import type { InstallPlanStep, LockFile, SlotTask } from '../../shared/lock-types.ts';
import { addGeneratedPaths, saveLock } from '../../shared/lock-utils.ts';
import { getWorkspacePaths, resolvePathInside } from '../../shared/paths.ts';
import { ensureProjectBase } from '../../shared/project-base.ts';
import { CodeBuilder } from '../codegen/code-builder.ts';
import { loadManifestForResolvedBlock } from '../parse/load-manifest.ts';
import { applyOverrides } from './apply-overrides.ts';
import { formatOutputFiles } from './format-output-files.ts';
import { applyPrefixSandboxing } from './frontend-stitching.ts';
import { generateRuntimeHostScaffold } from './generate-runtime-host.ts';
import { installOpaqueModules } from './install-opaque-modules.ts';
import { defaultInstallRegistry } from './install-strategies.ts';
import { mapCustomRoutes } from './map-custom-routes.ts';
import { mergePrismaTemplate } from './merge-prisma-template.ts';
import { mergeTailwindTheme } from './merge-tailwind-theme.ts';
import { lowerToMicroservices } from './microservice-lower-pass.ts';
import { setProjectReadOnlyLock } from './project-readonly-lock.ts';

/**
 * 渲染路由图 TS 文件，类似 LLVM Module 的 emitter：通过 CodeBuilder 程序化构造
 * GeneratedRoute interface 与 routes const，避免模板字符串拼接。
 */
async function renderRouteGraph(workspaceRoot: string, lock: LockFile): Promise<string> {
  const routeEntries = await Promise.all(
    lock.resolvedBlocks.map(async (block) => {
      const manifestEntry = await loadManifestForResolvedBlock(workspaceRoot, block);
      return manifestEntry.manifest.routes.map(
        (route) => `{ blockId: '${block.id}', path: '${route.path}', file: '${route.file}' }`
      );
    })
  );

  const builder = new CodeBuilder('generated/routes.ts')
    .addInterface(
      'GeneratedRoute',
      [
        { name: 'blockId', type: 'string' },
        { name: 'path', type: 'string' },
        { name: 'file', type: 'string' }
      ],
      true
    )
    .addVariable({
      name: 'routes',
      type: 'GeneratedRoute[]',
      isExported: true,
      initializer: `[\n${routeEntries.flat().map(entry => `  ${entry}`).join(',\n')}\n]`
    });

  return builder.getText();
}

/**
 * 渲染 slot 骨架文件，类似 LLVM Function declaration 的 emitter。
 * 优先使用 mockTemplate（如果有），否则通过 CodeBuilder 程序化构造：
 * - 有 exports：聚合 import type，为每个 export 生成 throw new Error('Not implemented') 的 stub 函数
 * - 无 exports：生成单参数 input 与可选的 inputType/outputType 类型导入
 */
function renderSlotSkeleton(task: SlotTask): string {
  if (task.mockTemplate) {
    return task.mockTemplate;
  }

  const builder = new CodeBuilder(task.target)
    .addFileComment(`@generated slot-id:${task.id} block:${task.block}`);

  if (task.exports && task.exports.length > 0) {
    // 聚合所有 export 需要的 type imports
    const imports = new Map<string, Set<string>>();
    for (const exp of task.exports) {
      for (const p of exp.params) {
        if (p.importFrom) {
          if (!imports.has(p.importFrom)) imports.set(p.importFrom, new Set());
          const importSet = imports.get(p.importFrom);
          if (importSet) { importSet.add(p.type); }
        }
      }
      if (exp.outputImportFrom && exp.outputType) {
        const baseType = exp.outputType.replace(/\[\]$/, '');
        if (!imports.has(exp.outputImportFrom)) imports.set(exp.outputImportFrom, new Set());
        const outputImportSet = imports.get(exp.outputImportFrom);
        if (outputImportSet) { outputImportSet.add(baseType); }
      }
    }

    for (const [src, types] of imports) {
      builder.addImport({
        moduleSpecifier: src,
        namedImports: Array.from(types),
        isTypeOnly: true
      });
    }

    for (const exp of task.exports) {
      builder.addFunction({
        name: exp.symbol,
        isExported: true,
        parameters: exp.params.map(p => ({ name: p.name, type: p.type })),
        returnType: exp.outputType,
        body: "throw new Error('Not implemented');"
      });
    }

    return builder.getText();
  }

  // 无 exports 分支：生成单参数 stub 函数
  if (task.inputType && task.outputType) {
    builder.addImport({
      moduleSpecifier: '../src/runtime/database.ts',
      namedImports: [task.inputType, task.outputType],
      isTypeOnly: true
    });
  }

  builder.addFunction({
    name: task.symbol,
    isExported: true,
    parameters: [{ name: 'input', type: task.inputType ?? 'unknown' }],
    returnType: task.outputType ?? 'unknown',
    body: "throw new Error('Not implemented');"
  });

  return builder.getText();
}

export async function composeProject(
  workspaceRoot: string,
  lock: LockFile,
  options?: { lockFiles?: boolean }
): Promise<LockFile> {
  const { projectRoot, generatedDir, blockUsageMapPath, installManifestPath } = getWorkspacePaths(workspaceRoot);

  // Make sure existing files are writable so compiler can overwrite them
  await setProjectReadOnlyLock(projectRoot, true);

  await ensureProjectBase(workspaceRoot);

  const installContext = { workspaceRoot, projectRoot, lock };
  await defaultInstallRegistry.executeAll(lock.installPlan, installContext);
  await mergePrismaTemplate(workspaceRoot, projectRoot);
  const opaqueGeneratedPaths = await installOpaqueModules(workspaceRoot, projectRoot);
  const tailwindGeneratedPaths = await mergeTailwindTheme(workspaceRoot, projectRoot);
  const customRoutesGeneratedPaths = await mapCustomRoutes(workspaceRoot, projectRoot);

  const installManifest: Array<InstallPlanStep & { status: 'installed' }> = lock.installPlan.map((step) => ({
    ...step,
    status: 'installed' as const
  }));

  const [routesContent] = await Promise.all([
    renderRouteGraph(workspaceRoot, lock),
    ensureDir(generatedDir),
    ensureDir(path.dirname(blockUsageMapPath)),
    ensureDir(path.dirname(installManifestPath))
  ]);

  await Promise.all([
    writeText(path.join(generatedDir, 'routes.ts'), routesContent),
    writeJson(blockUsageMapPath, {
      blocks: lock.resolvedBlocks.map((block) => ({
        id: block.id,
        installOrder: block.installOrder
      }))
    })
  ]);

  await Promise.all(
    lock.slotTasks.map((task) => defaultLimit(async () => {
      const targetPath = resolvePathInside(projectRoot, task.target);
      if (!targetPath) {
        throw new CompilerError('SLOT-SECURITY-001', `Slot target "${task.target}" escapes project root`);
      }
      if (!(await pathExists(targetPath))) {
        await writeText(targetPath, renderSlotSkeleton(task));
      }
      task.status = 'generated';
    }))
  );

  const runtimeScaffoldPaths = await generateRuntimeHostScaffold(workspaceRoot, lock);
  const microservicePaths = await lowerToMicroservices(workspaceRoot, lock);

  // Apply Prefix Sandboxing Pass for visual aesthetic isolation
  const initialGeneratedPaths = [
    ...runtimeScaffoldPaths,
    'generated/routes.ts',
    CI_ARTIFACT_FILES.blockUsageMap,
    CI_ARTIFACT_FILES.installManifest,
    ...opaqueGeneratedPaths,
    ...tailwindGeneratedPaths,
    ...customRoutesGeneratedPaths,
    ...microservicePaths
  ];
  const sandboxedPaths = await applyPrefixSandboxing(projectRoot, initialGeneratedPaths);

  addGeneratedPaths(lock, [
    ...initialGeneratedPaths,
    ...sandboxedPaths
  ]);


  await applyOverrides(workspaceRoot, 'compose');

  await formatOutputFiles(projectRoot, lock.generatedPaths);

  await writeJson(installManifestPath, installManifest);
  lock.passStatus.compose = 'succeeded';

  if (options?.lockFiles) {
    const slotTargets = lock.slotTasks.map((t) => t.target);
    await setProjectReadOnlyLock(projectRoot, false, slotTargets);
  }

  await saveLock(workspaceRoot, lock);
  return lock;
}
