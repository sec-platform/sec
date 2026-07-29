---
name: sec-impact-and-validation
description: 用于修改共享类型、公共合同、IR、selector、runtime 或未知影响代码前后，选择最小充分的 impact、focused、typecheck、docs、affected 与 Risk 验证；不用于机械全跑。
compatibility: SEC 仓库；按本 Skill 的权威、权限和验证边界执行。
---

# sec-impact-and-validation

## 触发
- 修改共享函数、公共类型、authority seam、selector、runtime、测试基础设施或未知影响实现。

## 不触发
- 已证明为局部叶节点且 Capsule内impact未失效。

## 输入
- base→candidate changed records、source owner、direct imports、test inventory、risk registry。

## 权限与路径
- 只执行 selector解析出的 tests/Gates；不写产品路径，除非本Task Envelope明确拥有。

## 允许工具与操作
- capability ledger与Capsule已批准且证明可调用的optional impact工具、check:affected plan/run、focused tests、typecheck、docs doctor、selected Risk。

## 前置门禁
- changed records完整；test inventory和owner registry可解析。

## 执行
1. 先运行只读 impact/affected plan；optional capability不可用时记录降级并改用exact imports、consumer与test-impact census，禁止为满足optional impact临时安装、动态解析package或重建索引；unresolved path立即 fail closed。
2. 开发中只运行 focused sentinel。
3. frozen candidate按变化类型一次运行 typecheck/docs/affected。
4. production browser/native/durable acceptance留给 selected Risk。
5. 同一 Gate identity PASS复用；确定性 FAIL输入未变不得重跑。

## 完成证据
- changed-path owners、selection reasons、focused/Gate results、deferred Risk list。

## 停止与恢复
- 每个 changed path有 owner、selected tests/reasons完整且 required Gate已执行或明确委托。
- unresolved owner停止；deterministic fail仅重跑失效delta；infra fail交failure-recovery。

## 禁止捷径
- 不用单次 wall-clock建立硬回归。
- 不以固定文件数删除覆盖。
- 不把 local Risk和hosted Risk重复当成两份正确性。

## 权威
- `docs/verification-governance.md`
- `platform/shared/test-impact-contract.ts`
