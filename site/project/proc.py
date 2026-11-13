"""Process staged PDFs: hash, page count, page-1/2 text, text-layer check; append to records.jsonl; delete staged copy."""
import json, os, subprocess, hashlib, sys, glob
S = '/tmp/claude-0/-home-claude/800fc37d-9da1-531b-8789-51723586bf26/scratchpad/'
ROOT = '/mnt/user-data/uploads/External Exams Stage 6/'
done = set()
if os.path.exists(S + 'records.jsonl'):
    done = {json.loads(l)['path'] for l in open(S + 'records.jsonl')}
out = open(S + 'records.jsonl', 'a')
n = 0
for fp in glob.glob(ROOT + '**/*', recursive=True):
    if not os.path.isfile(fp) or not fp.lower().endswith('.pdf'):
        continue
    rel = fp[len(ROOT):]
    rec = {'path': rel, 'size': os.path.getsize(fp)}
    try:
        rec['sha256'] = hashlib.sha256(open(fp, 'rb').read()).hexdigest()
        info = subprocess.run(['pdfinfo', fp], capture_output=True, text=True, timeout=60).stdout
        rec['pages'] = next((int(l.split()[-1]) for l in info.splitlines() if l.startswith('Pages:')), None)
        rec['producer'] = next((l.split(':', 1)[1].strip() for l in info.splitlines() if l.startswith(('Producer:'))), None)
        t1 = subprocess.run(['pdftotext', '-f', '1', '-l', '1', '-layout', fp, '-'], capture_output=True, text=True, timeout=60).stdout
        t2 = subprocess.run(['pdftotext', '-f', '2', '-l', '3', fp, '-'], capture_output=True, text=True, timeout=60).stdout
        rec['p1'] = t1[:2500]
        rec['p23_chars'] = len(t2.strip())
        rec['p1_chars'] = len(t1.strip())
        rec['has_text_layer'] = int(len(t2.strip()) > 200 or len(t1.strip()) > 300)
        rec['outcome'] = 'ok'
    except Exception as e:
        rec['outcome'] = 'failed'; rec['error'] = repr(e)[:300]
    out.write(json.dumps(rec) + '\n'); n += 1
    os.remove(fp)
print('processed', n, 'total records', len(done) + n)
