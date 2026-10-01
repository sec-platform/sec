---
schema: codex-development-work-package-v1
id: write-lease-owner-boundaries-20261001
tracking: none
base: 3a9631274d8d31321b5d390a799748ac470af221
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: separate-lease-observation-from-live-authority
    owner: workspace-write-lease
    ownedPaths:
      - src/adapters/filesystem/write-lease.ts
      - src/adapters/filesystem/write-lease-contract.ts
      - src/adapters/filesystem/write-lease-observation.ts
      - src/adapters/filesystem/write-lease-retirement-proof.ts
      - config/repository/active-work-package.md
      - config/repository/rolling-plan.md
      - config/repository/work-packages/dependency-runtime-owner-boundaries-20261001.md
      - config/repository/work-packages/write-lease-owner-boundaries-20261001.md
forbiddenPaths:
  - AGENTS.md
  - docs/
  - .documentation/
  - .agents/
  - .codex/
  - .github/
  - src/adapters/runtime-state/physical/
  - src/adapters/self-hosting/
  - tests/
  - package.json
  - bun.lock
  - LICENSE
  - LICENSES/
  - crates/
acceptance:
  - This external-maintainer proposal creates no active Work, Gate, health or automatic integration authority
  - Preserve the exact original public exports and V3 serialized token, heartbeat, terminal, inspection and retirement schemas
  - Separate byte validation, read-only ledger observations and retained retirement-proof checks into acyclic leaves
  - Keep all filesystem publication, relocation, cleanup, live manager maps and timers, private retirement recovery issuer, singleton and effect admission under the existing write-lease owner
  - Preserve every original executable declaration body and every existing consumer call without a second manager, issuer registry or callback authority
  - Reuse exact moved-body equivalence and existing focused public-owner observations for exclusion, retirement, physical relocation and heartbeat settlement
  - Preserve the confirmed PID observation-domain weakness and legacy generation 3 UNKNOWN obligation under issue 190 without reclaiming any old lease or declaring a kernel-lock migration complete
  - Do not alter #304 source, its pushed checkpoint, any retained old root, document-control writers or dependency writers
  - Required whole-candidate and hosted qualification remain separate obligations and are not inferred from the structural source proof or selected tests
tests:
  - tests/unit/workspace-write-lease.test.ts
---

# Separate workspace lease observations from live authority

The original lease module remains the unique runtime mutation and recovery owner.
The extracted leaves read or validate existing records and retained identities;
they cannot publish a generation, delete a holder or reconstruct live manager state.
Existing callers keep the same public entrypoint and all serialized bytes remain V3.

This is an internal responsibility separation. The legacy hostname/PID probe has
no persisted PID observation-domain or OS start identity. Its migration and the
old unknown holder remain #190 obligations; moving source does not settle them.
