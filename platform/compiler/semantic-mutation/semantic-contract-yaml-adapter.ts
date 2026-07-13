import { createHash } from 'node:crypto';

import { isMap, isSeq, parseDocument, type Document, type Node, type YAMLSeq } from 'yaml';

import type {
  LoadedSemanticContract,
  SemanticContract,
  SemanticContractTransition
} from '../../shared/semantic-contract-types.ts';
import type {
  SemanticMutationOperationV1,
  SemanticMutationSourceLineEnding
} from '../../shared/semantic-mutation-types.ts';
import { normalizeSemanticContract } from '../parse/load-semantic-contract.ts';
import { SemanticMutationContractError, compareCodeUnits, mutationDiagnostic } from './canonical.ts';

export interface SemanticContractYamlTransformV1 {
  readonly stagedBytes: Uint8Array;
  readonly beforeByteDigest: string;
  readonly stagedByteDigest: string;
  readonly utf8Bom: boolean;
  readonly lineEnding: SemanticMutationSourceLineEnding;
  readonly finalNewline: boolean;
}

const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

export function semanticMutationByteDigest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function transformFailure(message: string, operationId?: string): never {
  throw new SemanticMutationContractError(mutationDiagnostic(
    'SEMANTIC-MUTATION-006',
    'transform',
    message,
    operationId === undefined ? undefined : { operationId }
  ));
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= UTF8_BOM.length && UTF8_BOM.every((byte, index) => bytes[index] === byte);
}

function decodeSource(bytes: Uint8Array): { text: string; utf8Bom: boolean } {
  const utf8Bom = hasUtf8Bom(bytes);
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(utf8Bom ? bytes.slice(UTF8_BOM.length) : bytes),
      utf8Bom
    };
  } catch {
    transformFailure('Semantic contract source must be valid UTF-8');
  }
}

function sourceStyle(text: string): {
  lineEnding: SemanticMutationSourceLineEnding;
  finalNewline: boolean;
} {
  const withoutCrLf = text.replaceAll('\r\n', '');
  if (withoutCrLf.includes('\r') || (text.includes('\r\n') && withoutCrLf.includes('\n'))) {
    transformFailure('Semantic contract source has mixed or unsupported line endings');
  }
  return {
    lineEnding: text.includes('\r\n') ? 'crlf' : text.includes('\n') ? 'lf' : 'none',
    finalNewline: text.endsWith('\n')
  };
}

function parseContractDocument(text: string): Document.Parsed {
  const document = parseDocument(text, { keepSourceTokens: true, strict: true, uniqueKeys: true });
  if (document.errors.length > 0) transformFailure('Semantic contract YAML is not a valid unique-key document');
  return document;
}

function normalizedDocument(document: Document.Parsed): SemanticContract {
  try {
    return normalizeSemanticContract(document.toJS() as SemanticContract);
  } catch {
    transformFailure('Semantic contract YAML does not satisfy the canonical contract schema');
  }
}

function transitionKey(transition: SemanticContractTransition): string {
  return [transition.from, transition.to, transition.by].join('\u0000');
}

function transitionFromNode(node: Node | null | undefined): SemanticContractTransition {
  const value = node?.toJSON() as Partial<SemanticContractTransition> | undefined;
  if (!value || typeof value.from !== 'string' || typeof value.to !== 'string' || typeof value.by !== 'string') {
    transformFailure('Semantic contract transition AST drifted from the canonical schema');
  }
  return { from: value.from, to: value.to, by: value.by };
}

function transitionSequence(document: Document.Parsed, stateIndex: number): YAMLSeq {
  const stateNode = document.getIn(['states', stateIndex], true);
  if (!isMap(stateNode)) transformFailure('Semantic contract states must remain YAML mappings');
  let transitions = document.getIn(['states', stateIndex, 'transitions'], true);
  if (transitions === undefined) {
    document.setIn(['states', stateIndex, 'transitions'], document.createNode([]));
    transitions = document.getIn(['states', stateIndex, 'transitions'], true);
  }
  if (!isSeq(transitions)) transformFailure('Semantic contract transitions must remain a YAML sequence');
  return transitions;
}

