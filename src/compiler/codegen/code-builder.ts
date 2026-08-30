import { Project, Scope, VariableDeclarationKind, type SourceFile } from 'ts-morph';

/**
 * 代码生成 Builder API（基于 ts-morph Structure API）
 *
 * 设计目标：类似 LLVM IRBuilder，程序化构造 TS 源码 AST，而非大段模板字符串拼接。
 * - 顶层声明（import / type / variable / function / class / interface）通过 Builder 方法构造
 * - 函数体与方法体内部用 ts-morph 的 statements 字符串接口（ts-morph 会解析为 AST，
 *   语法错误会立即抛出，保证生成的代码可解析）
 * - 类型安全：每个方法返回 this，支持链式调用
 * - 可组合：多个 Builder 调用可串行构造一个完整文件
 *
 * 使用示例：
 *   const builder = new CodeBuilder('service.ts');
 *   builder
 *     .addFileComment('@generated-rpc-gateway block-id:ticket.basic')
 *     .addImport({ moduleSpecifier: 'yaml', namedImports: ['parse'] })
 *     .addFunction({
 *       name: 'parseDocument',
 *       isAsync: true,
 *       isExported: true,
 *       parameters: [{ name: 'request', type: 'Request' }],
 *       body: `return NextResponse.json({ ok: true });`
 *     });
 *   const code = builder.getText();
 */

export interface ImportSpec {
  moduleSpecifier: string;
  namedImports?: string[];
  defaultImport?: string;
  namespaceImport?: string;
  isTypeOnly?: boolean;
}

export interface ParameterSpec {
  name: string;
  type?: string;
  isReadonly?: boolean;
  /** 标记可选参数（在参数名后加 ?），如 `options?: {...}`。 */
  isOptional?: boolean;
}

export interface FunctionSpec {
  name: string;
  isAsync?: boolean;
  isExported?: boolean;
  parameters?: ParameterSpec[];
  returnType?: string;
  /** 函数体语句文本，ts-morph 会解析为 AST 语句序列。 */
  body: string;
}

export interface PropertySpec {
  name: string;
  type?: string;
  initializer?: string;
  scope?: 'public' | 'private' | 'protected';
  isReadonly?: boolean;
}

export interface MethodSpec {
  name: string;
  isAsync?: boolean;
  isExported?: boolean;
  scope?: 'public' | 'private' | 'protected';
  parameters?: ParameterSpec[];
  returnType?: string;
  /** 方法体语句文本。 */
  body: string;
}

export interface ClassSpec {
  name: string;
  isExported?: boolean;
  extends?: string;
  implements?: string[];
  properties?: PropertySpec[];
  methods?: MethodSpec[];
}

export interface VariableSpec {
  name: string;
  initializer: string;
  isExported?: boolean;
  type?: string;
}

export interface InterfacePropertySpec {
  name: string;
  type: string;
  isReadonly?: boolean;
  isOptional?: boolean;
}

/**
 * 进程级共享 ts-morph Project 单例。
 *
 * CodeBuilder 历史上每次构造都 new 一个 Project，导致大量重复的 ts-morph
 * 初始化开销。由于所有 CodeBuilder 生成的 SourceFile 都使用内存文件系统、
 * 不加载 lib 文件、不解析依赖，多个 SourceFile 可以安全共存于同一个 Project。
 * 通过 getDefaultProject() 复用单例可显著降低编译管线中的 Project 构造成本。
 */
let _defaultProject: Project | null = null;

export function getDefaultProject(): Project {
  if (_defaultProject === null) {
    _defaultProject = new Project({
      useInMemoryFileSystem: true,
      skipLoadingLibFiles: true,
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true
    });
  }
  return _defaultProject;
}

export class CodeBuilder {
  private readonly sourceFile: SourceFile;
  /**
   * 文件顶部注释（如 @generated 标记）。
   * 单独存储并在 getText() 时拼接到最前面，避免 ts-morph 的 addImportDeclaration
   * 总是把 import 插到文件顶部、把 insertText(0,...) 的注释挤到 import 之后。
   */
  private fileComment: string | null = null;

  constructor(filePath: string = 'generated.ts', initialText: string = '', project?: Project) {
    const resolvedProject = project ?? getDefaultProject();
    this.sourceFile = resolvedProject.createSourceFile(filePath, initialText, { overwrite: true });
  }

  /**
   * 在文件顶部添加注释（如 @generated 标记）。
   * comment 不带 // 前缀，本方法会按需添加。
   * 注释会拼接到最终输出的最前面（在所有 import 之上），调用顺序无关。
   */
  addFileComment(comment: string): this {
    this.fileComment = comment;
    return this;
  }

