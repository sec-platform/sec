# Graph-It-Live Runtime Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Context Packet `runtimeEvidence` projection so Graph-It-Live can accelerate SEC development, review, and navigation without becoming a canonical graph or write-authority.

**Architecture:** Add provider-neutral `RuntimeEvidence` and minimal `ContextPacket` contracts under `platform/shared`, then add a synthesize-layer builder that copies task envelope write bounds without deriving permissions from evidence. Add a Graph-It-Live adapter that normalizes externally obtained MCP/raw results into runtime evidence and a summary/inspect surface that Overview/Workbench can consume as read-only navigation input.

**Tech Stack:** TypeScript, Bun test, existing `CONTRACT_FORMAT_VERSION`, existing `uniqueSorted` helper, no new dependencies, no Graph-It-Live CLI/MCP invocation from platform code.

---

## Scope Check

The spec covers one subsystem: a read-only runtime evidence projection for Context Packets. It has three consumers in mind—development context, review risk, and Overview/Workbench navigation—but they share the same `RuntimeEvidence` contract and summary surface, so this remains one implementation plan.

## File Structure

- Create `platform/shared/runtime-evidence-types.ts`
  - Owns provider-neutral runtime evidence constants, types, builder, normalization, and summary.
- Create `platform/shared/context-packet-types.ts`
  - Owns minimal Context Packet types and inspection shape.
- Create `platform/compiler/synthesize/build-context-packet.ts`
  - Builds Context Packets from `TaskEnvelope` plus optional runtime evidence.
  - Copies write bounds only from `TaskEnvelope`.
- Create `platform/shared/graph-it-live-runtime-evidence.ts`
  - Normalizes externally obtained Graph-It-Live raw/codemap/reference/impact/provider diagnostic shapes into `RuntimeEvidence[]`.
  - Does not call MCP, CLI, network, or filesystem.
- Modify `platform/shared/types.ts`
  - Re-export new public types for existing shared-type import style.
- Modify `docs/09-AI Runtime、任务信封与治理规范.md`
  - Record that the implemented first Context Packet slice is `task + writeBounds + runtimeEvidence`.
- Modify `docs/11-Workbench与可视化规范.md`
  - Record that Overview/Workbench consume runtime evidence only through summary/inspect surfaces.
- Create `tests/unit/runtime-evidence.test.ts`
- Create `tests/unit/context-packet.test.ts`
- Create `tests/unit/graph-it-live-runtime-evidence.test.ts`

---

### Task 1: RuntimeEvidence contract and summary

**Files:**
- Create: `tests/unit/runtime-evidence.test.ts`
- Create: `platform/shared/runtime-evidence-types.ts`
- Modify: `platform/shared/types.ts:147`

- [ ] **Step 1: Write the failing runtime evidence test**

Create `tests/unit/runtime-evidence.test.ts` with this content:

```ts
import { expect, test } from 'bun:test';

import {
  buildRuntimeEvidence,
  summarizeRuntimeEvidence
} from '../../platform/shared/runtime-evidence-types.ts';

test('buildRuntimeEvidence normalizes read-only provider evidence', () => {
  const evidence = buildRuntimeEvidence({
    provider: 'graph-it-live',
    kind: 'code-context',
    confidence: 'high',
    targetFiles: [
      'platform/shared/tool-evidence-contract.ts',
      'platform/shared/tool-evidence-contract.ts'
    ],
    relatedFiles: [
      'platform/shared/tool-evidence-adapters.ts',
      '',
      'tests/unit/tool-evidence-contract.test.ts'
    ],
    symbols: [
      'function=buildToolEvidenceReport@platform/shared/tool-evidence-contract.ts:113',
      'function=buildToolEvidenceReport@platform/shared/tool-evidence-contract.ts:113',
      'function=formatToolEvidenceReport@platform/shared/tool-evidence-contract.ts:157'
    ],
    diagnostics: [
      {
        id: 'codemap-tool-evidence',
        severity: 'info',
        title: 'Graph-It-Live code context',
        message: 'Graph-It-Live found exports and direct dependents.',
        filePaths: [
          'platform/shared/tool-evidence-contract.ts',
          'platform/shared/tool-evidence-adapters.ts'
        ],
        evidence: ['exports=2', 'dependents=1', 'exports=2']
      }
    ],
    rawQueryIds: ['codemap:tool-evidence', 'codemap:tool-evidence'],
    rawReportPaths: ['report/graph-it-live/tool-evidence.json']
  });

  expect(evidence).toMatchObject({
    formatVersion: '1',
    provider: 'graph-it-live',
    kind: 'code-context',
    stableArtifact: false,
    confidence: 'high',
    targetFileCount: 1,
    relatedFileCount: 2,
    symbolCount: 2,
    diagnosticCount: 1,
    rawQueryIdCount: 1,
    rawReportPathCount: 1
  });
  expect(evidence.targetFiles).toEqual(['platform/shared/tool-evidence-contract.ts']);
  expect(evidence.relatedFiles).toEqual([
    'platform/shared/tool-evidence-adapters.ts',
    'tests/unit/tool-evidence-contract.test.ts'
  ]);
  expect(evidence.diagnostics[0]).toMatchObject({
    filePathCount: 2,
    evidenceCount: 2,
    evidence: ['dependents=1', 'exports=2']
  });
});

test('summarizeRuntimeEvidence exposes navigation counts without write authority', () => {
  const evidence = [
    buildRuntimeEvidence({
      provider: 'graph-it-live',
      kind: 'impact-hint',
      confidence: 'medium',
      targetFiles: ['platform/shared/tool-evidence-contract.ts'],
      relatedFiles: [
        'platform/shared/tool-evidence-adapters.ts',
        'tests/unit/tool-evidence-contract.test.ts'
      ],
      symbols: ['function=buildToolEvidenceReport'],
      diagnostics: [
        {
          id: 'impact-build-tool-evidence-report',
          severity: 'warning',
          title: 'Graph-It-Live impact hint',
          message: 'Changing buildToolEvidenceReport affects adapter tests.',
          filePaths: ['tests/unit/tool-evidence-contract.test.ts'],
          evidence: ['risk=medium']
        }
      ],
      rawQueryIds: ['impact:buildToolEvidenceReport']
    }),
    buildRuntimeEvidence({
      provider: 'graph-it-live',
      kind: 'navigation-hint',
      confidence: 'high',
      targetFiles: ['platform/shared/tool-evidence-contract.ts'],
      relatedFiles: ['platform/shared/tool-evidence-adapters.ts'],
      symbols: [],
      diagnostics: [],
      rawQueryIds: ['references:tool-evidence-contract']
    })
  ];

  const summary = summarizeRuntimeEvidence(evidence);

  expect(summary).toEqual({
    providerCount: 1,
    providers: ['graph-it-live'],
    evidenceItemCount: 2,
    targetFileCount: 1,
    relatedFileCount: 2,
    diagnosticCount: 1,
    topRelatedFiles: [
      'platform/shared/tool-evidence-adapters.ts',
      'tests/unit/tool-evidence-contract.test.ts'
    ]
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test tests/unit/runtime-evidence.test.ts
```

