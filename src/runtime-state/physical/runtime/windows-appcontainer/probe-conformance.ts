import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createRawServer, type Server as RawServer } from 'node:net';
import path from 'node:path';

export type WindowsAppContainerProbeCapability =
  | Readonly<{ status: 'available' }>
  | Readonly<{ status: 'unavailable' }>;

export type WindowsAppContainerNestedChildDiagnosticClass =
  | 'argument-parsing'
  | 'empty-nonzero'
  | 'isolation-assertion'
  | 'module-resolution'
  | 'module-initialization'
  | 'nested-sentinel'
  | 'none'
  | 'output-limit'
  | 'result-publication'
  | 'runtime'
  | 'runtime-bootstrap'
  | 'syntax';

export interface WindowsAppContainerNestedChildDiagnostic {
  readonly classification: WindowsAppContainerNestedChildDiagnosticClass;
  readonly digest: `sha256:${string}`;
}

export interface WindowsAppContainerProbeReportObservation {
  readonly isolated: boolean;
  readonly spawnedDiagnostic: WindowsAppContainerNestedChildDiagnostic;
  readonly spawnedExitCode: number;
  readonly spawnedResultPresent: boolean;
}

export interface WindowsAppContainerProbeConformanceServerLease {
  readonly httpPort: number;
  readonly rawPort: number;
  connectionAttempts(): Readonly<{ http: number; raw: number }>;
  close(): Promise<void>;
}

function listen(server: HttpServer | RawServer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}

function close(server: HttpServer | RawServer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function closeSettled(server: HttpServer | RawServer): Promise<void> {
  if (!server.listening) return;
  await close(server);
}

/**
 * Test-provider owner for the loopback endpoints used only to prove that an
 * AppContainer child cannot reach either HTTP or raw sockets.
 */
export async function acquireWindowsAppContainerProbeConformanceServersForTests(
): Promise<WindowsAppContainerProbeConformanceServerLease> {
  let httpConnections = 0;
  let rawConnections = 0;
  const httpServer = createHttpServer((_incoming, response) => {
    httpConnections += 1;
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('reachable');
  });
  const rawServer = createRawServer((socket) => {
    rawConnections += 1;
    socket.destroy();
  });
  try {
    await Promise.all([listen(httpServer), listen(rawServer)]);
    const httpAddress = httpServer.address();
    const rawAddress = rawServer.address();
    if (!httpAddress || typeof httpAddress === 'string' ||
      !rawAddress || typeof rawAddress === 'string') {
      throw new Error('Windows AppContainer probe server address is unavailable');
    }
    let closed = false;
    return Object.freeze({
      httpPort: httpAddress.port,
      rawPort: rawAddress.port,
      connectionAttempts: (): Readonly<{ http: number; raw: number }> => Object.freeze({
        http: httpConnections,
        raw: rawConnections
      }),
      close: async (): Promise<void> => {
        if (closed) return;
        const results = await Promise.allSettled([
          closeSettled(httpServer),
          closeSettled(rawServer)
        ]);
        const rejected = results.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected'
        );
        if (rejected) throw rejected.reason;
        closed = true;
      }
    });
  } catch (error) {
    await Promise.allSettled([closeSettled(httpServer), closeSettled(rawServer)]);
    throw error;
  }
}

export function buildWindowsAppContainerProbeEnvironmentForTests(
  source: Readonly<Record<string, string>>,
  stagingRoot: string,
  httpPort: number,
  rawPort: number
): Readonly<Record<string, string>> {
  const processRoot = path.join(stagingRoot, '.process');
  const home = path.join(processRoot, 'home');
  const environment: Record<string, string> = {
    ...source,
    PATH: '',
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(processRoot, 'appdata'),
    LOCALAPPDATA: path.join(processRoot, 'localappdata'),
    TEMP: path.join(processRoot, 'tmp'),
    TMP: path.join(processRoot, 'tmp'),
    TMPDIR: path.join(processRoot, 'tmp'),
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
    SEC_APPCONTAINER_PROBE_HTTP_PORT: String(httpPort),
    SEC_APPCONTAINER_PROBE_RAW_PORT: String(rawPort)
  };
  if (environment.BUN_INSTALL_CACHE_DIR !== undefined) {
    environment.BUN_INSTALL_CACHE_DIR = path.join(processRoot, 'bun-install-cache');
  }
  return Object.freeze(environment);
}

function exactObjectKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  return actual.length === canonical.length &&
    actual.every((key, index) => key === canonical[index]);
}

const NESTED_CHILD_DIAGNOSTIC_CLASSES = new Set<WindowsAppContainerNestedChildDiagnosticClass>([
  'argument-parsing',
  'empty-nonzero',
  'isolation-assertion',
  'module-initialization',
  'module-resolution',
  'nested-sentinel',
  'none',
  'output-limit',
  'result-publication',
  'runtime',
  'runtime-bootstrap',
  'syntax'
]);

export function observeWindowsAppContainerProbeReportForTests(
  value: unknown
): WindowsAppContainerProbeReportObservation | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    !exactObjectKeys(value, ['direct', 'spawned', 'spawnedDiagnostic', 'spawnedExitCode'])) {
    return undefined;
  }
  const report = value as Record<string, unknown>;
  if (!Number.isSafeInteger(report.spawnedExitCode) || Number(report.spawnedExitCode) < 0 ||
    !report.spawnedDiagnostic || typeof report.spawnedDiagnostic !== 'object' ||
    Array.isArray(report.spawnedDiagnostic) ||
    !exactObjectKeys(report.spawnedDiagnostic, ['classification', 'digest'])) {
    return undefined;
  }
  const diagnosticRecord = report.spawnedDiagnostic as Record<string, unknown>;
  if (!NESTED_CHILD_DIAGNOSTIC_CLASSES.has(
    diagnosticRecord.classification as WindowsAppContainerNestedChildDiagnosticClass
  ) || typeof diagnosticRecord.digest !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/u.test(diagnosticRecord.digest)) {
    return undefined;
  }
  const diagnostic = Object.freeze({
    classification: diagnosticRecord.classification as WindowsAppContainerNestedChildDiagnosticClass,
    digest: diagnosticRecord.digest as `sha256:${string}`
  });
  if ((Number(report.spawnedExitCode) === 0) !== (diagnostic.classification === 'none')) {
    return undefined;
  }
  const vectorLooksValid = (candidate: unknown): boolean => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) ||
      !exactObjectKeys(candidate, [
        'fetchConnect',
        'insideWrite',
        'outerRead',
        'outsideWrite',
        'parentRead',
        'rawConnect'
      ])) {
      return false;
    }
    const vector = candidate as Record<string, unknown>;
    return vector.insideWrite === true && vector.outsideWrite === false &&
      vector.parentRead === false && vector.outerRead === false &&
      vector.fetchConnect === false && vector.rawConnect === false;
  };
  return Object.freeze({
    isolated: vectorLooksValid(report.direct) && vectorLooksValid(report.spawned) &&
      report.spawnedExitCode === 0,
    spawnedDiagnostic: diagnostic,
    spawnedExitCode: Number(report.spawnedExitCode),
    spawnedResultPresent: report.spawned !== null && typeof report.spawned === 'object' &&
      !Array.isArray(report.spawned)
  });
}

export function windowsAppContainerProbeReportIsIsolatedForTests(value: unknown): boolean {
  return observeWindowsAppContainerProbeReportForTests(value)?.isolated === true;
}

export function redactWindowsAppContainerProbeCapabilityForTests(
  detailed: Readonly<{ status: 'available' | 'unavailable' }>
): WindowsAppContainerProbeCapability {
  return detailed.status === 'available'
    ? Object.freeze({ status: 'available' })
    : Object.freeze({ status: 'unavailable' });
}
