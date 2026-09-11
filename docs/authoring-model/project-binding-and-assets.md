---
title: 项目、绑定锁与全工程资产
status: stable
domain: authoring-model
---

# 项目、绑定锁与全工程资产

本文拥有持久作者工程的 source-set 组织、Project Source、Binding Lock 以及非源码资产的作者角色。它不拥有具体 Implementation Resolution 算法、package acquisition、runtime state 或 Evidence verdict。

## 1. Project Source

项目文件存在的条件是：多个 source scope / module / target request 需要一个可持久消费的共同入口。单函数或临时固定上下文不强制建立。

逻辑字段：

```text
ProjectSource = exact {
  schema,
  projectId,
  sourceScopes[],
  modules{},
  targetRequests[],
  projectSelections?
}
```

`sourceScopes` 指明作者/原生/资产的可读取范围和解释角色，不授予 Effect。`modules` 绑定模块 locator 与 expected identity，不把路径本身当 identity。`targetRequests` 表达需要的输出/消费边界；没有请求的 Target 不创建空后端。

Project Source 不保存：
- 实际 chosen package/version；
- live provider 状态；
- secret value；
- runtime Attempt；
- Verification PASS；
- generated-file hash ledger。

这些分别由 Binding/Provider/Secret/Runtime/Evidence/Artifact owner 持有。

## 2. Binding Lock

```text
BindingLock = exact {
  schema,
  projectRef,
  authorInterpretationBindings[],
  implementationBindings[],
  providerAndDependencyClosure[],
  targetProfileBindings[],
  backendBindings[],
  resolutionInputDigest
}
```

每项绑定记录 exact identity/revision/integrity/config/adapter/target relation，并保留**选择来源**：explicit pin、governed decision、derived unique result 等。作者模块中的 dialect constraint 在这里解析为实际 interpretation/dialect revision。锁不是“最近成功状态”；Execution/Verification 不反写成锁的 truth。

变化分类：
- 作者正文只变但解释/使用未相交：锁可保持；
- Definition/Contract/dialect interpretation revision、Target、Constraint、Candidate closure、Provider integrity、Adapter、dependency、policy、Backend 或 required Evidence 变化：相交 Binding invalid；
- location 变化而 exact content/identity 仍可取得：只更新 locator，不重写 semantic Binding；
- 用户明确 pin 的旧版本仍合法：新默认不能自动覆盖。

Lock 的写入只发生在新的 Resolution Decision 被正式采用后；候选搜索和 dry-run 不覆写现锁。

## 3. 一个canonical项目模型，多个输入frontends

SEC 可以读取既有工程清单、第三方project format或迁移期载体，但它们只能是**input frontend/importer**：

```text
foreign / existing project carrier
        ↓ strict importer + coverage
ProjectSource + BindingLock candidate
        ↓ validation/adoption
one canonical project interpretation
        ↓
workspace / semantics / compiler consumers
```

Importer必须保留无法映射的字段为typed unknown/frontier，不能用默认值吞掉含义。项目身份、source scope、binding、target request等只有在映射/采用后才进入canonical模型。

下游 workspace/compiler 不允许长期同时读取“旧Project模型 + 新ProjectSource”并做两套决策，也不允许双写两个lock再靠比较维持一致。过渡期可做read-only shadow/conformance comparison；切换后只有canonical ProjectSource/BindingLock producer拥有写权，旧frontend若仍有外部consumer只负责输入兼容，不拥有第二semantic core。

这条规则与具体历史文件名无关：以后接入新的IDE/project manifest也必须通过同一admission，而不是扩张成另一套项目本体。

## 4. Source role

每个工程内容按真实角色解释：

