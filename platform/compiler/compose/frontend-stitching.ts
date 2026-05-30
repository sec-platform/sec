import path from 'node:path';
import fs from 'node:fs/promises';
import { Project, SyntaxKind, Node } from 'ts-morph';
import { pathExists, readText, writeText } from '../../shared/fs.ts';

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

export async function injectTailwindPrefix(projectRoot: string): Promise<boolean> {
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
        await sourceFile.save();
        return true;
      }
    }
  } catch (err) {
    console.warn(`[Prefix Sandboxing] Failed to parse and inject prefix to tailwind.config.ts:`, err);
  }
  return false;
}

export async function prefixJsxClassNames(filePath: string, prefix = 'block-attachment-'): Promise<boolean> {
  try {
    const project = new Project({
      skipLoadingLibFiles: true,
      skipAddingFilesFromTsConfig: true
    });
    const sourceFile = project.addSourceFileAtPath(filePath);
    let changed = false;

    const jsxAttributes = sourceFile.getDescendantsOfKind(SyntaxKind.JsxAttribute);
    for (const attr of jsxAttributes) {
      const nameNode = (attr as any).getNameNode?.();
      const attrName = nameNode ? nameNode.getText() : (attr as any).getName?.() ?? '';
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
      await sourceFile.save();
    }
    return changed;
  } catch (err) {
    console.warn(`[Prefix Sandboxing] Failed to prefix classNames in Jsx file: ${filePath}`, err);
    return false;
  }
}

export async function applyPrefixSandboxing(projectRoot: string, generatedPaths: string[]): Promise<string[]> {
  const newGeneratedPaths: string[] = [];

  // 1. Inject prefix config to tailwind.config.ts
  const injected = await injectTailwindPrefix(projectRoot);
  if (injected) {
    newGeneratedPaths.push('tailwind.config.ts');
  }

  // 2. Loop through generated files and apply prefixing
  for (const relPath of generatedPaths) {
    const filePath = path.join(projectRoot, relPath);
    if (!(await pathExists(filePath))) continue;

    const ext = path.extname(relPath);
    if (ext === '.css') {
      const content = await readText(filePath);
      const updated = prefixCssContent(content);
      if (content !== updated) {
        await writeText(filePath, updated);
      }
    } else if (ext === '.tsx' || ext === '.jsx') {
      await prefixJsxClassNames(filePath);
    }
  }

  return newGeneratedPaths;
}
