export function isTestImpactSourceFile(file: string): boolean {
  return (
    /^(platform|scripts)\/.+\.[cm]?[tj]sx?$/u.test(file) ||
    /^platform\/registry\/.+\/block\.manifest\.ya?ml$/u.test(file) ||
    /^platform\/registry\/.+\/contracts\/.+\.ya?ml$/u.test(file) ||
    /^source\/model\/.+\.ya?ml$/u.test(file)
  );
}