Expected: FAIL because `platform/shared/runtime-evidence-types.ts` does not exist.

- [ ] **Step 3: Implement RuntimeEvidence contract**

Create `platform/shared/runtime-evidence-types.ts` with this content:

```ts
import { uniqueSorted } from './collections.ts';
import { CONTRACT_FORMAT_VERSION } from './constants.ts';

export const RUNTIME_EVIDENCE_PROVIDERS = ['graph-it-live'] as const;
export const RUNTIME_EVIDENCE_KINDS = [
  'code-context',
  'impact-hint',
  'review-risk',
  'navigation-hint'
] as const;
export const RUNTIME_EVIDENCE_CONFIDENCES = ['high', 'medium', 'low'] as const;
export const RUNTIME_EVIDENCE_DIAGNOSTIC_SEVERITIES = ['info', 'warning', 'error'] as const;

export type RuntimeEvidenceProvider = (typeof RUNTIME_EVIDENCE_PROVIDERS)[number];
export type RuntimeEvidenceKind = (typeof RUNTIME_EVIDENCE_KINDS)[number];
export type RuntimeEvidenceConfidence = (typeof RUNTIME_EVIDENCE_CONFIDENCES)[number];
export type RuntimeEvidenceDiagnosticSeverity = (typeof RUNTIME_EVIDENCE_DIAGNOSTIC_SEVERITIES)[number];

export interface RuntimeEvidenceDiagnosticInput {
  id: string;
  severity: RuntimeEvidenceDiagnosticSeverity;
  title: string;
  message: string;
  filePaths?: readonly string[];
  evidence?: readonly string[];
}

export interface RuntimeEvidenceDiagnostic extends Required<RuntimeEvidenceDiagnosticInput> {
  filePathCount: number;
  evidenceCount: number;
  filePaths: string[];
  evidence: string[];
}

export interface RuntimeEvidenceInput {
  provider: RuntimeEvidenceProvider;
  kind: RuntimeEvidenceKind;
  confidence: RuntimeEvidenceConfidence;
  targetFiles: readonly string[];
  relatedFiles?: readonly string[];
  symbols?: readonly string[];
  diagnostics?: readonly RuntimeEvidenceDiagnosticInput[];
  rawReportPaths?: readonly string[];
  rawQueryIds?: readonly string[];
}

export interface RuntimeEvidence {
  formatVersion: typeof CONTRACT_FORMAT_VERSION;
  provider: RuntimeEvidenceProvider;
  kind: RuntimeEvidenceKind;
  stableArtifact: false;
  confidence: RuntimeEvidenceConfidence;
  targetFileCount: number;
  targetFiles: string[];
  relatedFileCount: number;
  relatedFiles: string[];
  symbolCount: number;
  symbols: string[];
  diagnosticCount: number;
  diagnostics: RuntimeEvidenceDiagnostic[];
  rawReportPathCount: number;
  rawReportPaths: string[];
  rawQueryIdCount: number;
  rawQueryIds: string[];
}

export interface RuntimeEvidenceSummary {
  providerCount: number;
  providers: RuntimeEvidenceProvider[];
  evidenceItemCount: number;
  targetFileCount: number;
  relatedFileCount: number;
  diagnosticCount: number;
  topRelatedFiles: string[];
}

function buildRuntimeEvidenceDiagnostic(input: RuntimeEvidenceDiagnosticInput): RuntimeEvidenceDiagnostic {
  const filePaths = uniqueSorted(input.filePaths ?? []);
  const evidence = uniqueSorted(input.evidence ?? []);

  return {
    id: input.id,
    severity: input.severity,
    title: input.title,
    message: input.message,
    filePathCount: filePaths.length,
    filePaths,
    evidenceCount: evidence.length,
    evidence
  };
}

export function buildRuntimeEvidence(input: RuntimeEvidenceInput): RuntimeEvidence {
  const targetFiles = uniqueSorted(input.targetFiles);
  const relatedFiles = uniqueSorted(input.relatedFiles ?? []);
  const symbols = uniqueSorted(input.symbols ?? []);
  const diagnostics = [...(input.diagnostics ?? [])]
    .map(buildRuntimeEvidenceDiagnostic)
    .sort((left, right) => left.id.localeCompare(right.id));
  const rawReportPaths = uniqueSorted(input.rawReportPaths ?? []);
  const rawQueryIds = uniqueSorted(input.rawQueryIds ?? []);

  return {
    formatVersion: CONTRACT_FORMAT_VERSION,
    provider: input.provider,
    kind: input.kind,
    stableArtifact: false,
    confidence: input.confidence,
    targetFileCount: targetFiles.length,
    targetFiles,
    relatedFileCount: relatedFiles.length,
    relatedFiles,
    symbolCount: symbols.length,
    symbols,
    diagnosticCount: diagnostics.length,
    diagnostics,
    rawReportPathCount: rawReportPaths.length,
    rawReportPaths,
    rawQueryIdCount: rawQueryIds.length,
    rawQueryIds
  };
}

function relatedFileRank(evidence: readonly RuntimeEvidence[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of evidence) {
    for (const filePath of entry.relatedFiles) {
      counts.set(filePath, (counts.get(filePath) ?? 0) + 1);
    }
  }
  return counts;
}

export function summarizeRuntimeEvidence(evidence: readonly RuntimeEvidence[]): RuntimeEvidenceSummary {
  const providers = uniqueSorted(evidence.map((entry) => entry.provider));
  const targetFiles = uniqueSorted(evidence.flatMap((entry) => entry.targetFiles));
  const relatedFiles = uniqueSorted(evidence.flatMap((entry) => entry.relatedFiles));
  const diagnosticCount = evidence.reduce((count, entry) => count + entry.diagnosticCount, 0);
  const ranks = relatedFileRank(evidence);
  const topRelatedFiles = [...relatedFiles]
    .sort((left, right) => (ranks.get(right) ?? 0) - (ranks.get(left) ?? 0) || left.localeCompare(right))
    .slice(0, 5);

  return {
    providerCount: providers.length,
    providers,
    evidenceItemCount: evidence.length,
    targetFileCount: targetFiles.length,
    relatedFileCount: relatedFiles.length,
    diagnosticCount,
    topRelatedFiles
  };
}
```

