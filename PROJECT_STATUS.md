# Engineering Workspace Compiler — Project Status

This project is under active research and development. The repository retains the historical name `sec`; that name is not the current project definition or acronym. This document states the public maturity boundary and does not replace machine-generated verification or the canonical design corpus.

## Current phase

**Pre-public-release / active architecture and implementation convergence**

The repository contains substantial working implementation, tests, documentation, verification machinery, and self-hosting/development-control infrastructure. Important parts of the architecture and developer-facing surface are still being consolidated.

The project should therefore be evaluated as an active engineering system, not as a finished product or stable SDK.

## What may be relied on today

The following statements describe the current project direction and repository structure:

- the project is an **Engineering Workspace Compiler** built around governed engineering semantics rather than unrestricted whole-repository AI mutation;
- existing and newly authored software are intended to converge on the same canonical semantic and verification model;
- the architecture explicitly models identity, authority, exact observations, implementation binding, effects, settlement/readback, evidence, recovery, and evolution;
- existing programming languages remain target and interoperability layers rather than being treated as obsolete;
- project-owned code, specifications, architecture/design documentation, tests, and other copyrightable engineering materials are being prepared for distribution under the MIT License, subject to applicable third-party notices.

## What should not yet be assumed

Do not infer from the existence of a document, type, test, command, or implementation path that:

- the capability is complete;
- the interface is stable;
- every target language is supported;
- every documented design has been implemented;
- a passing local test proves production readiness;
- generated source proves the requested engineering outcome;
- compatibility will be preserved across the current development phase.

## Maturity vocabulary

The project deliberately distinguishes stages that are often collapsed in early-stage systems:

```text
proposed
→ accepted
→ specified
→ implemented
→ verified
→ enforced
→ adopted
→ superseded path retired
```

A capability can be far along in one stage and still not have crossed a later one.

## Public-release gates

Before the repository is intentionally presented as a public open-source release, the project should have all of the following closed or explicitly bounded:

1. public-facing naming and positioning are consistent;
2. README, architecture overview, status, license, and contributor guidance are coherent;
3. current capabilities and future direction are clearly separated;
4. the complete Git history and hosted automation surface have been checked for sensitive information that should not become public;
5. third-party licensing and provenance are suitable for public distribution;
6. generated, internal, obsolete, and public-authoritative artifacts are clearly separated;
7. issue and pull-request history has been reviewed for accidental disclosure and excessive internal noise;
8. at least one small, reproducible public path demonstrates what the current system actually does;
9. publication does not silently imply API stability or production readiness.

## Release policy

Repository visibility and software maturity are separate facts. Making the repository public will mean that the source and history are visible; it will not automatically mean that the Engineering Workspace Compiler has reached a stable release.

Versioned releases should make their own explicit claims about supported capabilities, compatibility, and verification coverage.