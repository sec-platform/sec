const WINDOWS_RESERVED_DEVICE_NAME = /^(?:con|prn|aux|nul|(?:com|lpt)[1-9\u00b9\u00b2\u00b3])(?:\..*)?$/u;

/**
 * Logical identities that can become filesystem components must not acquire a
 * Windows device alias. Windows reserves these device stems even when a file
 * extension is appended (for example `con.txt`). The ISO-8859-1 superscript
 * digits 1, 2 and 3 also form reserved COM/LPT names in Win32. Callers own their domain
 * grammar; this helper owns only the cross-domain host-reserved-name fact.
 */
export function isWindowsReservedLogicalComponent(value: string): boolean {
  return WINDOWS_RESERVED_DEVICE_NAME.test(value.toLowerCase());
}
