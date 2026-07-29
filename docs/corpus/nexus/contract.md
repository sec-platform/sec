---
title: Nexus Conformance Corpus
status: active
domain: nexus-corpus
last-reviewed: 2026-07-28
---

# Nexus Conformance Corpus

本文只拥有 `QzCrane/nexus` 作为 SEC 首个完整 Conformance Corpus 的覆盖、裁决、Parity 和退役门。Nexus 的具体产品值不进入 SEC Core。

## 完成定义

只有同时满足以下条件，才能声明无遗漏吸收：

```text
100% tracked-path classification
+ 100% mechanism decisions
+ 100% accepted-mechanism parity
+ 100% owner/consumer/retirement reconciliation
```

每个 accepted mechanism 必须具有 positive、negative、failure、diagnostic、side-effect 和 migration parity。Shadow compare 的 unexplained delta 必须为零。

## Corpus 与 Core 分离

Nexus 的 Bun、SPECTRA、HALO、Chrome、WebAudio、locale、路径、EPR编号和发布表面只进入 Profile、Policy Pack、Adapter、fixture 或 corpus requirement。通用机制必须由对应 SEC domain owner裁决；本文件不能反向改写 Core。

## 状态

当前机器状态只由 `docs/governance/nexus-absorption-ledger.yaml` 拥有。Ledger 为 invalidated、incomplete 或 census-required 时，本文件不复制历史 baseline、数量或完成报告。

## Census

Census 对 exact committed tree 覆盖 tracked paths/modes、entrypoints、authority、generated/public/deployed surfaces、runtime mechanisms、tests、hooks、workflows、release和历史回归。搜索命中、README、代码图或 clean worktree不能代替 exact-tree inventory。

旧实现只有在新 owner进入SEC、Parity通过、全部消费者迁移、projection可重建、rollback存在、真实Nexus e2e和release-equivalent验证通过后退役。
