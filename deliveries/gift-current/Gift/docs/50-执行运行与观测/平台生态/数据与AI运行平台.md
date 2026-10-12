# 数据与AI运行平台

## 数据平台、事务、模式演进、质量、血缘与治理

### 数据是工程语义的一部分

数据库表、事件、特征、索引、缓存和数据产品有 identity、owner、schema、质量、权限、生命周期和消费者，不能只作为实现细节。

### DataAsset

```text
DataAsset = exact {
  semanticIdentity,
  physicalBindings,
  schemaAndSemanticRevision,
  ownerAndSteward,
  producerConsumerLineage,
  qualityAndFreshnessClaims,
  privacySecurityAndResidency,
  retentionDeletionAndLegalHold,
  compatibilityAndMigration,
  observabilityAndIncidentRefs
}
```

### 数据使用目的、处理资格与派生义务

`DataAsset`中的privacy/security字段不能缩成一个“sensitive=true”。同一数据可在某个目的、主体、接收方、法域和时间范围内合法处理，而在另一用途不合格。具体法律、合同、组织政策或用户选择仍由 `ExternalAuthorityBinding` / Policy / Grant 提供；本节只规定工程上必须保留的绑定。

```text
DataUseBinding = exact {
  dataAssetAndFieldScopeRefs,
  dataSubjectOrPopulationScopeRefs?,
  processingPurposeAndOperationKinds,
  authorityPolicyConsentOrOtherBasisRefs,
  controllerProcessorRecipientRefs,
  regionAndTransferConstraints,
  minimizationAndRequiredDataProjection,
  retentionDeletionAndLegalHoldRefs,
  derivedDataAndLineagePropagationPolicy,
  deidentificationOrDisclosureControls,
  validityRevocationAndRecheckTriggers,
  auditAndEvidenceRefs
}
```

这是现有权限/数据/外部权威的组合投影，不是新的Grant系统。数据可读不意味着允许任意目的处理；用户/系统同意某用途也不产生超出该范围的文件、模型、网络或发布权限。若某法域允许不依赖consent的其他处理基础，也由对应ExternalAuthority准确表达，不能把“没有consent”统一解释成允许或禁止。

**同意、授权和历史事实分开。** consent/opt-in/opt-out是有主体、版本、范围、取得方式、有效时间和撤回状态的Observation/authority input；撤回首先使未来相交使用资格陈旧，并触发实际政策要求的删除、停止共享或其他操作。它不能把已合法发生的披露、付款、训练Run或第三方读取从历史中抹去，也不能由产品擅自决定哪些过去处理必须物理撤销。

**最小化发生在收集与每次消费。** “数据库已有这一列”不是读取理由；query、AI context、日志、export、telemetry和debugger各自只取得本目的必要投影。把全记录先取到应用层再丢字段不等于数据最小化，尤其在跨租户、模型或第三方Provider边界。

### 派生数据、索引、统计、Embedding与模型训练

原始记录、清洗表、特征、embedding、索引、缓存、日志、聚合、训练Dataset snapshot、模型weight和下游报告分别有identity与lineage。上游删除/更正/撤权不自动说明每个派生物必须删除，也不自动说明它们可永久保留；具体传播由适用Authority/Policy和Transformation属性决定。

派生物至少能回答：是否仍可链接到个人/源记录；是否包含原值或可逆编码；生成方法和source revision；谁可使用；删除/更正是否要求重算；已外传到哪些不可控边界。Lineage不足时不能宣称“全部副本已删除”或“该模型从未使用此数据”，只能给已观察范围。

训练数据发生删除/更正后，可能的处置包括未来训练排除、重训练、经过验证的machine-unlearning/模型修复、限制模型用途、保留历史模型但撤销新使用资格，或在适用规则下无需改旧模型。哪条成立由真实权威与方法证据决定；从训练集删一行不能自动签发weight中影响已消失。

### 去标识化、伪匿名化与匿名性Claim

去掉姓名、替换ID或普通hash并不自动形成匿名数据。去标识化方法必须绑定发布/使用场景、攻击者可获得的辅助信息、直接/准标识符、变换、可逆密钥或映射、数据效用、重识别风险和后续组合风险。

```text
DeidentificationAssessment = exact {
  sourceDatasetAndRevision,
  transformationAndMethodRevision,
  releaseOrUseContext,
  directAndQuasiIdentifierTreatment,
  attackerKnowledgeAndLinkageModel,
  residualReidentificationRiskEvidence,
  utilityAndDistortionEvidence,
  protectionOfReversalKeysOrMappings,
  validityAndReassessmentTriggers
}
```

