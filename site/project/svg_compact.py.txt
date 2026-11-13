"""Shrink pdftocairo SVGs: round numbers to 2 dp and write axis-aligned squares (stipple dots) in relative form.
v2 (owner: arrowheads not in line with the axes): numbers are ROUNDED, not truncated, and transform matrices are kept
at full precision. v1 cut 0.99736 to 0.99, which shrank long lines by ~0.75% while arrowheads and labels (placed by
their own translate) stayed put, so axis arrows sat off the axis and detached from it."""
import re, sys
p = sys.argv[1]; s = open(p).read()
parts = re.split(r'(transform="[^"]*")', s)                      # odd items: transform attributes, left untouched
def r2(m):
    v = round(float(m.group(0)), 2)
    return ('%.2f' % v).rstrip('0').rstrip('.') if v != 0 else '0'
for i in range(0, len(parts), 2):
    parts[i] = re.sub(r'-?\d+\.\d{3,}', r2, parts[i])
s = ''.join(parts)
N = r'(-?\d+(?:\.\d+)?)'
sq = re.compile(rf'M {N} {N} L {N} \2 L \3 {N} L \1 \4 Z')
def f(m):
    a, b, c, d = map(float, m.groups())
    g = lambda v: ('%.2f' % v).rstrip('0').rstrip('.')
    return f'M{g(a)} {g(b)}h{g(c-a)}v{g(d-b)}h{g(a-c)}z'
s = sq.sub(f, s)
open(p, 'w').write(s)
