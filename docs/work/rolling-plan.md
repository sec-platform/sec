---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-22
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成。普通选择与非普通transition使用同一机器拓扑和同一全文renderer；digest只证明规范化内容完整性，effectful owner仍必须在发布前重验其WorkDecision、committed-candidate或MainHealth authority。禁止单独修改标题、prose、JSON字段或digest。

```json
{
  "active": {
    "manifestDigest": "sha256:9b8982fdd9574304b444acbf42283b6e3fc4f49cf250199ca8653729217da69d",
    "manifestPath": "docs/work-packages/sec-static-convergence-v1.md",
    "packageId": "sec-static-convergence-v1",
    "tracking": "issue-311"
  },
  "authority": {
    "kind": "committed-candidate-replan",
    "sourceHead": "1f50385d6620a0feab733a386c0994e34f7ff766",
    "sourceManifestDigest": "sha256:9b8982fdd9574304b444acbf42283b6e3fc4f49cf250199ca8653729217da69d",
    "sourcePointerRevision": "sha256:587a8d53ee94c227ecf7f28a922a6117f24fac73a41abb05df27dab492484b8c",
    "sourceRollingRevision": "sha256:51370a38771d436f17bc614371e4913409804ec23326cef1edc83bbae1730e27",
    "sourceTree": "731e81f88f2b2042e8c206497f5905b1f66c4a9b"
  },
  "candidates": [
    "operation-read-plan-authority-canary-v1",
    "generated-ignored-state-lifecycle-v1",
    "candidate-control-transaction-v1",
    "typescript-7-checker-acceleration-v1"
  ],
  "exactMain": "f513d6fe022951662ce64520e5a9d0ccfbf56192",
  "exactMainTree": "5f1ea1c0b62ab4ab396b16c262bfcf1de06e4019",
  "projectionDigest": "sha256:eaea1c74477b90ac31120c4c3c066bf27dca58ef40c89ece11de3629b340d932",
  "schema": "sec-work-rolling-transition-projection-v1"
}
```

## 当前唯一 Work Package

### sec-static-convergence-v1

Existing active package replan bound to exact source head `1f50385d6620a0feab733a386c0994e34f7ff766`, source tree `731e81f88f2b2042e8c206497f5905b1f66c4a9b`, manifest `sha256:9b8982fdd9574304b444acbf42283b6e3fc4f49cf250199ca8653729217da69d`, and authority `sha256:d8be0acdcb1997f19644a86f26751aa4da1fad7ac7b9d69049da5a91bf71e451`.

## 候选 Work Package

### 1. operation-read-plan-authority-canary-v1

Retained ordered candidate from transition authority `sha256:d8be0acdcb1997f19644a86f26751aa4da1fad7ac7b9d69049da5a91bf71e451`.

### 2. generated-ignored-state-lifecycle-v1

Retained ordered candidate from transition authority `sha256:d8be0acdcb1997f19644a86f26751aa4da1fad7ac7b9d69049da5a91bf71e451`.

### 3. candidate-control-transaction-v1

Retained ordered candidate from transition authority `sha256:d8be0acdcb1997f19644a86f26751aa4da1fad7ac7b9d69049da5a91bf71e451`.

### 4. typescript-7-checker-acceleration-v1

Retained ordered candidate from transition authority `sha256:d8be0acdcb1997f19644a86f26751aa4da1fad7ac7b9d69049da5a91bf71e451`.

## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选少于二、多于五、重复、手工重排、增删；
3. WorkDecision或显式transition authority不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