- [ ] **Step 4: Re-export RuntimeEvidence types**

Modify `platform/shared/types.ts` near the existing `TaskEnvelope` export so it includes:

```ts
export type {
  RuntimeEvidence,
  RuntimeEvidenceConfidence,
  RuntimeEvidenceDiagnostic,
  RuntimeEvidenceDiagnosticInput,
  RuntimeEvidenceDiagnosticSeverity,
  RuntimeEvidenceInput,
  RuntimeEvidenceKind,
  RuntimeEvidenceProvider,
  RuntimeEvidenceSummary
} from './runtime-evidence-types.ts';
export type { TaskEnvelope } from './task-envelope-types.ts';
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
bun test tests/unit/runtime-evidence.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add -- platform/shared/runtime-evidence-types.ts platform/shared/types.ts tests/unit/runtime-evidence.test.ts
git commit -m "feat: add runtime evidence contract"
```

---

### Task 2: Context Packet builder and inspect summary

**Files:**
- Create: `tests/unit/context-packet.test.ts`
- Create: `platform/shared/context-packet-types.ts`
- Create: `platform/compiler/synthesize/build-context-packet.ts`
- Modify: `platform/shared/types.ts:147`

- [ ] **Step 1: Write the failing Context Packet test**

Create `tests/unit/context-packet.test.ts` with this content:

```ts
import { expect, test } from 'bun:test';

import {
  buildContextPacket,
  inspectContextPacket
} from '../../platform/compiler/synthesize/build-context-packet.ts';
import { buildRuntimeEvidence } from '../../platform/shared/runtime-evidence-types.ts';
import type { TaskEnvelope } from '../../platform/shared/task-envelope-types.ts';

const envelope: TaskEnvelope = {
  taskId: 'fill_slot_customer_normalizer',
  taskKind: 'adapter-slot',
  phase: 'adapt',
  targetBlock: 'customer.basic-profile',
  targetFile: 'source/code/slots/customer_normalizer.ts',
  sourceSlot: {
    id: 'customer_normalizer',
    status: 'generated',
    runtimeTarget: 'project/custom/customer_normalizer.ts',
    sourcePath: 'source/code/slots/customer_normalizer.ts',
    writableZones: ['source/code/slots/customer_normalizer.ts'],
    provenanceHints: {
      generator: 'mock-local-synthesizer',
      verifiedBy: []
    }
  },
  allowedPaths: ['source/code/slots/customer_normalizer.ts'],
  requiredSymbols: ['normalizeCustomerInput'],
  forbiddenOperations: [
    'modify_other_files',
    'add_dependencies',
    'access_database',
    'change_exports'
  ],
  inputContracts: {
    description: 'Normalize customer input before persistence.',
    inputType: 'CustomerInput',
    outputType: 'NormalizedCustomerInput'
  },
  testsToPass: [
    'tests/unit/customer-normalizer.test.ts',
    'tests/acceptance/customer-flow.test.ts'
  ],
  budget: {
    maxAttempts: 2,
    timeoutSeconds: 90,
    maxTokens: 16000
  },
  expectedOutput: {
    type: 'source-file',
    language: 'typescript'
  },
  lockSummary: {
    blocks: ['customer.basic-profile']
  }
};

test('buildContextPacket defaults to empty runtime evidence', () => {
  const packet = buildContextPacket(envelope);

  expect(packet).toMatchObject({
    formatVersion: '1',
    task: envelope,
    runtimeEvidence: [],
    writeBounds: {
      allowedPaths: ['source/code/slots/customer_normalizer.ts'],
      requiredSymbols: ['normalizeCustomerInput'],
      forbiddenOperations: [
        'modify_other_files',
        'add_dependencies',
        'access_database',
        'change_exports'
      ]
    }
  });
});

test('runtime evidence cannot expand Context Packet write bounds', () => {
  const evidence = buildRuntimeEvidence({
    provider: 'graph-it-live',
    kind: 'impact-hint',
    confidence: 'medium',
    targetFiles: ['source/code/slots/customer_normalizer.ts'],
    relatedFiles: ['platform/shared/tool-evidence-contract.ts'],
    symbols: ['function=buildToolEvidenceReport'],
    diagnostics: [
      {
        id: 'impact-tool-evidence-contract',
        severity: 'warning',
        title: 'Graph-It-Live impact hint',
        message: 'Related file is review context only, not a writable path.',
        filePaths: ['platform/shared/tool-evidence-contract.ts'],
        evidence: ['risk=medium']
      }
    ],
    rawQueryIds: ['impact:tool-evidence-contract']
  });

  const packet = buildContextPacket(envelope, { runtimeEvidence: [evidence] });

  expect(packet.writeBounds.allowedPaths).toEqual(['source/code/slots/customer_normalizer.ts']);
  expect(packet.runtimeEvidence[0].relatedFiles).toEqual(['platform/shared/tool-evidence-contract.ts']);
  expect(packet.writeBounds.allowedPaths).not.toContain('platform/shared/tool-evidence-contract.ts');
});

test('inspectContextPacket summarizes evidence separately from allowed paths', () => {
  const evidence = buildRuntimeEvidence({
    provider: 'graph-it-live',
    kind: 'navigation-hint',
    confidence: 'high',
    targetFiles: ['source/code/slots/customer_normalizer.ts'],
    relatedFiles: ['tests/unit/customer-normalizer.test.ts'],
    symbols: ['function=normalizeCustomerInput'],
    diagnostics: [],
    rawQueryIds: ['references:customer-normalizer']
  });
  const packet = buildContextPacket(envelope, { runtimeEvidence: [evidence] });
  const inspection = inspectContextPacket(packet);

  expect(inspection).toMatchObject({
    taskId: 'fill_slot_customer_normalizer',
    targetFile: 'source/code/slots/customer_normalizer.ts',
    allowedPathCount: 1,
    runtimeEvidenceSummary: {
      providerCount: 1,
      evidenceItemCount: 1,
      relatedFileCount: 1,
      topRelatedFiles: ['tests/unit/customer-normalizer.test.ts']
    }
  });
  expect(inspection.summaryLines).toContain('Allowed paths: source/code/slots/customer_normalizer.ts');
  expect(inspection.summaryLines).toContain('Related files are read-only navigation hints: tests/unit/customer-normalizer.test.ts');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test tests/unit/context-packet.test.ts
```

