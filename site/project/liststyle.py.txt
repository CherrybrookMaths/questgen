"""Owner (11 Nov): dot points in a paper render as dot points ("this should render as dot points … same for any other
questions"). In the bank a list is LaTeX: \\begin{itemize} \\item … \\item … \\end{itemize}. This converts any run of
paragraphs starting with "- ", "• " or "* " into that form; a figure/table paragraph between bullets stays with the item
before it. Safe to re-run (part of house_style.py)."""
import re
BUL = re.compile(r'^\s*(?:[-•▪●*])\s+')
def restyle(s):
    if not s or not re.search(r'(?m)^\s*[-•▪●*]\s+\S', s): return s
    paras = re.split(r'\n\s*\n', s); out = []; i = 0
    while i < len(paras):
        if BUL.match(paras[i]):
            items = []
            while i < len(paras) and (BUL.match(paras[i]) or (items and re.fullmatch(r'\s*\\ex(figure|table)\{[^}]*\}\s*', paras[i]))):
                if BUL.match(paras[i]): items.append(BUL.sub('', paras[i]).strip())
                else: items[-1] += '\n\n' + paras[i].strip()
                i += 1
            out.append('\\begin{itemize}\n' + '\n'.join('\\item ' + t for t in items) + '\n\\end{itemize}')
        else:
            out.append(paras[i]); i += 1
    return '\n\n'.join(out)
if __name__ == '__main__':
    print(restyle("Known.\n\n- 7 a\n\n- 20 b\n\n\\exfigure{x}\n\n- 18 c\n\nThen."))
