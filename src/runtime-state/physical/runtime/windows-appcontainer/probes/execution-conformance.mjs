const stdinText = await Bun.stdin.text();
process.stdout.write('appcontainer-execution-stdout-marker');
process.stderr.write('appcontainer-execution-stderr-marker');
await Bun.write('execution-conformance-result.json', JSON.stringify({
  ciExact: process.env.CI === 'true',
  isolatedVerificationExact: process.env.SEC_ISOLATED_VERIFICATION === '1',
  pathExact: process.env.PATH === '',
  stdinEof: stdinText === '',
  systemRootPresent: typeof process.env.SYSTEMROOT === 'string' && process.env.SYSTEMROOT.length > 0,
  windirPresent: typeof process.env.WINDIR === 'string' && process.env.WINDIR.length > 0
}));
