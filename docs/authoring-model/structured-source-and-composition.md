---
title: 结构化源、定义与组合
status: stable
domain: authoring-model
---

# 结构化源、定义与组合

本文细化结构化作者模块的 grammar-independent contract。JSON 是当前可直接实现的严格载体，但字段合同属于 Authoring Model；未来若存在另一种无损 authoring frontend，必须降低到相同对象、作用域、identity 和 Requirement 语义，不能建立第二套产品含义。

## 1. AuthorModule envelope

```text
AuthorModule = exact {
  schema,
  moduleId,
  namespace,
  dialects,
  imports,
  definitions,
  exports
}
```

- `schema` 选择外层模块 grammar 与严格 decoder；未知 schema 返回 unsupported。
- `moduleId/namespace` 是作者命名域身份，不从文件路径推导。
- `dialects` 把 definition-kind 前缀绑定到**准确的语义 dialect identity 与允许 revision constraint**；例如 `req:*` 只有在 `req` 已绑定 requirement-structure dialect 后才可解释。token 前缀本身不拥有语义。
- `imports` 给每个外部定义一个明确别名和 exact source/binding；同名冲突不按读取顺序裁决。
- `definitions` 只保存本模块拥有的作者含义。
- `exports` 只公开 Definition identity；它不等于运行 symbol、package export 或外部写权。

`dialects` 不是任意 plugin 自动加载表，也不授予运行能力。Module admission 先校验 dialect declaration，再由 Binding/interpretation owner 解析 constraint 到 exact supported dialect revision；未知 dialect、无满足 revision、同前缀多义或 definition kind 使用未声明前缀都 fail closed。Binding Lock 固定实际采用的 dialect/interpretation revision，后端不能按本机“最新插件”重新解释同一 AuthorModule。

重复 JSON key、未知字段、非法 Unicode/number、路径越界或缺失 import 都在语义实例化前拒绝。解析成功只说明结构可读，不说明 Requirement 可满足。

### 1.1 `requirement-structure` v1 的最小构造

当前 `req` dialect 只需要五种 Definition 角色；它们是 Authoring frontend 构造，不是第二 Engineering IR：

```text
req:subject      -> SubjectDefinition
req:value-type   -> local/nominal Type reference or finite-enum declaration
req:enum-value   -> nominal value identity
req:rule         -> typed Requirement/Preference schema bound to one canonical contract
req:composite    -> reusable Definition with parameters/subjects/terms/exposes
```

- `SubjectDefinition` 只声明合法 subject kind/role 结构；实例 identity 在 `use`/outer composition 中产生。
- `ValueTypeDefinition` 必须降低到 Compiler 唯一 Type Algebra。有限 enum 可以有 frontend shorthand，但不能建立独立类型系统。
- `EnumValueDefinition` 必须属于一个可解析 nominal value type；裸字符串或显示名不产生 enum identity。
- `RuleDefinition` 包含 `strength = require | prefer`、typed fields 与 canonical contract/meaning binding。旧式文档路径、说明文字或实现状态不能充当规则语义；字段 `meaning` 只能是人类说明，真正语义来自 rule/contract identity。
- `CompositeDefinition` 组合现有规则/定义，本身不等于运行对象或实现。

Rule field 在语义层只有两类入口：**Subject reference** 或 **Type Algebra value**；`enum`、`set`、`positive-integer`、`value` 等 JSON 形式若由某 dialect revision 提供，只是可严格归一的 frontend shorthand。归一后必须得到唯一 TypeRef + constraint 或 SubjectKindRef，后续 Compiler 不再读取这些 shorthand 决定语义。

Composite term 的 v1 封闭集合：

```text
Term =
    UseTerm { definitionRef, arguments }
  | RuleTerm { require|prefer, fields }
  | AllTerm { terms[] }
  | AnyTerm { alternatives[] }
  | WhenTerm { condition, then[], else[]? }
  | ForEachTerm { bind, finiteDomain, body[] }
  | ExistsTerm { bind, finiteDomain, body[] }
```

