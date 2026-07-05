export const SERIAL_FAST_TEST_FILES = [
  'tests/integration/project-runtime.test.ts'
] as const;

const serialFastTestFiles = new Set<string>(SERIAL_FAST_TEST_FILES);

export function partitionFastTestFiles(files: readonly string[]): {
  concurrent: string[];
  serial: string[];
} {
  const concurrent: string[] = [];
  const serial: string[] = [];

  for (const file of files) {
    if (serialFastTestFiles.has(file)) {
      serial.push(file);
    } else {
      concurrent.push(file);
    }
  }

  return { concurrent, serial };
}
