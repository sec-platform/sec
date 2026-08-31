/**
 * Package-local fault-injection entrypoint. Production code must import
 * ../runtime.ts, whose wrappers discard every test transport and lifecycle
 * control before entering the dependency owner.
 */
export * from '../runtime/project-runtime.ts';
export {
  issueCompilerDependencyFixtureOperation,
  rematerializeCompilerDependencyFixtureOperation,
  retireCompilerDependencyFixtureOperation,
  settleCompilerDependencyFixtureOperation
} from './compiler-dependency-fixture.ts';
export type {
  CompilerDependencyFixtureDescriptor,
  CompilerDependencyFixtureOperation,
  CompilerDependencyFixturePackage,
  CompilerDependencyFixtureReadyState
} from './compiler-dependency-fixture.ts';
