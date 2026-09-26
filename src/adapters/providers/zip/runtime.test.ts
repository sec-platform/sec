import { expect, test } from 'bun:test';

import { readZipTextFile } from './runtime.ts';

const SINGLE_FILE_ZIP = Buffer.from(
  'UEsDBAoAAAAAAFt4OF2IQX/CDAAAAAwAAAAMABwAcGF5bG9hZC5qc29uVVQJAAOdO7VqnTu1anV4CwABBAAAAAAEAAAAAHsib2siOnRydWV9ClBLAQIeAwoAAAAAAFt4OF2IQX/CDAAAAAwAAAAMABgAAAAAAAEAAACkgQAAAABwYXlsb2FkLmpzb25VVAUAA507tWp1eAsAAQQAAAAABAAAAABQSwUGAAAAAAEAAQBSAAAAUgAAAAAA',
  'base64'
);

test('ZIP text provider reads only the exact safe member', async () => {
  await expect(readZipTextFile({ archiveBytes: SINGLE_FILE_ZIP, expectedFileName: 'payload.json' }))
    .resolves.toBe('{"ok":true}\n');
  await expect(readZipTextFile({ archiveBytes: SINGLE_FILE_ZIP, expectedFileName: 'other.json' }))
    .rejects.toThrow('exact single expected member');
});

test('ZIP text provider rejects malformed names and archive bytes before extraction', async () => {
  await expect(readZipTextFile({ archiveBytes: SINGLE_FILE_ZIP, expectedFileName: '../payload.json' }))
    .rejects.toThrow('expected member name is invalid');
  await expect(readZipTextFile({ archiveBytes: new Uint8Array([1, 2, 3]), expectedFileName: 'payload.json' }))
    .rejects.toThrow('unzip failed');
});
