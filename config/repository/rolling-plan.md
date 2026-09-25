---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-09-23
---

# SEC 滚动近期计划

本文件由唯一rolling projection compiler生成。普通选择与非普通transition使用同一机器拓扑和同一全文renderer；digest只证明规范化内容完整性，effectful owner仍必须在发布前重验其WorkDecision、committed-candidate或MainHealth authority。禁止单独修改标题、prose、JSON字段或digest。

```json
{
  "active": {
    "manifestDigest": "sha256:741df9a432e425add332cabe97851cb4139c463fe17b2018bae15953ec972c4a",
    "manifestPath": "config/repository/work-packages/coordinated-repository-closeout.md",
    "packageId": "coordinated-repository-closeout",
    "tracking": "none"
  },
  "authority": {
    "kind": "committed-candidate-replan",
    "sourceHead": "1ad865b297ed77dc9bceaace46e825116c57a32b",
    "sourceManifestDigest": "sha256:1c36f1ae38441621a0f6aa96b25e43fc5a14a3278679b369f33085a0fe3ac020",
    "sourcePointerRevision": "sha256:c08c02adb3e8159a5b294cccf9cc600d655b0bbeb707f2ccef56e7aa0a09ea7e",
    "sourceRollingRevision": "sha256:c0047f9bcceb666c28bb3070a54bd34b8c3c56733f35d2624979348526721d40",
    "sourceTree": "29c565caa8a1149dbe8e13fd31b21f3a56eafb80"
  },
  "candidates": [
    "development-critical-path-spine-v1",
    "operation-read-plan-authority-canary-v1",
    "sec-static-convergence-v1",
    "candidate-control-transaction-v1",
    "typescript-7-checker-acceleration-v1"
  ],
  "exactMain": "8c6dc289e3fe17b358e6a9c335fbbe092b8ce1ce",
  "exactMainTree": "52b96737f3f3983347738fe4fec11a89e76dc92c",
  "projectionDigest": "sha256:54f6603cc4d0cf5872ecc4380e8ad3f8f1d9e33afda38e98636d0365c9f4b2b5",
  "schema": "sec-work-rolling-transition-projection-v1"
}
```

## 当前唯一 Work Package

### coordinated-repository-closeout

Existing active package replan bound to exact source head `1ad865b297ed77dc9bceaace46e825116c57a32b`, source tree `29c565caa8a1149dbe8e13fd31b21f3a56eafb80`, manifest `sha256:741df9a432e425add332cabe97851cb4139c463fe17b2018bae15953ec972c4a`, and authority `sha256:51f2b903199df97d949bb07e06198a6b549c7a8527dd6d78e8a3053b37028d27`.

## 候选 Work Package

### 1. development-critical-path-spine-v1

Retained ordered candidate from transition authority `sha256:51f2b903199df97d949bb07e06198a6b549c7a8527dd6d78e8a3053b37028d27`.

### 2. operation-read-plan-authority-canary-v1

Retained ordered candidate from transition authority `sha256:51f2b903199df97d949bb07e06198a6b549c7a8527dd6d78e8a3053b37028d27`.

### 3. sec-static-convergence-v1

Retained ordered candidate from transition authority `sha256:51f2b903199df97d949bb07e06198a6b549c7a8527dd6d78e8a3053b37028d27`.

### 4. candidate-control-transaction-v1

Retained ordered candidate from transition authority `sha256:51f2b903199df97d949bb07e06198a6b549c7a8527dd6d78e8a3053b37028d27`.

### 5. typescript-7-checker-acceleration-v1

Retained ordered candidate from transition authority `sha256:51f2b903199df97d949bb07e06198a6b549c7a8527dd6d78e8a3053b37028d27`.

## 重新规划硬触发器

1. exact main、roadmap/catalog、registry/lifecycle/conflict或current-spec revision漂移；
2. active/tracking/package与decision不一致，或候选少于二、多于五、重复、手工重排、增删；
3. WorkDecision、显式transition authority或proposal exact binding不再与当前projection逐项相等；
4. independent Review之后head/tree/base/manifest或本projection bytes改变。

## 加速验收

只执行delta直接拥有的最小验证；同一input/failure复用结果，不运行无因果consumer的全工程Gate。
