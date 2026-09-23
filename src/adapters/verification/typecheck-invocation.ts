import path from 'node:path';

export interface TypecheckProjectOptions {
  readonly dependencyProjectRoot?: string;
  readonly isolated?: boolean;
}

/** Fix host selection, path interpretation and diagnostic origin before any
 * dependency bridge or filesystem await. This does not authorize a dependency
 * root or replace the compiler host's lexical/physical source checks. */
export function captureTypecheckInvocation(projectRoot: string, input: TypecheckProjectOptions = {}) {
  const diagnosticRoot = process.cwd();
  const { dependencyProjectRoot: configuredDependencyRoot, isolated } = input;
  if (isolated !== undefined && typeof isolated !== 'boolean') throw new TypeError('Typecheck isolated mode must be boolean');
  const root = path.resolve(diagnosticRoot, projectRoot);
  const dependencyProjectRoot = configuredDependencyRoot === undefined
    ? root : path.resolve(diagnosticRoot, configuredDependencyRoot);
  return Object.freeze({ projectRoot: root, dependencyProjectRoot, diagnosticRoot, isolated: isolated === true });
}
