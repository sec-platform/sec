# Test and package architecture design record

This document is a historical entry point for the test architecture refactor. It must not repeat active test facts, package script lists, slow suite IDs, CI command arrays, or testkit APIs.

Use the active authorities instead:

| Topic | Authority |
| --- | --- |
| Final test model, layers, fact sources, testkit primitives, Playwright boundary | [test-architecture.md](test-architecture.md) |
| Local feedback, PR quick, PR risk, release/full behavior, `test:affected`, package script boundary, remote import automation | [test-feedback-and-ci-lanes.md](test-feedback-and-ci-lanes.md) |
| Slow suite ownership, slow commands, sharding policy | [slow-suite-registry.md](slow-suite-registry.md) |
| Generated project verification, provenance, graph, policy, coverage | [08-Verification、Provenance与Graph规范.md](08-Verification、Provenance与Graph规范.md) |

## Maintenance rule

When a test fact changes, update the authority above and add or adjust a contract test. Do not add a second copy here.
