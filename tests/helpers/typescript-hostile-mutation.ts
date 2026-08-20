import ts from 'typescript';

type NamedDeclaration =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ClassDeclaration
  | ts.InterfaceDeclaration
  | ts.TypeAliasDeclaration
  | ts.EnumDeclaration
  | ts.VariableStatement;

function declarationMatches(node: ts.Node, name: string): node is NamedDeclaration {
  if (
    ts.isFunctionDeclaration(node)
    || ts.isMethodDeclaration(node)
    || ts.isClassDeclaration(node)
    || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node)
    || ts.isEnumDeclaration(node)
  ) return node.name !== undefined && ts.isIdentifier(node.name) && node.name.text === name;
  return ts.isVariableStatement(node) && node.declarationList.declarations.some(
    (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name
  );
}

export function readTypeScriptHostileMutationNode(
  source: string,
  name: string,
  purpose: 'hostile-mutation'
): string {
  if (purpose !== 'hostile-mutation') {
    throw new Error('Raw TypeScript declaration bytes require hostile-mutation purpose.');
  }
  const sourceFile = ts.createSourceFile(
    'hostile-mutation.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const matches: NamedDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (declarationMatches(node, name)) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one TypeScript declaration named ${name}; observed ${matches.length}.`);
  }
  return source.slice(matches[0]!.getStart(sourceFile), matches[0]!.getEnd());
}
