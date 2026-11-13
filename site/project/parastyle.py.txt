"""Owner rule (11 Nov): every line break in the source is a paragraph break and must be kept.
In LaTeX-in-prose a single newline renders as a space, so any single newline in prose (not touching a $$ display)
becomes a blank line (paragraph break). Lines next to $$...$$ displays are left alone (displays are blocks already)."""
import re
SINGLE = re.compile(r'(?<!\n)\n(?!\n)')
def restyle(s):
    if not s or '\n' not in s: return s
    out, last = [], 0
    for m in SINGLE.finditer(s):
        a, b = s[:m.start()].rstrip(' '), s[m.end():].lstrip(' ')
        if a.endswith('$$') or b.startswith('$$'): continue
        if s[:m.start()].count('$$') % 2: continue          # inside a display (e.g. aligned rows)
        if b.startswith('\\item') or b.startswith('\\end{itemize}') or a.endswith('\\begin{itemize}'): continue   # list lines (liststyle.py)
        out.append(s[last:m.start()]); out.append('\n\n'); last = m.end()
    out.append(s[last:]); return ''.join(out)
