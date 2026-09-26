import {
  assertRetainedNoFollowCapability,
  type RetainedNoFollowChildProcessDirectory,
  type RetainedNoFollowOrdinaryFile
} from './physical-no-follow.ts';

export type RetainedCommandExecutable = RetainedNoFollowOrdinaryFile;
export type RetainedCommandWorkingDirectory = RetainedNoFollowChildProcessDirectory;

export const RETAINED_EXECUTABLE_CHILD_DESCRIPTOR = 3 as const;
export const RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR = 4 as const;

const RETAINED_COMMAND_BOUNDARY_BRAND: unique symbol = Symbol(
  'sec.retained-command-boundary'
);

export interface RetainedCommandBoundary {
  readonly [RETAINED_COMMAND_BOUNDARY_BRAND]: true;
  readonly executable: RetainedCommandExecutable;
  readonly workingDirectory: RetainedCommandWorkingDirectory;
}

export type RetainedCommandAuxiliaryInput =
  | Readonly<{
      readonly capability: RetainedNoFollowChildProcessDirectory;
      readonly kind: 'directory';
    }>
  | Readonly<{
      readonly capability: RetainedNoFollowOrdinaryFile;
      readonly kind: 'ordinary-file';
    }>;

const RETAINED_COMMAND_BOUNDARY_AUXILIARY_INPUTS =
  new WeakMap<RetainedCommandBoundary, readonly RetainedCommandAuxiliaryInput[]>();

export function issueRetainedCommandBoundaryIdentity(input: Readonly<{
  executable: RetainedCommandExecutable;
  workingDirectory: RetainedCommandWorkingDirectory;
  auxiliaryInputs: readonly RetainedCommandAuxiliaryInput[];
}>): RetainedCommandBoundary {
  const boundary = Object.freeze({
    [RETAINED_COMMAND_BOUNDARY_BRAND]: true as const,
    executable: input.executable,
    workingDirectory: input.workingDirectory
  });
  RETAINED_COMMAND_BOUNDARY_AUXILIARY_INPUTS.set(boundary, input.auxiliaryInputs);
  return boundary;
}

export function retainedCommandBoundaryAuxiliaryInputs(
  boundary: RetainedCommandBoundary
): readonly RetainedCommandAuxiliaryInput[] {
  const auxiliaryInputs = RETAINED_COMMAND_BOUNDARY_AUXILIARY_INPUTS.get(boundary);
  if (auxiliaryInputs === undefined) {
    throw new Error('Retained command boundary was not issued by its physical owner.');
  }
  return auxiliaryInputs;
}

export function assertRetainedCommandBoundaryCurrent(boundary: RetainedCommandBoundary): void {
  const auxiliaryInputs = retainedCommandBoundaryAuxiliaryInputs(boundary);
  assertRetainedNoFollowCapability(boundary.executable, 'executable', 'retained command executable');
  assertRetainedNoFollowCapability(
    boundary.workingDirectory,
    'working-directory',
    'retained command working directory'
  );
  boundary.executable.assertCurrent();
  boundary.workingDirectory.assertCurrent();
  for (const auxiliary of auxiliaryInputs) {
    if (auxiliary.kind === 'ordinary-file') auxiliary.capability.assertHandleCurrent();
    else auxiliary.capability.assertCurrent();
  }
}
