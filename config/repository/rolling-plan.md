---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-10-07
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成，是未获activation authority的proposal-only候选投影。authority固定为none；projection digest只保护规范化表示，不能产生WorkDecision、Effect、merge或完成权限。

```json
{
  "active": {
    "manifestDigest": "sha256:422dd5e18e7edcd1f1a62187354af460e133865e2608fb1c65e446925e642e65",
    "manifestPath": "config/repository/work-packages/release-parent-atomic-adoption-20261002.md",
    "packageId": "release-parent-atomic-adoption-20261002",
    "tracking": "none"
  },
  "authority": "none",
  "candidates": [],
  "exactMain": "cebc132edd029804a0797e1e330787fc8896da14",
  "exactMainTree": "13ae94937ee7711fdaa457ad6382bdf3aca7d00e",
  "projectionDigest": "sha256:6e9193740ef250c76c6772943ac03c34251cab19bfd9dcd8d688270d3e6ea7b8",
  "schema": "sec-work-rolling-proposal-projection-v1"
}
```

## 当前唯一 Work Package

### release-parent-atomic-adoption-20261002

Proposal-only target manifest `config/repository/work-packages/release-parent-atomic-adoption-20261002.md` at `sha256:422dd5e18e7edcd1f1a62187354af460e133865e2608fb1c65e446925e642e65`, based on exact main `cebc132edd029804a0797e1e330787fc8896da14` and tree `13ae94937ee7711fdaa457ad6382bdf3aca7d00e`.

## 候选 Work Package

## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选多于五、重复、手工重排、增删；
3. WorkDecision、显式transition authority或proposal exact binding不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
