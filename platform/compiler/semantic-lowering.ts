import path from 'node:path';

import { CompilerError } from '../shared/errors.ts';
import { writeText } from '../shared/fs.ts';
import type { LockFile, ResolvedBlock } from '../shared/lock-types.ts';
import { getWorkspacePaths, resolvePathInside } from '../shared/paths.ts';
import type { LoadedSemanticContract } from '../shared/semantic-contract-types.ts';
import type { SemanticGeneratorTask as SemanticLoweringTask } from '../shared/semantic-generator-types.ts';
import { CodeBuilder } from './codegen/code-builder.ts';
import { loadManifestForResolvedBlock } from './parse/load-manifest.ts';
import { loadSemanticContractsForManifestEntry } from './parse/load-semantic-contract.ts';

function constantPrefix(stateId: string): string {
  return stateId.replace(/[^a-zA-Z0-9]+/gu, '_').replace(/^_+|_+$/gu, '').toUpperCase();
}

function renderStateTransitionMap(task: SemanticLoweringTask, loaded: LoadedSemanticContract): string {
  const state = loaded.contract.states.find((entry) => entry.id === task.stateId);
  if (!state) {
    throw new CompilerError('GENERATOR-LOWER-001', `State "${task.stateId}" is unavailable for task "${task.id}"`);
  }

  const prefix = constantPrefix(state.id);
  const boundType = task.typeBinding.name;
  const nextByValue = new Map(state.transitions.map((transition) => [transition.from, transition.to]));
  const values = [...state.values].sort((left, right) => left.localeCompare(right));
  const transitions = [...state.transitions].sort((left, right) =>
    `${left.from}:${left.to}:${left.by}`.localeCompare(`${right.from}:${right.to}:${right.by}`)
  );

  const valueInitializer = `${JSON.stringify(values)} as const satisfies readonly ${boundType}[]`;
  const transitionInitializer = `${JSON.stringify(transitions, null, 2)} as const`;
  const nextInitializer = `${JSON.stringify(
    Object.fromEntries(values.map((value) => [value, nextByValue.get(value)])),
    null,
    2
  )} as const satisfies Record<${boundType}, ${boundType}>`;

  return new CodeBuilder(task.target)
    .addFileComment(`@generated semantic-task:${task.id} contract:${task.contractId} state:${task.stateId}`)
    .addImport({
      moduleSpecifier: task.typeBinding.importFrom,
      namedImports: [boundType],
      isTypeOnly: true
    })
    .addVariable({ name: `${prefix}_VALUES`, initializer: valueInitializer, isExported: true })
    .addVariable({ name: `${prefix}_TRANSITIONS`, initializer: transitionInitializer, isExported: true })
    .addVariable({ name: `NEXT_${prefix}`, initializer: nextInitializer, isExported: true })
    .getText();
}

async function loadTaskContract(
  workspaceRoot: string,
  block: ResolvedBlock,
  task: SemanticLoweringTask
): Promise<LoadedSemanticContract> {
  const manifestEntry = await loadManifestForResolvedBlock(workspaceRoot, block);
  const contracts = await loadSemanticContractsForManifestEntry(manifestEntry);
  const loaded = contracts.find((entry) => entry.contract.id === task.contractId);
  if (!loaded) {
    throw new CompilerError('GENERATOR-LOWER-002', `Contract "${task.contractId}" is unavailable for task "${task.id}"`);
  }
  return loaded;
}

export async function lowerSemanticTasks(workspaceRoot: string, lock: LockFile): Promise<string[]> {
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const generatedPaths: string[] = [];

  for (const task of lock.semanticLoweringTasks ?? []) {
    const block = lock.resolvedBlocks.find((entry) => entry.id === task.blockId);
    if (!block) {
      throw new CompilerError('GENERATOR-LOWER-003', `Block "${task.blockId}" is unavailable for task "${task.id}"`);
    }
    const targetPath = resolvePathInside(projectRoot, task.target);
    if (!targetPath) {
      throw new CompilerError('GENERATOR-LOWER-004', `Task "${task.id}" target escapes project root`);
    }

    const loaded = await loadTaskContract(workspaceRoot, block, task);
    const source = task.kind === 'generate-state-transition-map'
      ? renderStateTransitionMap(task, loaded)
      : null;
    if (source === null) {
      throw new CompilerError('GENERATOR-LOWER-005', `Unsupported semantic lowering kind "${String(task.kind)}"`);
    }

    await writeText(targetPath, source);
    task.status = 'generated';
    generatedPaths.push(path.relative(projectRoot, targetPath).replaceAll(path.sep, '/'));
  }

  return [...new Set(generatedPaths)].sort((left, right) => left.localeCompare(right));
}
