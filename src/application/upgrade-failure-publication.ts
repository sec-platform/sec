import { CompilerError } from '../compiler/errors.ts';
import { throwUpgradeFailureWithSecondaryFailures } from '../compiler/upgrade/failure.ts';

/**
 * Execute all requested failure publications so one secondary failure cannot
 * suppress the remaining independent failure evidence.
 */
export async function publishUpgradeFailureArtifacts(
  primary: Error,
  publications: readonly (() => Promise<void>)[],
  message: string
): Promise<never> {
  const secondaryFailures: unknown[] = [];
  for (const publish of publications) {
    try {
      await publish();
    } catch (error) {
      secondaryFailures.push(error);
    }
  }
  throwUpgradeFailureWithSecondaryFailures(primary, secondaryFailures, message);
}


export interface UpgradeApplyFailurePublicationOperations<TTerminal> {
  buildTerminal(): Promise<TTerminal>;
  publishTerminal(terminal: TTerminal): Promise<TTerminal>;
  publishDiagnostics(terminal: TTerminal): Promise<void>;
}

/**
 * Publish rollback/recovery evidence without allowing one secondary publication
 * failure to suppress the remaining independent evidence. Unknown applied-
 * terminal commit state deliberately suppresses a competing failure terminal.
 */
export async function publishUpgradeApplyFailureArtifacts<TTerminal>(
  primary: Error,
  appliedTerminalCommitUnknown: boolean,
  operations: UpgradeApplyFailurePublicationOperations<TTerminal>
): Promise<never> {
  if (typeof operations.buildTerminal !== 'function' ||
      typeof operations.publishTerminal !== 'function' ||
      typeof operations.publishDiagnostics !== 'function') {
    throw new TypeError('Upgrade apply failure publication operations must be callable');
  }

  const secondaryFailures: unknown[] = [];
  let terminal: TTerminal | null = null;
  if (!appliedTerminalCommitUnknown) {
    try {
      terminal = await operations.publishTerminal.call(
        operations,
        await operations.buildTerminal.call(operations)
      );
    } catch (error) {
      secondaryFailures.push(error);
    }
  }
  if (terminal !== null) {
    try {
      await operations.publishDiagnostics.call(operations, terminal);
    } catch (error) {
      secondaryFailures.push(error);
    }
  }
  throwUpgradeFailureWithSecondaryFailures(
    primary,
    secondaryFailures,
    'Upgrade apply failed and failure artifact publication did not complete'
  );
}


/**
 * Planning failures own blocked Upgrade evidence only when they are canonical
 * compiler failures. Unknown/provider failures propagate without inventing an
 * Upgrade diagnostic classification.
 */
export async function publishUpgradePlanningFailure(
  failure: unknown,
  publications: readonly (() => Promise<void>)[]
): Promise<never> {
  if (!(failure instanceof CompilerError)) throw failure;
  return publishUpgradeFailureArtifacts(
    failure,
    publications,
    'Upgrade planning failed and failure artifact publication did not complete'
  );
}


export interface UpgradePlanningFailurePublicationOperations {
  clearPlan(): Promise<void>;
  clearExecutionTerminal(): Promise<void>;
  publishDiagnostics(failure: CompilerError): Promise<void>;
}

/**
 * Execute one Upgrade planning operation and own canonical planning-failure
 * publication. Unknown/provider failures propagate unchanged and never acquire
 * an Upgrade diagnostic classification merely because they crossed bootstrap.
 */
export async function executeUpgradePlanningWithFailurePublication<T>(
  plan: () => Promise<T>,
  operations: UpgradePlanningFailurePublicationOperations
): Promise<T> {
  if (typeof plan !== 'function' ||
      typeof operations.clearPlan !== 'function' ||
      typeof operations.clearExecutionTerminal !== 'function' ||
      typeof operations.publishDiagnostics !== 'function') {
    throw new TypeError('Upgrade planning lifecycle operations must be callable');
  }
  try {
    return await plan();
  } catch (failure) {
    if (!(failure instanceof CompilerError)) throw failure;
    return publishUpgradeFailureArtifacts(
      failure,
      [
        () => operations.clearPlan.call(operations),
        () => operations.clearExecutionTerminal.call(operations),
        () => operations.publishDiagnostics.call(operations, failure)
      ],
      'Upgrade planning failed and failure artifact publication did not complete'
    );
  }
}
