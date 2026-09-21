import net from 'node:net';

/**
 * @typedef {Readonly<{
 *   fetchConnect: boolean;
 *   rawConnect: boolean;
 * }>} LoopbackNetworkProbeResult
 */

function canonicalPort(value, label) {
  const port = typeof value === 'string' && /^(?:[1-9]\d{0,4})$/u.test(value)
    ? Number(value)
    : Number.NaN;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${label} is not one canonical TCP port`);
  }
  return port;
}

async function rawConnect(port) {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 800);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/**
 * Executes the shared HTTP and raw-socket loopback probe. Invalid authority
 * inputs throw instead of being projected as an isolated network result.
 *
 * @param {Readonly<{ httpPort: unknown; rawPort: unknown }>} input
 * @returns {Promise<LoopbackNetworkProbeResult>}
 */
export async function probeLoopbackNetwork(input) {
  const httpPort = canonicalPort(input.httpPort, 'HTTP probe port');
  const rawPort = canonicalPort(input.rawPort, 'raw probe port');
  let fetchConnect = false;
  try {
    const response = await fetch(`http://127.0.0.1:${httpPort}/probe`, {
      signal: AbortSignal.timeout(800)
    });
    fetchConnect = response.ok;
  } catch {}
  const rawConnectResult = await rawConnect(rawPort);
  return Object.freeze({
    fetchConnect,
    rawConnect: rawConnectResult
  });
}
