export function upgradeFailureWithSecondaryFailures(
  primary: Error,
  secondaryFailures: readonly unknown[],
  message: string
): Error {
  if (secondaryFailures.length === 0) return primary;
  return new AggregateError(
    [primary, ...secondaryFailures],
    `${message}: ${primary.message}`,
    { cause: primary }
  );
}

export function throwUpgradeFailureWithSecondaryFailures(
  primary: Error,
  secondaryFailures: readonly unknown[],
  message: string
): never {
  throw upgradeFailureWithSecondaryFailures(primary, secondaryFailures, message);
}
