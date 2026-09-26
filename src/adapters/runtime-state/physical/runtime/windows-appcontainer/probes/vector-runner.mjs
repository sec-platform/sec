import path from 'node:path';

const NESTED_EXIT = Object.freeze({
  argumentParsing: 52,
  isolationAssertion: 43,
  moduleInitialization: 51,
  resultPublication: 55,
  sentinelExecution: 54
});

let probeLoopbackNetwork;
try {
  ({ probeLoopbackNetwork } = await import('./network-probe.mjs'));
} catch {
  process.exit(NESTED_EXIT.moduleInitialization);
}

const probeArguments = process.argv.slice(2);
if (probeArguments.some((argument) => argument !== '--spawned-probe') ||
  probeArguments.filter((argument) => argument === '--spawned-probe').length > 1) {
  process.exit(NESTED_EXIT.argumentParsing);
}

const PARENT_CANARY_NAMES = Object.freeze([
  '.appcontainer-host-read-canary',
  '.appcontainer-host-read-canary-v1'
]);
const OUTER_CANARY_NAMES = Object.freeze([
  '.appcontainer-outer-host-read-canary',
  '.appcontainer-outer-host-read-canary-v1'
]);

async function canReadCanary(relativeSegments, names) {
  for (const name of names) {
    try {
      await Bun.file(path.resolve(process.cwd(), ...relativeSegments, name)).text();
      return true;
    } catch {}
  }
  return false;
}

async function runSpawnedProbe() {
  const result = {
    insideWrite: false,
    outsideWrite: false,
    parentRead: false,
    outerRead: false,
    fetchConnect: false,
    rawConnect: false
  };
  try { await Bun.write(path.resolve(process.cwd(), 'spawned-inside.txt'), 'inside'); result.insideWrite = true; } catch {}
  try { await Bun.write(path.resolve(process.cwd(), '..', 'spawned-outside.txt'), 'outside'); result.outsideWrite = true; } catch {}
  result.parentRead = await canReadCanary(['..'], PARENT_CANARY_NAMES);
  result.outerRead = await canReadCanary(['..', '..'], OUTER_CANARY_NAMES);
  try {
    const network = await probeLoopbackNetwork({
      httpPort: process.env.SEC_APPCONTAINER_PROBE_HTTP_PORT,
      rawPort: process.env.SEC_APPCONTAINER_PROBE_RAW_PORT
    });
    result.fetchConnect = network.fetchConnect;
    result.rawConnect = network.rawConnect;
  } catch {
    return NESTED_EXIT.sentinelExecution;
  }
  const isolated = result.insideWrite && !result.outsideWrite && !result.parentRead &&
    !result.outerRead && !result.fetchConnect && !result.rawConnect;
  try {
    await Bun.write(path.resolve(process.cwd(), 'spawned-result.json'), JSON.stringify(result));
  } catch {
    return NESTED_EXIT.resultPublication;
  }
  return isolated ? 0 : NESTED_EXIT.isolationAssertion;
}

// CLI argv selects a probe vector; AppContainer capability is established by the parent executor.
// codeql[js/user-controlled-bypass]
if (process.argv.at(-1) === '--spawned-probe') {
  process.exit(await runSpawnedProbe());
}

const direct = {
  insideWrite: false,
  outsideWrite: false,
  parentRead: false,
  outerRead: false,
  fetchConnect: false,
  rawConnect: false
};
try { await Bun.write(path.resolve(process.cwd(), 'direct-inside.txt'), 'inside'); direct.insideWrite = true; } catch {}
try { await Bun.write(path.resolve(process.cwd(), '..', 'direct-outside.txt'), 'outside'); direct.outsideWrite = true; } catch {}
direct.parentRead = await canReadCanary(['..'], PARENT_CANARY_NAMES);
direct.outerRead = await canReadCanary(['..', '..'], OUTER_CANARY_NAMES);
const network = await probeLoopbackNetwork({
  httpPort: process.env.SEC_APPCONTAINER_PROBE_HTTP_PORT,
  rawPort: process.env.SEC_APPCONTAINER_PROBE_RAW_PORT
});
direct.fetchConnect = network.fetchConnect;
direct.rawConnect = network.rawConnect;

