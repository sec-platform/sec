---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-10-02
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成，是未获activation authority的proposal-only候选投影。authority固定为none；projection digest只保护规范化表示，不能产生WorkDecision、Effect、merge或完成权限。

```json
{
  "active": {
    "manifestDigest": "sha256:9e3dd805e5d9b520f6bbf222b635bf05a83db0b9b0a5f8757a82348e2baffa51",
    "manifestPath": "config/repository/work-packages/native-copy-directory-adoption-20261002.md",
    "packageId": "native-copy-directory-adoption-20261002",
    "tracking": "none"
  },
  "authority": "none",
  "candidates": [
    "development-critical-path-spine-v1",
    "operation-read-plan-authority-canary-v1",
    "sec-static-convergence-v1",
    "candidate-control-transaction-v1",
    "typescript-7-checker-acceleration-v1"
  ],
  "exactMain": "ff7a8707fdde08953a578bba89ec4637ce3a53ef",
  "exactMainTree": "ab531c61e771b9194ca958afd50791b54c3a00f0",
  "projectionDigest": "sha256:43ed28e3db9da019544769662103bc9d89dbe68a501b59c3cc5e003eb9ff83eb",
  "schema": "sec-work-rolling-proposal-projection-v1"
}
```

## 当前唯一 Work Package

### native-copy-directory-adoption-20261002

Proposal-only target manifest `config/repository/work-packages/native-copy-directory-adoption-20261002.md` at `sha256:9e3dd805e5d9b520f6bbf222b635bf05a83db0b9b0a5f8757a82348e2baffa51`, based on exact main `ff7a8707fdde08953a578bba89ec4637ce3a53ef` and tree `ab531c61e771b9194ca958afd50791b54c3a00f0`.

## 候选 Work Package

### 1. development-critical-path-spine-v1

Retained ordered candidate identity from the published baseline; no selection authority is implied.

### 2. operation-read-plan-authority-canary-v1

Retained ordered candidate identity from the published baseline; no selection authority is implied.

### 3. sec-static-convergence-v1

Retained ordered candidate identity from the published baseline; no selection authority is implied.

### 4. candidate-control-transaction-v1

Retained ordered candidate identity from the published baseline; no selection authority is implied.

### 5. typescript-7-checker-acceleration-v1

Retained ordered candidate identity from the published baseline; no selection authority is implied.

## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选少于二、多于五、重复、手工重排、增删；
3. WorkDecision、显式transition authority或proposal exact binding不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
