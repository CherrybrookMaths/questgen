#!/usr/bin/env python3
"""Standard course dot points from the 2024 syllabus (owner 23 Nov: "we need to start working on the standard course", then
"Standard 2 first"; Standard 1 is extracted too, from the same document, for later).

Input: "NSW Syllabus - Mathematics Standard (11-12).pdf" in the CMC Resources shared drive (read only; Drive id
1DDmgXTTwM3owUqKH-45eqCKx1ukqnSdt), saved locally. Output: state/work/skills/standard/dotpoints.json, one entry per content dot point:
{id, part: common | S1 | S2, yl, fa (focus area), sub (sub-heading or null), outcome (e.g. MST-12-S2-04), text (plain), tex ($...$ maths)}.
ids: S11-nnn (Year 11, both courses), S2-12-nnn (Year 12 Standard 2), S1-12-nnn (Year 12 Standard 1).
The PDF text layer garbles fractions, superscripts and subscripts; the formulas in T below were corrected by hand against the PDF
(23 Nov: 47 dot points; every formula renders in KaTeX).
  python3 tools/standard_syllabus.py <syllabus.pdf>
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import json, os, re, subprocess, sys
OUT = paths.S + 'work/skills/standard/dotpoints.json'


def parse(text):
    part = None; fa = None; sub = None; mode = None; cur = None; out = []; outcome = None; outbuf = []; yl = None
    L = [x.lstrip('\f') for x in text.split('\n')]
    def flush():
        nonlocal cur
        if cur:
            t = re.sub(r'\s+', ' ', ' '.join(cur['raw'])).strip()
            cur['text'] = t; out.append(cur); cur = None
    i0 = next(i for i, l in enumerate(L) if l.startswith('Outcomes and content for Year 11') and '....' not in l)
    for i in range(i0, len(L)):
        l = L[i]
        if re.match(r'Mathematics Standard 11–12 \(2024\)\s+Page', l): continue
        m = re.match(r'Outcomes and content for Year (11|12)(?:\s*\S\s*Standard ([12]))?', l)
        if m: flush(); part = 'common' if m.group(1) == '11' else 'S' + m.group(2); yl = int(m.group(1)); continue
        if l.strip() == 'Outcomes' and i > 0:
            flush(); fa = next(L[j].strip() for j in range(i - 1, i0, -1) if L[j].strip() and not L[j].startswith('Mathematics Standard')); mode = 'out'; sub = None; outbuf = []; continue
        if l.strip() == 'Content': flush(); mode = 'content'; continue
        if mode == 'out':
            outbuf.append(l.strip()); j=' '.join(outbuf).replace('- ','-')
            ms=re.findall(r'MST-1[12]-(?:S[12]-)?\d\d', j)
            if ms: outcome=ms[-1]
            continue
        if mode != 'content' or not l.strip(): continue
        if l.startswith('§'):
            flush(); cur = {'part': part, 'yl': yl, 'fa': fa, 'sub': sub, 'outcome': outcome, 'raw': [l[1:].strip()], 'gap': False}; continue
        if not l.startswith(' ') and cur is None or (not l.startswith(' ') and not l.startswith('§') and L[i + 1:i + 3] and any(x.startswith('§') for x in L[i + 1:i + 3])):
            flush(); sub = l.strip(); continue
        if cur is not None:
            if re.search(r'\S\s{6,}\S', l) or len(l) - len(l.lstrip()) > 12: cur['gap'] = True
            cur['raw'].append(l.strip())
    flush()
    n = {}
    for d in out:
        k = {'common': 'S11', 'S1': 'S1-12', 'S2': 'S2-12'}[d['part']]; n[k] = n.get(k, 0) + 1
        d['id'] = f'{k}-{n[k]:03d}'; d.pop('raw')
    return out


def clean(d):
    fas = {x['fa'] for x in d}
    for a, b in zip(d, d[1:] + [None]):
        if b and b['fa'] != a['fa'] and a['text'].endswith(' ' + b['fa']): a['text'] = a['text'][:-len(b['fa']) - 1]
    # hand corrections of formulas the PDF text layer garbles (checked against the PDF layout text, 23 Nov); tex uses $...$
    T = {
     'S11-003': 'Calculate distance, speed and time (with change of units of measurement as required) and stopping distances of vehicles using $\\text{speed}=\\dfrac{\\text{distance}}{\\text{time}}$ and stopping distance = reaction distance + braking distance',
     'S11-004': 'Apply the formulas $BAC_{\\text{male}}=\\dfrac{10N-7.5H}{6.8M}$ and $BAC_{\\text{female}}=\\dfrac{10N-7.5H}{5.5M}$ to calculate and interpret blood alcohol content (BAC) based on drink consumption and body weight, where $N$ is the number of standard drinks consumed, $H$ is the number of hours of drinking and $M$ is the person’s weight in kilograms',
     'S11-005': 'Apply the formula $\\text{Time}=\\dfrac{BAC}{0.015}$ to determine the number of hours required for a person to stop consuming alcohol in order to reach zero BAC',
     'S11-009': 'Change the subject of linear and non-linear formulas limited to quadratics of the form $y=ax^2+c$ to solve problems and make decisions about solutions in the context of the problem',
     'S11-013': 'Determine the equation of a straight line of the form $y=mx+c$ where $m$ is the gradient and $c$ is the $y$-intercept',
     'S11-020': 'Recognise that a direct variation relationship of the form $y=kx$ produces a straight-line graph',
     'S11-021': 'Explain that a direct variation relationship of the form $y=kx$ is a graph that passes through the origin with gradient $k$ being the constant of variation',
     'S11-022': 'Identify and represent direct variation of the form $y=kx$ from descriptions of situations in which one quantity varies directly with another quantity',
     'S11-023': 'Evaluate $k$ in equations of the form $y=kx$, given one pair of values for the variables, and use the resulting formula to find other values of the variables to solve problems in a variety of contexts',
     'S11-024': 'Graph and analyse equations of the form $y=kx$ to solve problems in a variety of contexts',
     'S11-052': 'Identify and convert between metric units of area, using $1\\text{ cm}^2=100\\text{ mm}^2$, $1\\text{ m}^2=10\\,000\\text{ cm}^2$, $1\\text{ ha}=10\\,000\\text{ m}^2$ and $1\\text{ km}^2=1\\,000\\,000\\text{ m}^2$',
     'S11-053': 'Identify and convert between metric units of volume, using $1\\text{ cm}^3=1000\\text{ mm}^3$, $1\\text{ m}^3=1\\,000\\,000\\text{ cm}^3$, and $1\\text{ km}^3=1\\,000\\,000\\,000\\text{ m}^3$',
     'S11-055': 'Identify and convert between units of volume and capacity, using $1\\text{ cm}^3=1\\text{ mL}$, $1\\text{ m}^3=1000\\text{ L}=1\\text{ kL}$ and $1000\\text{ kL}=1\\text{ ML}$',
     'S11-057': 'Apply scientific notation to represent numbers involving standard prefixes: nano- (n) for $10^{-9}$, micro- (µ) for $10^{-6}$, milli- (m) for $10^{-3}$, centi- (c) for $10^{-2}$, kilo- (k) for $10^{3}$, mega- (M) for $10^{6}$, giga- (G) for $10^{9}$ and tera- (T) for $10^{12}$, with and without a required number of significant figures',
     'S11-062': 'Solve practical problems involving volume and capacity of prisms, cylinders, spheres, cones, pyramids and composite solids in a variety of contexts',
     'S11-063': 'Apply the Trapezoidal rule $A\\approx\\dfrac{h}{2}(d_f+d_l)$, where $A$ is the area, $d_f$ and $d_l$ are the lengths of the parallel sides of the trapezium, $d_f$ is the first length and $d_l$ is the last length, and $h$ is the perpendicular distance between them, to solve a variety of practical problems involving area, volume and capacity for up to four applications',
     'S11-105': 'Calculate the range and population standard deviation $\\sigma$ of a dataset using a scientific calculator or other digital tools',
     'S11-118': 'Apply $Q_1-1.5\\times IQR$ and $Q_3+1.5\\times IQR$ to formally identify outliers',
     'S1-12-009': 'Calculate simple interest for different interest rates and time periods using the formula $I=Prn$ where $I$ = simple interest, $P$ = principal, $r$ = interest rate per time period and $n$ = number of time periods',
     'S1-12-012': 'Calculate the future value, present value or interest rate of a compound interest investment using the formula $FV=PV(1+r)^n$ where $FV$ = future value of the investment, $PV$ = present value of the investment, $r$ = interest rate per time period and $n$ = number of time periods',
     'S1-12-017': 'Apply the straight-line depreciation method to calculate the depreciation of an asset using the formula $S=V_0-Dn$ where $S$ = salvage value, $V_0$ = initial value of the asset, $D$ = depreciation amount per time period and $n$ = number of time periods',
     'S1-12-018': 'Apply the declining balance method to calculate the depreciation of an asset using the formula $S=V_0(1-r)^n$ where $S$ = salvage value, $V_0$ = initial value of the asset, $r$ = depreciation rate per time period and $n$ = number of time periods',
     'S1-12-065': 'Express the probability of an event that has a finite number of equally likely outcomes, as $P(\\text{event})=\\dfrac{\\text{number of favourable outcomes}}{\\text{total number of outcomes}}$',
     'S1-12-066': 'Apply $P(\\text{an event does not occur})=1-P(\\text{the event does occur})$ to calculate the probability of the complement of an event',
     'S2-12-008': 'Graph an exponential relationship of the form $y=a^x$ and $y=a^{-x}$, where $a>0$, with and without using graphing applications',
     'S2-12-009': 'Construct and analyse an exponential model of the form $y=ka^x$ and $y=ka^{-x}$, where $a>0$ and $k$ is a constant, to solve practical growth or decay problems',
     'S2-12-014': 'Graph a quadratic relationship of the form $y=ax^2+bx+c$ using graphing applications',
     'S2-12-020': 'Recognise that inverse variation is represented by a reciprocal relationship of the form $y=\\dfrac{k}{x}$, where $k$ is the constant of variation',
     'S2-12-021': 'Identify the hyperbolic shape of a reciprocal graph',
     'S2-12-022': 'Graph a reciprocal relationship of the form $y=\\dfrac{k}{x}$, with and without using graphing applications',
     'S2-12-023': 'Construct a reciprocal model of the form $y=\\dfrac{k}{x}$ to analyse inverse variation problems',
     'S2-12-024': 'Solve inverse variation problems graphically, or algebraically given the value of two of the variables in $y=\\dfrac{k}{x}$',
     'S2-12-026': 'Calculate simple interest for different rates and time periods using the formula $I=Prn$ where $I$ = simple interest, $P$ = principal, $r$ = interest rate per time period and $n$ = number of time periods',
     'S2-12-029': 'Calculate the future value, present value or interest rate of a compound interest investment using the formula $FV=PV(1+r)^n$ where $FV$ = future value of the investment, $PV$ = present value of the investment, $r$ = interest rate per time period and $n$ = number of time periods',
     'S2-12-040': 'Apply the straight-line depreciation method to calculate the depreciation of an asset using the formula $S=V_0-Dn$ where $S$ = salvage value, $V_0$ = initial value of the asset, $D$ = depreciation amount per time period and $n$ = number of time periods',
     'S2-12-041': 'Apply the declining balance method to calculate the depreciation of an asset using the formula $S=V_0(1-r)^n$ where $S$ = salvage value, $V_0$ = initial value of the asset, $r$ = depreciation rate per time period and $n$ = number of time periods',
     'S2-12-062': 'Apply trigonometric ratios to right-angled triangles to find either the lengths of unknown sides or the size of unknown angles in both degrees, and degrees and minutes',
     'S2-12-063': 'Apply the sine rule $\\dfrac{a}{\\sin A}=\\dfrac{b}{\\sin B}=\\dfrac{c}{\\sin C}$ in a given triangle $ABC$ to find the value of an unknown side',
     'S2-12-064': 'Apply the sine rule $\\dfrac{\\sin A}{a}=\\dfrac{\\sin B}{b}=\\dfrac{\\sin C}{c}$ in a given triangle $ABC$ to find the value of an unknown angle, excluding the ambiguous case',
     'S2-12-066': 'Apply the cosine rule $c^2=a^2+b^2-2ab\\cos C$ in a given triangle $ABC$ to find the value of an unknown side',
     'S2-12-067': 'Apply the cosine rule $\\cos C=\\dfrac{a^2+b^2-c^2}{2ab}$ in a given triangle $ABC$ to find the value of an unknown angle',
     'S2-12-068': 'Apply the formula $A=\\dfrac{1}{2}ab\\sin C$, where $a$ and $b$ are the sides that form the included angle $C$ in a given triangle $ABC$, to solve problems in a range of contexts',
     'S2-12-082': 'Calculate the volume of rainfall over an area using $V=Ah$, where $V$ is the volume, $A$ is the area of land and $h$ is the depth of rain, from a site plan, an aerial photograph, a radial survey or a map that includes a scale',
     'S2-12-124': 'Express the probability of an event that has a finite number of equally likely outcomes, as $P(\\text{event})=\\dfrac{\\text{number of favourable outcomes}}{\\text{total number of outcomes}}$',
     'S2-12-125': 'Apply $P(\\text{an event does not occur})=1-P(\\text{the event does occur})$ to calculate the probability of the complement of an event',
     'S2-12-127': 'Determine the probabilities of outcomes for multistage events using $P(A\\text{ and }B)=P(A)\\times P(B)$',
     'S2-12-137': 'Calculate the $z$-score corresponding to a specific value in a dataset by applying the formula $z=\\dfrac{x-\\mu}{\\sigma}$, where $x$ is a specific value, $\\mu$ is the mean and $\\sigma$ is the standard deviation',
    }
    plain = lambda t: re.sub(r'\s+', ' ', re.sub(r'\$([^$]*)\$', lambda m: re.sub(r'\\dfrac\{([^{}]*)\}\{([^{}]*)\}', r'(\1)/(\2)', m.group(1)).replace('\\text{', '{').replace('\\', '').replace('{', '').replace('}', '').replace('^', '^'), t)).strip()
    for x in d:
        x['tex'] = T.get(x['id'], x['text']).replace('―', '−')
        x['text'] = plain(x['tex']) if x['id'] in T else x['text'].replace('―', '−')
        x.pop('gap', None)
    return d


if __name__ == '__main__':
    txt = subprocess.run(['pdftotext', '-layout', sys.argv[1], '-'], capture_output=True, text=True, check=True).stdout
    d = clean(parse(txt))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(d, open(OUT, 'w'), indent=1, ensure_ascii=False)
    import collections
    print(f"{len(d)} dot points {dict(collections.Counter(x['part'] for x in d))} -> {OUT}")
