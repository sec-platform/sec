---
name: sec-govern-capability
description: 对外部工具、Provider、MCP、模型、索引器、服务和平台能力的引入、调用、升级、替换与退役进行必要性、权限、数据、安全、Evidence和唯一owner裁决；不把外部输出提升为SEC事实。
compatibility: SEC Agent Skill System v2 proposal
metadata:
  sec-schema: sec-agent-skill-v2
  sec-version: '2'
  sec-operation: govern-capability
  sec-risk: governed
---

# sec-govern-capability

## 目标

把“使用某个外部工具”转换为明确的 capability decision：真实缺口、Provider边界、权限/数据流、version/environment identity、fallback、Verification和retirement。外部能力只拥有物理执行或Evidence生产，不拥有SEC语义、Impact、write authority或merge truth。

## 触发

- 引入、调用、升级、替换或退役外部CLI、MCP、模型、服务、native/browser/container、代码图或安全/发布工具。
- 已登记能力的version、permission、data boundary、consumer或availability发生变化。
- optional capability缺失阻断无关Core，或外部输出被错误当成authority。

## 不触发

- 已批准能力identity未失效，当前operation只进行普通只读调用。
- 只是package/lock物理变化且采用决策已完成：转`sec-govern-toolchain`。
- 产品Provider protocol或semantic permission模型需要重建：转`sec-design-change`。

## 必需输入

- operation envelope、consumer和真实能力缺口；
- capability ledger现有记录；
- exact version/runtime/platform/license/security/maintenance Evidence；
- network、credential、path、read/write、data retention和privacy边界；
- alternatives、fallback、exit/retirement条件；
- Role和external-control授权状态。

## 权限边界

- 只读研究可用`read-only`；配置/adapter/ledger变化用`branch-write`；外部写动作另需`external-control`。
- Skill不能直接授予network、credential、MCP、Shell、repository write或publication权限。
- 只修改envelope授权的ledger、Provider adapter、配置、tests和retirement paths。
- 外部工具不得修改AGENTS、Skills、canonical docs或产品source，除非经过独立typed operation。

## 执行

1. 证明真实consumer和缺口；现有canonical primitive/Provider能满足时优先复用，禁止工具收藏式引入。
2. 定义capability object：inputs/outputs、physical owner、semantic non-authority、failure modes、version/environment和support level。
3. 审计权限和数据流：repository/path、network endpoint、credential scope、prompt/source上传、retention、tenant、write effects和cleanup。
4. 收集官方和物理Evidence：version、license、security、runtime/platform、native/install、availability和limits；营销材料/README只作候选说明。
5. 比较adopt、provider-only、interoperate、defer、reject和retire。外部输出必须由SEC validator、owning Gate或人工authority重新裁决。
6. 建立显式Provider boundary、typed protocol、timeout/cancellation/error/unsupported、observability和fallback；能力缺失不得使无关Core import失败。
7. 更新capability ledger、consumer adapter、tests、permission projection和retirement plan。需要package/lock时输出后继`govern-toolchain`，不并发双写。
8. 退役时删除入口、配置、standing MCP、scripts和当前口吻；历史Evidence保持historical且不可调用。
9. 对实际外部写动作验证target、dry-run/diff、reversibility、readback和cleanup receipt。

## 输出合同

```yaml
schema: sec-capability-decision-v2
capability:
consumer:
problem:
decision: adopt | provider-only | interoperate | defer | reject | retire
versionIdentity:
environmentCells: []
permissions:
  repository: []
  filesystem: []
  network: []
  credentials: []
  externalWrites: []
dataBoundary:
outputsAuthority: evidence | proposal | physical-result
fallback:
failureProtocol:
verification: []
ledgerDelta:
toolchainFollowUp:
retirement:
nextOperation: govern-toolchain | review-change | design-change | integrate-change | no-change
outcome: completed | blocked | design-required | no-change
```

## 失败与转移

- 无真实consumer或可验证收益 → reject/defer/no-change。
- 权限、数据或license边界不可接受 → blocked/reject。
- package/lock需要变化 → `govern-toolchain`。
- semantic permission/Provider protocol改变 → `design-change`。
- adapter/ledger candidate完成 → `review-change`。

## 示例

GitNexus可保留只读CLI Evidence，但standing MCP无consumer且权限面更大：退役MCP入口，不删除历史研究。

Browser Provider在Linux缺executable：输出unsupported，不让普通Compiler Core启动失败，也不把“未运行”记为PASS。

## 资源

- `../../registry.yaml`
- `../../README.md`
- external capability ledger、provider policy、permission evaluator
- official version/license/security sources与runtime capability Evidence

## 禁止

- 不把外部工具输出、分数、图、模型confidence或trace当canonical Fact。
- 不保留无consumer的MCP、credential或网络入口。
- 不让Skill的`allowed-tools`或说明文字放大Host权限。
- 不以“能运行”证明适合Core、稳定、正确或安全。
- 不引入没有fallback、retirement或owner的能力。