| Source role | Meaning | 默认写者 |
| --- | --- | --- |
| structured-author | independent product/design decision | authoring owner |
| governed-native | native implementation or config | native/source owner |
| generated-managed | derived target bytes with source map | generator, unless ownership transferred |
| opaque-external | readable/linked but semantics incomplete | external owner; SEC records boundary |
| asset | resource/media/static data | asset owner |
| derived-view | index/report/navigation/HTML/SVG | generator only |
| runtime/evidence | observation/settlement/evidence | corresponding runtime/assurance owner |

一个文件可以物理包含多类信息时，只有存在可靠、可维护的边界才分区 ownership；否则采用整个文件的单一 writer，并用关系引用其内部事实。

## 5. 全工程资产

源范围不仅包含程序源码。真实任务可要求：

- build/package/tool configuration；
- schema、migration、seed/reference data；
- images/styles/fonts/localization；
- documentation/source comments；
- test/fixture/oracle；
- model weights/data descriptors；
- firmware/device resources；
- licenses/notices/SBOM inputs；
- generated target files；
- user-selected opaque assets。

未知格式默认 byte-preserving。没有解释器时可以 inventory/copy/hash（在有权范围内），不能编辑其 meaning。支持一种文件不要求转换成 JSON。

## 6. 路径、内容和 identity

必须分离：

```text
LogicalIdentity
PhysicalAddress
ContentIdentity
InterpretationRevision
ConfigurationSelection
```

移动文件通常只改变 Address；内容相同不自动合并 LogicalIdentity；同一 LogicalIdentity 的新 revision 可以有不同 ContentIdentity。

路径规范化必须处理平台大小写、Unicode、分隔符、symlink/reparse point、根逃逸和设备/网络边界；解析器不能用字符串前缀代替真实 containment 检查。

## 7. Secret 与权限

Project/Lock 只能保存 secret reference 与所需 capability，不保存 secret value。读取源码/资产的 Authority 与生成/安装/执行的 Authority 分开。锁定 Provider 也不代表当前凭据、配额或 endpoint 可用。

## 8. Candidate snapshot

编辑期间不要求每次按键生成持久 revision。真正需要分析、生成或应用时，Workspace 固定：

```text
CandidateSnapshot {
  source identities,
  exact content/revisions,
  interpretation/profile refs,
  unresolved frontier,
  read coverage
}
```

后续阶段只能消费这份冻结输入或显式启动新 epoch；不得中途读 `latest` 把同一次任务变成混合快照。

## 9. 草稿与缺项

结构/原生 source 可在不完整状态保存。状态必须区分：
- parse-invalid；
- parse-valid but unresolved；
- semantic conflict；
- MissingSupply；
- Target unsupported；
- implementation/evidence incomplete。

保存草稿不移动已发布 Binding/Artifact，也不要求生成 TODO implementation。对独立 root 的部分成功保留已完成结果；共同发行的 completion 仍按共同条件判断。

## 10. 格式演进

在公共 reader 尚未发布前，schema 可以以受控 breaking change 演进，但文档与范本必须同步。正式存在 durable/external reader 后：
- schema identity/revision 与 semantic revision 分开；
- parser strict；
- migration 有 owner、支持窗口和拒绝结果；
- 不通过“缺字段自动填默认”兼容未知历史含义；
- consumer-zero 后退役旧 parser，正常路径不永久 dual-read。

## 11. 退出 SEC

工程的退出条件是原生/目标资产和已声明必要运行依赖足以由普通目标工具链使用；不要求 SEC 守护进程、账户或专有 registry 才能理解已发布的用户资产，除非产品明确选择了该外部能力并接受其依赖。

结构化意图如果只用于未来再生成，可以作为可选工程源保留；删除它不允许谎称还能做同样的意图级演进。

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

Project Source 只组织持久作者输入与目标请求；Binding Lock 只固定精确解释和实现选择。既有/第三方project carrier只能通过严格frontend导入同一canonical ProjectSource/BindingLock，下游不长期双读双写。源码、资产、秘密、运行状态与证据保留各自真源，路径/内容/identity/configuration 分离，未知格式先保全，草稿允许不完整但不得移动已发布事实。
