import {
  enableExecutionProgress,
  reportExecutionProgress,
  type ExecutionProgressState
} from '../../../../execution/execution-progress.ts';
import type {
  SourceProgramCompilationPhaseEvent
} from '../../../repository/source-program-model/compilation-operation.ts';

export type DevExecutionProgressState = ExecutionProgressState;

export const enableDevExecutionProgress = enableExecutionProgress;

export function reportDevExecutionProgress(input: Readonly<{
  command: string;
  phase: string;
  state: DevExecutionProgressState;
  detail?: Readonly<Record<string, unknown>>;
  elapsedMs?: number;
}>): void {
  reportExecutionProgress(input);
}

export function sourceProgramProgressObserver(
  command: string
): (event: SourceProgramCompilationPhaseEvent) => void {
  return (event) => reportDevExecutionProgress({
    command,
    phase: `source-program.${event.phase}`,
    state: event.state,
    elapsedMs: event.elapsedMs
  });
}
