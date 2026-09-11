---
title: 作者模型
status: stable
domain: authoring-model
---

# 作者模型

本文拥有 SEC **作者侧工程事实的结构与解释边界**：用户/AI 真正维护什么、哪些决定可以复用、哪些内容只属于实现供给，以及作者内容如何进入 canonical Engineering Semantics。它不是新的 Product Domain；作者内容经严格解释后进入 [Engineering IR](semantic-model.md)，具体实现由 [Compiler / Target IR](compiler-target-ir.md) 解析，现实写入与执行仍经过既有 Operation/Authority 边界。

SEC 不要求发明一门新的通用文本编程语言。当前产品主线允许并鼓励直接复用原生目标语言源码、成熟库、配置、资源和设备/服务能力；**只有与具体实现独立存在的产品决定**才需要独立作者表示。`.sec` 或其他中立计算表示只在被明确选择为某个计算/校准区域的表示时成立，不是所有工程的前置。

## 1. 作者成果的四类真源

| 角色 | 负责 | 不负责 |
| --- | --- | --- |
| Structured author module | Definition、Subject、Requirement、组合、参数、选择和公开逻辑边界 | 算法实现、安装结果、运行 PASS |
| Native/governed source | 已有或新写的真实实现、脚本、配置和目标语言结构 | 反向定义产品要求 |
| Asset/data source | 图像、资源、数据、schema、模型等真实载荷 | 因“放进 JSON”获得语义权威 |
| External/adopted definition | 已采用的标准、库/协议合同和外部能力 | 自动获得 SEC Authority、Permission 或 Verification |

同一独立决定只有一个可写 owner。解释视图、IDE 表单、图、HTML、生成源码和 AI context 都是投影或派生物，不能形成第二写源。

## 2. 结构化主面的核心对象

结构化作者模块采用严格、带 schema identity 的对象表示。最低共同模型：

```text
AuthorModule
  identity
  imports
  definitions
  exports

Definition
  identity
  parameters
  subjects
  terms
  exposes

Term =
    use
  | require
  | prefer
  | all
  | any
  | when
  | forEach
  | exists
```

其中：

- **Definition** 是可复用含义单元；Block 只可作为某类复合 Definition 的设计角色，不是全局核心对象。
- **Subject** 是需求实际约束的逻辑对象/角色；同类型的两个 Subject 不因此是同一实例。
- **Value parameter** 传值；**Subject parameter** 传准确主体身份，二者不能互换。
- **use** 实例化已有 Definition；**require** 引入硬义务；**prefer** 只在全部硬资格满足后参与选择。
- **exposes** 公开逻辑主体或合法角色路径，不自动产生运行函数、HTTP 路由或权限。
- display label、文件名、数组位置和目录路径都不是作者对象 identity。

未知字段、重复 key、无法唯一解析的引用、类型不符、非法默认、越界暴露或作用域捕获必须 fail closed；不能为“向前兼容”静默吞掉会改变 meaning 的输入。

## 3. 默认、选择、条件与量化

Value 参数可以声明**闭合默认值**，仅用于省略机械重复：

```text
effective(parameter) =
  explicit_argument
  else closed_default
  else missing
```

默认：
- 不能读取运行环境、时钟、随机、其他参数或隐式服务；
- 与硬要求冲突时报告冲突，不自动寻找别的默认；
- 显式写入与“沿用默认得到同值”保留不同来源，因它们在后续定义升级时行为不同；
- list 默认按完整值替换，除非具体类型另有显式合并语义。

组合运算的含义：

| 构造 | 精确含义 |
| --- | --- |
| `all` | 同时满足全部子义务 |
| `any` | 至少一个**完整备选**成立；不得从多个失败分支拼一份成功 |
| `when` | 在已固定设计条件下施加相应要求；未知不等于 false |
| `forEach` | 对有限、已知元素类型的设计域逐项实例化义务 |
| `exists` | 在有限设计域内存在一个满足条件的见证 |

空域遵循量词语义：`forEach/all` 对空域真、`exists/any` 对空域假；但产品正常功能、非空输入等独立 Requirement 仍必须单独成立，不能借空真把空产品标成完成。

动态成员、无限流、运行期变化、分布式成员关系不能伪装成上述有限静态量化；它们由相应状态/流语义承担。

## 4. Requirement 与 Preference

Requirement 的 identity、主体、量词、输入域、允许结果、失败、状态/效果、资源和适用条件必须可定位。名字相同、函数签名相同或输出样例相同都不能替代这些条件。

多个 Requirement 的联合实现要求：

