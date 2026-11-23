#!/usr/bin/env python3
"""The database backup on Drive, in parts (owner 23 Nov: "Lets split the db backup as well").

The xz of questions.db reached 2.93 MB on 23 Nov, against the Drive connector's ~3.1 MB upload limit. The backup is now
questions_<YYYYMMDD>.db.xz.part00, .part01, ... (1.5 MB each) plus questions_<YYYYMMDD>.db.xz.SHA256SUMS.txt, in the Drive folder
"HSC Advanced Question Bank" (CLAUDE.md "Where everything lives"). The newest set without "superseded" in its names is the backup.

  python3 tools/db_backup.py split            compress the database (xz -9e) into work/dbparts/: the parts + SHA256SUMS.txt;
                                              prints each part's upload reference (sha256:<hash>:<absolute path>)
  python3 tools/db_backup.py join DIR [DEST]  check the parts in DIR against SHA256SUMS.txt, join and decompress them to DEST
                                              (default: the DB path of tools/paths.py); refuses an existing DEST
Upload: Google Drive create_file per file, base64Content = the printed reference, contentMimeType application/octet-stream
(text/plain for the sums), disableConversionToGoogleType true. Then rename the previous set (and any older questions.db.xz / .zip)
"... (superseded <date>, safe to delete)" (never trash).
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import glob, hashlib, lzma, os, subprocess, sys, time

PART = 1_500_000
OUT = paths.P + 'work/dbparts/'


def sha(b): return hashlib.sha256(b).hexdigest()


def split():
    os.makedirs(OUT, exist_ok=True)
    for f in glob.glob(OUT + '*'): os.remove(f)
    stamp = time.strftime('%Y%m%d', time.localtime())   # run with TZ=Australia/Sydney
    data = subprocess.run(['xz', '-9e', '-c', paths.DBS], check=True, capture_output=True).stdout
    name = f'questions_{stamp}.db.xz'
    lines = []
    for i in range(0, len(data), PART):
        p = f'{name}.part{i // PART:02d}'
        open(OUT + p, 'wb').write(data[i:i + PART]); lines.append(f'{sha(data[i:i + PART])}  {p}')
    lines.append(f'{sha(data)}  {name} (the parts joined, in order)')
    open(OUT + f'{name}.SHA256SUMS.txt', 'w').write('\n'.join(lines) + '\n')
    print(f'{len(data) / 1e6:.2f} MB in {len(lines) - 1} parts -> {OUT}')
    for f in sorted(os.listdir(OUT)):
        print(f'  {f}  sha256:{sha(open(OUT + f, "rb").read())}:{os.path.abspath(OUT + f)}')


def join(d, dest=None):
    dest = dest or paths.DBS
    if os.path.exists(dest): sys.exit(f'{dest} exists: move it away first')
    sums = glob.glob(os.path.join(d, '*SHA256SUMS*'))
    if len(sums) != 1: sys.exit(f'want one SHA256SUMS file in {d}, found {len(sums)}')
    rows = [l.split(None, 1) for l in open(sums[0]) if l.strip()]
    parts, whole = [r for r in rows if '.part' in r[1]], [r for r in rows if '.part' not in r[1]]
    data = b''
    for h, n in sorted(parts, key=lambda r: r[1]):
        b = open(os.path.join(d, n.strip()), 'rb').read()
        if sha(b) != h: sys.exit(f'{n.strip()}: checksum differs')
        data += b
    if whole and sha(data) != whole[0][0]: sys.exit('joined file: checksum differs')
    open(dest, 'wb').write(lzma.decompress(data))
    print(f'{len(parts)} parts checked and joined -> {dest} ({os.path.getsize(dest) / 1e6:.1f} MB)')


if __name__ == '__main__':
    a = sys.argv[1:]
    if a[:1] == ['split']: split()
    elif a[:1] == ['join'] and len(a) >= 2: join(a[1], a[2] if len(a) > 2 else None)
    else: sys.exit(__doc__)
