"""Layers 2-3: text fingerprint per document and near-duplicate questions (Jaccard on word 3-shingles; exact, not MinHash, at pilot scale)."""
import sqlite3,re,hashlib,itertools,collections
db=sqlite3.connect('/mnt/user-data/outputs/questions.db')
def norm(s): return re.sub(r'[^a-z0-9]+',' ',(s or '').lower().replace('\\dfrac','\\frac')).split()
qs={}
for qid,doc,num,stem in db.execute("select id,document_id,number,stem_latex from questions"):
    txt=' '.join([stem or '']+[r[0] for r in db.execute('select latex from parts where question_id=? order by ordinal',(qid,))]+[r[0] for r in db.execute('select latex from mcq_options where question_id=? order by label',(qid,))])
    qs[qid]=(doc,num,norm(txt))
# layer 2: document fingerprint
bydoc=collections.defaultdict(list)
for qid,(doc,num,w) in sorted(qs.items()): bydoc[doc].append(' '.join(w))
for doc,ts in bydoc.items():
    db.execute('update documents set text_fingerprint=? where id=?',(hashlib.sha256(''.join(ts).replace(' ','').encode()).hexdigest(),doc))
def sh(w): return {' '.join(w[i:i+3]) for i in range(max(1,len(w)-2))}
S={k:sh(v[2]) for k,v in qs.items() if len(v[2])>=6}
db.execute('delete from related_questions')
pairs=[]
for a,b in itertools.combinations(S,2):
    if qs[a][0]==qs[b][0]: continue
    j=len(S[a]&S[b])/len(S[a]|S[b])
    if j>=0.5:
        rel='duplicate' if j>=0.85 else ('numbers_changed' if j>=0.65 else 'variant')
        db.execute('insert into related_questions values (?,?,?,?)',(a,b,round(j,3),rel)); pairs.append((j,a,b,rel))
db.commit()
print('pairs >=0.5:',len(pairs),'>=0.85:',sum(p[0]>=0.85 for p in pairs))
c=collections.Counter((min(qs[a][0],qs[b][0]),max(qs[a][0],qs[b][0]),rel) for j,a,b,rel in pairs)
for k,v in sorted(c.items(),key=lambda x:-x[1])[:15]: print(k,v)
fp=collections.Counter(r[0] for r in db.execute("select text_fingerprint from documents where text_fingerprint is not null"))
print('identical doc fingerprints:',sum(v-1 for v in fp.values() if v>1))
