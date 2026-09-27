---
schema: codex-development-work-package-v1
id: open-control-evolution-integration
tracking: none
base: e5880a5805260b3c478f9a3eed46cab13a79ba80
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: integrate-open-control-evolution
    owner: documentation-control-owner
    ownedPaths:
      - config/repository/work-packages/open-control-evolution-integration.md
      - .documentation/documents.json
      - .documentation/requirements.json
      - .documentation/source-manifest.json
      - docs/产品/产品要求与工作约束.md
      - docs/作者/组合/稀疏控制与目标限定.md
      - docs/作者/组合/语义扩展与领域接合.md
      - docs/依据/来源/语言编译与目标工具.md
      - docs/信息/存储保留与恢复.md
      - docs/信息/对象关系与配置基线.md
      - docs/内容索引.md
      - docs/决策/设计理由-目标与核心.md
      - docs/开发/AI协作/委派安全与持续交接.md
      - docs/开发/测试发现与执行.md
      - docs/架构/README.md
      - docs/架构/实现供给与替换.md
      - docs/架构/实现语言与机制演进.md
      - docs/架构/总体设计.md
      - docs/架构/装配/源绑定与解释映像.md
      - docs/状态/作者与接口.md
      - docs/状态/信息约束与验证.md
      - docs/状态/编译与目标.md
      - docs/演进/实施/安全构建发布与环境.md
      - docs/编译/实现选择与设计搜索.md
      - docs/编译/查询增量与性能.md
      - docs/编译/表示/目标运行与观测.md
      - docs/运行/保证/系统不变量与组合.md
      - docs/运行/保证/要求证据与裁决.md
      - docs/运行/发布运行与资源生命周期.md
      - docs/运行/权限与资源管理.md
      - docs/运行/验收/README.md
      - docs/运行/验收/会话集成与结果复用.md
      - docs/运行/验收/控制与演进案例.md
      - docs/运行/验收/方法与独立证据.md
      - docs/运行/验收/测试生成与形式方法.md
forbiddenPaths:
  - .github/
  - AGENTS.md
  - package.json
  - bun.lock
  - config/repository/active-work-package.md
  - config/repository/current-state.yaml
  - config/repository/rolling-plan.md
  - config/repository/work-selection.md
  - src/
  - tests/
acceptance:
  - 混合显式控制硬约束偏好与自动委派复用现有控制描述符和稀疏作者记录而不建立第二决策内核
  - 控制的表达解释选择施加观察裁决以及用户接管和旧任务围栏具有明确责任与失败语义
  - 未知内容保全与新解释激活分离且新语义新运行责任和根规则变化沿明确演进路径处理
  - 联合资源约束负依赖自适应政策身份表示迁移恢复和退出边界进入其canonical owner
  - 实现语言与机制按真实责任同口径比较且不保留无依据的性能排名迁移比例或全核重写命令
  - ProofObligation与VerificationMethodSelection的精确revision进入逐义务Evidence接纳且物理ActionKey只按真实执行输入去重
  - TestResponsibility由既有实施规范唯一拥有且每个义务binding分别解释失败含义观察边界和Oracle独立性
  - 79项条件化场景及6组联合攻击作为验收设计保存且不冒充产品测试已通过
  - 所有修改后的documentation projection与canonical正文保持当前冻结候选一致
  - 本工作包只拥有本清单和所列规范及documentation投影不修改运行代码依赖测试或workflow
tests:
  - tests/contract/agent-skills.test.ts
---

# 开放控制与机制演进规范融合

本工作包把开放控制、最大自动化、未来控制维度演进、实现语言与机制演进、迁移恢复以及精确验证绑定融合回SEC现有canonical owners。它不创建第二套DecisionDimension、控制数据库、验证真值或运行平台。

作者层保留稀疏差异和真实自定义程序能力；编译、运行和保证层分别拥有选择、施加、观察与裁决。新的可控维度按可观察区别和真实消费者接入，未知内容的保全与后来激活分开。实现语言是具体责任的机制选择，不改变SEC语言中立语义，也不要求先完整实现未来会废弃的过渡内核。

本包同时把验证义务、方法选择及其revision绑定到下游Action、Evidence和case-producing TestResponsibility，避免相同稳定ID或方法名跨语义修订复用旧证据。案例文档用于设计攻击与有限模型，不宣称软件实现、运行或完整形式证明已经取得。