Expected: FAIL because `build-context-packet.ts` does not exist.

- [ ] **Step 3: Implement Context Packet types**

Create `platform/shared/context-packet-types.ts` with this content:

```ts
import type { RuntimeEvidence, RuntimeEvidenceSummary } from './runtime-evidence-types.ts';
import type { TaskEnvelope } from './task-envelope-types.ts';

export interface ContextPacketWriteBounds {
  allowedPaths: string[];
  forbiddenOperations: string[];
  requiredSymbols: string[];
}

export interface ContextPacket {
  formatVersion: string;
  task: TaskEnvelope;
  writeBounds: ContextPacketWriteBounds;
  runtimeEvidence: RuntimeEvidence[];
}

export interface BuildContextPacketOptions {
  runtimeEvidence?: readonly RuntimeEvidence[];
}

export interface ContextPacketInspection {
  taskId: string;
  targetFile: string;
  allowedPathCount: number;
  requiredSymbolCount: number;
  forbiddenOperationCount: number;
  runtimeEvidenceSummary: RuntimeEvidenceSummary;
  summaryLines: string[];
}
```

- [ ] **Step 4: Implement Context Packet builder and inspector**

Create `platform/compiler/synthesize/build-context-packet.ts` with this content:

```ts
import { CONTRACT_FORMAT_VERSION } from '../../shared/constants.ts';
import type {
  BuildContextPacketOptions,
  ContextPacket,
  ContextPacketInspection
} from '../../shared/context-packet-types.ts';
import type { RuntimeEvidence } from '../../shared/runtime-evidence-types.ts';
import { summarizeRuntimeEvidence } from '../../shared/runtime-evidence-types.ts';
import type { TaskEnvelope } from '../../shared/task-envelope-types.ts';

function runtimeEvidenceKey(evidence: RuntimeEvidence): string {
  return [
    evidence.provider,
    evidence.kind,
    evidence.confidence,
    evidence.targetFiles.join('|'),
    evidence.relatedFiles.join('|'),
    evidence.symbols.join('|'),
    evidence.rawQueryIds.join('|'),
    evidence.rawReportPaths.join('|')
  ].join('::');
}

function cloneRuntimeEvidence(evidence: RuntimeEvidence): RuntimeEvidence {
  return {
    ...evidence,
    targetFiles: [...evidence.targetFiles],
    relatedFiles: [...evidence.relatedFiles],
    symbols: [...evidence.symbols],
    diagnostics: evidence.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      filePaths: [...diagnostic.filePaths],
      evidence: [...diagnostic.evidence]
    })),
    rawReportPaths: [...evidence.rawReportPaths],
    rawQueryIds: [...evidence.rawQueryIds]
  };
}

function normalizeRuntimeEvidence(evidence: readonly RuntimeEvidence[]): RuntimeEvidence[] {
  const byKey = new Map<string, RuntimeEvidence>();
  for (const entry of evidence) {
    byKey.set(runtimeEvidenceKey(entry), cloneRuntimeEvidence(entry));
  }
  return [...byKey.values()].sort((left, right) => runtimeEvidenceKey(left).localeCompare(runtimeEvidenceKey(right)));
}

export function buildContextPacket(task: TaskEnvelope, options: BuildContextPacketOptions = {}): ContextPacket {
  return {
    formatVersion: CONTRACT_FORMAT_VERSION,
    task,
    writeBounds: {
      allowedPaths: [...task.allowedPaths],
      forbiddenOperations: [...task.forbiddenOperations],
      requiredSymbols: [...task.requiredSymbols]
    },
    runtimeEvidence: normalizeRuntimeEvidence(options.runtimeEvidence ?? [])
  };
}

export function inspectContextPacket(packet: ContextPacket): ContextPacketInspection {
  const runtimeEvidenceSummary = summarizeRuntimeEvidence(packet.runtimeEvidence);
  const relatedFiles = runtimeEvidenceSummary.topRelatedFiles.length > 0
    ? runtimeEvidenceSummary.topRelatedFiles.join(', ')
    : 'none';

  return {
    taskId: packet.task.taskId,
    targetFile: packet.task.targetFile,
    allowedPathCount: packet.writeBounds.allowedPaths.length,
    requiredSymbolCount: packet.writeBounds.requiredSymbols.length,
    forbiddenOperationCount: packet.writeBounds.forbiddenOperations.length,
    runtimeEvidenceSummary,
    summaryLines: [
      `Context packet ${packet.task.taskId}`,
      `Target file: ${packet.task.targetFile}`,
      `Allowed paths: ${packet.writeBounds.allowedPaths.join(', ') || 'none'}`,
      `Required symbols: ${packet.writeBounds.requiredSymbols.join(', ') || 'none'}`,
      `Forbidden operations: ${packet.writeBounds.forbiddenOperations.join(', ') || 'none'}`,
      `Runtime evidence: providers=${runtimeEvidenceSummary.providerCount}; items=${runtimeEvidenceSummary.evidenceItemCount}; diagnostics=${runtimeEvidenceSummary.diagnosticCount}`,
      `Related files are read-only navigation hints: ${relatedFiles}`
    ]
  };
}
```

