# Engineering Workspace Compiler — Architecture Overview

This is a public projection of the current SEC-086 design. It helps readers enter the system; it does not replace the canonical documents under `docs/**`.

## System boundary

SEC turns engineering goals, maintainable author content, and available implementations into target workspaces whose sources and limits remain explicit. It can return analysis, a bounded design, implementation candidates, complete artifacts, or the result of an authorized operation. The requested outcome determines the stopping point.

```text
People / AI / Existing Tools
              │ goals, changes, authorized operations
              ▼
 Engineering Workspace Compiler
   ├─ captures exact workspace and source facts
   ├─ interprets meaning and requirements
   ├─ selects or creates eligible implementations
   ├─ produces complete target artifacts
   ├─ evaluates applicable evidence
   └─ admits and settles requested effects
              │
              ├─ analysis, diagnostics, candidates
              ├─ source, dependencies, resources
              └─ observed operation results
```

The compiler is usually an embeddable, modular local system. A short CLI, SDK consumer, optional warm service, isolated worker, or remote provider can host parts of it when their real lifecycle and failure boundaries justify that shape. The design does not equate logical responsibilities with separate services.

## Responsibilities

The architecture uses ten implementation responsibilities:

| Responsibility | Owns | Does not own |
|---|---|---|
| `contracts` | shared value shapes, references, results, diagnostics | domain meaning or execution permission |
| `workspace` | author content, identity, scope, frozen candidates, source location | target write authority |
| `semantics` | definitions, names, types, effects, domain rules, edit meaning | external effects |
| `compiler` | analysis by roots, implementation selection, lowering, target members, source correspondence | publication or runtime adoption |
| `assurance` | claims, methods, coverage, evidence applicability | acceptance requirements or write permission |
| `application` | request purpose, exact inputs, candidate changes, missing information, result ownership | a second type system or global current result |
| `execution` | admission, resources, operation identity, effects, receipts, recovery | invented settlement after provider loss |
| `adapters` | concrete filesystem, language, source, and host capabilities | stronger guarantees than a provider supplies |
| `entry` | protocols, encoding, negotiated behavior, result presentation | side-channel persistence or authority |
| `bootstrap` | constructing an instance, injecting implementations, closing created resources | a runtime-global service locator |

These responsibilities collaborate without collapsing their state:

```text
entry → application → workspace
             │          │
             ├──────→ compiler ← semantics
             │             │
             ├──────→ assurance
             │
             └──────→ execution → adapters

contracts define shared boundary values;
bootstrap constructs the selected implementation graph.
```

## Two input paths, one downstream model

For existing software, SEC captures exact physical observations, language and dependency facts, and candidate responsibilities. It adopts supported meaning, rejects disproven interpretations, and preserves material unknowns.

For new or intentionally changed software, SEC consumes goals, constraints, contracts, and authored choices. Both paths converge on maintained engineering content, implementation selection, exact target members, controlled changes, readback, and evidence.

This convergence matters because generated code is not a separate truth. Author content remains maintainable, implementation choices remain traceable, and the target workspace carries only the source, dependencies, and resources it actually needs.

## State and failure boundaries

The design keeps several facts separate:

- a candidate author change and a persisted workspace change;
- an eligible implementation and a selected implementation;
- a generated artifact and a published artifact;
- a verification result and the claim it actually covers;
- an admitted operation, its provider attempt, and its observed settlement;
- a new source revision and an already running instance.

This prevents common false conclusions. A green test does not prove an unrelated claim; a timeout does not prove that an external effect never happened; saving new source does not hot-swap an old process; success for one output root does not prove a multi-root delivery is complete.

Failures retain their real classification: rejected, unresolved, blocked, conclusively failed, recovery required, rolled back with evidence, or published with evidence. Unknown external settlement remains a recovery responsibility rather than being rewritten as success or safe retry.

## AI and external capability boundary

AI can interpret intent, query canonical engineering facts, propose bounded changes, explain decisions and evidence, and invoke operations within granted authority. It cannot silently replace canonical content, manufacture evidence, expand its own permission, or use generated source as proof of completion.

Compilers, package managers, providers, source services, and host tools are consumed through their narrow real capabilities. Their output remains bound to its source, revision, coverage, environment, and settlement behavior. A wrapper, registry entry, or successful installation does not upgrade those guarantees.

## Canonical design entry points

- [Product scope and constraints](docs/产品/README.md)
- [Complete system architecture](docs/架构/总体设计.md)
- [Assembly and implementation boundaries](docs/架构/装配/README.md)
- [Author content](docs/作者/README.md)
- [Compilation](docs/编译/README.md)
- [Runtime effects and recovery](docs/运行/README.md)
- [Verification and evidence](docs/运行/保证/README.md)
- [Evolution, migration, and retirement](docs/演进/README.md)
- [Design decisions](docs/决策/README.md)
- [Known unresolved scope](docs/状态/README.md)
- [Documentation architecture](docs/维护/文档架构.md)

The [documentation index](docs/README.md) and [task routes](docs/任务路线.md) locate the actual owner for a specific mechanism. Public summaries should be corrected from those owners whenever the design changes.
