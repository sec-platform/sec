---
title: Nexus Conformance Corpus
status: active
domain: nexus-corpus
last-reviewed: 2026-07-29
---

# Nexus Conformance Corpus

本文只拥有 `QzCrane/nexus` 作为 SEC 首个完整 Conformance Corpus 的 inventory、分类、机制裁决、Parity、consumer迁移和退役门。Nexus 的具体产品值、品牌、路径和当前计数不进入 SEC Core；机器状态只由 `docs/governance/nexus-absorption-ledger.yaml` 拥有。

## 目的

Nexus用于攻击 SEC 是否真的能处理复杂、长期演进、跨package、browser/runtime/release/governance密集工程，而不是为 SEC 提供一套要硬编码的产品模板。

它验证两种能力：

1. **表示与治理**：SEC能否完整看见、分类、解释、引用、验证和受控变更一个真实工程；
2. **机制吸收**：Nexus中通用而成熟的机制能否进入SEC唯一domain owner，同时保留Nexus特有Policy/Profile/Adapter而不特化Core。

“SEC能在Nexus仓库运行”不等于完成吸收；“所有路径有标签”也不等于机制、consumer和现实行为已闭合。

## Corpus Identity

每轮Census/Parity必须绑定：

- repository identity和default ref；
- exact committed tree和submodule/external source revisions；
- package/lock/toolchain/platform/profile revisions；
- public/release/deployed surface identity；
- SEC contracts/providers/ledger revision；
- exclusions、unreadable/unsupported regions和原因。

Dirty worktree、README、代码搜索、代码图索引或历史报告不能替代exact-tree corpus。未提交文件可以作为独立diagnostic input，但不能静默混入正式baseline。

## Inventory

Census至少覆盖：

- tracked paths、mode、content/object identity、symlink/reparse和generated/vendor/binary/secret分类；
- workspace、package、module、application、build target和entrypoints；
- source owner、public API、runtime route、browser/background/content/native boundary；
- config、resource、locale、permission、secret、environment和platform assumptions；
- state owner、storage、message/event、process/network/browser lifecycle；
- build/test/verification、hooks、workflows、release/package/store/deployment surfaces；
- Agent/Skill/EPR/Policy、documentation、diagnostics和recovery mechanisms；
- consumers、duplicate implementations、historical compatibility和retirement candidates；
- unknown、ambiguous、conflicted、opaque、unreadable和unsupported regions。

Path classification和mechanism inventory是不同对象：一个机制可以跨多个文件，一个文件可以承载多个机制。只统计路径无法证明机制完整。

## Path Classification

每个tracked path只使用一个primary physical classification，并可引用多个mechanism records：

```text
authoring-source | governed-source | generated-artifact
| public/release-surface | config/resource | test/fixture
| workflow/hook | documentation | vendor/external
| binary/secret/protected | cache/temporary | historical
| unknown/unsupported
```

Classification必须由证据和owner说明，不按目录名猜测。Generated、public、deployed和runtime-consumed可以同时存在于不同维度，但primary writer/authority必须唯一。

## Mechanism Decision Taxonomy

每个独立机制进入一个明确裁决：

```text
already-represented
absorb-into-sec-domain
integrate-provider-or-adapter
retain-nexus-policy-profile
retain-project-specific-implementation
replace-after-parity
reject-with-rationale
superseded-or-retire
unknown-needs-evidence
```

禁止使用 `maybe`、`later`、`same enough` 或“先全部搬进Core”。

一个裁决记录至少包含：

- mechanism identity、description和Nexus owner；
- source/artifact/runtime surfaces；
- producers、consumers和lifecycle；
- state、Effect、Permission、resource和platform boundary；
- failure/recovery和observable contract；
- SEC target domain/owner/contract；
- decision、rationale、alternatives和strongest counterevidence；
- parity requirements、Evidence、unknown和residual risk；
- migration、rollback和retirement exit。

## Corpus 与 Core 分离

Nexus的Bun、SPECTRA、HALO、Chrome、WebAudio、locale、path quirks、EPR编号、provider品牌和发布表面只能进入：

- Nexus Policy Pack / Target Profile；
- project-specific Adapter/Block/fixture；
- Brownfield Source Program Model/Evidence；
- conformance requirement；
- external capability ledger。

只有跨项目稳定、具有独立consumer、能形成通用identity/contract/state/failure/verification并通过反特化的机制，才进入SEC domain owner。

通用机制提升后必须用至少一个非Nexus corpus或无关模型验证；否则可能只是把Nexus命名隐藏进抽象。

## EPR、Skill 与机制映射

Nexus中的工程问题记录、运行规则或Agent启发式分别映射到：

- machine contract/validator/test；
- SEC domain design；
- unique Skill；
- Nexus-specific policy/fixture；
- historical/rejected record。