- [ ] **Step 5: Re-export Context Packet types**

Modify `platform/shared/types.ts` near the runtime evidence and task envelope exports so it includes:

```ts
export type {
  BuildContextPacketOptions,
  ContextPacket,
  ContextPacketInspection,
  ContextPacketWriteBounds
} from './context-packet-types.ts';
export type {
  RuntimeEvidence,
  RuntimeEvidenceConfidence,
  RuntimeEvidenceDiagnostic,
  RuntimeEvidenceDiagnosticInput,
  RuntimeEvidenceDiagnosticSeverity,
  RuntimeEvidenceInput,
  RuntimeEvidenceKind,
  RuntimeEvidenceProvider,
  RuntimeEvidenceSummary
} from './runtime-evidence-types.ts';
export type { TaskEnvelope } from './task-envelope-types.ts';
```

- [ ] **Step 6: Run the test to verify it passes**

Run:

```bash
bun test tests/unit/context-packet.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add -- platform/shared/context-packet-types.ts platform/compiler/synthesize/build-context-packet.ts platform/shared/types.ts tests/unit/context-packet.test.ts
git commit -m "feat: add context packet runtime evidence projection"
```

---

### Task 3: Graph-It-Live runtime evidence adapter

**Files:**
- Create: `tests/unit/graph-it-live-runtime-evidence.test.ts`
- Create: `platform/shared/graph-it-live-runtime-evidence.ts`

- [ ] **Step 1: Write the failing Graph-It-Live adapter test**

Create `tests/unit/graph-it-live-runtime-evidence.test.ts` with this content:

```ts
import { expect, test } from 'bun:test';

import { buildGraphItLiveRuntimeEvidence } from '../../platform/shared/graph-it-live-runtime-evidence.ts';

test('converts Graph-It-Live codemap results into code context evidence', () => {
  const evidence = buildGraphItLiveRuntimeEvidence({
    codeMaps: [
      {
        targetFile: 'platform/shared/tool-evidence-contract.ts',
        exports: [
          { kind: 'function', name: 'buildToolEvidenceReport', filePath: 'platform/shared/tool-evidence-contract.ts', line: 113 },
          { kind: 'function', name: 'formatToolEvidenceReport', filePath: 'platform/shared/tool-evidence-contract.ts', line: 157 }
        ],
        imports: [
          { path: 'platform/shared/collections.ts' },
          { path: 'platform/shared/constants.ts' }
        ],
        dependents: [
          { path: 'platform/shared/tool-evidence-adapters.ts' },
          { path: 'tests/unit/tool-evidence-contract.test.ts' }
        ],
        callFlow: [
          { from: 'buildToolEvidenceReport', to: 'buildToolEvidenceSummary' },
          { from: 'formatToolEvidenceReport', to: 'inspectToolEvidenceReport' }
        ],
        rawQueryId: 'codemap:tool-evidence-contract'
      }
    ]
  });

  expect(evidence).toHaveLength(1);
  expect(evidence[0]).toMatchObject({
    provider: 'graph-it-live',
    kind: 'code-context',
    stableArtifact: false,
    confidence: 'high',
    targetFiles: ['platform/shared/tool-evidence-contract.ts'],
    relatedFiles: [
      'platform/shared/collections.ts',
      'platform/shared/constants.ts',
      'platform/shared/tool-evidence-adapters.ts',
      'tests/unit/tool-evidence-contract.test.ts'
    ],
    rawQueryIds: ['codemap:tool-evidence-contract']
  });
  expect(evidence[0].symbols).toEqual([
    'function=buildToolEvidenceReport@platform/shared/tool-evidence-contract.ts:113',
    'function=formatToolEvidenceReport@platform/shared/tool-evidence-contract.ts:157'
  ]);
  expect(evidence[0].diagnostics[0].evidence).toEqual([
    'call=buildToolEvidenceReport -> buildToolEvidenceSummary',
    'call=formatToolEvidenceReport -> inspectToolEvidenceReport',
    'dependents=2',
    'exports=2',
    'imports=2'
  ]);
});

test('converts references and impact results into navigation and review evidence', () => {
  const evidence = buildGraphItLiveRuntimeEvidence({
    references: [
      {
        targetFile: 'platform/shared/tool-evidence-contract.ts',
        referencingFiles: [
          'platform/shared/tool-evidence-adapters.ts',
          'tests/unit/tool-evidence-adapters.test.ts'
        ],
        symbols: ['buildToolEvidenceReport'],
        rawQueryId: 'references:tool-evidence-contract'
      }
    ],
    impacts: [
      {
        targetFile: 'platform/shared/tool-evidence-contract.ts',
        impactedFiles: [
          'platform/shared/project-overview.ts',
          'platform/compiler/emit/write-local-views.ts'
        ],
        impactedSymbols: [
          { kind: 'function', name: 'buildProjectOverview', filePath: 'platform/shared/project-overview.ts', line: 245 }
        ],
        risk: 'medium',
        depth: 2,
        rawQueryId: 'impact:tool-evidence-contract'
      }
    ]
  });

  expect(evidence.map((entry) => entry.kind)).toEqual(['navigation-hint', 'impact-hint']);
  expect(evidence[0]).toMatchObject({
    confidence: 'high',
    relatedFiles: [
      'platform/shared/tool-evidence-adapters.ts',
      'tests/unit/tool-evidence-adapters.test.ts'
    ]
  });
  expect(evidence[1]).toMatchObject({
    confidence: 'medium',
    relatedFiles: [
      'platform/compiler/emit/write-local-views.ts',
      'platform/shared/project-overview.ts'
    ]
  });
  expect(evidence[1].diagnostics[0]).toMatchObject({
    severity: 'warning',
    evidence: ['depth=2', 'impactedFiles=2', 'risk=medium']
  });
});

test('converts provider diagnostics without blocking Context Packet construction', () => {
  const evidence = buildGraphItLiveRuntimeEvidence({
    diagnostics: [
      {
        id: 'graph-it-live-call-graph-unavailable',
        severity: 'warning',
        title: 'Graph-It-Live call graph unavailable',
        message: 'extensionPath required for call graph WASM parsers',
        targetFile: 'platform/shared/tool-evidence-contract.ts',
        rawQueryId: 'callgraph:tool-evidence-contract'
      }
    ]
  });

  expect(evidence).toHaveLength(1);
  expect(evidence[0]).toMatchObject({
    provider: 'graph-it-live',
    kind: 'navigation-hint',
    confidence: 'low',
    stableArtifact: false,
    targetFiles: ['platform/shared/tool-evidence-contract.ts'],
    relatedFiles: [],
    rawQueryIds: ['callgraph:tool-evidence-contract']
  });
  expect(evidence[0].diagnostics[0]).toMatchObject({
    severity: 'warning',
    title: 'Graph-It-Live call graph unavailable'
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test tests/unit/graph-it-live-runtime-evidence.test.ts
```

