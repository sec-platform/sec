---
name: sec-impact-and-validation
description: 用于修改共享类型、公共合同、IR、selector、runtime 或未知影响代码前后，选择最小充分的 impact、focused、typecheck、docs、affected 与 Risk 验证；不用于机械全跑。
compatibility: SEC 仓库；按本 Skill 的权威与工具边界执行。
---

# sec-impact-and-validation

## 触发
- 修改共享函数、公共类型、authority seam、selector、runtime、测试基础设施或未知影响实现。
## 不触发
- 已证明为局部叶节点且 Capsule内impact未失效。
## 输入
- base→candidate changed records、source owner、direct imports、test inventory、risk registry。
## 执行
1. 先运行只读 impact/affected plan；unresolved path立即 fail closed。
2. 开发中只运行 focused sentinel。
3. frozen candidate按变化类型一次运行 typecheck/docs/affected。
4. production browser/native/durable acceptance留给 selected Risk。
5. 同一 Gate identity PASS复用；确定性 FAIL输入未变不得重跑。
## 停止条件
- 每个 changed path有 owner、selected tests/reasons完整且 required Gate已执行或明确委托。
## 禁止捷径
- 不用单次 wall-clock建立硬回归。
- 不以固定文件数删除覆盖。
- 不把 local Risk和hosted Risk重复当成两份正确性。
## 权威
- `docs/test-architecture.md`
- `docs/test-feedback-and-ci-lanes.md`
- `platform/shared/test-impact-contract.ts`