```text
exists one admissible implementation/binding closure
such that
all active hard obligations hold
for the required input/environment universe
```

这与“每个例子分别存在某个程序能通过”不同。

Preference 只排序已合格候选。优先级采用词典式/分层比较：
1. 高优先级确定支配时直接决定；
2. 高优先级全部确定相等才进入下一层；
3. 高优先级存在 trade-off 或 unknown 时保留该前沿，低层不能补偿；
4. 同层不同量纲没有被明确归一/权重前不得私自相加。

由求解器选择的备选分支不能通过“选择一个没有该偏好的分支”逃掉共同 Preference；条件化 Preference 必须有可比较规则。

## 5. 作者源、项目清单与 Binding Lock

持久工程可有一个项目清单与一个解析/绑定锁；它们角色不同：

**Project source** 保存：
- 工程 identity；
- source scopes / module locators；
- 明确的作者入口；
- 需要的 target/deliverable 请求；
- 项目级公开选择。

**Binding lock** 保存：
- 已解释的 Definition/Contract revision；
- exact Implementation Binding；
- Provider/package/integrity/config/adapter/dependency closure；
- Target/Profile/Backend identity；
- 解析输入 digest 和必须保持的选择来源。

它们**不分别表示“全部意图”和“全部实现”**，也不要求工程只有两个文件。真实源码、资产、数据和工具锁保留自己的格式及 owner。项目清单不是 Permission，锁文件不是安装/运行 Evidence。

短表达式、单函数或固定上下文的小任务不强制先建立完整项目。只有持久复用、分发、多根目标、恢复或跨会话绑定确有消费者时才持久化项目/锁对象。

## 6. 原生源码与结构化意图如何共存

三条正常路径同等合法：

1. **已有实现已经表达完整需求**：直接采用原生源码/库，结构层只保存真正独立的要求或可以完全省略。
2. **已有行为只需改变消费方式/参数**：作者保存差额；Target/Adapter 负责真实转换。
3. **存在新的独立行为关系**：用 Definition/Requirement 表达该关系，由供给侧选择成熟实现或创作实现。

不得为了证明 SEC 存在而把 TS/Rust/Java/C/Python 等源码机械改写成 JSON 或 `.sec`。同样，不得因为原生源码存在就把独立产品要求、隐私/时序/资源/错误合同退化为实现注释。

## 7. 编辑、身份和再次修改

作者修改针对稳定逻辑 identity，而不是“第 N 个节点”。移动/改名但含义连续时保持 identity；split/merge/replacement 需要明确后继关系；不唯一时返回 ambiguous。

结构编辑遵循：
1. 固定作者 revision 和目标语义对象；
2. 解析名称、类型、Subject、默认与真实使用点；
3. 形成候选变更，不立即发布；
4. 重算相交 Requirement、Binding、Target 与消费者；
5. 生成/回写唯一作者区域；
6. 检查当前前像仍匹配；
7. 发布新 revision，旧运行和旧产物继续绑定旧来源。

格式化、重排和导入整理不能借机改变 meaning。重命名必须更新已解析引用而不是文本替换；函数抽取/内联必须保持一次求值、捕获、控制流、异常/效果、可见性和 source mapping。

生成区域如果被人工编辑，先成为候选：能准确回源则回到作者 owner；决定由人工接管时显式转移写权；不能长期保留两个竞争 writer。

## 8. 作者视图与完成

面向用户/AI可以生成四种常用视图：
- **作者视图**：公开 Definition、参数、共享 Subject 和独特决定；
- **解释视图**：完整 Requirement、来源、默认/固定选择与理由；
- **实现视图**：实际 Candidate/Binding/Adapter、Target 产物和剩余 import；
- **运行视图**：制品、参数、实例状态和未结算责任。

它们都读取同一 canonical 对象，不是四份可写模型。

作者设计闭合只表示：定义、引用、类型、条件、默认、公开边界和需求含义无待猜项。它不证明 Implementation、Verification、Deployment 已完成。

子规范：
- [结构化源、定义与组合](authoring-model/structured-source-and-composition.md)
- [项目、绑定锁与全工程资产](authoring-model/project-binding-and-assets.md)

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

SEC 的作者模型只保存与具体实现独立存在的工程决定；结构化 Definition/Subject/Requirement 是当前主要高层载体，但原生源码、成熟库、资源和专用格式保持一等真源。Block 不是全局本体，`.sec` 不是必经语言；Project Source 与 Binding Lock 分责，所有派生视图均不得形成第二作者权威。
