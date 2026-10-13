import type { RuntimeDependencyInstallRequest } from './dependency-install-request.ts';
import type { RuntimeDependencyGeneratedStateLifecycle, RuntimeDependencyLifecycleFactory } from './generated-state/dependency-lifecycle.ts';
export type DependencyProjectLifecycleAdmission =
  | Readonly<{ installMode: 'prebound-only' }>
  | Readonly<{ generatedStateLifecycleFactory: RuntimeDependencyLifecycleFactory }>
  | Readonly<{ generatedStateLifecycle: RuntimeDependencyGeneratedStateLifecycle }>;
export interface DependencyProjectOperation {
  ensureProjectDependencies(projectRoot: string, request?: RuntimeDependencyInstallRequest): Promise<void>;
  withProjectDependencyBridge<Value>(projectRoot: string, use: () => Promise<Value>, request?: RuntimeDependencyInstallRequest): Promise<Value>;
}
export interface DependencyProjectOperationFactory {
  forWorkspace(workspaceRoot: string): DependencyProjectOperation;
}
