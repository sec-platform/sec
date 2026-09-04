---
title: 文档 Semantic Identity、Reference 与局部失效
status: stable
domain: documentation
---

# 文档 Semantic Identity、Reference 与局部失效

本文拥有 Document/Clause reference identity、Markdown Address adapter、fragment validation 与 documentation projection 的局部输入 closure。Source role/admission由 `source-and-authority.md` 拥有，semantic compilation/view由 `compilation-and-views.md` 拥有，迁移由 `evolution-and-conformance.md` 拥有。

## 1. Identity 与 Address 分离

```text
DocumentRef = stable semantic document identity
ClauseRef   = stable normative/explanatory node identity
ScopeRef    = stable semantic scope identity

DocumentAddress = generation-bound physical path
FragmentAddress = renderer-bound heading/anchor address
HeadingLabel    = presentation text
```

`path`、heading text、heading level、章节顺序与locale不能生成稳定 semantic identity。移动文件、重命名章节、翻译标题只改变 Address/Presentation；若 meaning 未变，DocumentRef/ClauseRef不变。

## 2. Clause source syntax

Typed clause directive允许显式稳定 identity：

```text
<!-- sec-clause {"id":"resource-accounting-mode","blocker":null,"kind":"stable-decision"} -->
## 规范片段
```

`id` 是 document-local stable token；完整 `ClauseRef = documentRef + clause id`。同一 document 内重复 id fail closed。headingPath只用于 presentation/navigation，不进入 ClauseRef。

旧 source 没有 explicit id 时可以暂时生成 `legacy-heading-address` 作为 migration observation，但该值不能被新 machine consumer当稳定 ClauseRef；正式迁移的每个 externally referenced/normative clause必须获得 explicit id。

## 3. Markdown link 是 Address projection，不是 semantic relation

```text
DocumentationLink = {
  fromClauseRef,
  relationKind,
  toDocumentRef | toClauseRef
}

MarkdownLink = render(
  DocumentationLink,
  exact address generation
)
```

因此 Markdown target必须验证两层：

1. target DocumentAddress存在；
2. 有 fragment 时，FragmentAddress在目标 generation中存在。

只检查 `foo.md` 存在却删除 `#fragment` 后仍 PASS 属于 `fragment-reference-drift`。

当前 Markdown adapter必须解析 fenced code、GitHub-style heading slug duplicate suffix与显式 HTML id；解析能力不足返回 unknown/unsupported，不删除 fragment 后继续当合法。

## 4. Public projection 不允许第二引用通道

Page manifest中的 `canonicalRefs` 和正文中的 `docs/...` / DocumentRef locator 都必须进入同一个 reference census。正文 backtick、表格或普通段落不能绕过 manifest validator。

```text
PublicProjectionClosed =
  every canonical locator resolves to registered DocumentRef
  and every fragment resolves in the exact target generation
  and manifest/source bindings cover every projected meaning owner
```

删除/迁移 canonical owner 时，public manifest、正文 refs与generated index必须同 generation切换；不能留下已删除 owner 继续教学。

## 5. Projection ActionKey 绑定实际 closure

```text
DocumentationProjectionActionKey = digest(
  exact purpose closure refs,
  disclosure refs,
  exact addresses/fragments actually rendered,
  renderer/presentation contract revisions
)
```

whole `DocumentationGenerationRef` 默认只属于 lineage/readback，不进入局部 projection key。若 unrelated document变化但当前 purpose closure、addresses与renderer都未变，则 ActionKey和bytes必须保持相同。

只有 whole-corpus index/audit 确实观察整个 generation 时才允许全局 generation成为 ActionKey输入。

## 6. Split/Merge/Move 的 identity preservation

### move/reparent

same semantic node → same Ref；Address revision改变；所有 link projections重新编译；旧Address consumer-zero后删除。

### split

一个旧 ClauseRef 拆成多个独立 meaning 时必须显式 identity-evolution relation：preserved/refined/split。不能因为加入一个 `##` 就自动生成新的 semantic object。

### merge

多个旧 nodes合并时必须给出 preservation mapping；不能因为删除 heading 就把历史 relation静默指到 parent。

## 7. 新信息的局部吸收

发现一个新 relation/constraint/consumer：

```text
add typed node/edge
→ affected purpose closures重新计算
→ only reverse-reachable projection keys stale
```

新增无关文档、标题调整、目录迁移、locale变化不能迫使整个 semantic generation重新定义所有 Clause identity。

## 8. Current migration

当前 compiler仍允许 heading-derived clause id 作为 legacy migration carrier；目标迁移顺序：

1. normative / externally referenced clauses获得 explicit id；
2. reference index从Markdown path/fragment映射到 DocumentRef/ClauseRef；
3. machine consumers切到 refs；
4. Markdown fragments降为 renderer Address；
5. old heading-derived identity consumer-zero后退役。

迁移期间不得同时把 heading-id 与 explicit ClauseRef都当 canonical。

## 9. 完成

```text
DocumentationReferenceIdentityClosed =
  semantic refs exclude path/heading/presentation
  and every canonical/public reference resolves target identity plus fragment address
  and projection ActionKeys bind actual purpose closure rather than whole generation
  and split/merge/move preserve or explicitly evolve identity
  and unrelated changes leave unaffected refs/ActionKeys stable
```

<!-- sec-clause {"id":"documentation-reference-identity","blocker":null,"kind":"stable-decision"} -->
## 规范片段

DocumentRef/ClauseRef/ScopeRef是稳定semantic identity；path、heading与fragment只属于generation-bound Address。Markdown与public projection必须验证目标文件和fragment，正文locator不能绕过manifest；projection ActionKey只绑定实际purpose closure，新增无关文档或改标题不得制造全局semantic失效。
