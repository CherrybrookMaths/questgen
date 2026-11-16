"""Owner rule: a multiplication dot is \\cdot (centred), never a full stop on the baseline (".").
Changes "x . y" / "\\sec x.\\operatorname{cosec} x" inside maths to "\\cdot"; leaves decimals and sentence full stops.
Also (owner, 11 Nov: "the decimal points are floating"): a decimal point is always a baseline "." -- papers that print a
raised decimal point (e.g. 2021 Independent Trial "0\u00b74") are transcribed as 0.4, never 0\\cdot 4."""
import re
INL = re.compile(r'(\$\$.*?\$\$|(?<![\\$])\$(?!\$)(?:\\\$|[^$])+?\$)', re.S)
DOT = re.compile(r'(?<=[A-Za-z0-9)}\]])\s*\.\s*(?=\\(?!quad|qquad|,|;)[A-Za-z]|[A-Za-z(])')
DOT2 = re.compile(r'(?<=[)}\]])\s*\.\s+(?=\d)')          # "e^{2x}. 2" -> product with a number
TXT = re.compile(r'\\(?:text|mathrm|textit|textbf)\{[^{}]*\}')
def fix_math(m):
    keep = []
    m = TXT.sub(lambda t: keep.append(t.group(0)) or f'\x00{len(keep)-1}\x00', m)
    m = DOT2.sub(r' \\cdot ', DOT.sub(r' \\cdot ', m))
    return re.sub(r'\x00(\d+)\x00', lambda t: keep[int(t.group(1))], m)
DEC = re.compile(r'(?<!\\ln )(?<!\\log )(?<=\d)\s*\\cdot\s*(?=\d)(?!\d(?:\^|\{))')   # digit \cdot digit is a raised decimal point, not a product
# ...except a single digit raised to a power (owner 12 Nov via checker: "\ln 5\cdot 5^x" became "\ln 5.5^x", "2\cdot 3^{n-1}" became "2.3^{n-1}")
def restyle(s, bare=False, decimals=True):
    # owner 17 Nov (Batch 7: eight worked solutions read "-3.4-4" for -3 x 4 - 4): a worked solution is written by the solution
    # step in house style, where a dot between digits is a product, so the raised-decimal rule applies to printed paper text only
    # (questions, parts, options, tables). decimals=False for solutions and their criteria.
    if s and decimals: s = DEC.sub('.', s)
    if not s or '.' not in s: return s
    if bare: return fix_math(s)
    s = s.replace('\\$', '\x01')                      # escaped dollar (money) is not a maths delimiter
    return INL.sub(lambda m: fix_math(m.group(0)), s).replace('\x01', '\\$')
if __name__ == '__main__':
    for t in [r'$\sec x.\operatorname{cosec} x$', r'$x=2.5$ and $y$.', r'$f(x).g(x)$', r'$e^{2x}. 2$', r'$3.14$', r'$0\cdot 4+1\cdot 05^n$', r'$\text{e.g. } x$']:
        print(restyle(t))