pseudonymization仍可能由密钥、映射表或外部数据重新链接，继续按相应敏感等级和权限治理。synthetic data、聚合和差分隐私也各自有方法/预算/泄漏条件；不能只因输出不是原始行就自动公开。无法在给定use/release场景达到所需风险边界时，选择受保护查询接口、受控环境、更强形式化隐私或拒绝公开，而不是修改“anonymous”标签。

### 数据主体/记录主体请求是有覆盖的工作流

访问、导出、更正、删除、限制处理等请求是否适用及期限/例外由外部权威决定；Gift只把被要求的动作工程化。一个请求至少区分requester/代表关系、subject matching、适用Authority、requested scope、身份核验、数据发现coverage、第三方/hold冲突、每个目标操作、导出/响应Artifact和最终residue。

```text
DataRightsOperation = exact {
  requestAndAuthorityRefs,
  requesterSubjectAndRepresentationRefs,
  requestedActionAndScope,
  identityMatchingAndVerificationEvidence,
  discoveredDataAndCoverage,
  conflictExceptionAndHoldRefs,
  plannedAndExecutedOperations,
  responseOrExportArtifactRefs,
  externalUncontrolledCopyRefs,
  settlementAndResidue
}
```

姓名/邮箱相同不足以把两个人的数据合并；无法唯一匹配时保持冲突或扩大有权取证。导出成功不证明全系统已发现全部数据，删除主库不证明缓存/索引/备份/第三方已结算，更正业务记录也不改写不可变审计历史。响应Artifact只包含当前请求有权披露的数据，不能为了“完整导出”泄露其他主体。

### 数据使用、隐私与派生义务的验证

覆盖purpose改变、consent撤回与在途操作、最小读取投影、跨Region复制、共享Provider、日志/telemetry残留、缓存/索引/备份复活、第三方副本、同名主体误匹配、partial discovery、legal hold冲突、de-identification后外部数据重识别、hash低熵ID、训练集删除但旧模型仍部署、machine-unlearning证据不足及导出包含他人数据。

### 事务与一致性

每个业务 invariant 绑定实际事务边界、隔离级别和外部 Effect。数据库事务不能覆盖消息和远程 API，需要 outbox、saga 或 reconciliation。

### 模式演进

```text
expand
→ backfill
→ verify
→ switch-read
→ switch-write
→ observe
→ contract
```

每步有版本、兼容、回滚、资源和读回。双写只在有界窗口和一致性证明下使用。

### 数据质量

完整性、正确性、唯一性、一致性、及时性、代表性和偏差分别建模。质量规则有总体、窗口、阈值、抽样和 owner；未观测不能写成零错误。

### 血缘

记录 source、transform、environment、code/data/model revision 和 output。字段级 lineage 只在真实影响/合规消费者需要时物化。

### 模式演进、数据质量与迁移的验证

模式漂移、部分回填、双写分叉、变更数据捕获缺口、迟到事件、重复键、隐私删除、备份复活、质量监控失败和消费者迁移漏计。

### 数据库工作台、会话、计划与行编辑的Provider接合

通用 `DataAsset/Schema/Migration/Operation/Observation` 足以拥有数据库开发事实；本节只规定专业客户端/Provider怎样接合，不另建数据库authority。

```text
SchemaIntrospectionSnapshot = exact {
  providerServerAndDatabaseRefs,
  sessionOrSnapshotRef,
  effectivePrincipalAndNamespaceRefs,
  metadataMechanismAndRevision,
  objectAndRelationObservations,
  providerSpecificExtensionRefs,
  visibilityAndCoverage
}

QueryPlanObservation = exact {
  statementAndParameterRefs,
  databaseSchemaAndStatisticsRefs,
  sessionPlannerAndRoleRefs,
  plannerProviderAndRevision,
  estimatedOrExecutedMode,
  planTreeRef,
  estimatesAndActualObservationRefs,
  executionEffectsIfAny,
  measurementOverheadAndCoverage
}
```

Introspection只描述当前可见metadata；名字相同不自动等于同一DataAsset。系统catalog能提供Provider专有信息，但不能把内部OID/物理地址无条件升级成跨restore/cluster稳定identity。

query plan属于一项有条件的Observation。planner statistics、table规模、配置、参数、cache/prepared-plan状态、索引与server revision都是相交依赖；显示plan不能直接写回作者源码。`EXPLAIN ANALYZE`实际执行statement，继续按原Effect/transaction合同结算；为了“只测计划”包在数据库transaction里rollback，只能撤销该事务真实覆盖的数据库作用，不会自动撤销外部函数/网络Effect。

row editor只能在Provider证明updatable target与强row locator时降低成DML。逻辑key优先；物理row-version locator明确短寿命，并绑定table/snapshot/transaction。更新后重新读回新的逻辑值、generated/default/trigger结果和locator；旧row-version引用失效。批量row edit需要明确每行/批次原子域，不能因GUI表格一次按Save就宣称跨行全原子。

