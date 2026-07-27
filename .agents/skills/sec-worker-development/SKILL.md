---
name: sec-worker-development
description: 用于在 frozen Task Envelope 内实现一个 SEC 产品、修复或重构纵切片并提交 Reconciliation Delta；不用于 DAG、merge、hosted Gate 或跨 owner 改动。
compatibility: SEC 仓库；按本 Skill 的权威、权限和验证边界执行。
---

# sec-worker-development

## 触发
- 已收到 exact base、branch、owned/forbidden paths、acceptance和focused tests。

## 不触发
- active pointer unresolved；需要改 Work Package、authority或跨 owner设计。

## 输入
- Task Envelope、相关 types/tests/source、当前 failing reproduction。

## 权限与路径
- 仅修改Envelope owned paths；forbidden paths和其他owner只读。

## 允许工具与操作
- 代码编辑、focused test、typecheck/docs/affected按需、imports:freeze、Git commit/push。

## 前置门禁
- Envelope完整、base未漂移、用户修正已reconcile。

## 执行
1. inspect相关 authority/types/tests，禁止默认全仓扫描。
2. 实现最小完整纵切片。
3. 开发中只跑当前 failing/focused sentinel；candidate冻结前可执行 `bun run check:affected --plan`。
4. 稳定后按变化类型运行一次适用 typecheck/docs/final affected；只有resolved plan才运行 `bun run check:affected`。
5. 显式 stage owned paths并运行 `bun run imports:freeze`。
6. commit/push后返回 tested head/base、changed symbols、Evidence delta、blocker、next seam和计数器。

## 完成证据
- Reconciliation Delta、tested head/base、changed symbols、focused results、Evidence delta。

## 停止与恢复
- acceptance满足并提交 Reconciliation Delta；或触发 proof reset/authority blocker。
- 普通失败回实现；frozen同根因二次失效返回STOP_PROOF_RESET。

## 禁止捷径
- 不运行重复 Risk/Full。
- 不删除测试、弱化 assertion、扩大 timeout或顺手重构。
- 普通测试失败不自动计为 candidate invalidation。

## 权威
- `AGENTS.md`
- `docs/04-AI自主实现执行蓝图.md`
- `docs/test-feedback-and-ci-lanes.md`
