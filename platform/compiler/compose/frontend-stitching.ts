import path from 'node:path';
import { Node, Project, SyntaxKind } from 'ts-morph';
import { pathExists, readText, writeText, type CommitFence } from '../../shared/fs.ts';
import type { Logger } from '../../shared/logger.ts';
import { defaultLogger } from '../../shared/logger.ts';

export function prefixClassNameString(classString: string, prefix = 'block-attachment-'): string {
  return classString
    .split(/\s+/)
    .map(word => {
      if (!word) return '';
      if (word.startsWith(prefix)) return word;
      
      // 排除动态插值或复杂三元表达式的非类名单词
      if (word.includes('${') || word.includes('}') || word.includes('?') || (word.includes(':') && !word.includes('-') && !/[a-zA-Z]/.test(word))) {
        return word;
      }
      
      // 特殊处理 Tailwind 的负数类名，例如 -mx-2 变成 -block-attachment-mx-2
      if (word.startsWith('-')) {
        return `-${prefix}${word.slice(1)}`;
      }
      
      // 特殊处理带修饰符的类名，例如 hover:text-red-500
      const parts = word.split(':');
      if (parts.length > 1) {
        const lastPart = parts[parts.length - 1];
        const modifierParts = parts.slice(0, -1);
        if (lastPart.startsWith('-')) {
          return `${modifierParts.join(':')}:-${prefix}${lastPart.slice(1)}`;
        }
        return `${modifierParts.join(':')}:${prefix}${lastPart}`;
      }

      return `${prefix}${word}`;
    })
    .join(' ');
}

export function prefixCssContent(content: string, prefix = 'block-attachment-'): string {
  // 只在花括号外进行匹配，匹配以 . 开头的类选择器，但排除百分比、数字等
  const classSelectorRegex = /\.([a-zA-Z_][a-zA-Z0-9_-]*)(?=[^{}]*\{)/g;
  return content.replace(classSelectorRegex, `.${prefix}$1`);
}

export async function injectTailwindPrefix(
  projectRoot: string,
  logger: Logger = defaultLogger,
  commitFence?: CommitFence
): Promise<boolean> {
  const configPath = path.join(projectRoot, 'tailwind.config.ts');
  if (!(await pathExists(configPath))) return false;

  try {
    const project = new Project({
      skipLoadingLibFiles: true,
      skipAddingFilesFromTsConfig: true
    });
    const sourceFile = project.addSourceFileAtPath(configPath);

    let configObject = sourceFile.getVariableDeclaration('config')
      ?.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
    
    if (!configObject) {
      const exportAssignment = sourceFile.getExportAssignments().find(ea => !ea.isExportEquals());
      if (exportAssignment) {
        configObject = exportAssignment.getExpressionIfKind(SyntaxKind.ObjectLiteralExpression);
      }
    }

    if (configObject) {
      const prefixProp = configObject.getProperty('prefix');
      if (!prefixProp) {
        configObject.addPropertyAssignment({
          name: 'prefix',
          initializer: '"block-attachment-"'
        });
        await commitFence?.();
        await sourceFile.save();
        return true;
      }
    }
  } catch (err) {
    logger.warn('Failed to parse and inject prefix to tailwind.config.ts', { error: err });
  }
  return false;
}

export async function prefixJsxClassNames(
  filePath: string,
  prefix = 'block-attachment-',
  logger: Logger = defaultLogger,
  commitFence?: CommitFence
): Promise<boolean> {
  try {
    const project = new Project({
      skipLoadingLibFiles: true,
      skipAddingFilesFromTsConfig: true
    });
    const sourceFile = project.addSourceFileAtPath(filePath);
    let changed = false;

    const jsxAttributes = sourceFile.getDescendantsOfKind(SyntaxKind.JsxAttribute);
    for (const attr of jsxAttributes) {
      // ts-morph JsxAttribute.getNameNode() 总是返回 JsxAttributeName（不会是 undefined），
      // 早期的 as any + 可选链是过度防御，且 fallback 的 getName() 根本不是 JsxAttribute 的方法。
      const nameNode = attr.getNameNode();
      const attrName = nameNode.getText();
      if (attrName === 'className') {
        const initializer = attr.getInitializer();
        if (!initializer) continue;

        if (Node.isStringLiteral(initializer)) {
          const originalVal = initializer.getLiteralValue();
          const newVal = prefixClassNameString(originalVal, prefix);
          if (originalVal !== newVal) {
            attr.setInitializer(`"${newVal}"`);
            changed = true;
          }
        } else if (Node.isJsxExpression(initializer)) {
          const stringLiterals = initializer.getDescendantsOfKind(SyntaxKind.StringLiteral);
          for (const str of stringLiterals) {
            const originalVal = str.getLiteralValue();
            const newVal = prefixClassNameString(originalVal, prefix);
            if (originalVal !== newVal) {
              str.setLiteralValue(newVal);
              changed = true;
            }
          }
        }
      }
    }

    if (changed) {
      await commitFence?.();
      await sourceFile.save();
    }
    return changed;
  } catch (err) {
    logger.warn('Failed to prefix classNames in Jsx file', { filePath, error: err });
    return false;
  }
}

export async function applyPrefixSandboxing(
  projectRoot: string,
  generatedPaths: string[],
  logger: Logger = defaultLogger,
  commitFence?: CommitFence
): Promise<string[]> {
  const newGeneratedPaths: string[] = [];

  const injected = await injectTailwindPrefix(projectRoot, logger, commitFence);
  if (injected) {
    newGeneratedPaths.push('tailwind.config.ts');
  }

  for (const relPath of generatedPaths) {
    const filePath = path.join(projectRoot, relPath);
    if (!(await pathExists(filePath))) continue;

    const ext = path.extname(relPath);
    if (ext === '.css') {
      const content = await readText(filePath);
      const updated = prefixCssContent(content);
      if (content !== updated) {
        await writeText(filePath, updated, commitFence);
      }
    } else if (ext === '.tsx' || ext === '.jsx') {
      await prefixJsxClassNames(filePath, 'block-attachment-', logger, commitFence);
    }
  }

  return newGeneratedPaths;
}
