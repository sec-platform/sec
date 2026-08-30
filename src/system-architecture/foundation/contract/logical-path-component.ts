const WINDOWS_RESERVED_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/u;

/**
 * Logical identities that can become filesystem components must not acquire a
 * Windows device alias. Windows reserves these device stems even when a file
 * extension is appended (for example `con.txt`). Callers own their domain
 * grammar; this helper owns only the cross-domain host-reserved-name fact.
 */
export function isWindowsReservedLogicalComponent(value: string): boolean {
  return WINDOWS_RESERVED_DEVICE_NAME.test(value.toLowerCase());
}
