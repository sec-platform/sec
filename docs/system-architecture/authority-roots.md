---
title: Authority Root、Adoption 与决策终点
status: stable
domain: system-architecture
---

# Authority Root、Adoption 与决策终点

本文拥有 authority closure 的 root kinds、universal law 与 project adoption 分离、compound issuer 与 delegation ceiling。具体 Operation Grant流仍由 `operations-and-resources.md` 拥有。

## 1. 所有 Authority 都回到 Product 是错误的

Product/Domain 决定用户结果与业务语义，但不能因此拥有跨项目 Design Calculus、Engineering Constitution、Agent Constitution 或外部法律/Provider authority 的通用含义。

必须区分：

```text
AuthorityRoot =
  | UniversalLawRoot
  | ProjectLawAdoptionRoot
  | ProductOutcomeRoot
  | DomainDefinitionRoot
  | RepositoryGovernanceRoot
  | ExternalAuthorityRoot
  | CompoundIssuerRoot
```

## 2. Universal law 与项目采用

```text
UniversalLawRoot
  owns: law/principle/calculus definition revision

ProjectLawAdoptionRoot
  owns: this project adopts exact law revision/profile
```

例如：

```text
EngineeringConstitution@R
```

由 engineering-constitution owner定义；SEC Product/Project可以决定：

```text
SEC adopts EngineeringConstitution@R
```

但不能反向改写该 law 的通用语义。项目若需要例外，只能在 law允许的 profile/decision boundary 内收窄，或正式演进 law owner。

## 3. Product / Domain roots

`ProductOutcomeRoot`拥有 accepted outcome、non-goal、不可推导产品 tradeoff；`DomainDefinitionRoot`拥有业务 Definition、invariant、public operation/state/failure semantics。

Product constraint 可以约束 Domain，但 Product 不能因父层关系自动取得某个 Domain writer/parser/Effect authority；这些由 ResponsibilityAssignment与Grant单独签发。

## 4. Repository governance root

Repository/organization可以拥有：branch/ruleset/publish process、maintainer role、trust epoch、break-glass policy等 governance decision。它不能创造产品语义 truth，也不能因为 admin capability 自动取得某 Domain semantic mutation authority。

## 5. External authority root

法律、license、external service principal、provider account、OS/security policy等可以成为独立外部 authority输入。SEC只能观察/绑定/收窄它们，不能把它们伪装成 Product 自己签发。

## 6. Compound issuer

需要 quorum/threshold/segregation-of-duties 时：

```text
CompoundIssuer = exact policy + participant shares + linearization protocol
```

combined authority是一个新的 issuer result，而不是多个 competing canonical owners。participant只拥有其份额。

## 7. Authority closure

```text
AuthorityClosureValid =
  finite
  and acyclic
  and every delegation edge non-amplifying
  and every terminal root has an explicit AuthorityRoot kind
  and root kind is authorized for the decision/effect dimension
```

因此不能再写泛化规则：

```text
all authority eventually terminates at Product/Domain
```

正确的是：

```text
all authority terminates at an admitted root authorized for that exact dimension
```

## 8. 文档与机器 binding

Documentation `AuthorityBinding`必须指向这些 typed roots/assignments；文件作者、path、status、compiler、projection、自签 digest不能成为 root。Public docs只投影 root refs。

## 9. 新 root 类别的演进

未来出现新的制度/安全/组织 authority 类型时，先判断是否已有 root kind可表达。只有它拥有新的不可替代 issuer/admission/revocation语义时才扩 `AuthorityRoot` algebra；新增公司、Provider、团队或用户实例只新增 binding，不改 root grammar。

## 10. 完成

```text
AuthorityRootsClosed =
  every authority chain is finite/non-amplifying
  and terminates at an exact root kind authorized for that dimension
  and universal law definition is distinct from project adoption
  and Product/Domain cannot absorb unrelated governance/external/law authority
  and new issuer instances require only local bindings
```

<!-- sec-clause {"id":"authority-root-kinds","blocker":null,"kind":"stable-decision"} -->
## 规范片段

Authority closure必须终止于对该decision/effect dimension有权的typed root，而不是统一回根Product/Domain。UniversalLaw definition、Project adoption、Product outcome、Domain definition、Repository governance、External authority与Compound issuer分型；新增主体只增加binding，不修改root grammar。
