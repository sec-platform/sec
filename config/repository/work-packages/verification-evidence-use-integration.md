---
schema: codex-development-work-package-v1
id: verification-evidence-use-integration
tracking: issue-176
base: 6854e16cc2b520a15b78e46749c9e1150e356f48
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: establish-verification-specification-and-evidence-use-boundary
    owner: verification-evidence-use-owner
    ownedPaths:
      - docs/编译/表示/目标运行与观测.md
      - docs/运行/验收/会话集成与结果复用.md
      - docs/运行/验收/方法与独立证据.md
      - src/assurance/verification/contract/data.ts
      - src/assurance/verification/contract/specification.ts
      - src/assurance/verification/evidence-use/contract/schema.ts
      - src/assurance/verification/evidence-use/contract/use.ts
      - src/assurance/verification/evidence-use/sec.module.json
      - src/assurance/verification/result/contract/result.ts
      - tests/unit/verification-evidence-use-contract.test.ts
      - tests/unit/verification-specification-identity.test.ts
      - .documentation/source-manifest.json
      - config/repository/work-packages/verification-evidence-use-integration.md
forbiddenPaths:
  - .github/
  - src/adapters/verification/platform/action/
  - src/adapters/verification/platform/ci/
acceptance:
  - VerificationGateResult remains the physical compatibility result and cannot itself authorize Claim satisfaction
  - Claim ProofObligation and VerificationMethodSelection bind exact refs revisions and canonical digests without duplicating upstream semantic bodies
  - VerificationEvidenceUse can only be constructed from one owner-validated specification binding and binds exact Evidence producer subject obligation selection conclusion and current qualification
  - supports contradicts indeterminate and not-produced are method-level conclusions; not-produced cannot materialize EvidenceUse and neither direction becomes Verdict authority without current qualification
  - stale or invalid Evidence preserves historical producer settlement and conclusion while blocking current qualified consumption
  - reused Evidence does not fabricate a new producer and result/evidence/consumer ownership remains one-way
  - verification data parsing rejects proxies accessors sparse arrays extra fields cycles and toJSON without invoking candidate behavior
  - current cross-system independent-oracle and recovery witness guidance remains present in the canonical evidence-method authority
  - documentation source manifest exactly reflects this combined contract/documentation state
  - no CI Action writer provider execution path or final Verdict consumer is modified by this slice
tests:
  - tests/unit/verification-evidence-use-contract.test.ts
  - tests/unit/verification-specification-identity.test.ts
  - tests/contract/verification-result-contract.test.ts
---

# Verification specification 与 Evidence Use 收口

本工作包把保留分支中的 Verification specification identity、严格数据边界和 EvidenceUse 合同重新建立在当前 main，并同时吸收后续 VerificationResult/Evidence 文档收口。它不恢复旧 ExecutionResult 真值，不把 Gate PASS、内容摘要或历史 reuse 提升为 Verdict authority。
