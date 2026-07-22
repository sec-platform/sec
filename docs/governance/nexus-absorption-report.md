---
title: Nexus 吸收与 Conformance 报告
status: active
last-reviewed: 2026-07-22
---

# Nexus 吸收与 Conformance 报告

## 裁决

**未完成。** 当前只建立 canonical contract、ledger/report owner 与 exact committed-tree baseline；没有完成 path classification、mechanism decisions、EPR/Skill binding、Parity 或 retirement。不得使用“无遗漏吸收完成”。

## Exact baseline

| 项目 | 当前记录 |
| --- | --- |
| Nexus repository | `QzCrane/nexus`，本地根目录 `D:/Project/Nexus` |
| Nexus commit | `e75caa28dcbc1ffa6e893b5539f85c8177346cd3` |
| Nexus Git tree | `3a8ad6bedd56fd92db141c45ec687b75263364c2` |
| Tracked paths | 1,439；`nexus/` 1,405，其他 repository paths 34 |
| SEC base | `ea8d1287dd6d41ed84d198904a55906a345907ec` |
| Goal ledger template | raw SHA-256 `dedbb7ae68c065779131c337b39f69d2c9e5f1de0a250fd3f11106336c542348` |
| Manifest digest | 尚未物化 |

该表只证明 baseline identity。新 commit 是原观察值 `1b82ace…` 的单 parent descendant：31 paths、255 insertions、1,231 deletions，并删除一个 tracked test path；EPR-001..029 与 11 个 Project Skill entrypoint 的 exact count 未变。该 SPECTRA delta 移除 site-native fallback 并泛化 playback-rate bridge，后续 Census 必须同时分类被删除 owner 与替代机制。live Nexus worktree 即使观察时 clean，也不能代替 exact committed-tree Census 输入。

## Coverage

| Gate | 当前值 | 完成要求 |
| --- | ---: | ---: |
| Path classification | 0 / 1,439 | 1,439 / 1,439 |
| Mechanism decisions | 0 / 3 Goal-seeded candidates；全量仍未知 | 100% exact Census mechanisms |
| EPR bindings | exact tree 存在 EPR-001..029，绑定 0 / 29 | 29 / 29 |
| Current Skill bindings | exact tree 存在 11 个 Project Skills，绑定 0 / 11 | 11 / 11 |
| Executable entrypoints | 尚未 inventory | 100% |
| Generated-output owners | 尚未 inventory | 100% |
| Public/deployed surfaces | 尚未 inventory | 100% |
| Accepted parity | 0 / 0 | 100% accepted mechanisms |
| Unexplained deltas | 尚未计算 | 0 |
| Unauthorized retirements | 0 observed | 0 |

空的 `paths` array 表示 path inventory 尚未落盘，不表示没有路径；`mechanisms` 当前也只含三个上游 seed，不表示全量机制只有三个。机器可读状态见 `docs/governance/nexus-absorption-ledger.yaml`。

Ledger 已从 Goal-directory V1 template 提升三个 exact-blob checked candidate：documentation owner uniqueness、desired/actual/ACK separation、frozen-source promotion receipt。它们的 decision 均为 `null`、六维 parity 均为 `missing`；seed 只防止已知机制遗失，不构成 Census 决策或 acceptance。

## 尚缺的强制产物

- 1,439/1,439 exact path/mode/object inventory 与 classification；
- executable entrypoints、scripts、hooks、workflows、generators 与 tests inventory；
- authority graph、generated outputs、public/release/deployed surfaces；
- EPR-001..029 全绑定；
- exact baseline 下实际 Project Skills 全绑定；
- 每个 mechanism 的 absorb/retain/supersede/reject 决策；
- 每个 accepted mechanism 的 positive、negative、failure、diagnostic、side-effect、migration 六维 parity；
- 独立 shadow reconciliation 与 unexplained-delta classifier；
- old/new owner、consumer、projection、rollback 与 retirement reconciliation；
- deterministic manifest digest、coverage report 与 unexplained-delta classifier。

## 下一步

正式 `nexus-phase-0a-exact-tree-census` Work Package 必须从 exact commit/tree 或 clean isolated view 生成 deterministic inventory，再由 A0 串行 reconcile ledger。它可以只读并行采集，但不能成为与 SEC 产品主线竞争的 active package，也不能先修改共享 canonical types。

Nexus baseline 变化后，按 contract 执行 delta census、更新受影响 decision 并只重跑失效 parity；本报告的旧 baseline 不证明新 commit。
