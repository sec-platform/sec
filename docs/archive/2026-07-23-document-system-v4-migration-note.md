---
title: 文档系统 V4/V5 迁移与执行审计
status: historical
last-reviewed: 2026-07-23
---

# 文档系统 V4/V5 迁移与执行审计

本文只记录 2026-07-23 的输入、归位决策与执行边界，不是产品、路线或完成 authority。候选是否进入 `main` 仍由最终 Git diff、测试、CI 与 Review决定。

## Goal 输入绑定

用户根工作树 `D:/Project/sec/docs/goals/**` 的九份 Markdown 已完整读取。Combined revision算法为：按 repository-relative POSIX path ordinal升序，依次串接 `<path>` + TAB + `<lowercase raw SHA-256>` + LF，再对UTF-8/no-BOM payload计算SHA-256。

```text
sha256:555a187dc8a1a8ed8d52e76c23a2e2e752c2a77073664fde5f286d274cbbf676
```

| Source | Bytes | Raw SHA-256 | Canonical destination / disposition |
|---|---:|---|---|
| `docs/goals/SEC_Document_System_V4_Combined_Reference.md` | 110937 | `77dd444ed1215da03c392ce84741509ea40adaf323a0d32e57b7de105a52a5db` | 只作综合输入索引；不进入候选、不成为第二authority |
| `docs/goals/sec_document_system_v4/01-SEC-Codex-Persistent-Goal-V4.md` | 10758 | `c14b64a51c88929ff02efd32b3ef55891277386efa800aa2cbb926fa56f5d120` | `goals/SEC-Engineering-Workspace-Compiler.md`、`03`、`04`、`work/**` |
| `docs/goals/sec_document_system_v4/02-SEC-Product-Architecture-V4.md` | 16807 | `b0d7ad1f1cade594d36c622edb67721db4f24762f05fb9fe8b2d3445ae51b2d3` | `02`、`14`、`architecture/**`；latest-main authority优先 |
| `docs/goals/sec_document_system_v4/03-SEC-Roadmap-and-Completion-V4.md` | 14853 | `ac2ec8c3509765f213dcf5ef66459aa1efb1c9205e1212633ff49f82e4e192db` | `03`稳定DAG与完成定义；动态事实只进`work/**` |
| `docs/goals/sec_document_system_v4/04-SEC-Engineering-Operating-Protocol-V4.md` | 12927 | `7994c7804d9367be60851026053bfa726bc143d091bd0fa0fc92b5e953f2ad7a` | `AGENTS.md`为仓库合同，`04`为一致投影；未另建schema |
| `docs/goals/sec_document_system_v4/05-SEC-External-Capability-and-MCP-Policy-V1.md` | 16547 | `e748332f0bf1ebf4f845d55ce9c82fbbba625736e04ac51d5847872713b5f316` | `governance/external-capability-and-provider-policy.md`与ledger |
| `docs/goals/sec_document_system_v4/06-SEC-Nexus-Conformance-Spec-V2.md` | 26484 | `1f4b2341d1a8b270e9f9c7762e656b1e1dfa2fb0d40c4eca95b93183da05755f` | Nexus Conformance Corpus/Policy Pack、ledger、report；不是Core owner |
| `docs/goals/sec_document_system_v4/MIGRATION-MATRIX.md` | 6577 | `aa6871af90c5f6b031fe64122b8cd9693d7e9c2fe4e515a8a779794db0e2ba54` | 本审计的线索；逐项重新裁决，不直接复制完成状态 |
| `docs/goals/sec_document_system_v4/README.md` | 5710 | `0efd7260d96b805f8899b2b9d5c689eea6ecc2e841826854e36164887f22dd1f` | 只作V4目录说明；不进入active authority |

这些 V4 路径未被加入候选分支。用户根工作树中的未跟踪输入保持原样，不能把“未进入 Git candidate”误写成“已物理删除用户文件”。

## V5 replacement 包审计

原包 `docs/scripts/SEC_docs_v5_replacement` 的 manifest raw SHA-256 为：

```text
dfebcd615422f7d70fea68537cf4e9c82cd0d81e4ac401fd1c8aaf333890e9c2
```

原始 manifest 对原始包的 132 个条目 byte/hash自洽，但该 identity仍包含不可执行或不安全语义：

- PowerShell、Bash和payload `docs-doctor.ts`首行多出反斜杠；
- `06-Registry与Block...` filename编码损坏；
- source位于目标 `docs` 内，原脚本会删除自身；
- preserve整目录恢复会丢payload-only的 migration note与`work/README.md`；
- doctor会把`00`中“禁止旧V4路径”的policy文字误判为active引用；
- shell installer把linked worktree的`.git`文件误判为非仓库；
- installer没有可靠传播 doctor failure。

执行者只在 `%TEMP%` 临时副本中修正Windows执行前置，并在隔离 worktree `codex/docs-document-authority-v5` 上运行。Overlay层证据为：103个 current preserve文件零missing/byte drift，33个payload-owned文件零missing/hash mismatch，最终136个docs文件，机械Git delta为18 modified + 4 added + 0 deleted。修复后的临时副本已不再由原manifest identity覆盖，因此这些数字只证明一次overlay输出，不证明原包可发布。

## 语义裁决

机械安装后的候选被明确判为 NO-GO，因为它把 `origin/main@8aa2d2d` 的较新事实回退到旧本地 `main@eb48eb3`：

- 删除 Workspace domains、Validated Snapshot 与 Application/Behavior/Target Program IR层；
- 删除 Task Envelope v2尚未实现、SM-4A shared adapter与local HTTP trust boundary；
- 把已完成SM-3和精确SM-4A/B/C时序回退为旧规划；
- 把current V1 CI从`ci-verification-v9`回退到v6/v7；
- 用空Nexus V2 template覆盖已冻结exact baseline；
- 用较弱doctor替换legacy file URI、repo path和deprecated-token诊断。

最终迁移策略因此是：恢复latest-main唯一owner，再选择性吸收V5的Goal、稳定DAG、Provider治理、Nexus Corpus/Policy Pack和迁移说明。`docs-doctor`语义超集与installer differential fixtures后置为独立trust-root Work Package；本次候选保持现有doctor bytes。

## 未被本记录证明的事项

- V5文档候选已进入`main`；
- 原replacement包跨平台可复用；
- Nexus Census、Parity或Retirement完成；
- Provider A/B或默认选型完成；
- 任何planned Workspace/SEC-TS/Brownfield/AI层已经实现；
- 文档计划可以替代测试、CI、Review或真实产物。