EPR编号、Issue标题和Skill文件数量不是mechanism identity。多个EPR可能属于同一根机制；一个EPR也可能包含多条需要拆分的机制。Mapping必须证明没有未绑定的accepted mechanism，也没有一个Skill/contract无证据地覆盖宽泛路径。

## Parity

Accepted/replacement机制的Parity不是“输出看起来相同”。至少检查：

- positive behavior；
- negative/forbidden behavior；
- failure code、phase、diagnostic和operator next action；
- side effects、state owner、ordering、concurrency和idempotency；
- crash、cleanup、rollback/recovery和residue；
- source/artifact bytes、format、public API和runtime observable behavior；
- platform/Host/Toolchain/Target differences；
- security、permission、privacy、secret和network boundary；
- performance/resource budget，在有正式采样协议时；
- migration、compatibility、release和consumer behavior。

Shadow comparison必须绑定相同inputs、environment和revisions。Unexplained delta为零只对已定义比较维度成立；比较器coverage不足时仍是unknown，不能用零差异宣称全Parity。

## Provider 与 Evidence

代码图、Compiler API、runtime trace、browser observation、AI和其他Provider只提供Evidence。每个结果绑定provider/source revisions、scope、coverage、freshness、diagnostics和unresolved regions。

多个Provider一致不自动升格为authority；冲突保留竞争解释。Provider缺失或stale不能返回空集冒充“没有机制”。

Evidence只支持/反驳mechanism claim，不直接改变SEC Core、Nexus source owner或retirement decision。

## Owner、Consumer 与 Retirement

旧机制只有在以下全部成立后退役：

1. 新SEC owner/contract/implementation已进入唯一主链；
2. 正面、负面、失败、副作用和迁移Parity通过；
3. 所有代码、runtime、test、workflow、docs、Agent和release consumer已迁移；
4. projection/artifact可从新owner重建；
5. rollback/recovery存在且验证；
6. 真实Nexus e2e和release-equivalent路径通过；
7. 旧entry、writer、dependency、config、Skill、workflow和文档已删除或归档；
8. new-main/Nexus readback无unexplained delta。

仅停止调用旧函数、关闭PR或保留“备用”入口不算退役。无法安全删除时必须记录真实physical residue和owner，不能写“已清理”。

## Unknown 与 No-Omission Claim

No-omission只在以下分母明确且均闭合时成立：

```text
all exact-tree paths classified
+ all discovered mechanisms decided
+ all accepted mechanisms have required parity
+ all owners/consumers/retirements reconciled
+ all exclusions/unknowns explicitly resolved or blocking
```

Counter必须是finite non-negative safe integer并具有可回看record集合。`classified === total`、`bound === expected`等相等只有在两边集合identity、coverage和生成规则有效时才有意义；missing/empty/nonnumeric不能通过。

Unknown不能为了达到100%被改名为project-specific。真实unsupported可以作为完成结果，但必须有scope、rationale、product behavior和未来review trigger；若目标是“完整吸收”，它仍可能阻断该更强claim。

## Change 与 Invalidation

以下变化使相应Census/Parity/Evidence失效或要求增量重算：

- Nexus tree/package/lock/toolchain/public/release surface变化；
- SEC domain contract、identity、Provider或Parity comparator变化；
- 新consumer、runtime path、platform或release channel出现；
- Provider coverage/freshness失效；
- incident、negative test、Full/import发现遗漏或新机制；
- previously project-specific机制被证明通用，或反之。

增量Census可以复用未受影响records，但必须证明intervening diff coverage；不能因大多数文件未变沿用整个“complete”状态。

## 安全与隐私

Census默认只读，不执行不受信install/build/runtime，不上传source/secret，不跟随越界symlink/reparse。需要真实browser、network、native或release测试时使用显式Provider capability、隔离环境、secret policy、cleanup/readback和Evidence scope。

报告和ledger不复制secret、credential、个人信息、完整私有source或host绝对路径；需要回看时使用受控artifact digest/reference。

## 机器状态

`docs/governance/nexus-absorption-ledger.yaml`只拥有当前records、counters、status、bindings和Evidence refs。本文不复制当前数量、baseline、版本或完成报告。

Ledger status至少区分census-required、incomplete、blocked、candidate-complete、complete和invalidated；`complete`只能由validator根据record集合和本合同派生，不能手填一个status绕过缺失records。

## 完成定义

“无遗漏吸收”只有在：

- exact corpus identity和inventory闭合；
-每个path和mechanism有可回看record；
-每个decision有唯一owner、rationale、Evidence和exit；
- accepted mechanisms的所有required parity维度闭合；
- unknown/conflict/exclusion按目标claim裁决；
-所有consumer迁移、duplicate owner退役、Nexus现实路径通过；
- SEC Core经非Nexus反特化验证；
- ledger validator、docs-doctor和new-main/Nexus readback一致；

之后才能成立。任何后续决定性变化都会按invalidation规则降低状态并重算，不能永久保留一次性“100%”标签。
