import { compareCodeUnits, deepFreeze } from '../../../../contracts/canonical.ts';
import {
  SEC_DEVELOPMENT_CRITICAL_PATH_REVISION,
  criticalPathRef,
  failCriticalPath,
  uniqueSortedCriticalPathRefs
} from './common.ts';

export interface OperationalTerminalProjectionV1 {
  readonly schema: 'sec-critical-path-operational-terminal-v1';
  readonly revision: typeof SEC_DEVELOPMENT_CRITICAL_PATH_REVISION;
  readonly operationalState: 'terminal' | 'blocked';
  readonly physicalClean: boolean;
  readonly gcState: 'completed' | 'pending' | 'blocked';
  /** Blockers to business/session operational terminal. */
  readonly blockerRefs: readonly string[];
  /** Physical-settlement blockers remain visible without blocking unrelated business progress. */
  readonly gcBlockerRefs: readonly string[];
  readonly reasonCodes: readonly string[];
}

function terminalState<State extends string>(
  value: State,
  allowed: readonly State[],
  label: string
): State {
  if (!allowed.includes(value)) failCriticalPath(`${label} state is invalid.`);
  return value;
}

export function compileOperationalTerminalProjectionV1(input: Readonly<{
  namespace: Readonly<{
    state: 'detached' | 'active' | 'unknown';
    observationRef: string;
  }>;
  dependencies: readonly Readonly<{
    ownerRef: string;
    state: 'terminal' | 'active' | 'unknown';
    receiptRef: string;
  }>[];
  residue: Readonly<{
    state: 'absent' | 'exact-owned-quarantine' | 'foreign' | 'unknown';
    observationRef: string;
  }>;
  retirementAuthorization: Readonly<{
    state: 'not-required' | 'authorized' | 'missing' | 'unknown';
    authorityRef: string;
  }>;
  gcSettlement: Readonly<{
    state: 'completed' | 'pending' | 'blocked' | 'unknown';
    settlementRef: string;
  }>;
}>): OperationalTerminalProjectionV1 {
  const namespaceRef = criticalPathRef(input.namespace.observationRef, 'namespace.observationRef');
  const residueRef = criticalPathRef(input.residue.observationRef, 'residue.observationRef');
  const authorityRef = criticalPathRef(
    input.retirementAuthorization.authorityRef,
    'retirementAuthorization.authorityRef'
  );
  const settlementRef = criticalPathRef(
    input.gcSettlement.settlementRef,
    'gcSettlement.settlementRef'
  );
  const namespaceState = terminalState(
    input.namespace.state,
    ['detached', 'active', 'unknown'] as const,
    'namespace'
  );
  const residueState = terminalState(
    input.residue.state,
    ['absent', 'exact-owned-quarantine', 'foreign', 'unknown'] as const,
    'residue'
  );
  const retirementState = terminalState(
    input.retirementAuthorization.state,
    ['not-required', 'authorized', 'missing', 'unknown'] as const,
    'retirementAuthorization'
  );
  const gcState = terminalState(
    input.gcSettlement.state,
    ['completed', 'pending', 'blocked', 'unknown'] as const,
    'gcSettlement'
  );
  const dependencies = input.dependencies.map((value, index) => Object.freeze({
    ownerRef: criticalPathRef(value.ownerRef, `dependencies[${index}].ownerRef`),
    state: terminalState(
      value.state,
      ['terminal', 'active', 'unknown'] as const,
      `dependencies[${index}]`
    ),
    receiptRef: criticalPathRef(value.receiptRef, `dependencies[${index}].receiptRef`)
  })).sort((left, right) => compareCodeUnits(left.ownerRef, right.ownerRef));
  if (new Set(dependencies.map(({ ownerRef }) => ownerRef)).size !== dependencies.length) {
    failCriticalPath('dependencies contain a duplicate ownerRef.');
  }

  if (residueState === 'absent') {
    if (retirementState !== 'not-required' || gcState !== 'completed') {
      failCriticalPath(
        'absent residue requires not-required retirement authorization and completed GC.'
      );
    }
  } else if (residueState === 'exact-owned-quarantine') {
    if (retirementState !== 'authorized' && retirementState !== 'missing'
        && retirementState !== 'unknown') {
      failCriticalPath('owned quarantine requires retirement authorization state.');
    }
    if (gcState === 'completed') {
      failCriticalPath('quarantined residue cannot simultaneously report completed physical GC.');
    }
  }

  const reasons: string[] = [];
  const blockers: string[] = [];
  if (namespaceState === 'active') {
    reasons.push('namespace-active');
    blockers.push(namespaceRef);
  } else if (namespaceState === 'unknown') {
    reasons.push('namespace-unknown');
    blockers.push(namespaceRef);
  }
  for (const dependency of dependencies) {
    if (dependency.state === 'active') {
      reasons.push('dependency-active');
      blockers.push(dependency.receiptRef);
    } else if (dependency.state === 'unknown') {
      reasons.push('dependency-unknown');
      blockers.push(dependency.receiptRef);
    }
  }
  if (residueState === 'foreign') {
    reasons.push('foreign-residue');
    blockers.push(residueRef);
  } else if (residueState === 'unknown') {
    reasons.push('residue-unknown');
    blockers.push(residueRef);
  } else if (residueState === 'exact-owned-quarantine') {
    if (retirementState === 'missing') {
      reasons.push('retirement-authorization-missing');
      blockers.push(authorityRef);
    } else if (retirementState === 'unknown') {
      reasons.push('retirement-authorization-unknown');
      blockers.push(authorityRef);
    }
  }
  if (gcState === 'unknown') {
    reasons.push('gc-settlement-unknown');
    blockers.push(settlementRef);
  }

  if (blockers.length > 0) {
    return deepFreeze({
      schema: 'sec-critical-path-operational-terminal-v1',
      revision: SEC_DEVELOPMENT_CRITICAL_PATH_REVISION,
      operationalState: 'blocked',
      physicalClean: false,
      gcState: 'blocked',
      blockerRefs: uniqueSortedCriticalPathRefs(blockers),
      gcBlockerRefs: gcState === 'blocked' ? [settlementRef] : [],
      reasonCodes: uniqueSortedCriticalPathRefs(reasons)
    });
  }

  if (residueState === 'absent') {
    return deepFreeze({
      schema: 'sec-critical-path-operational-terminal-v1',
      revision: SEC_DEVELOPMENT_CRITICAL_PATH_REVISION,
      operationalState: 'terminal',
      physicalClean: true,
      gcState: 'completed',
      blockerRefs: [],
      gcBlockerRefs: [],
      reasonCodes: ['physical-clean']
    });
  }

  return deepFreeze({
    schema: 'sec-critical-path-operational-terminal-v1',
    revision: SEC_DEVELOPMENT_CRITICAL_PATH_REVISION,
    operationalState: 'terminal',
    physicalClean: false,
    gcState: gcState === 'pending' ? 'pending' : 'blocked',
    blockerRefs: [],
    gcBlockerRefs: gcState === 'blocked' ? [settlementRef] : [],
    reasonCodes: [
      gcState === 'pending'
        ? 'operational-terminal-gc-pending'
        : 'operational-terminal-gc-blocked'
    ]
  });
}
