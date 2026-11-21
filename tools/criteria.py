"""Marking criteria parser for solutions (moved here 21 Nov from tools/ui_v2_data.py, which tools/post_load.py used to run
through exec on a slice of its source text; ui_v2_data.py was a one-off and is archived). Used by tools/post_load.py."""
import re


def parse_criteria(mb):
    meta = {}
    s = mb or ''
    m = re.search(r'\s*CONCERN:\s*(.*)$', s, re.S)
    if m: meta['concern'] = m.group(1).strip(); s = s[:m.start()]
    m = re.search(r'\s*\[confidence\s*([\d.]+);\s*check:\s*([^\]]*)\]', s)
    if m: meta['confidence'] = float(m.group(1)); meta['check'] = m.group(2).strip(); s = s[:m.start()] + s[m.end():]
    m = re.search(r'\s*\[reused from duplicate(?: question)?\s*(\d+)(?:,\s*similarity\s*([\d.]+))?\]', s)
    if m: meta['reused_from'] = int(m.group(1)); s = s[:m.start()] + s[m.end():]
    s = s.strip()
    # split on "; N:" boundaries (not inside $...$)
    pieces, cur, inmath, i = [], '', False, 0
    while i < len(s):
        ch = s[i]
        if ch == '$' and (i == 0 or s[i-1] != '\\'): inmath = not inmath
        if ch == ';' and not inmath and re.match(r';\s*\d+\s*:', s[i:]):
            pieces.append(cur); cur = ''; i += 1; continue
        cur += ch; i += 1
    pieces.append(cur)
    crit = []
    for p in pieces:
        p = p.strip()
        m = re.match(r'(\d+)\s*:\s*(.*)$', p, re.S)
        if m: crit.append([int(m.group(1)), m.group(2).strip()])
        elif p:
            if crit: crit[-1][1] += ' ' + p
            else: crit.append([None, p])
    # trailing advice sentence after last criterion e.g. "... incorrect. Students need to ..."
    if crit:
        m = re.match(r'(.*?[.])\s+(Students .*|Note.*|Markers .*)$', crit[-1][1], re.S)
        if m: crit[-1][1] = m.group(1); meta['marker_note'] = m.group(2)
    return crit, meta
