import type { GeneratedStateCleanupContinuationReceipt, GeneratedStateDisposalReceipt } from './contract.ts';
export interface GeneratedStateNativeTerminalEvidence { readonly kind: 'generated-state-native-terminal-evidence'; }
type TerminalReceipt = GeneratedStateDisposalReceipt | GeneratedStateCleanupContinuationReceipt;
const receipts = new WeakMap<object, Readonly<{ receipt: TerminalReceipt; nativeEvidence: GeneratedStateNativeTerminalEvidence }>>();
function freezeDeep<Value>(value: Value): Value {
  if (value !== null && typeof value === 'object') { Object.values(value).forEach(freezeDeep); Object.freeze(value); }
  return value;
}
export function issueGeneratedStateTerminalReceipt<Value extends TerminalReceipt>(receipt: Value,
  nativeEvidence: GeneratedStateNativeTerminalEvidence): Value {
  const retained = freezeDeep(structuredClone(receipt));
  receipts.set(retained, Object.freeze({ receipt: retained, nativeEvidence }));
  return retained;
}
export function inspectIssuedGeneratedStateTerminalReceipt<Value extends TerminalReceipt>(receipt: Value) {
  const original = receipts.get(receipt);
  if (original === undefined) throw new Error('Generated-state terminal receipt was not issued by its owner.');
  return original;
}
