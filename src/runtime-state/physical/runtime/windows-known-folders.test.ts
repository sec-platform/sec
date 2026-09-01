import path from 'node:path';

import { expect, test } from 'bun:test';

import { resolveWindowsKnownFolderPath } from './windows-known-folders.ts';

test.skipIf(process.platform !== 'win32')(
  'Program Files identity comes from the OS Known Folder rather than ambient environment',
  async () => {
    const original = process.env.PROGRAMFILES;
    try {
      process.env.PROGRAMFILES = String.raw`C:\ambient-redirect-must-not-authorize`;
      const programFiles = await resolveWindowsKnownFolderPath('program-files');
      expect(path.win32.isAbsolute(programFiles)).toBe(true);
      expect(path.win32.resolve(programFiles)).toBe(programFiles);
      expect(programFiles).not.toBe(process.env.PROGRAMFILES);
    } finally {
      if (original === undefined) delete process.env.PROGRAMFILES;
      else process.env.PROGRAMFILES = original;
    }
  }
);
