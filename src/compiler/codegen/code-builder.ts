import ts from 'typescript';

/**
 * Small TypeScript code-generation builder backed by the repository-pinned
 * TypeScript compiler API. Business callers provide declaration data; this
 * module alone owns parsing fragments, constructing nodes, printing source,
 * and rejecting malformed generated syntax.
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
  isOptional?: boolean;
}

export interface FunctionSpec {
  name: string;
  isAsync?: boolean;
  isExported?: boolean;
  parameters?: ParameterSpec[];
  returnType?: string;
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

const PRINTER = ts.createPrinter({
  newLine: ts.NewLineKind.LineFeed,
  removeComments: false
});

function diagnosticMessage(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
}

function parseSource(text: string, label: string, fileName = 'generated.ts'): ts.SourceFile {
  const diagnostics = ts.transpileModule(text, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext
    },
    fileName,
    reportDiagnostics: true
  }).diagnostics?.filter(({ category }) => category === ts.DiagnosticCategory.Error) ?? [];
  if (diagnostics.length > 0) {
    throw new Error(`${label} is not valid TypeScript: ${diagnosticMessage(diagnostics[0]!)}`);
  }
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

function parseType(text: string, label: string): ts.TypeNode {
  const source = parseSource(`type __SecGeneratedType = ${text};`, label);
  const declaration = source.statements[0];
  if (!declaration || !ts.isTypeAliasDeclaration(declaration)) {
    throw new Error(`${label} did not produce a TypeScript type.`);
  }
  return declaration.type;
}

function parseExpression(text: string, label: string): ts.Expression {
  const source = parseSource(`const __secGeneratedExpression = ${text};`, label);
  const statement = source.statements[0];
  const declaration = statement && ts.isVariableStatement(statement)
    ? statement.declarationList.declarations[0]
    : undefined;
  if (!declaration?.initializer) {
    throw new Error(`${label} did not produce a TypeScript expression.`);
  }
  return declaration.initializer;
}

function parseBody(text: string, label: string): ts.Block {
  const source = parseSource(`function __secGeneratedBody() {\n${text}\n}`, label);
  const declaration = source.statements[0];
  if (!declaration || !ts.isFunctionDeclaration(declaration) || !declaration.body) {
    throw new Error(`${label} did not produce a TypeScript function body.`);
  }
  return declaration.body;
}

function parseStatements(text: string, label: string): readonly ts.Statement[] {
  return [...parseSource(text, label).statements];
}

function synthesize<T extends ts.Node>(node: T): T {
  const visit = (current: ts.Node): void => {
    ts.setTextRange(current, { pos: -1, end: -1 });
    current.forEachChild(visit);
  };
  visit(node);
  return node;
}

function scopeModifier(
  scope: 'public' | 'private' | 'protected' | undefined
): ts.Modifier | undefined {
  switch (scope) {
    case 'public': return ts.factory.createModifier(ts.SyntaxKind.PublicKeyword);
    case 'private': return ts.factory.createModifier(ts.SyntaxKind.PrivateKeyword);
    case 'protected': return ts.factory.createModifier(ts.SyntaxKind.ProtectedKeyword);
    default: return undefined;
  }
}

function modifiers(input: Readonly<{
  exported?: boolean;
  async?: boolean;
  scope?: 'public' | 'private' | 'protected';
  readonly?: boolean;
}>): readonly ts.Modifier[] | undefined {
  const values = [
    input.exported ? ts.factory.createModifier(ts.SyntaxKind.ExportKeyword) : undefined,
    scopeModifier(input.scope),
    input.async ? ts.factory.createModifier(ts.SyntaxKind.AsyncKeyword) : undefined,
    input.readonly ? ts.factory.createModifier(ts.SyntaxKind.ReadonlyKeyword) : undefined
  ].filter((value): value is ts.Modifier => value !== undefined);
  return values.length === 0 ? undefined : values;
}

function parameter(spec: ParameterSpec, label: string): ts.ParameterDeclaration {
  return ts.factory.createParameterDeclaration(
    modifiers({ readonly: spec.isReadonly }),
    undefined,
    spec.name,
    spec.isOptional ? ts.factory.createToken(ts.SyntaxKind.QuestionToken) : undefined,
    spec.type === undefined ? undefined : parseType(spec.type, `${label} type`),
    undefined
  );
}

function heritageType(
  text: string,
  token: 'extends' | 'implements',
  label: string
): ts.ExpressionWithTypeArguments {
  const source = parseSource(`class __SecGenerated ${token} ${text} {}`, label);
  const declaration = source.statements[0];
  const type = declaration && ts.isClassDeclaration(declaration)
    ? declaration.heritageClauses?.[0]?.types[0]
    : undefined;
  if (!type) {
    throw new Error(`${label} did not produce a TypeScript heritage type.`);
  }
  return type;
}

export class CodeBuilder {
  private readonly baseSourceFile: ts.SourceFile;
  private readonly imports: ts.ImportDeclaration[] = [];
  private readonly statements: ts.Statement[] = [];
  private fileComment: string | null = null;

  constructor(filePath = 'generated.ts', initialText = '') {
    this.baseSourceFile = parseSource(initialText, `Initial source for ${filePath}`, filePath);
  }

  addFileComment(comment: string): this {
    this.fileComment = comment;
    return this;
  }

  addImport(spec: ImportSpec): this {
    if (spec.namespaceImport !== undefined && spec.namedImports !== undefined) {
      throw new Error('Import cannot combine namespaceImport with namedImports.');
    }
    const names = spec.namedImports === undefined
      ? undefined
      : [...new Set(spec.namedImports)];
    const namedBindings = spec.namespaceImport !== undefined
      ? ts.factory.createNamespaceImport(ts.factory.createIdentifier(spec.namespaceImport))
      : names === undefined
        ? undefined
        : ts.factory.createNamedImports(names.map((name) =>
            ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier(name))
          ));
    return this.addStatement(ts.factory.createImportDeclaration(
      undefined,
      ts.factory.createImportClause(
        spec.isTypeOnly ?? false,
        spec.defaultImport === undefined
          ? undefined
          : ts.factory.createIdentifier(spec.defaultImport),
        namedBindings
      ),
      ts.factory.createStringLiteral(spec.moduleSpecifier)
    ), 'Import declaration', true);
  }

  addTypeAlias(name: string, type: string, isExported = false): this {
    return this.addStatement(ts.factory.createTypeAliasDeclaration(
      modifiers({ exported: isExported }),
      name,
      undefined,
      parseType(type, `Type alias ${name}`)
    ), `Type alias ${name}`);
  }

  addVariable(spec: VariableSpec): this {
    const declaration = ts.factory.createVariableDeclaration(
      spec.name,
      undefined,
      spec.type === undefined ? undefined : parseType(spec.type, `Variable ${spec.name} type`),
      parseExpression(spec.initializer, `Variable ${spec.name} initializer`)
    );
    return this.addStatement(ts.factory.createVariableStatement(
      modifiers({ exported: spec.isExported }),
      ts.factory.createVariableDeclarationList([declaration], ts.NodeFlags.Const)
    ), `Variable ${spec.name}`);
  }

  addFunction(spec: FunctionSpec): this {
    return this.addStatement(ts.factory.createFunctionDeclaration(
      modifiers({ exported: spec.isExported, async: spec.isAsync }),
      undefined,
      spec.name,
      undefined,
      (spec.parameters ?? []).map((value, index) =>
        parameter(value, `Function ${spec.name} parameter ${index}`)
      ),
      spec.returnType === undefined ? undefined : parseType(spec.returnType, `Function ${spec.name} return type`),
      parseBody(spec.body, `Function ${spec.name} body`)
    ), `Function ${spec.name}`);
  }

  addClass(spec: ClassSpec): this {
    const heritageClauses: ts.HeritageClause[] = [];
    if (spec.extends !== undefined) {
      heritageClauses.push(ts.factory.createHeritageClause(
        ts.SyntaxKind.ExtendsKeyword,
        [heritageType(spec.extends, 'extends', `Class ${spec.name} extends`)]
      ));
    }
    if ((spec.implements?.length ?? 0) > 0) {
      heritageClauses.push(ts.factory.createHeritageClause(
        ts.SyntaxKind.ImplementsKeyword,
        spec.implements!.map((value, index) =>
          heritageType(value, 'implements', `Class ${spec.name} implements ${index}`)
        )
      ));
    }
    const properties = (spec.properties ?? []).map((value) =>
      ts.factory.createPropertyDeclaration(
        modifiers({ scope: value.scope, readonly: value.isReadonly }),
        value.name,
        undefined,
        value.type === undefined ? undefined : parseType(value.type, `Property ${spec.name}.${value.name} type`),
        value.initializer === undefined
          ? undefined
          : parseExpression(value.initializer, `Property ${spec.name}.${value.name} initializer`)
      )
    );
    const methods = (spec.methods ?? []).map((value) =>
      ts.factory.createMethodDeclaration(
        modifiers({ exported: value.isExported, async: value.isAsync, scope: value.scope }),
        undefined,
        value.name,
        undefined,
        undefined,
        (value.parameters ?? []).map((entry, index) =>
          parameter(entry, `Method ${spec.name}.${value.name} parameter ${index}`)
        ),
        value.returnType === undefined
          ? undefined
          : parseType(value.returnType, `Method ${spec.name}.${value.name} return type`),
        parseBody(value.body, `Method ${spec.name}.${value.name} body`)
      )
    );
    return this.addStatement(ts.factory.createClassDeclaration(
      modifiers({ exported: spec.isExported }),
      spec.name,
      undefined,
      heritageClauses,
      [...properties, ...methods]
    ), `Class ${spec.name}`);
  }

  addInterface(name: string, properties: InterfacePropertySpec[], isExported = false): this {
    return this.addStatement(ts.factory.createInterfaceDeclaration(
      modifiers({ exported: isExported }),
      name,
      undefined,
      undefined,
      properties.map((value) => ts.factory.createPropertySignature(
        modifiers({ readonly: value.isReadonly }),
        value.name,
        value.isOptional ? ts.factory.createToken(ts.SyntaxKind.QuestionToken) : undefined,
        parseType(value.type, `Interface ${name}.${value.name} type`)
      ))
    ), `Interface ${name}`);
  }

  addExportAssignment(expression: string): this {
    return this.addStatement(ts.factory.createExportAssignment(
      undefined,
      false,
      parseExpression(expression, 'Export assignment')
    ), 'Export assignment');
  }

  appendRaw(text: string): this {
    for (const statement of parseStatements(text, 'Appended source')) {
      this.statements.push(synthesize(statement));
    }
    return this;
  }

  getText(): string {
    const body = PRINTER.printFile(this.getSourceFile());
    const text = this.fileComment === null ? body : `// ${this.fileComment}\n${body}`;
    parseSource(text, `Generated source ${this.baseSourceFile.fileName}`, this.baseSourceFile.fileName);
    return text;
  }

  getSourceFile(): ts.SourceFile {
    return ts.factory.updateSourceFile(
      this.baseSourceFile,
      [...this.imports, ...this.baseSourceFile.statements, ...this.statements]
    );
  }

  private addStatement(statement: ts.Statement, label: string, insertAsImport = false): this {
    const synthesized = synthesize(statement);
    const candidateImports = insertAsImport
      ? [...this.imports, synthesized as ts.ImportDeclaration]
      : this.imports;
    const candidateStatements = insertAsImport
      ? this.statements
      : [...this.statements, synthesized];
    const candidate = ts.factory.updateSourceFile(
      this.baseSourceFile,
      [...candidateImports, ...this.baseSourceFile.statements, ...candidateStatements]
    );
    parseSource(PRINTER.printFile(candidate), label, this.baseSourceFile.fileName);
    if (insertAsImport) {
      this.imports.push(synthesized as ts.ImportDeclaration);
    } else {
      this.statements.push(synthesized);
    }
    return this;
  }
}
