#!/usr/bin/env python3
"""Refresh Graphify graph from public task materials; no environment or runtime data read.
Semantic concepts below were extracted by the Graphify extraction agent; JSON references
are replayed deterministically. Use --code to additionally extract apps/packages/scripts.
"""
import json,re,sys,hashlib
from pathlib import Path
from graphify.detect import detect,save_manifest
from graphify.extract import extract,collect_files
from graphify.build import build_from_json
from graphify.cluster import cluster,score_all
from graphify.analyze import god_nodes,surprising_connections,suggest_questions
from graphify.report import generate
from graphify.export import to_json,to_html
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'graphify-out'; OUT.mkdir(exist_ok=True)
DATA=ROOT/'docs/voice_router_dataset'
N=[]; E=[]
def nid(path,key): return re.sub('[^a-z0-9_]','_',str(path.relative_to(ROOT).with_suffix('')).lower()+'_'+key.lower())
def node(path,key,label,loc=None,**extra):
 i=nid(path,key);N.append(dict(id=i,label=label,file_type='concept',source_file=str(path),source_location=loc,**extra));return i
def edge(a,b,p,relation='references',loc=None): E.append(dict(source=a,target=b,relation=relation,confidence='EXTRACTED',confidence_score=1.0,source_file=str(p),source_location=loc,weight=1.0))
def load(n):return json.loads((DATA/(n+'.json')).read_text())
sc=load('scenarios'); acts=load('actions'); sl=load('slots'); kb=load('knowledge_base')
sp=DATA/'scenarios.json';ap=DATA/'actions.json';lp=DATA/'slots.json';kp=DATA/'knowledge_base.json';rp=DATA/'README.ru.md'
for x in sc['system_intents']: x['scenario_id']=x.get('scenario_id',x.get('id',x.get('intent_id')))
S={x['scenario_id']:node(sp,x['scenario_id'],x['scenario_id']+' '+x.get('name',x['scenario_id']), '$.scenarios.'+x['scenario_id'],description=x.get('description','')) for x in sc['scenarios']+sc['system_intents']}
A={x['name']:node(ap,x['name'],x['name'],'$.actions.'+x['name'],description=x['description']) for x in acts['actions']}
L={x['name']:node(lp,x['name'],x['name'],'$.slots.'+x['name'],description=x['description']) for x in sl['slots']}
K={x:node(kp,x,x,'$.'+x) for x in kb if x!='meta'}
C={}
for key,label,why in [
 ('llm_router','LLM scenario router','The task requires LLM-based scenario selection rather than an intent classifier.'),
 ('confirmation','Explicit confirmation','Irreversible actions require preview followed by explicit customer confirmation.'),
 ('dialogue_state','Dialogue state','Language, client, active scenario, suspended topics and slots persist during dialogue.'),
 ('handoff','Operator handoff','Unresolved or requested transfers include dialogue context.'),
 ('trace','Supervisor trace','Show transcript, scenario, rationale, alternatives and measured latency.'),
 ('languages','Russian Kazakh mixed speech','Recognize both required languages including mid-utterance switching.'),
 ('uncertainty','Uncertainty policy','Clarify uncertain requests instead of guessing.'),
 ('urgent','Urgent scenarios first','Accident now, overseas medical help and suspected fraud receive priority.'),
 ('facts','Grounded company facts','Answers use knowledge_base.json; do not invent company facts.'),
 ('normalization','Slot normalization','Normalize spoken numbers, identifiers and relative dates.'),
 ('evaluation','Routing evaluation','104 utterances test primary intent, exact match and multi-intent recall.'),
 ('synthetic','Synthetic backend','Business records are fictitious; no actual client data is required.')]:
 C[key]=node(rp,key,label,rationale=why)
for s in sc['scenarios']:
 sid=S[s['scenario_id']]
 edge(C['llm_router'],sid,sp)
 for a in s['actions']:edge(sid,A[a],sp,'references',s['scenario_id']+'.actions')
 for typ,slots in s['slots'].items():
  for l in slots:edge(sid,L[l],sp,'references',s['scenario_id']+'.slots.'+typ)
 for rule in s['not_this_if']:edge(sid,S[rule['use_instead']],sp,'references',s['scenario_id']+'.not_this_if')
 if s['requires_confirmation']:edge(sid,C['confirmation'],sp)
 if s['handoff']:edge(sid,C['handoff'],sp)
 if s['priority']=='urgent':edge(sid,C['urgent'],sp)
