from pathlib import Path
from collections import Counter
import os,json,subprocess,xml.etree.ElementTree as ET
root=Path.cwd(); temp=Path(os.environ['RUNNER_TEMP']); out=temp/'sec086-verification'; out.mkdir(exist_ok=True)
files=json.loads((root/'.github/sec086-resume-transfer/tests.json').read_text())
assert len(files)==len(set(files))==58
summary={}; inventories={}; failure_sets={}
for label,cwd in [('before',temp/'sec086-before'),('candidate',root)]:
    assert all((cwd/p).is_file() for p in files)
    report=out/f'{label}.xml'
    command=['bun','test','--isolate','--no-orphans','--reporter=junit',f'--reporter-outfile={report}',*files]
    with (out/f'{label}.log').open('w') as log:
        result=subprocess.run(command,cwd=cwd,stdout=log,stderr=subprocess.STDOUT,timeout=180)
    tree=ET.parse(report); cases=tree.findall('.//testcase'); failures=[]
    for case in cases:
        for issue in case.findall('failure')+case.findall('error'):
            failures.append({'name':case.get('name'),'type':issue.get('type'),'message':issue.get('message')})
    summary[label]={'exitCode':result.returncode,'cases':len(cases),'passed':len(cases)-len(failures),'skipped':sum(c.find('skipped') is not None for c in cases),'failures':failures}
    inventories[label]=Counter(c.get('name') for c in cases)
    failure_sets[label]=Counter((f['name'],f['type'],f['message']) for f in failures)
(out/'comparison.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
expected={'tracked project observation returns exact NUL-delimited Git-indexed project paths','template conditionals are exactly paired, nested, and boolean-owned'}
assert {f['name'] for f in summary['before']['failures']}==expected
assert all(s['exitCode']==1 and len(s['failures'])==2 and s['skipped']==0 for s in summary.values())
assert failure_sets['before']==failure_sets['candidate'],'New or changed failure'
assert not (inventories['before']-inventories['candidate']),'Baseline cases were lost'
assert summary['candidate']['cases']-summary['before']['cases']==2
print('No additional failure in the selected frozen comparison. Two existing failures remain; this is not an all-green suite or trusted Gate.')
