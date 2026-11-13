"""Owner rule: fractions are \\dfrac, except a fraction nested inside another fraction (composite) or inside a
superscript/subscript (exponents, integral limits), which is \\frac. Works on LaTeX-in-prose and on bare maths."""
import re
CMD = re.compile(r'\\(dfrac|tfrac|frac)(?![a-zA-Z])')
def restyle(s):
    if not s or 'frac' not in s: return s
    out, i, stack, pending = [], 0, [], []   # stack: context of each open brace ('frac' | 'script' | 'other')
    # pending: contexts to assign to the next opening braces (two for a fraction, one for a script)
    while i < len(s):
        m = CMD.match(s, i)
        if m:
            inner = any(c in ('frac', 'script') for c in stack)
            out.append('\\frac' if inner else '\\dfrac'); i = m.end()
            pending = [('frac', len(stack)), ('frac', len(stack))] + pending
            continue
        ch = s[i]
        if ch == '\\' and i + 1 < len(s):       # escaped char or other command: copy as is
            m2 = re.match(r'\\([a-zA-Z]+|.)', s[i:]); out.append(m2.group(0)); i += len(m2.group(0)); continue
        if ch in '^_':
            out.append(ch); i += 1
            j = i
            while j < len(s) and s[j] == ' ': j += 1
            if j < len(s) and s[j] == '{': pending = [('script', len(stack))] + pending
            elif CMD.match(s, j):                 # x^\frac12 style: treat as script content
                out.append(s[i:j]); i = j; m = CMD.match(s, i)
                out.append('\\frac'); i = m.end(); pending = [('frac', len(stack)), ('frac', len(stack))] + pending
            continue
        if ch == '{':
            if pending and pending[0][1] == len(stack): stack.append(pending.pop(0)[0])
            else: stack.append('other')
            out.append(ch); i += 1; continue
        if ch == '}':
            if stack: stack.pop()
            out.append(ch); i += 1; continue
        if pending and not ch.isspace() and pending[0][1] == len(stack): pending = [p for p in pending if p[1] != len(stack)]   # unbraced argument at this level
        out.append(ch); i += 1
    return ''.join(out)
if __name__ == '__main__':
    for t in [r'For $y=a\sin(bx)$ the period is $\frac{2\pi}{b}$. Here $b=\frac{1}{3}$',
              r'$\dfrac{\frac{1}{2}}{3}$', r'$e^{\frac{x}{2}}$', r'$\int_{\frac{\pi}{6}}^{\frac{\pi}{2}} \frac{1+\cos x}{\sin x}\,dx$',
              r'$\tfrac{5}{2}$', r'$\dfrac{1-\dfrac{1}{x}}{2}$']:
        print(restyle(t))
