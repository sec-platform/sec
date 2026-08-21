---
name: sec-heuristic-governance
description: 裁决一个新 Agent 行为应进入确定性机器 owner、已有 Skill，还是确有新的不可约启发式责任；不充当 work registry、selector 或提示词垃圾桶。
---

# sec-heuristic-governance

本 Skill 仅在 trusted applicability 选中后加载；只消费 Operation Read Plan 已准入事实，`effectAuthority=none`。

## 适用边界
- 适用：新“何时选择/回退/停止/取舍”行为尚不能确定属于 deterministic contract 还是 heuristic judgement；或现有 Skill 出现责任重叠/catch-all。
- 不适用：schema/type/state machine/validator/selector 已能完全决定；或只是把已接受 finding 写入 Issue/WorkDecision/registry。

## 已准入输入
- 仅使用 Read Plan 给出的 behavior observation、consumer、canonical owner facts、Skill metadata、反例和已有 work identity。
- 不因“查重”读取全 Skill、Issue、评论、Memory 或文档；缺 owner/current-spec facts 返回 `reconcile-needed`。

## 判断职责
1. 分类为 `deterministic-owner | existing-skill | new-skill-needed | retire-skill | unresolved`。
2. deterministic 时指出唯一应下沉 owner 与应删除 prose surface，不保留“提示词备份”。
3. heuristic 时比较现有 8 个 Skill 的判断问题与输出；能自然容纳时只选择已有 Skill。
4. 只有 trigger/input/judgement/output/stop 真正独立且现有 Skill 都不能表达时，才提出 `new-skill-needed`；新增仍由机器治理执行。

## 判断输出
- `heuristicDecision`：classification、owner/skillId、consumer、被移除重复/确定性表面、反例、retirement/creation rationale 与 unresolved facts。

## 停止与回退
- 行为已归一到唯一 deterministic owner 或唯一 Skill 时停止。
- 新 Evidence 证明分类错误时回到 deterministic-vs-heuristic 分界重算，不追加 catch-all 例外。

## 禁止
- 不创建万能 Skill，不按“一文件一 Skill”机械切分。
- 不复制产品字段、动态状态、命令 choreography、版本/SHA、Gate 算法到 Skill。
- 不用聊天/Memory/最后评论当 durable current spec，也不自行写 Issue/roadmap/rolling plan。

## 语义权威（非自动读取）
以下只声明优先级；是否读取仍由当前 Read Plan 决定：
- `docs/development-governance.md`
- `platform/shared/agent-skill-contract.ts`
- 当前行为对应的 canonical domain owner
