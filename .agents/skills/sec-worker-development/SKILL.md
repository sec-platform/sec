---
name: sec-worker-development
description: 在机器已冻结并授权的单一 Operation 内，判断最小完整实现方案、局部取舍与何时必须升级为 blocker/architecture finding；不拥有 staging、Action/Gate 或 candidate 生命周期。
---

# sec-worker-development

本 Skill 仅在 trusted applicability 选中后加载；只消费 Operation Read Plan 已准入事实，`effectAuthority=none`。

## 适用边界
- 适用：exact base/target、owned/forbidden surfaces、acceptance 与 implementation seam 已由 Task Capsule / Operation Envelope 绑定，但具体实现仍需模型判断。
- 不适用：control/authority/scope unresolved；需要重设计 canonical owner/public contract/跨 owner architecture；或只需 deterministic transform/test selection/staging/publication/resume/Gate/closeout。

## 已准入输入
- 仅使用 Read Plan 给出的相关 owner contract、types/source、当前 reproduction/finding、consumer constraints 与已选择 Action/Result facts。
- 缺信息返回 `implementation-unresolved`/frontier，不默认全仓扫描、搜索 Memory/旧 PR 或加载另一 Skill。

## 判断职责
1. 在给定 seam 内选择完整满足 acceptance 的最小实现，不为局部方便降低上游 invariant。
2. 同类问题重复或局部修复需要新增例外时，优先识别 shared contract/root cause；超出 seam 则输出 architecture/failure finding而不是越权修改。
3. 比较方案的正确性、确定性、恢复、兼容、性能与长期删除成本；优先复用 canonical primitive/Provider。
4. 未证明行为保留 explicit unknown，不用测试特化、magic constant 或 example-only 分支伪造通用性。

## 判断输出
- `implementationJudgement`：chosen approach、changed semantic surfaces、acceptance mapping、被拒方案/原因、需要 deterministic executor 执行的 effect/action refs、blocker/escalation finding。
- 该输出不是 candidate publication、Verification PASS 或 completion receipt。

## 停止与回退
- 实现方案已闭合并可交给 deterministic writer/verification owner执行时停止。
- 新事实要求跨 owner/authority 变化时返回 reconcile/architecture finding；普通 test failure 回当前实现判断或 failure owner。

## 禁止
- 不删测试、弱化 assertion、扩大 timeout、顺手重构或制造 v2/v3 worktree。
- 不把普通 failure 自动当 candidate invalidation，不重复启动相同 ActionKey。
- 不执行未被 Envelope/selector 授权的 Full/Risk/remote Effect，不自行 stage/commit/PR/merge。

## 语义权威（非自动读取）
以下只声明优先级；是否读取仍由当前 Read Plan 决定：
- 当前 frozen Work Package / Task Capsule / Operation Envelope
- 当前 implementation seam 对应的 canonical domain owner
- `docs/development-governance.md`
- `docs/verification-governance.md`
