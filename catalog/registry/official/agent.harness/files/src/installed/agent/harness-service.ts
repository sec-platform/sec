import type { Database } from '../../runtime/database.ts';
import type { Session } from '../auth/session.ts';
import { currentTenant } from '../tenant/context.ts';

export interface AIAgentInput {
  name: string;
  role: string;
  allowedZones: string; // comma separated, e.g. "tickets,comments"
}

export interface AIAgentRecord extends AIAgentInput {
  id: number;
  tenantId: string;
  isActive: boolean;
}

declare module '../../runtime/database.ts' {
  interface Database {
    nextAgentId?: number;
    agents?: AIAgentRecord[];
  }
}

function getAgentsTable(db: Database): AIAgentRecord[] {
  return db.agents ??= [];
}

function useNextAgentId(db: Database): number {
  const nextId = db.nextAgentId ?? 1;
  db.nextAgentId = nextId + 1;
  return nextId;
}

export function registerAgent(db: Database, session: Session, input: AIAgentInput): AIAgentRecord {
  const tenantId = currentTenant(session);
  const agents = getAgentsTable(db);
  const nextId = useNextAgentId(db);

  const agent: AIAgentRecord = {
    id: nextId,
    tenantId,
    name: input.name.trim(),
    role: input.role.trim(),
    allowedZones: input.allowedZones.trim(),
    isActive: true
  };

  agents.push(agent);
  return agent;
}

export function listAgents(db: Database, session: Session): AIAgentRecord[] {
  const tenantId = currentTenant(session);
  return getAgentsTable(db).filter((agent) => agent.tenantId === tenantId);
}

export function verifyAgentZonePermission(db: Database, session: Session, agentId: number, zone: string): boolean {
  const tenantId = currentTenant(session);
  const agent = getAgentsTable(db).find(
    (candidate) => candidate.id === agentId && candidate.tenantId === tenantId
  );
  if (!agent?.isActive) return false;

  const zones = agent.allowedZones.split(',').map((entry) => entry.trim());
  return zones.includes(zone) || zones.includes('*');
}
