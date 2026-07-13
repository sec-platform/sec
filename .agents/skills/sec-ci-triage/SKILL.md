---
name: sec-ci-triage
description: "定位 SEC GitHub Actions、quick/full profile、test selector 或 verification Gate 失败的根因并选择最小修复/重跑；没有 CI 失败时不要触发。"
---

# SEC CI Triage

本 Skill 处理真实失败，不把 rerun 当作诊断。

## 流程

1. 绑定 repository、PR、workflow run、job、attempt、exact head/base/profile/revision。
2. 确认触发是否合法：label、branch/base freshness、expected head、verification key。
3. 读取 failed job steps 和最小必要日志尾部；先定位第一个决定性失败。
4. 分类：
   - product/implementation regression；
   - test or Contract Freeze mismatch；
   - selector/impact ownership gap；
   - reference/generated artifact drift；
   - workflow/wiring/setup defect；
   - dependency/environment/transient failure。
5. 沿 shared abstraction、contract、state ownership 和 Gate wiring 检查同类根因，避免逐个症状修补。
6. 选择最小动作：
   - 正式 `fix/*` 或当前产品分支修复；
   - 测试/CI authority 修正；
   - reference refresh（仅在 authority 证明需要时）；
   - 有证据的单次 job/failed-run rerun；
   - 阻止 merge 并升级 Work Package plan。

## 禁止

- 未读日志就重跑；
- 用扩大 timeout、跳过 Gate、删测试或降低断言制造绿色；
- 把 flaky/环境猜测写成已确认；
- 在落后 head 上消耗 hosted runner；
- 让 diagnostic probe 直接进入 `main`。

输出根因证据、受影响 scope、修复 owner、focused sentinel、需要的后续 Gate 和仍未确认项。
