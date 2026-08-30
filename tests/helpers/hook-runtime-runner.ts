const marker = process.env.SEC_HOOK_RUNTIME_MARKER;
if (!marker) {
  throw new Error('SEC_HOOK_RUNTIME_MARKER is required');
}

const command = process.argv[2]?.replace(':', '-') ?? 'missing';
await Bun.write(`${marker}.${command}`, process.execPath);