`require` 只能引用 require-strength rule，`prefer` 只能引用 prefer-strength rule；调用形式不能覆盖 rule 本身的 strength。

设计期 ValueExpr 的 v1 核心只允许可冻结、可类型检查的构造：literal、parameter、subject、bound variable、nominal enum ref、typed list/record/value ref。Condition v1 只需要 typed equality 与 Bool value test；它不包含任意函数调用、I/O、时钟、随机、workspace read 或通用运行表达式。出现新的 condition/value construct 时必须通过新 dialect revision 明确其 Type/Effect/求值/失效语义，不能借未知 JSON object 自动扩展。

`all/any/when/forEach/exists` 中的嵌套 body 仍由同一 Term grammar 解释；bound variable 只有词法作用域，没有隐式捕获外层同名 binding。解析后的 normalized term graph 保留 origin、use-site 与 subject identity，然后才进入 canonical Engineering Semantics。

## 2. Definition

```text
Definition = exact {
  id,
  parameters[],
  subjects[],
  terms[],
  exposes?
}
```

Parameter:

```text
ValueParameter {
  id,
  type,
  default? // closed value only
}

SubjectParameter {
  id,
  subjectKind
}
```

Subject 是逻辑身份槽而不是 runtime object。每次 `use` 可创建新私有 Subject，或显式传入父级共享 Subject；**只有准确 identity 相同才合取要求**。

Definition 的 body 可以隐藏任意内部 Subject/term；`exposes` 只把必要的逻辑边界映射为稳定公开槽。父 Definition 若需要公开子定义内部能力，应先把父级 Subject 传给子定义，再公开父级同一 Subject；不得绕过封装按内部 ID 穿透。

## 3. DefinitionRef 与引用解析

引用至少包含：
- 当前 import alias；
- exported Definition identity；
- exact bound source revision/contract revision。

显示名、相对路径和搜索排名只是 locator。解析返回唯一目标、ambiguous、missing、unsupported 或 incompatible；不能 first-match。

跨 revision 同名 Definition 只有在 binding 明确选择后才能实例化。锁定旧 Definition 的 use-site 不因为默认定义升级而原地改义。

## 4. `use`

`use` 做**语义实例化**而不是文本复制：

```text
use {
  ref,
  arguments
}
```

处理顺序：
1. 解析 exact Definition；
2. 检查参数集合和类型；
3. 先验证全部默认是否合法；
4. 显式值覆盖省略默认；
5. 为未外传的私有 Subject 建新 identity；
6. 替换 Value/Subject 参数；
7. 展开 terms，但保留 origin/use-site/subject identity；
8. 检查 Requirement 冲突与公开边界。

同一 Definition 被用两次并不因此共享可变 state；只有明确传入同一 Subject、resource 或 instance binding 才共享相应对象。

## 5. `require` 与 `prefer`

`require` 绑定：
- rule/contract identity；
- `on` 或其他 Subject role；
- typed field values；
- applicable universe。

Rule 的字段具有准确类型：literal、nominal enum、record/list/map/union 等由共同 Type Algebra 解释；任意 JSON object 不能当“未来扩展”。

`prefer` 与 `require` 使用同一主体/字段解析，但只生成软排序义务。任何安全、Permission、license、Effect、兼容、正确性和资源上限等硬 Constraint 先过滤候选；Preference 不能补偿。

## 6. `all`、`any`、`when`

`all(terms)` 对同一实例化环境合取。

`any(alternatives)` 的一个 alternative 必须整体满足；选定分支、其见证和实际绑定进入 Resolution Decision，Target lowering 不可重新选另一分支。

`when(condition, then, else?)` 的 condition 只读取已经固定的设计值/外层 binding。三态求值：

```text
true     -> enable matching branch
false    -> enable opposite/no branch
unknown  -> unresolved; never silently false
```

