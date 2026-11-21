import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import pymupdf,re,json,collections
d=pymupdf.open(_sys.argv[1])   # the NESA Mathematics Advanced 11-12 (2024) syllabus PDF; one-off, output is tracked
Y11=['Working with functions','Trigonometry and measure of angles','Trigonometric identities and equations','Introduction to differentiation','Exponential and logarithmic functions','Graph transformations','Probability and data']
Y12=['Further graph transformations and modelling','Sequences and series','Differential calculus','Integral calculus','Applications of calculus','Random variables','Financial mathematics']
items=[]
for i,p in enumerate(d):
    if i<6: continue
    for b in p.get_text('dict')['blocks']:
        for l in b.get('lines',[]):
            t=''.join(s['text'] for s in l['spans']).strip()
            if not t or t.startswith('Mathematics Advanced 11–12 (2024)') or re.match(r'Page \d+ of 34',t): continue
            sp=max(l['spans'],key=lambda s:len(s['text']))
            items.append((t,round(sp['size'],1),bool(sp['flags']&16)))
dps=[];fa=None;mode=None;sub=None;cur=None
for t,s,b in items:
    if t in Y11+Y12 and b and s>=14: fa=t; mode='out'; sub=None; cur=None; continue
    if t=='Content' and b and s>=12: mode='content'; cur=None; continue
    if b and s>=12: mode='out'; continue
    if mode!='content': continue
    if t=='§': cur={'focus_area':fa,'year_level':12 if fa in Y12 else 11,'subheading':sub,'text':''}; dps.append(cur); continue
    if b and s>=10.5: sub=t; cur=None; continue
    if cur is not None: cur['text']+=' '+t
dps=[x for x in dps if x['text'].strip()]
for i,x in enumerate(dps): x['id']=f"{'Y11' if x['year_level']==11 else 'Y12'}-{i+1:03d}"; x['text']=re.sub(r'\s+',' ',x['text']).strip()
json.dump(dps,open(paths.P + 'site/project/syllabus_dotpoints.json','w'),indent=1,ensure_ascii=False)
print(len(dps)); print(collections.Counter(x['focus_area'] for x in dps))