schema comparison消费两个固定schema observations/author definitions生成TransformationView；真正migration使用既有兼容矩阵、MigrationPlan/Operation和readback。introspection刷新、schema diff生成、DDL执行、metadata refresh是四步，不用一个“Synchronize”状态合并。

数据导入/导出同样复用Artifact与Operation；文件/clipboard只是载体。导出中未授权列、masked值、截断分页和未稳定排序必须保留；导入的parse成功不证明constraints/triggers/外部effects成功，完成以后按目标数据库权威读回。

## 机器学习模型、数据、评测、漂移与人工智能安全

### 模型输出是候选，不是事实

模型可能随机、偏差、幻觉、被注入、数据过期和分布外失败。Gift 只把模型作为受约束 Provider，其输出进入 proposal/inference，不能自动取得 authority。

### ModelBinding

```text
ModelBinding = exact {
  modelAndProviderIdentity,
  versionOrContentRef,
  taskAndCapabilityProfile,
  promptAndToolContract,
  contextAndDataPolicy,
  evaluationAndSafetyEvidenceRefs,
  costLatencyResourceEnvelope,
  knownLimitationsAndUnsupportedDomains,
  driftMonitoringRequirementRefs,
  fallbackPolicyRef,
  retirementPolicyRef
}
```

### Model interchange与执行绑定

模型“格式兼容”不等于运行实现、数值或评测等价。外部模型表示作为ModelBinding的输入投影，至少固定表示规范版本、模型自身版本、operator/opset语义、扩展域、shape/dtype约束和目标backend能力。

```text
ModelInterchangeBinding = exact {
  modelArtifactRef,
  interchangeFormatAndRevision,
  irOrSerializationRevision,
  operatorSetAndExtensionRefs,
  declaredInputsOutputsAndConstraints,
  targetCompilerRuntimeAndDeviceRefs,
  unsupportedOrImplementationDefinedSemantics,
  conversionAndLossEvidence
}
```

ONNX的IR version、operator/opset version和model version是不同轴，不能拿onnx package release或文件摘要替代。StableHLO的portable-artifact compatibility只在其声明窗口、受支持feature与规范语义内成立；unsupported dialect/features、backend不支持的algorithm和数值accuracy等仍单独处理。格式checker通过不证明模型accuracy、安全、性能或目标设备支持。

### 模型生命周期身份不能被registry alias压平

`ModelBinding`只回答“本次任务允许采用哪个模型/Provider能力及其适用证据”，其中评测、漂移、fallback和retirement字段都只是固定的Evidence/Requirement/Policy引用，不保存后来发生的监测结果、fallback Attempt或退役历史；这些变化使Binding陈旧或生成新的Operation/Observation/Record。它不替代训练、制品、注册表、部署和单次推理的真实身份。至少区分：

```text
TrainingDefinition / TrainingRun
DatasetRevision / EvaluationDatasetRevision
ModelArtifact / WeightClosure
PortableModelRepresentation
RegistryEntry / ModelVersion / MutableAlias
ServingArtifact / ServingGeneration
InferenceAttempt / OutputObservation
```

同一逻辑模型名可以有多个权重和部署；同一权重又可经不同tokenizer、pre/postprocess、quantization、adapter/LoRA、runtime compiler、hardware engine和generation parameters得到不同实际行为。Registry中的version/tag/alias只是外部管理事实，特别是mutable alias不能作为长期证据主体。

```text
ServingGeneration = derived {
  exactModelArtifactRefs,
  tokenizerAndPrePostProcessRefs,
  adapterOrFineTuneRefs,
  quantizationOrCompiledArtifactRefs,
  runtimeProviderAndRevision,
  hardwareAndExecutionProfile,
  promptToolAndSafetyPolicyRefs,
  batchingCachingAndRandomnessPolicy,
  deploymentAndRoutingGeneration
}
```

它仍由现有Artifact/Provider/Deployment对象组成，不新建另一套模型仓库。`InferenceAttempt`必须绑定一次实际ServingGeneration、input/content refs、随机/采样条件、路由/fallback、batch位置和attempt identity；返回文本/embedding/logits等是Observation或Artifact，不能只用model alias解释。

### 可移植模型格式只拥有表示语义

ONNX、StableHLO等可移植表示只承担各自规范描述的graph/program和operator semantics。它们不拥有训练数据、模型registry、部署采用、线上权限或评测Verdict。模型文件引用external tensor data时，artifact identity覆盖完整外部数据闭包；只hash主 `.onnx` 文件会漏掉真实权重。