  /**
   * 添加 import 声明。
   */
  addImport(spec: ImportSpec): this {
    const namedImports = spec.namedImports === undefined
      ? undefined
      : [...new Set(spec.namedImports)];
    this.sourceFile.addImportDeclaration({
      moduleSpecifier: spec.moduleSpecifier,
      namedImports: namedImports?.map(name => ({ name })),
      defaultImport: spec.defaultImport,
      namespaceImport: spec.namespaceImport,
      isTypeOnly: spec.isTypeOnly ?? false
    });
    return this;
  }

  /**
   * 添加 type alias。
   */
  addTypeAlias(name: string, type: string, isExported = false): this {
    this.sourceFile.addTypeAlias({ name, type, isExported });
    return this;
  }

  /**
   * 添加 const 变量声明。
   */
  addVariable(spec: VariableSpec): this {
    this.sourceFile.addVariableStatement({
      declarationKind: VariableDeclarationKind.Const,
      declarations: [{ name: spec.name, type: spec.type, initializer: spec.initializer }],
      isExported: spec.isExported
    });
    return this;
  }

  /**
   * 添加函数声明。
   * body 是函数体内的语句文本，ts-morph 会将其解析为 AST 节点（语法错误会抛出）。
   */
  addFunction(spec: FunctionSpec): this {
    this.sourceFile.addFunction({
      name: spec.name,
      isAsync: spec.isAsync,
      isExported: spec.isExported,
      parameters: spec.parameters?.map(p => ({
        name: p.name,
        type: p.type,
        isReadonly: p.isReadonly,
        hasQuestionToken: p.isOptional
      })),
      returnType: spec.returnType,
      statements: spec.body
    });
    return this;
  }

  /**
   * 添加类声明。
   * scope 字符串会被转换为 ts-morph 的 Scope 枚举，以保证类型安全。
   */
  addClass(spec: ClassSpec): this {
    this.sourceFile.addClass({
      name: spec.name,
      isExported: spec.isExported,
      extends: spec.extends,
      implements: spec.implements,
      properties: spec.properties?.map(p => ({
        name: p.name,
        type: p.type,
        initializer: p.initializer,
        scope: toScope(p.scope),
        isReadonly: p.isReadonly
      })),
      methods: spec.methods?.map(m => ({
        name: m.name,
        isAsync: m.isAsync,
        isExported: m.isExported,
        scope: toScope(m.scope),
        parameters: m.parameters?.map(p => ({
          name: p.name,
          type: p.type,
          isReadonly: p.isReadonly,
          hasQuestionToken: p.isOptional
        })),
        returnType: m.returnType,
        statements: m.body
      }))
    });
    return this;
  }

  /**
   * 添加 interface 声明。
   */
  addInterface(
    name: string,
    properties: InterfacePropertySpec[],
    isExported = false
  ): this {
    this.sourceFile.addInterface({
      name,
      isExported,
      properties: properties.map(p => ({
        name: p.name,
        type: p.type,
        isReadonly: p.isReadonly,
        isOptional: p.isOptional
      }))
    });
    return this;
  }

  /**
   * 添加 export default 赋值。
   */
  addExportAssignment(expression: string): this {
    this.sourceFile.addExportAssignment({ expression });
    return this;
  }

  /**
   * 在文件末尾追加原始文本（用于无法用 Structure API 表达的边角场景）。
   * 调用方需自行保证语法正确性。
   */
  appendRaw(text: string): this {
    this.sourceFile.addStatements(text);
    return this;
  }

  /**
   * 获取生成的代码文本。
   * 若通过 addFileComment 设置了文件顶部注释，会拼接到最前面。
   */
  getText(): string {
    const body = this.sourceFile.getText();
    if (this.fileComment) {
      return `// ${this.fileComment}\n${body}`;
    }
    return body;
  }

  /**
   * 获取底层 SourceFile，用于高级操作或 ts-morph 直接交互。
   */
  getSourceFile(): SourceFile {
    return this.sourceFile;
  }
}

/**
 * 将字符串 scope 转换为 ts-morph 的 Scope 枚举。
 * 保留字符串输入是为了调用方的人体工学（无需关心 ts-morph 内部枚举）。
 */
function toScope(scope?: 'public' | 'private' | 'protected'): Scope | undefined {
  switch (scope) {
    case 'public': return Scope.Public;
    case 'private': return Scope.Private;
    case 'protected': return Scope.Protected;
    default: return undefined;
  }
}
