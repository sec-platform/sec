---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-10-13
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成，是未获activation authority的proposal-only候选投影。authority固定为none；projection digest只保护规范化表示，不能产生WorkDecision、Effect、merge或完成权限。

```json
{
  "active": {
    "manifestDigest": "sha256:f129c53e67b77206b27486f05611491734d79cdd94cd07441319c88d2f7c9b04",
    "manifestPath": "config/repository/work-packages/main-health-dependency-admission-20261013.md",
    "packageId": "main-health-dependency-admission-20261013",
    "tracking": "none"
  },
  "authority": "none",
  "candidates": [],
  "exactMain": "a2ee46c9ad478def280bad0fc5358e4b9eb1eb62",
  "exactMainTree": "03a4f0c4bf4fcf9de2cf19442fde97898539fa2f",
  "projectionDigest": "sha256:8b59fd51885de3a3a902bbfd60f86675df97b1f42dbfa193483d9931b1b2681c",
  "schema": "sec-work-rolling-proposal-projection-v1"
}
```

## 当前唯一 Work Package

### main-health-dependency-admission-20261013

Proposal-only target manifest `config/repository/work-packages/main-health-dependency-admission-20261013.md` at `sha256:f129c53e67b77206b27486f05611491734d79cdd94cd07441319c88d2f7c9b04`, based on exact main `a2ee46c9ad478def280bad0fc5358e4b9eb1eb62` and tree `03a4f0c4bf4fcf9de2cf19442fde97898539fa2f`.

## 候选 Work Package


## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选多于五、重复、手工重排、增删；
3. WorkDecision、显式transition authority或proposal exact binding不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
