import { deepFreeze, sha256 } from '../../../contracts/canonical.ts';
import { readVerificationDataRecord, snapshotVerificationData } from './data.ts';
import {
  createVerificationSpecificationBinding,
  type VerificationSpecificationBinding
} from './specification.ts';

/** Canonical test responsibility data. Validation is not author approval. */
export interface VerificationTestResponsibility {
  readonly schema: 'verification-test-responsibility-v1';
  readonly testRef: string;
  readonly testRevision: string;
  readonly ownerRef: string;
  readonly bindings: readonly Readonly<{
    readonly specification: VerificationSpecificationBinding;
    readonly failureMeaning: string;
    readonly observationBoundary: string;
    readonly oracleAndIndependenceRefs: readonly string[];
  }>[];
  readonly environmentAndResourceRequirementsDigest: `sha256:${string}`;
  readonly impactAndLifecycleDigest: `sha256:${string}`;
  readonly retirementConditionsDigest: `sha256:${string}`;
  readonly responsibilityDigest: `sha256:${string}`;
}

type ResponsibilityInput = Omit<VerificationTestResponsibility,
  'schema' | 'responsibilityDigest'>;

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} fields are invalid`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096
      || value.trim() !== value || value.normalize('NFC') !== value
      || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)) {
    throw new Error(`${label} requires bounded canonical text`);
  }
  return value;
}

function digest(value: unknown, label: string): `sha256:${string}` {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)
      || value === `sha256:${'0'.repeat(64)}`) {
    throw new Error(`${label} requires a non-placeholder digest`);
  }
  return value as `sha256:${string}`;
}

const INPUT_KEYS = [
  'testRef', 'testRevision', 'ownerRef', 'bindings',
  'environmentAndResourceRequirementsDigest', 'impactAndLifecycleDigest',
  'retirementConditionsDigest'
] as const;

export function createVerificationTestResponsibility(input: ResponsibilityInput): VerificationTestResponsibility {
  const value = readVerificationDataRecord(
    snapshotVerificationData(input, 'Test responsibility'), 'Test responsibility'
  );
  exactKeys(value, INPUT_KEYS, 'Test responsibility');
  if (!Array.isArray(value.bindings) || value.bindings.length === 0 || value.bindings.length > 128) {
    throw new Error('Test responsibility requires a bounded non-empty obligation binding set');
  }
  const ownerRef = text(value.ownerRef, 'Test responsibility ownerRef');
  const bindings = value.bindings.map((raw) => {
    const binding = readVerificationDataRecord(raw, 'Test responsibility binding');
    exactKeys(binding, [
      'specification', 'failureMeaning', 'observationBoundary', 'oracleAndIndependenceRefs'
    ], 'Test responsibility binding');
    const specificationData = readVerificationDataRecord(
      binding.specification, 'Test responsibility specification'
    );
    exactKeys(specificationData, [
      'schema', 'claim', 'proofObligation', 'methodSelection', 'bindingDigest'
    ], 'Test responsibility specification');
    const specification = createVerificationSpecificationBinding({
      claim: specificationData.claim as VerificationSpecificationBinding['claim'],
      proofObligation: specificationData.proofObligation as VerificationSpecificationBinding['proofObligation'],
      methodSelection: specificationData.methodSelection as VerificationSpecificationBinding['methodSelection']
    });
    if (specificationData.schema !== specification.schema
        || specificationData.bindingDigest !== specification.bindingDigest) {
      throw new Error('Test responsibility does not bind the exact specification');
    }
    if (!Array.isArray(binding.oracleAndIndependenceRefs)
        || binding.oracleAndIndependenceRefs.length === 0
        || binding.oracleAndIndependenceRefs.length > 128) {
      throw new Error('Test responsibility requires bounded oracle/independence references');
    }
    const oracleAndIndependenceRefs = binding.oracleAndIndependenceRefs
      .map((ref) => text(ref, 'Test responsibility oracle reference')).sort();
    if (new Set(oracleAndIndependenceRefs).size !== oracleAndIndependenceRefs.length) {
      throw new Error('Test responsibility oracle references must be unique');
    }
    return deepFreeze({
      specification,
      failureMeaning: text(binding.failureMeaning, 'Test responsibility failureMeaning'),
      observationBoundary: text(binding.observationBoundary, 'Test responsibility observationBoundary'),
      oracleAndIndependenceRefs
    });
  }).sort((left, right) => left.specification.bindingDigest < right.specification.bindingDigest ? -1 : 1);
  if (new Set(bindings.map(({ specification }) => specification.bindingDigest)).size !== bindings.length) {
    throw new Error('Test responsibility specification bindings must be unique');
  }
  const canonical = deepFreeze({
    schema: 'verification-test-responsibility-v1' as const,
    testRef: text(value.testRef, 'Test responsibility testRef'),
    testRevision: text(value.testRevision, 'Test responsibility testRevision'),
    ownerRef,
    bindings,
    environmentAndResourceRequirementsDigest: digest(
      value.environmentAndResourceRequirementsDigest, 'Test responsibility environment/resources'
    ),
    impactAndLifecycleDigest: digest(value.impactAndLifecycleDigest, 'Test responsibility lifecycle'),
    retirementConditionsDigest: digest(value.retirementConditionsDigest, 'Test responsibility retirement')
  });
  return deepFreeze({ ...canonical, responsibilityDigest: sha256(canonical) as `sha256:${string}` });
}

/** Revalidate persisted data through the same canonical owner, without issuing approval. */
export function parseVerificationTestResponsibility(input: unknown): VerificationTestResponsibility {
  const value = readVerificationDataRecord(
    snapshotVerificationData(input, 'Test responsibility'), 'Test responsibility'
  );
  exactKeys(value, ['schema', ...INPUT_KEYS, 'responsibilityDigest'], 'Test responsibility');
  const { schema, responsibilityDigest, ...fields } = value;
  const canonical = createVerificationTestResponsibility(fields as unknown as ResponsibilityInput);
  if (schema !== canonical.schema || responsibilityDigest !== canonical.responsibilityDigest) {
    throw new Error('Test responsibility schema or digest is invalid');
  }
  return canonical;
}