格式版本、IR version、opset/extension set和转换工具revision分别参与兼容。转换/优化/量化后即使预测样本看似一致，也形成新的representation/artifact及相交验证义务；不能因“还是同一个模型名”复用旧性能/数值/安全Evidence。

### Serving与一次Inference

模型服务器启动成功不等于指定ServingGeneration已ready，health/readiness、权重加载、warmup、routing和真实traffic adoption分别观察。动态batching可以让多个请求共享一次设备执行，但每个request/attempt仍保留自己的输入、授权、取消和输出映射；共享GPU kernel不合并业务身份。

fallback是新的resolution：主模型失败后切较小模型、旧模型、另一Provider或规则系统时，必须保留实际selected binding和能力/安全差异。返回一个“成功回答”不能把fallback伪装成主模型结果。

streaming/token输出具有时间与取消边界：已发送token无法因后续取消从消费者撤回；cancel accepted不证明device/provider计算立即停止。最终usage/cost、工具调用和外部Effect各按真实Provider回执结算。

### 训练Run与再现

TrainingRun绑定训练代码/配置、初始model/weights、精确dataset revision、数据顺序/采样、random seeds及不可封闭随机源、distributed topology、hardware/runtime、optimizer状态、checkpoint和输出artifact。记录seed不等于训练必然bit-reproducible；GPU nondeterminism、数据服务、库算法和并行归约等仍按真实依赖说明。

checkpoint只表示训练状态快照，不自动成为可发布模型；resume产生同一训练谱系中的新attempt/generation，并保留从哪个checkpoint、哪些数据和环境继续。训练metric不是线上SupportCommitment，offline evaluation也不直接代替production distribution。

### 模型定义、可移植表示、权重、引擎与Serving不是同一主体

“模型版本”至少可能指作者/训练定义、某次训练Run产生的具体权重、ONNX/StableHLO等可移植计算表示、目标编译器生成的engine/executable、registry alias、Serving deployment及单次InferenceAttempt。它们不能共享一个latest/modelVersion字符串。

```text
ModelExecutionBinding = exact {
  modelDefinitionRef,
  trainingRunAndDatasetRevisionRefs?,
  weightArtifactRef,
  portableIrArtifactAndSemanticVersionRefs?,
  compilerAndTargetEngineRefs,
  servingGenerationAndEnvironmentRefs,
  runtimeProviderAndDeviceRefs,
  executionPolicyRefs,
  validityAndInvalidationRefs
}
```
`ModelExecutionBinding` 只固定一次 serving generation 可采用的模型/compiled representation/runtime/device 关联；每次 `InferenceAttempt`、input 与 output `Observation` 独立拥有自己的 identity。推理完成不会修改 Binding；模型、serving generation、runtime/device 或 execution policy 变化使旧 Binding 失效。

ONNX的IR version、opset/domain version和具体model version彼此独立；解析一个ModelProto不证明当前runtime支持其全部opset/extension，也不证明转换后数值特性满足原Claim。StableHLO等portable artifact同样只在其正式兼容窗口、规定序列化路径与已规范语义内提供可移植性；pretty-print、任意MLIR bytecode、未规范扩展或实现定义数值精度不能自动继承兼容保证。

模型格式转换是Transformation，必须保留原/目标语义范围、量化/精度、shape/dynamic behavior、custom op、随机语义和不支持项。转换器成功只证明它产生了目标表示，不证明目标runtime输出等价；按Claim需要做reference/differential/tolerance验证。

registry的`production`/`best`/alias只是当前选择指针。alias移动不改写历史InferenceAttempt和评测；Serving rollout成功也不说明所有节点、accelerator cache、batcher或长期连接已采用新weight/engine。运行请求绑定实际deployment/engine/weight observation，无法取得时不能按控制面期望版本补造。

### 数据

训练、微调、检索、评测和运行数据有来源、许可、隐私、质量、代表性、时间和删除义务。模型版本号不能代替数据/行为闭包。

### 评测

benchmark、golden、adversarial、tool-use、long-context、cross-domain 和真实任务分别。防止 contamination、overfitting、grader bias 和代理指标。

### 漂移

Provider 更新、模型别名、系统提示、工具、数据和政策变化都可改变行为。旧 Evidence 绑定 exact closure，漂移后降级。

### 安全

prompt injection、data exfiltration、tool misuse、jailbreak、indirect injection、model inversion、unsafe autonomy 和 human overreliance。物理工具权限由外部 broker 控制。

### 验证：机器学习模型、数据、评测、漂移与人工智能安全

同输入非确定性、Provider 别名漂移、上下文截断、检索投毒、秘密泄露、评分器共享同一模型、分布漂移、回退到更弱模型和撤销。
