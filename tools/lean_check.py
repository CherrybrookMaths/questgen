#!/usr/bin/env python3
"""Nightly lean check for the review page (owner 21 Nov: "This should really be done every night so it stays lean").

Finds bloat that a script can prove, and fixes only what is provably safe:
  1. CSS declarations a LATER top-level rule with the IDENTICAL selector sets again (same property; the earlier one not
     !important): by the cascade they can never apply. --fix-css removes them (health pass 21 Nov removed 279 this way,
     screenshots pixel-identical).
  2. CSS class selectors whose class appears nowhere in page_src/js, page.html or tools/page_test.js (dynamic class names are
     looked up by their prefix; KNOWN_DYNAMIC lists the families built at runtime). Reported only: a person checks them.
  3. Top-level page functions/constants used nowhere but their own definition (also searched in page_test.js). Reported only.
  4. Page size and CSS/JS size against the last run (state/work/lean_check.json).

  python3 tools/lean_check.py              report (exit 0)
  python3 tools/lean_check.py --fix-css    also remove the dead declarations of (1), then rebuild with tools/build_page.py
  python3 tools/lean_check.py --json       machine-readable report (the night run writes it to Next up)
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import glob, json, os, re, sys, time

P = paths.P
CSS = sorted(glob.glob(P + 'page_src/css/*.css'))   # build.json concatenates them in this order
JS = sorted(glob.glob(P + 'page_src/js/*.js'))
STATE = paths.S + 'work/lean_check.json'
# class families the page builds at runtime (a selector .<prefix><anything> counts as used); found in the 21 Nov health pass
KNOWN_DYNAMIC = ['rep-', 'gdotl', 'b-', 'pr-b', 'se ', 'sb ', 'sr ', 'y1', 'c', 'b', 'sc', 'chip', 'exgk', 'Fluency', 'Problem']


def toplevel_rules(s):
    """(start, end, selector, body_start, body_end) of each top-level rule; @-blocks are skipped."""
    i, n, out = 0, len(s), []
    while i < n:
        if s.startswith('/*', i): i = s.index('*/', i) + 2; continue
        if s[i].isspace(): i += 1; continue
        if s[i] == '@':
            j, k = s.find('{', i), s.find(';', i)
            if k != -1 and (j == -1 or k < j): i = k + 1; continue
            depth = 0
            while True:
                if s[j] == '{': depth += 1
                elif s[j] == '}':
                    depth -= 1
                    if depth == 0: break
                j += 1
            i = j + 1; continue
        j = s.index('{', i); k = s.index('}', j)
        sel = re.sub(r'\s+', ' ', re.sub(r'/\*.*?\*/', '', s[i:j], flags=re.S).strip())
        out.append((i, k + 1, sel, j + 1, k)); i = k + 1
    return out


def decls(body):
    parts, cur, d, q = [], '', 0, None
    for ch in body:
        if q:
            cur += ch
            if ch == q: q = None
            continue
        if ch in '"\'': q = ch
        if ch == '(': d += 1
        if ch == ')': d -= 1
        if ch == ';' and d == 0: parts.append(cur); cur = ''; continue
        cur += ch
    if cur.strip(): parts.append(cur)
    return parts


PROP = re.compile(r'\s*(?:/\*.*?\*/\s*)*([-\w]+)\s*:(.*)$', re.S)


def css_overridden(srcs):
    rules = []
    for f in CSS:
        for (a, b, sel, bs, be) in toplevel_rules(srcs[f]):
            props = []
            for d in decls(srcs[f][bs:be]):
                m = PROP.match(d)
                if m: props.append((m.group(1).lower(), '!important' in m.group(2)))
            rules.append((f, a, b, sel, bs, be, props))
    dead = {}
    for i, (f, a, b, sel, bs, be, props) in enumerate(rules):
        later = [r for r in rules[i + 1:] if r[3] == sel]
        if not later: continue
        lp = {p for r in later for p, _ in r[6]}; li = {p for r in later for p, imp in r[6] if imp}
        ds = {p for p, imp in props if p in lp and (not imp or p in li) and not p.startswith('--')}
        if ds: dead[(f, bs)] = (sel, ds)
    return rules, dead


def fix_css(srcs, rules, dead):
    removed = 0
    for f in CSS:
        s, edits = srcs[f], []
        for (f0, a, b, sel, bs, be, props) in rules:
            if f0 != f or (f, bs) not in dead: continue
            ds = dead[(f, bs)][1]
            keep = [d for d in decls(s[bs:be]) if not ((m := PROP.match(d)) and m.group(1).lower() in ds and '/*' not in d)]
            removed += len(decls(s[bs:be])) - len(keep)
            body = ';'.join(keep)
            edits.append((a, b, (s[a:bs] + body + '}') if body.strip() else ''))
        for a, b, rep in sorted(edits, reverse=True): s = s[:a] + rep + s[b:]
        if s != srcs[f]: open(f, 'w').write(s)
    return removed


def unused_classes(srcs):
    code = ''.join(open(f).read() for f in JS) + open(P + 'page_src/page.html').read() + open(P + 'tools/page_test.js').read()
    css = re.sub(r'/\*.*?\*/', '', ''.join(srcs.values()), flags=re.S)
    css = re.sub(r'url\([^)]*\)|"[^"]*"|\'[^\']*\'', '', css)
    names = set(re.findall(r'\.(-?[A-Za-z_][\w-]*)', css))
    out = []
    for c in sorted(names):
        if re.fullmatch(r'\d.*', c) or c in ('woff2', 'png', 'svg', 'json', 'css', 'js'): continue
        if re.search(r'(?<![\w-])' + re.escape(c) + r'(?![\w-])', code): continue
        if any(c.startswith(p.strip()) and (len(p) > 2 or c[len(p.strip()):].isdigit()) for p in KNOWN_DYNAMIC): continue   # e.g. b3 = 'b'+band
        out.append(c)
    return out


def unused_js():
    src = {f: open(f).read() for f in JS}
    allc = ''.join(src.values()) + open(P + 'page_src/page.html').read() + open(P + 'tools/page_test.js').read()
    out = []
    for f, s in src.items():
        for m in re.finditer(r'^(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=)', s, re.M):
            n = m.group(1) or m.group(2)
            if len(re.findall(r'(?<![\w$.])' + re.escape(n) + r'(?![\w$])', allc)) <= 1: out.append(f'{os.path.basename(f)}: {n}')
    return out


def main():
    srcs = {f: open(f).read() for f in CSS}
    rules, dead = css_overridden(srcs)
    rep = {'at': time.strftime('%Y-%m-%dT%H:%M'), 'css_overridden': sum(len(v[1]) for v in dead.values()),
           'css_overridden_rules': sorted({v[0] for v in dead.values()})[:20]}
    if '--fix-css' in sys.argv and dead:
        rep['css_removed'] = fix_css(srcs, rules, dead)
        srcs = {f: open(f).read() for f in CSS}
    rep['unused_css_classes'] = unused_classes(srcs)
    rep['unused_js'] = unused_js()
    page = P + 'site/review.html'
    rep['sizes'] = {'page': os.path.getsize(page) if os.path.exists(page) else None,
                    'css': sum(os.path.getsize(f) for f in CSS), 'js': sum(os.path.getsize(f) for f in JS)}
    prev = json.load(open(STATE)) if os.path.exists(STATE) else {}
    rep['growth'] = {k: (v - prev['sizes'][k]) if prev.get('sizes', {}).get(k) and v else None for k, v in rep['sizes'].items()}
    json.dump(rep, open(STATE, 'w'), indent=1)
    if '--json' in sys.argv: print(json.dumps(rep, indent=1)); return
    print(f"lean check: {rep['css_overridden']} overridden CSS declaration(s)" + (f", removed {rep.get('css_removed')}" if 'css_removed' in rep else ''))
    print(f"  {len(rep['unused_css_classes'])} CSS class(es) not found in the page code: {rep['unused_css_classes'][:12]}")
    print(f"  {len(rep['unused_js'])} page function(s)/constant(s) used nowhere: {rep['unused_js'][:12]}")
    print(f"  sizes {rep['sizes']} · since last run {rep['growth']}")


if __name__ == '__main__':
    main()
