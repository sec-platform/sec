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
    "manifestDigest": "sha256:70cdaf6c982e05e5b75678734d3b76c4067850648ef87094832bc3cee056e0e3",
    "manifestPath": "config/repository/work-packages/local-validation-lease-batch-adoption-20261002.md",
    "packageId": "local-validation-lease-batch-adoption-20261002",
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
  "exactMain": "683e78ccf679619319254c3f43ba12f37a83f2ef",
  "exactMainTree": "328c039833fcb495cfd60fdeb0c4a9a9f7167a14",
  "projectionDigest": "sha256:47f5c5b08d2629d51998be46e3d855dc70c19ed5d6613b76d4b0e92e1149b7cc",
  "schema": "sec-work-rolling-proposal-projection-v1"
}
```

## 当前唯一 Work Package

### local-validation-lease-batch-adoption-20261002

Proposal-only target manifest `config/repository/work-packages/local-validation-lease-batch-adoption-20261002.md` at `sha256:70cdaf6c982e05e5b75678734d3b76c4067850648ef87094832bc3cee056e0e3`, based on exact main `683e78ccf679619319254c3f43ba12f37a83f2ef` and tree `328c039833fcb495cfd60fdeb0c4a9a9f7167a14`.

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