function applyOperation(
  document: Document.Parsed,
  contract: SemanticContract,
  operation: SemanticMutationOperationV1
): void {
  if (operation.contract.namespace !== contract.namespace || operation.contract.contractId !== contract.id) {
    transformFailure('Operation namespace or contract id does not match the loaded source', operation.operationId);
  }
  const matchingStates = contract.states
    .map((state, index) => ({ state, index }))
    .filter((entry) => entry.state.id === operation.stateId);
  if (matchingStates.length !== 1) {
    transformFailure('Operation state id does not resolve to exactly one YAML state', operation.operationId);
  }
  const state = matchingStates[0]!;
  const exact = state.state.transitions.filter((transition) =>
    transition.from === operation.from && transition.to === operation.to && transition.by === operation.by
  );
  const conflicting = state.state.transitions.filter((transition) =>
    transition.from === operation.from && transition.to === operation.to && transition.by !== operation.by
  );
  if (exact.length > 0 || conflicting.length > 0) {
    transformFailure('Operation transition already exists or conflicts in the current source', operation.operationId);
  }
  const transitions = transitionSequence(document, state.index);
  const transitionNode = document.createNode({
    from: operation.from,
    to: operation.to,
    by: operation.by
  });
  if (!isMap(transitionNode)) {
    transformFailure('Semantic contract transition could not be represented as a YAML mapping');
  }
  transitions.add(transitionNode);
  transitions.items.sort((left, right) => compareCodeUnits(
    transitionKey(transitionFromNode(left as Node)),
    transitionKey(transitionFromNode(right as Node))
  ));
  state.state.transitions.push({ from: operation.from, to: operation.to, by: operation.by });
  state.state.transitions.sort((left, right) => compareCodeUnits(transitionKey(left), transitionKey(right)));
}

function encodedDocument(
  document: Document.Parsed,
  utf8Bom: boolean,
  lineEnding: SemanticMutationSourceLineEnding,
  finalNewline: boolean
): Uint8Array {
  let text = document.toString();
  if (!finalNewline) text = text.replace(/\n$/u, '');
  if (lineEnding === 'crlf') text = text.replaceAll('\n', '\r\n');
  const body = new TextEncoder().encode(text);
  if (!utf8Bom) return body;
  const withBom = new Uint8Array(UTF8_BOM.length + body.length);
  withBom.set(UTF8_BOM);
  withBom.set(body, UTF8_BOM.length);
  return withBom;
}

function transformSemanticContractYamlInternal(
  bytes: Uint8Array,
  loadedContract: LoadedSemanticContract | undefined,
  operations: readonly SemanticMutationOperationV1[]
): SemanticContractYamlTransformV1 {
  const { text, utf8Bom } = decodeSource(bytes);
  const { lineEnding, finalNewline } = sourceStyle(text);
  const document = parseContractDocument(text);
  const before = normalizedDocument(document);
  if (loadedContract !== undefined && JSON.stringify(before) !== JSON.stringify(loadedContract.contract)) {
    transformFailure('Current YAML bytes do not match the loaded canonical contract provenance');
  }
  const expected = structuredClone(before);
  for (const operation of operations) applyOperation(document, expected, operation);
  const stagedBytes = encodedDocument(document, utf8Bom, lineEnding, finalNewline);
  const stagedText = decodeSource(stagedBytes).text;
  const after = normalizedDocument(parseContractDocument(stagedText));
  if (JSON.stringify(after) !== JSON.stringify(expected)) {
    transformFailure('YAML transform changed content outside the requested transition set');
  }
  return {
    stagedBytes,
    beforeByteDigest: semanticMutationByteDigest(bytes),
    stagedByteDigest: semanticMutationByteDigest(stagedBytes),
    utf8Bom,
    lineEnding,
    finalNewline
  };
}

export function transformSemanticContractYaml(
  bytes: Uint8Array,
  loadedContract: LoadedSemanticContract,
  operations: readonly SemanticMutationOperationV1[]
): SemanticContractYamlTransformV1 {
  return transformSemanticContractYamlInternal(bytes, loadedContract, operations);
}

export function renderSemanticContractYamlEdit(
  bytes: Uint8Array,
  operations: readonly SemanticMutationOperationV1[]
): SemanticContractYamlTransformV1 {
  return transformSemanticContractYamlInternal(bytes, undefined, operations);
}
