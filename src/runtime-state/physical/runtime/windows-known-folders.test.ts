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

test.skipIf(process.platform !== 'win32')(
  'Windows identity comes from the OS Known Folder rather than ambient environment',
  async () => {
    const originalSystemRoot = process.env.SYSTEMROOT;
    const originalWindir = process.env.WINDIR;
    try {
      process.env.SYSTEMROOT = String.raw`C:\ambient-system-root-must-not-authorize`;
      process.env.WINDIR = String.raw`C:\ambient-windir-must-not-authorize`;
      const windows = await resolveWindowsKnownFolderPath('windows');
      expect(path.win32.isAbsolute(windows)).toBe(true);
      expect(path.win32.resolve(windows)).toBe(windows);
      expect(windows).not.toBe(process.env.SYSTEMROOT);
      expect(windows).not.toBe(process.env.WINDIR);
    } finally {
      if (originalSystemRoot === undefined) delete process.env.SYSTEMROOT;
      else process.env.SYSTEMROOT = originalSystemRoot;
      if (originalWindir === undefined) delete process.env.WINDIR;
      else process.env.WINDIR = originalWindir;
    }
  }
);
