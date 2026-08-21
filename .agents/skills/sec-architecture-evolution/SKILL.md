---
name: sec-architecture-evolution
description: 在机器事实已闭合但仍存在多个真实架构、owner、状态或迁移方案时，裁决唯一长期结构与反转条件；不执行确定性控制面或普通实现。
---

# sec-architecture-evolution

本 Skill 仅在 trusted applicability 选中后加载；只消费 Operation Read Plan 已准入事实，`effectAuthority=none`。

## 适用边界
- 适用：同一真实问题仍有两个以上可行架构/owner/状态模型，或新 Evidence 证明当前对象边界、身份、恢复/迁移模型存在根冲突。
- 不适用：canonical owner、public contract 与 migration 已冻结，只剩普通实现；orientation、WorkDecision、impact、Gate、bootstrap、resume 等已有机器 owner 可唯一决定。

## 已准入输入
- 仅使用当前 Read Plan 给出的 Goal/invariant、canonical owner facts、consumer/impact、反证 Evidence、兼容与迁移约束。
- 缺决定性事实返回 unresolved frontier，不自行扩读全仓、Memory、历史 PR/Issue 或第二 Skill。

## 判断职责
1. 从产品 Goal 与不可绕过不变量重建对象、身份、状态 owner、接口、生命周期、确定性和恢复边界。
2. 比较最强竞争方案的正确性、可恢复性、兼容、并发/崩溃、长期演进成本与第二事实源风险。
3. 选择唯一 owner 与迁移方向，并明确被吸收/退役表面、rollback、反转条件和决定性未知。
4. Evidence 无法区分方案时只提出最小决定性实验，不凭偏好制造结论。

## 判断输出
- `architectureDecision`：chosen owner/mechanism、被拒方案及原因、invariants、consumer impact、migration/retirement、rollback、reversal conditions 与 unresolved evidence。
- 该输出不是实现、Verification 或 adoption。

## 停止与回退
- 唯一选择和迁移边界足以交给确定性 owner/Worker 时停止。
- 新 Evidence 改变根假设时整体回退重算，不在旧方案末尾追加例外。

## 禁止
- 不先改实现再反推 authority；不创建第二 writer/pipeline/revision/state owner。
- 不把 spike、示例通过、PR/Issue prose 或局部测试写成架构完成。
- 不因“可能相关”自行扩大读取闭包或加载另一 Skill。

## 语义权威（非自动读取）
以下只声明优先级；是否读取仍由当前 Read Plan 决定：
- `docs/authority.json`
- `docs/product.md`
- `docs/roadmap.md`
- `docs/system-architecture.md`
- 当前变更对应的唯一 canonical domain owner
