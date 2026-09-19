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