Expected: FAIL because `graph-it-live-runtime-evidence.ts` does not exist.

- [ ] **Step 3: Implement Graph-It-Live adapter**

Create `platform/shared/graph-it-live-runtime-evidence.ts` with this content:

```ts
import { buildRuntimeEvidence, type RuntimeEvidence, type RuntimeEvidenceDiagnosticInput } from './runtime-evidence-types.ts';

type GraphItLiveFileRef = string | {
  path?: string;
  filePath?: string;
  file?: string;
};

type GraphItLiveSymbolRef = string | {
  kind?: string;
  name?: string;
  filePath?: string;
  file?: string;
  line?: number;
};

export interface GraphItLiveCallFlowRef {
  from?: string;
  to?: string;
}

export interface GraphItLiveCodeMapResult {
  targetFile?: string;
  filePath?: string;
  exports?: readonly GraphItLiveSymbolRef[];
  internals?: readonly GraphItLiveSymbolRef[];
  imports?: readonly GraphItLiveFileRef[];
  dependents?: readonly GraphItLiveFileRef[];
  callFlow?: readonly GraphItLiveCallFlowRef[];
  rawQueryId?: string;
  rawReportPath?: string;
}

export interface GraphItLiveReferencesResult {
  targetFile?: string;
  filePath?: string;
  referencingFiles?: readonly GraphItLiveFileRef[];
  dependents?: readonly GraphItLiveFileRef[];
  references?: readonly GraphItLiveFileRef[];
  symbols?: readonly GraphItLiveSymbolRef[];
  rawQueryId?: string;
  rawReportPath?: string;
}

export interface GraphItLiveImpactResult {
  targetFile?: string;
  filePath?: string;
  impactedFiles?: readonly GraphItLiveFileRef[];
  relatedFiles?: readonly GraphItLiveFileRef[];
  impactedSymbols?: readonly GraphItLiveSymbolRef[];
  risk?: string;
  depth?: number;
  rawQueryId?: string;
  rawReportPath?: string;
}

export interface GraphItLiveProviderDiagnosticResult {
  id: string;
  severity?: string;
  title: string;
  message: string;
  targetFile?: string;
  filePaths?: readonly GraphItLiveFileRef[];
  rawQueryId?: string;
  rawReportPath?: string;
}

export interface GraphItLiveRuntimeEvidenceInput {
  codeMaps?: readonly GraphItLiveCodeMapResult[];
  references?: readonly GraphItLiveReferencesResult[];
  impacts?: readonly GraphItLiveImpactResult[];
  diagnostics?: readonly GraphItLiveProviderDiagnosticResult[];
}

function compact(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

function fileRefPath(value: GraphItLiveFileRef | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.path ?? value.filePath ?? value.file ?? '';
}

function symbolLabel(symbol: GraphItLiveSymbolRef, fallbackFile = ''): string {
  if (typeof symbol === 'string') return symbol;
  const name = symbol.name ?? 'unknown';
  const kind = symbol.kind ?? 'symbol';
  const filePath = symbol.filePath ?? symbol.file ?? fallbackFile;
  const location = compact([filePath, symbol.line === undefined ? undefined : String(symbol.line)]).join(':');
  return location ? `${kind}=${name}@${location}` : `${kind}=${name}`;
}

function callFlowLabel(call: GraphItLiveCallFlowRef): string | undefined {
  if (!call.from && !call.to) return undefined;
  return `call=${call.from ?? 'unknown'} -> ${call.to ?? 'unknown'}`;
}

function targetFileOf(value: { targetFile?: string; filePath?: string }): string {
  return value.targetFile ?? value.filePath ?? '';
}

function normalizeSeverity(value?: string): RuntimeEvidenceDiagnosticInput['severity'] {
  if (value === 'error') return 'error';
  if (value === 'warning' || value === 'warn') return 'warning';
  return 'info';
}

function confidenceFromRisk(risk?: string): 'high' | 'medium' | 'low' {
  if (risk === 'high' || risk === 'critical') return 'high';
  if (risk === 'medium') return 'medium';
  return 'low';
}

function severityFromRisk(risk?: string): RuntimeEvidenceDiagnosticInput['severity'] {
  if (risk === 'high' || risk === 'critical' || risk === 'medium') return 'warning';
  return 'info';
}

function rawQueryIds(rawQueryId?: string): string[] {
  return rawQueryId ? [rawQueryId] : [];
}

function rawReportPaths(rawReportPath?: string): string[] {
  return rawReportPath ? [rawReportPath] : [];
}

function codeMapEvidence(result: GraphItLiveCodeMapResult): RuntimeEvidence {
  const targetFile = targetFileOf(result);
  const exports = result.exports ?? [];
  const imports = (result.imports ?? []).map(fileRefPath);
  const dependents = (result.dependents ?? []).map(fileRefPath);
  const callFlow = result.callFlow ?? [];

  return buildRuntimeEvidence({
    provider: 'graph-it-live',
    kind: 'code-context',
    confidence: 'high',
    targetFiles: [targetFile],
    relatedFiles: [...imports, ...dependents],
    symbols: exports.map((entry) => symbolLabel(entry, targetFile)),
    diagnostics: [
      {
        id: `graph-it-live-codemap-${targetFile || 'unknown'}`,
        severity: 'info',
        title: 'Graph-It-Live code context',
        message: `Graph-It-Live found ${exports.length} exports, ${imports.length} imports, and ${dependents.length} dependents.`,
        filePaths: [targetFile, ...dependents],
        evidence: compact([
          `dependents=${dependents.length}`,
          `exports=${exports.length}`,
          `imports=${imports.length}`,
          ...callFlow.map(callFlowLabel)
        ])
      }
    ],
    rawQueryIds: rawQueryIds(result.rawQueryId),
    rawReportPaths: rawReportPaths(result.rawReportPath)
  });
}

function referencesEvidence(result: GraphItLiveReferencesResult): RuntimeEvidence {
  const targetFile = targetFileOf(result);
  const relatedFiles = [
    ...(result.referencingFiles ?? []),
    ...(result.dependents ?? []),
    ...(result.references ?? [])
  ].map(fileRefPath);
  const symbols = (result.symbols ?? []).map((entry) => symbolLabel(entry, targetFile));

  return buildRuntimeEvidence({
    provider: 'graph-it-live',
    kind: 'navigation-hint',
    confidence: 'high',
    targetFiles: [targetFile],
    relatedFiles,
    symbols,
    diagnostics: [
      {
        id: `graph-it-live-references-${targetFile || 'unknown'}`,
        severity: 'info',
        title: 'Graph-It-Live navigation hint',
        message: `Graph-It-Live found ${relatedFiles.length} referencing or dependent files.`,
        filePaths: [targetFile, ...relatedFiles],
        evidence: [`references=${relatedFiles.length}`]
      }
    ],
    rawQueryIds: rawQueryIds(result.rawQueryId),
    rawReportPaths: rawReportPaths(result.rawReportPath)
  });
}

function impactEvidence(result: GraphItLiveImpactResult): RuntimeEvidence {
  const targetFile = targetFileOf(result);
  const relatedFiles = [
    ...(result.impactedFiles ?? []),
    ...(result.relatedFiles ?? [])
  ].map(fileRefPath);
  const risk = result.risk ?? 'unknown';

  return buildRuntimeEvidence({
    provider: 'graph-it-live',
    kind: 'impact-hint',
    confidence: confidenceFromRisk(result.risk),
    targetFiles: [targetFile],
    relatedFiles,
    symbols: (result.impactedSymbols ?? []).map((entry) => symbolLabel(entry, targetFile)),
    diagnostics: [
      {
        id: `graph-it-live-impact-${targetFile || 'unknown'}`,
        severity: severityFromRisk(result.risk),
        title: 'Graph-It-Live impact hint',
        message: `Graph-It-Live reports ${risk} impact for ${targetFile || 'unknown target'}.`,
        filePaths: [targetFile, ...relatedFiles],
        evidence: compact([
          result.depth === undefined ? undefined : `depth=${result.depth}`,
          `impactedFiles=${relatedFiles.length}`,
          `risk=${risk}`
        ])
      }
    ],
    rawQueryIds: rawQueryIds(result.rawQueryId),
    rawReportPaths: rawReportPaths(result.rawReportPath)
  });
}

function providerDiagnosticEvidence(result: GraphItLiveProviderDiagnosticResult): RuntimeEvidence {
  const targetFile = result.targetFile ?? '';
  const filePaths = (result.filePaths ?? []).map(fileRefPath);

  return buildRuntimeEvidence({
    provider: 'graph-it-live',
    kind: 'navigation-hint',
    confidence: 'low',
    targetFiles: [targetFile],
    relatedFiles: [],
    symbols: [],
    diagnostics: [
      {
        id: result.id,
        severity: normalizeSeverity(result.severity),
        title: result.title,
        message: result.message,
        filePaths: [targetFile, ...filePaths],
        evidence: compact([result.rawQueryId ? `rawQueryId=${result.rawQueryId}` : undefined])
      }
    ],
    rawQueryIds: rawQueryIds(result.rawQueryId),
    rawReportPaths: rawReportPaths(result.rawReportPath)
  });
}

export function buildGraphItLiveRuntimeEvidence(input: GraphItLiveRuntimeEvidenceInput): RuntimeEvidence[] {
  return [
    ...(input.codeMaps ?? []).map(codeMapEvidence),
    ...(input.references ?? []).map(referencesEvidence),
    ...(input.impacts ?? []).map(impactEvidence),
    ...(input.diagnostics ?? []).map(providerDiagnosticEvidence)
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
bun test tests/unit/graph-it-live-runtime-evidence.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add -- platform/shared/graph-it-live-runtime-evidence.ts tests/unit/graph-it-live-runtime-evidence.test.ts
git commit -m "feat: add Graph-It-Live runtime evidence adapter"
```

