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
