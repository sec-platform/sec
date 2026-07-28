import fs from 'node:fs';
import path from 'node:path';
import { CompilerError } from '../../shared/errors.ts';
import { compilerRuntimeResources } from '../../shared/runtime-layout.ts';

const TEMPLATES_DIR = compilerRuntimeResources.composeTemplates;

export class TemplateEngine {
  private static cache = new Map<string, string>();

  /**
   * 渲染外部物理模板文件，并根据上下文进行条件编译与文本插值。
   * @param templateName 模板文件名，例如 'app/layout.tsx.template'
   * @param context 包含布尔变量和文本插值的上下文对象
   * @param templatesDir 模板存放的基础目录，默认为当前文件目录下的 templates
   */
  public static render(
    templateName: string,
    context: Record<string, any>,
    templatesDir: string = TEMPLATES_DIR
  ): string {
    const filePath = path.join(templatesDir, templateName);
    let templateContent = this.cache.get(filePath);

    if (!templateContent) {
      if (!fs.existsSync(filePath)) {
        throw new CompilerError('COMPOSE-TEMPLATE-001', `Scaffold template not found: ${filePath}`);
      }
      templateContent = fs.readFileSync(filePath, 'utf8');
      this.cache.set(filePath, templateContent);
    }

    return this.renderString(templateContent, context);
  }

  /**
   * 核心递归解析方法，支持无限嵌套的 /*#IF* / 与 /*#ENDIF* / 条件编译
   */
  public static renderString(content: string, context: Record<string, any>): string {
    const parse = (text: string): string => {
      let output = '';
      let cursor = 0;

      while (cursor < text.length) {
        const nextIf = text.indexOf('/*#IF ', cursor);
        if (nextIf === -1) {
          output += text.slice(cursor);
          break;
        }

        // 拼接 IF 之前的文本
        output += text.slice(cursor, nextIf);

        // 找到对应的 condition
        const condEnd = text.indexOf('*/', nextIf);
        if (condEnd === -1) {
          throw new CompilerError('COMPOSE-TEMPLATE-002', 'Malformed template: missing */ for /*#IF');
        }
        const condition = text.slice(nextIf + 6, condEnd).trim();

        // 递归寻找与当前 IF 配对的 /*#ENDIF*/
        let depth = 1;
        let scan = condEnd + 2;
        let foundEnd = -1;

        while (scan < text.length) {
          const innerIf = text.indexOf('/*#IF ', scan);
          const innerEnd = text.indexOf('/*#ENDIF*/', scan);

          if (innerEnd === -1) {
            throw new CompilerError('COMPOSE-TEMPLATE-003', `Malformed template: missing /*#ENDIF*/ for IF ${condition}`);
          }

          if (innerIf !== -1 && innerIf < innerEnd) {
            // 遇到了嵌套的 IF
            depth++;
            scan = innerIf + 6;
          } else {
            // 遇到了配对的 ENDIF
            depth--;
            if (depth === 0) {
              foundEnd = innerEnd;
              break;
            }
            scan = innerEnd + 10;
          }
        }

        if (foundEnd === -1) {
          throw new CompilerError('COMPOSE-TEMPLATE-004', `Malformed template: unmatched /*#ENDIF*/ for IF ${condition}`);
        }

        // 提取被 IF 包裹的体内容
        const bodyContent = text.slice(condEnd + 2, foundEnd);

        // 判定条件
        const isNegated = condition.startsWith('!');
        const varName = isNegated ? condition.slice(1) : condition;
        const val = !!context[varName];
        const shouldKeep = isNegated ? !val : val;

        if (shouldKeep) {
          // 递归渲染内部嵌套的块，从而完美支持嵌套 IF
          output += parse(bodyContent);
        }

        cursor = foundEnd + 10;
      }

      return output;
    };

    let result = parse(content);

    // 2. 处理 __VARIABLE__ 文本插值
    for (const [key, val] of Object.entries(context)) {
      if (typeof val === 'string' || typeof val === 'number') {
        const placeholder = new RegExp(`__${key}__`, 'g');
        result = result.replace(placeholder, String(val));
      }
    }

    return result;
  }
}