---

### Task 4: Documentation sync for runtime evidence boundaries

**Files:**
- Modify: `docs/09-AI Runtime、任务信封与治理规范.md:94-100`
- Modify: `docs/11-Workbench与可视化规范.md:266-279`

- [ ] **Step 1: Update AI Runtime Context Packet section**

In `docs/09-AI Runtime、任务信封与治理规范.md`, replace the current `### Context Packet 投影` paragraph at lines 94-100 with this text:

```md
### Context Packet 投影

Context Packet 是 task envelope 在执行时的只读上下文投影，不是新的事实源、持久化 artifact 或独立状态机。第一版实现的最小投影为 `task`、`writeBounds`、`runtimeEvidence`；后续字段仍必须从 task envelope、lock、manifest、acceptance、verification、provenance、explain graph 和必要源码骨架派生。

允许暴露的完整投影字段包括：`task`、`affectedGraph`、`blocks`、`pins`、`policies`、`writableAnchors`、`readonlyAnchors`、`cannotModify`、`mustPreserve`、`verification`、`provenance`、`issueClassification`、`runtimeEvidence`。

权限仍只由 `allowedPaths`、`forbiddenOperations`、task kind、phase 和 zone 决定；Context Packet 的 `writeBounds` 只能复制 task envelope 的写入边界，不能从 runtime evidence、external provider finding 或 related files 推导新增可写路径。Graph-It-Live/MCP、GitNexus、Graphify、trace、IDE graph 或其他工具结果只能作为 `runtimeEvidence` / evidence reference 进入投影。
```

