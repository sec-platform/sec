import { Buffer } from 'node:buffer';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const WINDOWS_BROWSER_EXECUTABLE_RELATIVE_PATH =
  'chromium_headless_shell-1217/chrome-headless-shell-win64/chrome-headless-shell.exe';

export async function createWindowsBrowserLaunchFixture(): Promise<Readonly<{
  browserRoot: string;
  executablePath: string;
  root: string;
  temporaryRoot: string;
}>> {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-browser-launch-test-'));
  const browserRoot = path.join(root, 'physical-browser-cache');
  const executablePath = path.join(
    browserRoot,
    ...WINDOWS_BROWSER_EXECUTABLE_RELATIVE_PATH.split('/')
  );
  const temporaryRoot = path.join(root, 'temporary-authority');
  await Promise.all([
    mkdir(path.dirname(executablePath), { recursive: true }),
    mkdir(temporaryRoot, { recursive: true })
  ]);
  await writeFile(executablePath, Buffer.from('exact-browser-executable'));
  return Object.freeze({ browserRoot, executablePath, root, temporaryRoot });
}
