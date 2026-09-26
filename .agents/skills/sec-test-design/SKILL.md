---
name: sec-test-design
description: 用于已有 Claim/acceptance 需要 case/test 证明时，判断现有证据是否充分、oracle 是否独立以及最小 observation boundary；不创建第二套测试状态或删除权限。
---

# sec-test-design

## 触发
- 已有 canonical Claim/acceptance/invariant，但 case/test proof 尚未闭合，或现有测试疑似同源 oracle、重复证明、假 contract/E2E、成功型 fixture、实现布局锁定。
- Worker 只有改变测试语义、oracle 或退役判断才能继续时返回 `test-design-required`。

## 边界
- 本 Skill 由 A0 在有界测试设计任务中读取；仓库当前 hosted activation 只签发 Worker implement，注册信息不证明 hosted A0 design 已接通。`test-design-required` 回交主线程 A0，在已有授权内补齐语义后继续原任务，不默认请求用户审批。
- 没有 canonical Claim，或 verification method 尚未决定为 cases/test：返回 requirement/assurance owner；只执行、选择、复跑既有 tests：交给 selector/runner。
- CasePlan/casesRef 与实际测试框架继续拥有测试输入、oracle、环境和执行；Test Value/Supersession 继续拥有 keep/rewrite/merge/delete。Skill 不创建 `TestDesignDecision`、inventory、ledger、评分或平行 disposition。
- Skill 不扩张 Work Package/operation scope；测试重写与退役按[测试发现与执行 Q4](../../../docs/开发/测试发现与执行.md#developer-test-selection)取得各自证据，不能把 rewrite 当成无替代者删除的许可。

## 方法前置

- 进入 TestCase 设计前，先确认上游 Assurance 已把相交 Proof Obligation 的方法选择为 case/test。若类型、Source Program、架构审计、静态安全、形式证明、runtime readback 或其他直接方法已经能产生资格充分的 Evidence，不为统一入口再创建 `.test.ts`。
- repository invariant 应由其 canonical checker 对真实候选直接求值；TestCase 只校准 checker 的正反例、边界、解码与 failure meaning。禁止用测试复制生产规则、源码字符串、路径墓碑或私有布局形成第二真值。
- runner 的 ordinary parallel/isolation/shard/timing/retry/reporting 属于 adopted Provider mechanics。测试设计不得为了这些机械能力创造新的 semantic metadata、suite authority 或 scheduler；只有 Provider 无法表达的真实资源/权限/settlement约束才交回 Execution owner。

## 判断
1. 固定 Claim、适用域和真实失败模型；测试方法不得反向定义需求。
2. 先比较现有 evidence 的 observation、环境和 authority/effect boundary；已有 proof 已充分覆盖所需 observation 时，不新增测试。
3. Oracle 的判错依据必须独立于待证明行为。由同一生产 builder/catalog/selector/formatter 生成 actual 与 expected 只能证明明确的 plumbing relation，不能自证上游语义；差异输入、往返或变形关系可以比较生产结果，但性质与预期须有独立合同，并能区分真实错误。
4. 测试必须有可区分错误实现的 **failure witness**，但不强制专门造 counterexample。真实 regression、counterexample、mutation、differential/metamorphic case、boundary violation 或外部 readback mismatch 均可；property 已给出充分区分条件时不重复造 case。
5. 按最小 observation boundary 选层级：纯算法/codec/property 用 unit；跨 owner/storage/effect/recovery 用 integration；稳定外部 bytes/schema/config 用 contract；真实入口/进程/Git/宿主链才用 E2E。目录名本身没有证明力。
6. Fixture 只建立前置状态，不能先执行待证明 transition 或由同一 SUT 制造 postcondition。platform/env/clock/cwd/random/provider 必须绑定实际环境与隔离；skip/未运行不是 PASS，retry 不抹掉首次 failure。
7. 性能 Claim 必须有 workload、环境、baseline、measurement method 与 observed result；catalog 只是 plan。Golden/snapshot 只能因 Claim/公共合同变化由作者显式更新，不能由 actual 自动批准。
8. 输出最小可实施语义：复用哪个 proof，或需要哪个 test/case、输入、oracle/property、observation boundary、环境和 failure witness；已有 write scope 时由 Worker materialize。

## 完成
- 必须能回答：**新增了哪项现有 evidence 尚未充分覆盖的必要 observation？判错依据是否独立于待证明行为？** 两项任一答不出，不新增测试。
- Claim/consumer/authority/environment 未知且会改变结论时 fail-closed；疑似 merge/delete 只返回候选与所需 canonical evidence，不自行授权。

## 禁止捷径
- 不因生产文件变化机械增测，不以 test/assert 数量、coverage%、层级或“全绿”作为价值。
- 不用 pathname/string/private helper/function arity/version 常量代理真实性质，除非它们本身就是外部合同；不保留只证明自己注册/冻结的自指测试。
- 不靠弱化 assertion、扩大 timeout、sleep/retry、skip、吞异常或更新 snapshot 换绿色；本地 PASS、CodeQL 或“测试存在”都不能冒充其未证明的 Gate/平台能力。
