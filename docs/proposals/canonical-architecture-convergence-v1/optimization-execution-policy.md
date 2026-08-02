---
title: SEC Convergence Execution Policy
status: proposal
tracking: issue-232
authority: none
---

# Purpose

This file does not create another architecture. It defines how the existing decisions converge into implementation without expanding future-design surface.

# Optimization objective

Optimize for:

1. first trustworthy product closure;
2. minimum irreversible architecture commitment;
3. maximum reuse of validated work;
4. shortest path from intent to verified result.

Do not optimize for:

- number of abstractions;
- number of skills;
- number of agents;
- number of proposal documents;
- theoretical future coverage without consumers.

# Single execution path

```text
Intent
→ Operation
→ Capability resolution
→ Plan
→ Impact
→ Controlled mutation
→ Verification
→ Evidence
→ Integration
```

Skill is a strategy layer only. It must not own permission, truth, verification, state transitions, or canonical data.

# Repository convergence rules

Every future design item must become exactly one of:

- canonical implementation owner;
- machine registry;
- experiment with activation condition;
- issue decision record;
- archive.

No parallel final designs are allowed.

# Product priority

The implementation order is:

```text
Verification truth
→ SEC self-observation slice
→ Responsibility / Impact
→ minimal governed Mutation
→ TypeScript round-trip
→ Brownfield adoption
→ expansion
```

Infrastructure that does not unblock a real product slice must not become a prerequisite.

# Documentation minimization

A concept may have only one semantic owner.

- prose explains stable concepts;
- registries store machine facts;
- code contracts define executable behavior;
- evidence stores measurements;
- issues store unresolved choices;
- archive stores history.

Adding a document requires identifying what existing document it replaces, extends, or references.

# Test optimization

Testing is split into:

- feedback loop: fastest useful signal;
- candidate verification: merge confidence;
- release verification: complete proof.

The fastest loop may be incomplete. It must never create merge authority.

# Reversal rule

If future evidence invalidates an identity, owner, dependency, or product assumption, return to that decision layer and recompute. Do not append exceptions indefinitely.
