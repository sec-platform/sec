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
    "manifestDigest": "sha256:089f793453491728f2f9f731167322e6ea0971b79fc7b0953d02d438abd14950",
    "manifestPath": "config/repository/work-packages/runner-build-adoption-20261002.md",
    "packageId": "runner-build-adoption-20261002",
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
  "exactMain": "51a5cfb15a1a5d7aaf8cfe1464b64c617f53a50f",
  "exactMainTree": "5c985128885dbcf4a811e8d1b1c854287b93d582",
  "projectionDigest": "sha256:f321a92ff4cf76c88bd9d227cb6113a5970ed46585689426f8337ec57c085f7d",
  "schema": "sec-work-rolling-proposal-projection-v1"
}
```

## 当前唯一 Work Package

### runner-build-adoption-20261002

Proposal-only target manifest `config/repository/work-packages/runner-build-adoption-20261002.md` at `sha256:089f793453491728f2f9f731167322e6ea0971b79fc7b0953d02d438abd14950`, based on exact main `51a5cfb15a1a5d7aaf8cfe1464b64c617f53a50f` and tree `5c985128885dbcf4a811e8d1b1c854287b93d582`.

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