for a in acts['actions']:
 if a['irreversible']:edge(A[a['name']],C['confirmation'],ap)
for k in K.values():edge(C['facts'],k,rp)
for key in ['confirmation','dialogue_state','handoff','trace','languages','uncertainty','urgent','normalization']:edge(C['llm_router'],C[key],rp)
for fn,key in [('dev_utterances.json','utterances'),('dialogs_sample.json','dialogs')]:
 p=DATA/fn;d=json.loads(p.read_text());root=node(p,key,fn,'$.'+key);edge(C['evaluation'],root,rp)
 for item in d[key]:
  ids=item.get('expected',[]) if key=='utterances' else [s for t in item['turns'] for s in t.get('scenarios',[])]
  for s in dict.fromkeys(ids):
   if s in S:edge(root,S[s],p,'references',item.get('id',item.get('dialog_id')))
mp=DATA/'mock_backend.json'
for name in ['clients','policies','claims','payments']:
 m=node(mp,name,'Synthetic '+name,'$.'+name);edge(C['synthetic'],m,rp)
for name in ['README.md','README.kz.md']:
 p=DATA/name;i=node(p,'dataset','Dataset guide '+name);edge(i,C['llm_router'],p)
# DOCX conversion is unavailable in installed graphify; concepts extracted from OOXML text.
doc=next((ROOT/'docs').glob('*.docx'))
t=node(doc,'voice_router','Voice Router specification','Case 2: Voice Router')
for key in ['llm_router','trace','languages','handoff','confirmation']:edge(t,C[key],doc)
for key,label in [('single_command','Single-command launch'),('grading','100-point scoring rubric'),('web_voice','Web microphone voice interaction')]:
 i=node(doc,key,label,'Case 2 / requirements');edge(t,i,doc)
d=detect(ROOT/'docs')
# JSON domain records need semantic reference extraction, not code AST.
code=[DATA/'evaluate.py']
if '--code' in sys.argv:
 for name in ['apps','packages','scripts']:
  if (ROOT/name).exists():code+=collect_files(ROOT/name)
ast=extract(code,cache_root=ROOT,parallel=False)
sem=dict(nodes=N,edges=E,hyperedges=[],input_tokens=0,output_tokens=0,token_usage_status='unavailable: host agent does not expose token usage')
(OUT/'semantic-docs.json').write_text(json.dumps(sem,ensure_ascii=False,indent=2))
merged=dict(nodes=ast['nodes']+N,edges=ast['edges']+E,hyperedges=[],input_tokens=0,output_tokens=0)
g=build_from_json(merged,root=str(ROOT));communities=cluster(g);scores=score_all(g,communities)
labels={i:' / '.join(g.nodes[n].get('label',n) for n in sorted(ns,key=lambda n:g.degree(n),reverse=True)[:2])[:100] for i,ns in communities.items()}
gods=god_nodes(g);surprises=surprising_connections(g,communities);questions=suggest_questions(g,communities,labels)
report=generate(g,communities,scores,labels,gods,surprises,d,{'input':0,'output':0},str(ROOT),suggested_questions=questions)
report='> Token usage: unavailable. Zero numeric counters below are library placeholders, not measured token usage.\n> Corpus: task docs plus optional source AST; no secrets or runtime client history.\n> DOCX: OOXML text inspected by extraction agent; built-in office conversion unavailable.\n\n'+report
(OUT/'GRAPH_REPORT.md').write_text(report)
if not to_json(g,communities,str(OUT/'graph.json'),community_labels=labels):raise RuntimeError('Graph shrink guard refused export')
to_html(g,communities,str(OUT/'graph.html'),community_labels=labels)
(OUT/'.graphify_python').write_text(sys.executable)
(OUT/'.graphify_root').write_text(str(ROOT))
(OUT/'cost.json').write_text(json.dumps({'token_usage':'unavailable','reason':'Host agent usage counters are not exposed'}))
(OUT/'source-manifest.json').write_text(json.dumps({str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'docs').rglob('*') if p.is_file() and 'graphify-out' not in p.relative_to(ROOT/'docs').parts and p.suffix in ['.json','.md','.py','.docx']},indent=2))
print(f'Graph complete: {g.number_of_nodes()} nodes, {g.number_of_edges()} edges; token usage unavailable')
