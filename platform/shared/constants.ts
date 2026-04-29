import type { AcceptanceItem } from './acceptance-types.ts';
import type { PassStatus } from './lock-types.ts';

export const SUPPORTED_STACK = 'nextjs-ts-prisma-sqlite' as const;

export const PASS_SEQUENCE = [
  'parse',
  'align',
  'resolve',
  'compose',
  'adapt',
  'verify',
  'repair',
  'lock',
  'emit'
] as const;

export const PASS_STATUS_PENDING: PassStatus = Object.freeze({
  parse: 'pending',
  align: 'pending',
  resolve: 'pending',
  compose: 'pending',
  adapt: 'pending',
  verify: 'pending',
  repair: 'skipped',
  lock: 'pending',
  emit: 'pending'
});

export const KIND_PRIORITY = Object.freeze<Record<string, number>>({
  infra: 0,
  governance: 1,
  capability: 2,
  strategy: 3
});

export const DEFAULT_ACCEPTANCE: readonly AcceptanceItem[] = Object.freeze([
  { id: 'user_can_login' },
  { id: 'user_can_create_customer' },
  { id: 'user_can_list_customers' },
  { id: 'tenant_only_sees_own_customers' }
]);

export const ERROR_CODE_PREFIX_MAP = Object.freeze<Record<string, string>>({
  PARSE: 'parse/',
  MANIFEST: 'parse/',
  ALIGN: 'align/',
  RESOLVE: 'resolve/',
  COMPOSE: 'compose/',
  SLOT: 'synthesize/',
  ADAPT: 'synthesize/',
  VERIFY: 'verify/',
  REPAIR: 'repair/',
  UPGRADE: 'upgrade/',
  LOCK: 'emit/',
  EMIT: 'emit/',
  OVERRIDE: 'compose/',
  WORKBENCH: 'workbench/'
} as const);

export const PASS_DEPENDENCIES = Object.freeze<Record<string, string[]>>({
  parse: [],
  align: ['parse'],
  resolve: ['align'],
  compose: ['resolve'],
  adapt: ['compose'],
  verify: ['adapt'],
  repair: ['verify'],
  lock: ['adapt'],
  emit: ['lock']
} as const);
