import { LOCK_FILE_FORMAT_VERSION, type LockFile, type PlanFile } from '../compiler/contract.ts';
import { PASS_INITIAL_STATES } from '../compiler/contract/pass-status.ts';
import { CodedFailure } from '../contracts/failure.ts';
import { withAcquiredResource } from '../execution/resource-settlement.ts';
import { freezeWorkspaceCreateBlueprint, snapshotWorkspaceCreateRequest, type WorkspaceCreateSession, type WorkspaceCreateTemplate, type WorkspaceTemplateBlueprint } from '../execution/workspace-create.ts';
import type { PreparedWorkspaceCreate } from './workspace-create.ts';

export interface WorkspaceInitializationOperations {
  loadTemplate(template: WorkspaceCreateTemplate): WorkspaceTemplateBlueprint | PromiseLike<WorkspaceTemplateBlueprint>;
  renderControls(plan: PlanFile, lock: LockFile): WorkspaceTemplateBlueprint | PromiseLike<WorkspaceTemplateBlueprint>;
  openSession(): WorkspaceCreateSession | PromiseLike<WorkspaceCreateSession>;
}

function invalid(reason: string): never {
  throw new CodedFailure('WORKSPACE-INIT-003', 'Workspace creation requires lifecycle recovery; existing objects were preserved', { reason });
}

/** Application owns blueprint construction and Create's phase/recovery choices.
 * Template and control renderers supply bytes; later author files are never
 * inputs. The native session owns each fenced effect and exact readback. */
export async function initializePreparedWorkspace(
  prepared: PreparedWorkspaceCreate,
  operations: WorkspaceInitializationOperations
): Promise<void> {
  const { loadTemplate, renderControls, openSession } = operations;
  if ([loadTemplate, renderControls, openSession].some(operation => typeof operation !== 'function')) {
    throw new TypeError('Workspace initialization operations must be callable');
  }
  const template = prepared.template;
  const plan = structuredClone(prepared.plan);
  const initialGeneratedPaths = [...prepared.initialGeneratedPaths];
  const initialLock: LockFile = {
    formatVersion: LOCK_FILE_FORMAT_VERSION,
    app: { id: plan.app.id, name: plan.app.name, stack: plan.app.stack, mode: plan.app.mode },
    resolvedBlocks: [], resolvedCapabilities: [], installPlan: [],
    generatedPaths: [...initialGeneratedPaths],
    acceptancePlan: plan.acceptance.map(entry => entry.id),
    passStatus: { ...PASS_INITIAL_STATES }
  };
  const suppliedRecipe = await loadTemplate.call(operations, template);
  const recipe: WorkspaceTemplateBlueprint = {
    directories: [...suppliedRecipe.directories],
    files: suppliedRecipe.files.map(file => ({ ...file, bytes: Uint8Array.from(file.bytes) }))
  };
  const controls = await renderControls.call(operations, plan, initialLock);
  const { blueprint, intent } = snapshotWorkspaceCreateRequest(template, freezeWorkspaceCreateBlueprint([recipe, controls]));
  await withAcquiredResource({
    operationLabel: 'workspace create', resourceLabel: 'workspace create session',
    acquire: () => openSession.call(operations),
    release: session => session.dispose(),
    use: async session => {
      const observed = await session.observe();
      if (observed.phase === 'absent') {
        await session.prepare(blueprint, intent);
      } else {
        if (observed.intent.template !== intent.template || observed.intent.digest !== intent.digest) invalid('template-request-mismatch');
        if (observed.phase === 'completed') {
          await session.readCompleted(blueprint, intent);
          return;
        }
        await session.resume(blueprint, intent);
      }
      if (observed.phase !== 'settling') {
        // prepare/resume qualifies the complete frontier before any effect.
        const frontier = [...session.frontier()];
        for (const entry of frontier) {
          if (await session.observePublication(entry) === 'staged') await session.publish(entry);
        }
        await session.beginSettlement();
      }
      await session.retireStage();
      await session.flushPublished();
      await session.complete();
    }
  });
}
