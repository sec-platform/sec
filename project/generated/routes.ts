export interface GeneratedRoute {
  blockId: string;
  path: string;
  file: string;
}

export const routes: GeneratedRoute[] = [
  { blockId: 'auth/basic-session', path: '/login', file: 'src/installed/auth/session.ts' },
  { blockId: 'tenant/basic-workspace', path: '/workspace', file: 'src/installed/tenant/context.ts' },
  { blockId: 'entity/customer-basic', path: '/customers', file: 'src/installed/entity/customer-service.ts' }
];
