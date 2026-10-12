# Gift112：现有声明式语言为何只能覆盖通用意图的一部分

本文件是方法比较材料，不是当前 IntentDefinition、Method 或 Target 的第二权威。以下各资料为公开原始入口；实际产品兼容与完整实现均需另行检验。

## DMN 与规则评估

OMG 的 DMN 用于结构化业务决策与规则，也说明流程、案例和决策往往互补，不是一种语言同时替代所有职责。公开入口：<https://www.omg.org/dmn/>；规范入口：<https://www.omg.org/spec/DMN/1.5>。Gift 可复用合格决策引擎为 `Decision` 类型 Method；但业务目标不一定是单次给出决定（例如受权实际支付、跨时间禁令）。不能把 Decision 输出直接当作 Effect/事实。

## Rego 与策略评估

OPA/Rego 提供声明式规则，并将策略决定与执行分离。官方资料：<https://www.openpolicyagent.org/docs/policy-language>、<https://www.openpolicyagent.org/docs>。Gift 可把已接受策略作为有版本的 Meaning/Requirement，与外部执行者分别资格化；“策略允许”本身不创造目标宿主 Grant，更不能证明某个动作已经发生。

## 有界规划与真实行为

PDDL 将行动前提、效果与目标分开，是有限条件下从目标求出操作序列的成熟参照：<https://planning.wiki/ref/pddl/domain>、<https://planning.wiki/ref/pddl/problem>。其常见封闭世界假设不能直接应用于现实外部事实。Gift112 的有限演示刻意保留 Unknown 与 `NoPlanInSuppliedFiniteModel`，不把搜索有界穷举称作全业务不可实现。

## 现实授权与资格

NIST SP 800-162 将主体、对象、操作及环境属性作为访问控制的判断基础：<https://csrc.nist.gov/pubs/sp/800/162/upd2/final>。这只为明确授权层的对象/条件提供依据，不证明一个 IntentSource 有效时现实主体自动获得权限。

## 对 Gift 架构的实际影响

现成规则、决策、关系、规划、优化、流程、UI、设备引擎有不同正确性与可观察边界；应当通过版本化语义资格和 Method 适配组合，而不是重写所有功能为一种语言。即使能把有限模型全部编译成程序，也不能推知所有业务事实、未知的法域政策或主观质量。保留这些独立机制及不同的失败路径，比再枚举行业名称更有助于实现通用意图语言。
