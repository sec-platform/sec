#!/usr/bin/env python3
"""Extract a bounded, exact-source research trace. Does not modify source archives."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--archive', type=Path, required=True, help='Exact 2026-11-05 fusion ZIP; SHA is verified before use.')
parser.add_argument('--output', type=Path, default=Path('research_connections.json'))
args = parser.parse_args()
archive = args.archive
expected_archive = 'd29d86fdaa4313460e677043156f46cf15cd8ae3689ff3f4684e22e2bde7c676'
assert hashlib.sha256(archive.read_bytes()).hexdigest() == expected_archive
prefix = 'Gift_IR_仓库设计融合_20261105/data/'
with zipfile.ZipFile(archive) as z:
    raw_model = z.read(prefix + 'research_model.original.json')
    raw_mapping = z.read(prefix + '多维到Gift模型_568项逐项追溯.json')
model_sha = hashlib.sha256(raw_model).hexdigest()
mapping_sha = hashlib.sha256(raw_mapping).hexdigest()
assert model_sha == 'c64d0bc4452a24e36f83fbfd27d22fe64dec4259666be7cbdac7b44a806b157e'
assert mapping_sha == '735fed9f13fdd7f865103567bb9555d81676ba8e69792fde234471074cc0fdfd'
model = json.loads(raw_model)
mapping = json.loads(raw_mapping)
units = {u['id']: u for u in model['units']}
contracts = {d['id']: d for d in mapping['question_mapping']}
choices = {
 'D0108': {
   'seam': 'type_count/TypeId展示摘要不能作为完整类型或Method资格',
   'consumers': ['crates/gift-author-kernel/src/signature_resolution.rs', 'crates/gift-author-kernel/src/project_input.rs', 'src/adapters/compilation/author-analysis-transport.ts'],
   'models': ['summary_does_not_reconstruct_arena', 'qualification_depends_on_requested_stage']},
 'D0140': {
   'seam': '在真实Rust分析会话内继续限定根的资格与降低；生成输出重新检查，不以摘要重新猜解释',
   'consumers': ['crates/gift-author-kernel/src/signature_resolution.rs', 'docs/编译/内核/领域方法与整体根.md'],
   'models': ['qualification_depends_on_requested_stage']},
 'D0188': {
   'seam': '发布比较准确前像、当前操作代及实际接受范围；状态迁移不能补造已丢信息',
   'consumers': ['src/compiler/pipeline/semantic-context.ts', 'docs/编译/目标/成员布局与完整产物.md'],
   'models': ['check_then_publish_race', 'content_equality_does_not_revive_request', 'state_schema_equality_is_not_migration']},
 'D0349': {
   'seam': '捕获内容准确、共同观察切面、一次运行读取同代分别成立',
   'consumers': ['src/compiler/semantic-compiler.ts', 'docs/编译/目标/成员布局与完整产物.md'],
   'models': ['one_generation_per_logical_read', 'disjoint_writes_shared_predicate']},
 'D0371': {
   'seam': '旧代持有、候选代、正常工作与故障结算共同计量；容量不能全被正常复制占用',
   'consumers': ['src/adapters/compilation/author-analysis-transport.ts', 'crates/gift-author-kernel/src/project_input.rs'],
   'models': ['pins_have_global_retention_cost', 'pin_acquisition_vs_reclamation', 'transport_encoded_size_and_replay']},
 'D0445': {
   'seam': '编辑可保全的空洞不冒充可生成值；独立文件变更仍须检查共同前提',
   'consumers': ['docs/编译/内核/领域方法与整体根.md', 'docs/编译/目标/成员布局与完整产物.md'],
   'models': ['disjoint_writes_shared_predicate', 'qualification_depends_on_requested_stage']},
}
selected = []
for id_, proposed in choices.items():
    d = contracts[id_]
    original_units = [units[uid] for uid in d['source_units']]
    selected.append({'original_question_contract': d, 'original_source_units': original_units,
                     'this_review_proposed_connection': proposed,
                     'status': '原始记录与引用存在已核；接合方案及独立模型，不是生产实现资格或原理论的全域证明'})
out = {'scope': '6 existing D records and their 23 distinct U records; not all 568/1786 mappings validated.',
       'source_archive_sha256': expected_archive,
       'source_model': {'member': prefix + 'research_model.original.json', 'size_bytes': len(raw_model), 'sha256': model_sha},
       'source_mapping': {'member': prefix + '多维到Gift模型_568项逐项追溯.json', 'size_bytes': len(raw_mapping), 'sha256': mapping_sha},
       'question_count': len(selected),
       'unique_unit_count': len({u['id'] for x in selected for u in x['original_source_units']}),
       'preservation_note': 'JSON对象按语义值原样提取，输出文件不是原始源文件字节副本；原源由上述SHA和member定位。source_refs原引用未在本轮全部追到外部原文。',
       'connections': selected}
assert out['unique_unit_count'] == 23
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'question_count': out['question_count'], 'unique_unit_count': out['unique_unit_count'], 'model_sha256':model_sha}, ensure_ascii=False))