未激活分支仍做 schema/type/reference 合法性检查，使无效内容不能藏在“现在不走”分支；但该分支没有实现供给时，不阻塞与它无关且已证明不可达的当前 Target。

条件为 false 只表示“不增加此 Requirement”，不是自动产生 `forbid`。

## 7. `forEach` 与 `exists`

量化域必须：
- 在该 design revision 内有限且可枚举；
- 元素类型固定；
- 元素 identity/ordering 规则明确。

`forEach` 为每个元素创建有独立 binding environment 的义务。`exists` 选择一个见证；见证进入 Binding/Decision，不能在后端再次漂移。

Occurrence path 只用于同一 frozen snapshot 的局部定位；插入前项后不能把“位置相同”当成跨 revision identity。跨 revision 的 subject continuity 使用真实 identity/edit/migration relation。

## 8. Value

Value 是有限精确联合，而不是“JSON 任意值”。最低支持：
- Bool；
- Text（合法 Unicode scalar sequence）；
- exact Int；
- bounded/defined rational or numeric profile；
- nominal enum；
- list/record/map 等复合值；
- typed reference；
- `null` 仅在类型显式允许时成立。

JavaScript `number` 不能自动承担数学 Int。wire/display encoding 与 semantic value 分开；例如大整数可用规范十进制字符串传输，但其语义仍是 Int。

## 9. 公共管脚

“管脚”只是一种**公开 typed boundary view**，不是全系统强制建模单位。一个 pin 至少绑定：
- exposed Subject/value identity；
- direction/role；
- type；
- required/optional；
- activation condition；
- effect/resource contract（若有）。

合法连接要求 identity/role/type、值域、错误、Effect、时序、资源和目标兼容；同名端点不能直接连。

分析依赖边、作者连接边、运行数据流、任务依赖边和文档关系是不同 relation，不统一成“线”。

## 10. 结构编辑

结构编辑必须保留作者 identity 与语义一次性：

- **rename**：按已解析 symbol/ref 更新，不做全局文本替换；
- **extract**：计算 free value/subject/effect set，显式形成参数，保持 once-evaluation 与控制/异常语义；
- **inline**：只在捕获、作用域、求值次数和 Effect 顺序可保持时展开；
- **expose**：公开既有父级 Subject/role，不凭内部路径创建第二对象；
- **change signature**：构造所有已知消费者的联合候选，不能先提交 provider 再逐个修坏消费者；
- **format/import organize**：只处理被声明为 presentation/ordering freedom 的区域。

无法证明保持时产生候选与明确 blocker；不能为了让重构工具成功缩窄原要求。

## 11. 混合工程

同一物理工程允许：
- 结构作者模块；
- 完整原生源；
- 受管生成区域；
- opaque external source；
- assets/config/data。

每个区域一个 writer。部分转换只有在边界可稳定定位且消费者闭合时成立；无法可靠切开的单文件保持原生 owner。查看结构、导出 JSON、生成代码都不转移写权。

未知扩展若可能注册全局符号、改变默认、Effect 或解析结果，不能因当前视图没画边就视为无影响。

## 12. 诊断

诊断至少携带：
- stable code；
- author source span / logical subject；
- message/data；
- affected root；
- severity/admission class；
- fix candidate（若存在）；
- unresolved dependency/requirement identity。

类型错误、主体 hole、Requirement conflict、MissingSupply、UnsupportedTarget、PermissionDenied、EvidenceMissing 是不同类别；“生成不了”不能统一变成语法错误。

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

结构化作者源以 Definition/Subject/Requirement 为核心，AuthorModule 显式绑定外层 schema 与所用语义 dialect revision；`requirement-structure` v1 具有封闭Definition/Term/设计期表达构造并统一降低到 Engineering Semantics 与唯一 Type Algebra。所有组合保留 exact identity、作用域和来源；默认只省略机械重复，条件/量化不吞 unknown，管脚只是可选公开边界视图，结构编辑和混合原生工程始终保持单写者及一次求值/Effect 语义。
