import fs from 'node:fs/promises';
import path from 'node:path';
import { Project, SyntaxKind } from 'ts-morph';
import { CompilerError } from '../../shared/errors.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';

// 危险Node核心模块及敏感执行模块的封禁黑名单
const FORBIDDEN_MODULES = new Set([
  'child_process',
  'fs',
  'fs/promises',
  'os',
  'cluster',
  'net',
  'vm',
  'worker_threads'
]);

/**
 * 静态审计自定义 Slot 文件的 TS 语法树，防御恶意代码注入与危险系统调用
 */
export async function validateSlotSecurity(workspaceRoot: string, lock: LockFile): Promise<void> {
  const { sourceSlotsRoot } = getWorkspacePaths(workspaceRoot);
  const slotsDir = sourceSlotsRoot;

  // 如果 slots 目录不存在，跳过安全审计
  try {
    await fs.access(slotsDir);
  } catch {
    return;
  }

  // 筛选出所有已填充的自定义 Slot 任务文件
  const activeSlotFiles: string[] = [];
  for (const task of lock.slotTasks) {
    if (task.sourcePath && (task.status === 'filled' || task.status === 'verified')) {
      const fullPath = path.resolve(workspaceRoot, task.sourcePath);
      try {
        await fs.access(fullPath);
        activeSlotFiles.push(fullPath);
      } catch {
        // 文件尚未落盘，跳过
      }
    }
  }

  if (activeSlotFiles.length === 0) {
    return;
  }

  // 初始化 ts-morph 编译分析上下文，避免在沙盒/临时测试目录中解析 tsconfig 与系统 lib.d.ts 库失败
  const project = new Project({
    skipLoadingLibFiles: true,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: false,
      declaration: false,
      noEmit: true
    }
  });

  // 载入需要安全审计的 Slot 物理源文件
  for (const file of activeSlotFiles) {
    project.addSourceFileAtPath(file);
  }

  // 逐一审查每个 Slot 的 AST 节点
  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    const relativeName = path.relative(workspaceRoot, filePath);

    // 1. 静态审查所有的 Import 导入依赖
    const imports = sourceFile.getImportDeclarations();
    for (const importDecl of imports) {
      const moduleSpecifier = importDecl.getModuleSpecifierValue().trim();
      
      // 匹配封禁黑名单
      if (FORBIDDEN_MODULES.has(moduleSpecifier) || moduleSpecifier.startsWith('node:')) {
        const cleanSpecifier = moduleSpecifier.replace(/^node:/, '');
        if (FORBIDDEN_MODULES.has(cleanSpecifier)) {
          throw new CompilerError(
            'SLOT-SECURITY-002',
            `Forbidden system module import "${moduleSpecifier}" detected in Custom Slot file "${relativeName}". Physical security gate enforcement blocked compilation.`
          );
        }
      }
    }

    // 2. 静态审查所有的 dynamic import() 与 require() 危险调用
    const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const callExpr of callExpressions) {
      const text = callExpr.getText();
      
      // 检测 require('child_process')
      if (text.startsWith('require(')) {
        const args = callExpr.getArguments();
        if (args.length > 0) {
          const argText = args[0].getText().replace(/['"`]/g, '').trim();
          if (FORBIDDEN_MODULES.has(argText) || argText.startsWith('node:')) {
            throw new CompilerError(
              'SLOT-SECURITY-002',
              `Forbidden dynamic require("${argText}") call detected in Custom Slot file "${relativeName}". Physical security gate enforcement blocked compilation.`
            );
          }
        }
      }

      // 检测 import('child_process')
      if (text.startsWith('import(')) {
        const args = callExpr.getArguments();
        if (args.length > 0) {
          const argText = args[0].getText().replace(/['"`]/g, '').trim();
          if (FORBIDDEN_MODULES.has(argText) || argText.startsWith('node:')) {
            throw new CompilerError(
              'SLOT-SECURITY-002',
              `Forbidden dynamic import("${argText}") call detected in Custom Slot file "${relativeName}". Physical security gate enforcement blocked compilation.`
            );
          }
        }
      }
    }
  }
}
