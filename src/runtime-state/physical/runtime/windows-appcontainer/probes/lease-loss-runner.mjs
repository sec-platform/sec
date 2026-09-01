import path from 'node:path';

const bunConfigPath = path.join(path.dirname(process.execPath), 'bunfig.toml');
const descendant = Bun.spawn([
  process.execPath,
  '--no-env-file',
  '--config=' + bunConfigPath,
  '--no-install',
  '-e',
  'setInterval(() => {}, 1000)'
], {
  cwd: process.cwd(),
  env: process.env,
  stdin: 'ignore',
  stdout: 'ignore',
  stderr: 'ignore'
});
await Bun.write('lease-loss-marker.json', JSON.stringify({
  processId: process.pid,
  descendantProcessId: descendant.pid
}));
await new Promise(() => {});
