import path from 'node:path';
import type { GeneratedStateCleanupIntent } from '../../../execution/generated-state/journal-port.ts';
import { parseGeneratedStateCleanupIntentBytes } from './journal-codec.ts';
import { registrationKey, type GeneratedStateRuntimeStore } from './registration-store.ts';

/** Read-only access shared by journal publication and native Effect admission. */
export function transactionPointerPath(store: GeneratedStateRuntimeStore, relativePath: string): string {
  return path.join(store.transactionsRoot, `current-${registrationKey(relativePath)}.json`);
}

export function loadCleanupIntent(store: GeneratedStateRuntimeStore, relativePath: string): GeneratedStateCleanupIntent | null {
  const locator = transactionPointerPath(store, relativePath);
  return store.fs.exists(locator) ? parseGeneratedStateCleanupIntentBytes(store.fs.readText(locator), relativePath) : null;
}