- [ ] **Step 2: Update Workbench evidence boundary section**

In `docs/11-Workbench与可视化规范.md`, replace lines 266-279 with this text:

```md
### 10.3 Evidence 与 overlay 路径原则

外部工具报告可以进入 `control/evidence/**`、`control/graph/*-overlay.json` 或 AI Runtime 的 Context Packet `runtimeEvidence`，但必须标记来源、工具版本或查询线索、置信度和非稳定性。推荐预留类型：

```text
control/evidence/code-quality-report.json
control/evidence/architecture-boundary-report.json
control/evidence/semantic-pattern-report.json
control/graph/code-quality-overlay.json
control/graph/architecture-overlay.json
control/graph/semantic-pattern-overlay.json
ContextPacket.runtimeEvidence[]
```

这些路径在实现前不得加入 stable artifact 清单；当前只在 `platform/shared/tool-evidence-contract.ts` 中以 `stableArtifact: false` 的 draft report contract 固定 kind、summary 与 inspect 输出，并在 `platform/shared/runtime-evidence-types.ts` 中以 `stableArtifact: false` 固定开发期 Context Packet runtime evidence。升级任何路径为 stable artifact 时必须同步 `08` 的治理产物说明、`05` 的 CLI/工具入口和 contract freeze 范围。

Overview / Workbench 只能通过 runtime evidence summary 或 inspect 输出消费 Graph-It-Live 这类 provider 结果，用于显示 provider、target files、related files、diagnostic count 和 review priority hints；不得把 external provider 的节点边合并进 Explain Graph，不得修改 Review Summary 的 verification 结论，不得生成 mutation apply 输入。
```

- [ ] **Step 3: Run focused tests after docs sync**

Run:

```bash
bun test tests/unit/runtime-evidence.test.ts tests/unit/context-packet.test.ts tests/unit/graph-it-live-runtime-evidence.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 4: Commit Task 4**

Run:

```bash
git add -- "docs/09-AI Runtime、任务信封与治理规范.md" "docs/11-Workbench与可视化规范.md"
git commit -m "docs: clarify runtime evidence boundaries"
```

---

### Task 5: Final verification and integration check

**Files:**
- Verify all files changed in Tasks 1-4.

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
bun test tests/unit/runtime-evidence.test.ts tests/unit/context-packet.test.ts tests/unit/graph-it-live-runtime-evidence.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 2: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run fast check**

Run:

```bash
bun run check:fast
```

Expected: PASS.

- [ ] **Step 4: Inspect git status**

Run:

```bash
git status --short
```

Expected: only pre-existing unrelated `?? .claude/skills/` remains untracked.

- [ ] **Step 5: If verification required minor fixes, commit them**

If Step 1-3 required code or docs changes, run:

```bash
git add -- platform/shared/runtime-evidence-types.ts platform/shared/context-packet-types.ts platform/shared/graph-it-live-runtime-evidence.ts platform/compiler/synthesize/build-context-packet.ts platform/shared/types.ts tests/unit/runtime-evidence.test.ts tests/unit/context-packet.test.ts tests/unit/graph-it-live-runtime-evidence.test.ts "docs/09-AI Runtime、任务信封与治理规范.md" "docs/11-Workbench与可视化规范.md"
git commit -m "fix: stabilize runtime evidence checks"
```

Expected: a commit is created only if there were verification fixes.

---

## Plan Self-Review

- Spec coverage:
  - Development context: Task 3 codemap → `code-context` evidence.
  - Review risk: Task 3 impact → `impact-hint` evidence.
  - Overview/Workbench navigation: Task 1 summary and Task 2 inspection provide read-only summary surfaces; Task 4 documents the boundary.
  - No stable artifact: Task 1 asserts `stableArtifact: false`; Task 3 asserts provider evidence remains false.
  - No write-bound expansion: Task 2 asserts related files do not enter `allowedPaths`.
  - No MCP/CLI invocation: Task 3 adapter accepts raw shapes and imports no process/network/filesystem APIs.
- Placeholder scan: no placeholder steps, no unspecified tests, no missing command expectations.
- Type consistency:
  - `RuntimeEvidence` and `RuntimeEvidenceSummary` are defined before `ContextPacket` imports them.
  - `buildRuntimeEvidence` exists before Graph-It-Live adapter uses it.
  - `inspectContextPacket` returns `ContextPacketInspection` with field names used in tests.
