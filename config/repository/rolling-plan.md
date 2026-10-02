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
    "manifestDigest": "sha256:1bbb6932d72a29543d0b6a9c880add44e54343450b76769ea1f5e51ab1b2f1cc",
    "manifestPath": "config/repository/work-packages/reader-preparation-adoption-20261002.md",
    "packageId": "reader-preparation-adoption-20261002",
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
  "exactMain": "08635ccf8dd6a036de9f4b8e2f0941c54967ee85",
  "exactMainTree": "7c420050a6705005816b62ec75059e1644ebefc9",
  "projectionDigest": "sha256:ed3af540137e5161272a8e08444a937629005fcd09f8dd65ac4a3e83e5b93e0e",
  "schema": "sec-work-rolling-proposal-projection-v1"
}
```

## 当前唯一 Work Package

### reader-preparation-adoption-20261002

Proposal-only target manifest `config/repository/work-packages/reader-preparation-adoption-20261002.md` at `sha256:1bbb6932d72a29543d0b6a9c880add44e54343450b76769ea1f5e51ab1b2f1cc`, based on exact main `08635ccf8dd6a036de9f4b8e2f0941c54967ee85` and tree `7c420050a6705005816b62ec75059e1644ebefc9`.

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
