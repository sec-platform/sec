---
title: Brownfield 导入
status: stable
domain: brownfield
last-reviewed: 2026-07-29
---

# Brownfield 导入

本文拥有既有工程进入 SEC 的五阶段模型、Source Program Model、Language Provider边界和unknown/opaque处理。TypeScript是第一目标，Core contract保持语言无关。

```text
Attach → Lift → Reconcile → Adopt → Normalize
```

## Attach

对exact source revision建立完整物理inventory，只证明看见了什么：文件、package/module、config、generated/owned区域、入口、依赖、resource与platform hints。

Attach默认只读。路径、encoding、symlink/reparse、case、Git/tree和dependency identity必须保留；扫描缺失或read failure形成unknown，不能解释为不存在。

## Lift

Language/Compiler/Static/Runtime Provider把source提升为Source Program Model和候选关系：syntax tree、symbol/type、module/import/export、call/data/state/effect/config/resource observation。

Tree-sitter、TypeScript Compiler、ast-grep、runtime trace和AI分析都是Provider。它们只能增加Evidence；语法树、调用图、confidence或多数票不能创建authority。

## Reconcile

将Source Program Model与Semantic Contract、Engineering IR、Repository owner、配置/资源authority和competing Evidence对齐，保留：

```text
accepted | rejected | ambiguous | unknown | opaque
```

同名、路径邻近、运行时偶遇或高confidence不建立canonical关联。Conflict由显式policy和graph-context validator处理。

## Adopt

显式接受source、binding或boundary，建立：

- stable identity与revision；
-唯一source owner和writer；
- governed/opaque boundary；
- operation/mutation adapter；
- Contract/Effect/Permission；
- minimum Verification；
- migration与rollback/recovery。

Adopt不是复制源码进入IR，也不要求所有模块先变成Block。没有Block的工程仍可拥有source owner、Contract和受控Mutation。

## Normalize

只有完整表示、round-trip、behavior/effect parity、consumer migration、deterministic lowering、Verification和rollback全部通过的模块，才转为SEC-owned projection。

Normalize按artifact/module逐步进行；旧source writer与新writer不能长期双写。无法完整映射的区域长期保留Governed Extension或Opaque Boundary，不以TODO skeleton伪装完成。

## Source Program Model边界

Source Program Model是observed/derived representation，不是Engineering IR、Repository IR、Application/Behavior/Target Program IR或生成目标。它绑定exact source/provider revisions、coverage、freshness、diagnostics与unresolved frontier。

Language Frontend负责syntax/symbol/type observation；Language Backend负责Target Program IR到目标bytes。两者通过版本化Provider协议接入，不能把某一语言AST提升为通用Engineering IR。

## 配置与资源

框架/工具配置、memory/thread/process/network/storage、environment和deployment hints在Attach/Lift中作为observed inputs。只有建立明确schema、owner、lifecycle、capability、mutation和Verification后，才可升格为对应Workspace domain或Target Profile字段。

## 写入前置

Attach/Lift/Reconcile默认只读。未来写入必须复用operation registry、authorization、source owner、path proof、workspace lease、isolated rebuild、actual Delta/Impact、Hermetic Verification与rollback/recovery。

任何Provider不能直接写canonical IR或live source；Codemod只产生patch proposal，必须重新parse/compile、计算Semantic Delta并由transaction发布。