const bunConfigPath = path.join(path.dirname(process.execPath), 'bunfig.toml');
const spawnedRunnerPath = path.resolve(process.cwd(), 'vector-runner.mjs');
const spawnedStdoutFile = Bun.file(path.resolve(process.cwd(), '.spawned-probe-stdout'));
const spawnedStderrFile = Bun.file(path.resolve(process.cwd(), '.spawned-probe-stderr'));

async function captureBounded(file, maximumBytes) {
  const byteLength = file.size;
  const bytes = new Uint8Array(await file.slice(0, maximumBytes).arrayBuffer());
  return Object.freeze({ bytes, overflow: byteLength > maximumBytes });
}

function nestedDiagnostic(stdout, stderr, exitCode) {
  const diagnosticBytes = new Uint8Array(stdout.bytes.byteLength + 1 + stderr.bytes.byteLength);
  diagnosticBytes.set(stdout.bytes, 0);
  diagnosticBytes[stdout.bytes.byteLength] = 0;
  diagnosticBytes.set(stderr.bytes, stdout.bytes.byteLength + 1);
  const digest = `sha256:${new Bun.CryptoHasher('sha256').update(diagnosticBytes).digest('hex')}`;
  if (stdout.overflow || stderr.overflow) return Object.freeze({ classification: 'output-limit', digest });
  if (exitCode === 0) return Object.freeze({ classification: 'none', digest });
  if (exitCode === 1) return Object.freeze({ classification: 'runtime-bootstrap', digest });
  if (exitCode === NESTED_EXIT.moduleInitialization) {
    return Object.freeze({ classification: 'module-initialization', digest });
  }
  if (exitCode === NESTED_EXIT.argumentParsing) {
    return Object.freeze({ classification: 'argument-parsing', digest });
  }
  if (exitCode === NESTED_EXIT.isolationAssertion) {
    return Object.freeze({ classification: 'isolation-assertion', digest });
  }
  if (exitCode === NESTED_EXIT.sentinelExecution) {
    return Object.freeze({ classification: 'nested-sentinel', digest });
  }
  if (exitCode === NESTED_EXIT.resultPublication) {
    return Object.freeze({ classification: 'result-publication', digest });
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(stderr.bytes).toLocaleLowerCase('en-US');
  if (text.includes('module not found') || text.includes('cannot find module') ||
    text.includes('failed to resolve module')) {
    return Object.freeze({ classification: 'module-resolution', digest });
  }
  if (text.includes('syntaxerror') || text.includes('syntax error')) {
    return Object.freeze({ classification: 'syntax', digest });
  }
  if (text.length === 0 && stdout.bytes.byteLength === 0) {
    return Object.freeze({ classification: 'empty-nonzero', digest });
  }
  return Object.freeze({ classification: 'runtime', digest });
}

const spawned = Bun.spawn([
  process.execPath,
  '--no-env-file',
  '--config=' + bunConfigPath,
  '--no-install',
  spawnedRunnerPath,
  '--spawned-probe'
], {
  cwd: process.cwd(),
  env: process.env,
  stdin: 'ignore',
  stdout: spawnedStdoutFile,
  stderr: spawnedStderrFile
});
const spawnedExitCode = await spawned.exited;
const [stdoutCapture, stderrCapture] = await Promise.all([
  captureBounded(spawnedStdoutFile, 4096),
  captureBounded(spawnedStderrFile, 4096)
]);
const spawnedDiagnostic = nestedDiagnostic(stdoutCapture, stderrCapture, spawnedExitCode);
await Promise.all([spawnedStdoutFile.delete(), spawnedStderrFile.delete()]);
let spawnedResult = null;
try { spawnedResult = JSON.parse(await Bun.file(path.resolve(process.cwd(), 'spawned-result.json')).text()); } catch {}
const report = { direct, spawnedDiagnostic, spawnedExitCode, spawned: spawnedResult };
await Bun.write(path.resolve(process.cwd(), 'capability-result.json'), JSON.stringify(report));
const ok = direct.insideWrite && !direct.outsideWrite && !direct.parentRead && !direct.outerRead &&
  !direct.fetchConnect && !direct.rawConnect && spawnedExitCode === 0 &&
  spawnedResult?.insideWrite && !spawnedResult?.outsideWrite && !spawnedResult?.parentRead &&
  !spawnedResult?.outerRead && !spawnedResult?.fetchConnect && !spawnedResult?.rawConnect;
process.exit(ok ? 0 : 44);
