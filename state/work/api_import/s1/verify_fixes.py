import sqlite3, json, sys
db = sqlite3.connect('/home/user/questions.db')
NOTE = 'Claude 23 Nov (Standard batch 1 verify): '
F = {
6628: (r"""The mode is the value that occurs most often. Reading the stem-and-leaf plot, the scores are
$$6,\ 8,\ 12,\ 14,\ 15,\ 21,\ 25,\ 25,\ 29,\ 35$$
Only $25$ occurs twice; every other score occurs once.
$$\therefore\ \text{The mode is } 25 \quad\text{(C)}$$""", 'the generated working misread the plot (mode 18, key B); the data give mode 25, key C'),
6685: (r"""Each subject's scores are normally distributed, so compare Pia's marks using $z$-scores, $z=\dfrac{x-\mu}{\sigma}$.
$$\begin{aligned} \text{English: } z &= \dfrac{78-66}{6} = 2.0 \\ \text{Mathematics: } z &\approx 0.9 \\ \text{Science: } z &\approx 0.47 \\ \text{History: } z &\approx 1.44 \end{aligned}$$
The largest $z$-score is English.
$$\therefore\ \text{English} \quad\text{(A)}$$""", 'the generated working said Mathematics (B); the z-scores give English (A)'),
6573: (r"""The 7th decile is the value $70\%$ of the way through the data. The total frequency is $800$.
$$0.7\times 800 = 560$$
The cumulative frequency reaches $420$ at the end of the $151$–$160$ class and $680$ at the end of the $161$–$170$ class, so the $560$th score lies in the $161$–$170$ class.
$$\therefore\ 161\text{–}170\text{ cm} \quad\text{(C)}$$""", 'no key and no final answer in the generated working; key set to C'),
6570: (r"""From the frequency table, the calculator's statistics mode gives
$$\bar{x} = 8.375, \qquad \sigma \approx 1.285$$
One standard deviation either side of the mean is from about $7.09$ to $9.66$, which contains the scores $8$ and $9$.
$$8 + 5 = 13 \text{ students}$$
$$\therefore\ 13 \quad\text{(B)}$$""", 'no key and no final answer in the generated working; key set to B'),
6646: (r"""The monthly rate is the interest in month 1 divided by the opening balance.
$$\begin{aligned} r &= \dfrac{18.75}{12\,500} \\ &= 0.0015 = 0.15\% \text{ per month} \end{aligned}$$
For month 7, the opening balance is the closing balance of month 6, $\$15\,624.20$.
$$\begin{aligned} \text{Interest} &= 0.0015\times 15\,624.20 \\ &\approx \$23.44 \end{aligned}$$
The deposit is added after the interest.
$$\begin{aligned} \text{Closing balance} &= 15\,624.20+23.44+500 \\ &= \$16\,147.64 \end{aligned}$$
$$\therefore\ \text{Month 7: opening } \$15\,624.20,\ \text{interest } \$23.44,\ \text{closing } \$16\,147.64$$""", 'the generated solution was written without the table (it used 0.4% and $15 833.17); rewritten from the table'),
6656: (r"""Annual cost $=$ power (kW) $\times$ hours per year $\times$ price per kWh, with $3\times 365 = 1095$ hours a year.
$$\begin{aligned} \text{Television } B: \quad 0.16\times 1095\times 0.25 &= \$43.80 \\ \text{Difference} &= 48.18 - 43.80 \\ &= \$4.38 \end{aligned}$$
$$\therefore\ \text{The difference in annual running cost is } \$4.38$$""", 'the generated solution gave only formulas; the table values give $4.38'),
6657: (r"""Television $B$ costs $\$21.90$ more to buy but $\$4.38$ less to run each year (part (a)).
$$\begin{aligned} n &= \dfrac{21.90}{4.38} \\ &= 5 \end{aligned}$$
$$\therefore\ \text{After } 5 \text{ years}$$""", 'the generated solution gave only a formula; the table values give 5 years'),
6729: (r"""Activities with $\text{EST} = \text{LST}$ have no float. $A$ and $C$ have float, so the critical path is the route through $B$.
$$\therefore\ \text{Critical path: } B\to E\to G\to I$$""", 'the generated solution described the method but never named the path'),
6730: (r"""$I$ starts when the critical path reaches it, $\text{EST}(I) = 12$ hours, and the project finishes at $19$ hours.
$$\begin{aligned} \text{duration of } I &= 19 - 12 \\ &= 7 \text{ hours} \end{aligned}$$
$$\therefore\ 7 \text{ hours}$$""", 'the generated solution never gave the duration'),
6731: (r"""$F$ can start at $3$ hours (after $C$), and $H$ must finish by $\text{LST}(I) = 19 - 7 = 12$ hours.
$$\begin{aligned} T &= 12 - 3 \\ &= 9 \text{ hours} \end{aligned}$$
$$\therefore\ \text{At most } 9 \text{ hours}$$""", 'the generated solution stopped at "16 − duration of I"'),
6703: (r"""The table is for an annuity of $\$1$ paid at the start of each period. For $8$ periods at $5\%$ the factor is $10.0266$.
$$\begin{aligned} FV &= 200 \times 10.0266 \\ &= \$2005.32 \end{aligned}$$
$$\therefore\ \text{The future value is } \$2005.32$$""", 'the generated solution used 9.5491, which is not in the table; the table factor is 10.0266'),
6704: (r"""Payments every 6 months for 3 years give $6$ periods at $\dfrac{4\%}{2} = 2\%$. The table factor is $6.4343$.
$$\begin{aligned} \text{Payment} &= \dfrac{4500}{6.4343} \\ &\approx \$699.38 \end{aligned}$$
To the nearest $\$10$ the payment must be at least this, so $\$700$:
$$700 \times 6.4343 = \$4504.01 \ge \$4500$$
$$\therefore\ \text{The minimum payment is } \$700 \text{ every 6 months.}$$""", 'the generated solution used 6.3081, which is not in the table; the table factor is 6.4343'),
6707: (r"""$A$ and $B$ are the values at $x = 0$ (1985). From the table, $A = 34$, and for the decreasing model
$$\begin{aligned} B &= \dfrac{61}{0.97^{50}} \\ &\approx 280 \end{aligned}$$
The yearly changes are $+5.5\%$ for $W$ (multiplier $1.055$) and $-3\%$ for $K$ (multiplier $0.97$). At $x = 50$:
$$W = 34\times 1.055^{50} \approx 494$$
$$\therefore\ A = 34,\ B = 280$$""", 'the generated solution read A = 35 from the graph, but the table gives A = 34; the missing table entries are added'),
6680: (r"""Using the female mean and standard deviation from Table 2, $\mu = 165.4$ and $\sigma = 4.8$, each female height is placed at its $z$-score: $175$ cm is $\mu + 2\sigma$ and $160.6$ cm is $\mu - \sigma$.

\exfigure{38_q41_s1}

The male is taller than $84\%$ of males. By the empirical rule, $50\% + 34\% = 84\%$ lie below $\mu + \sigma$, so his $z$-score is $1$. From Table 2 the male mean is $173.67$ and the standard deviation is $5.28$.
$$\begin{aligned} x &= 173.67 + 1\times 5.28 \\ &= 178.95 \text{ cm} \end{aligned}$$
$$\therefore\ 178.95 \text{ cm}$$""", 'the generated solution never put in the Table 2 values'),
}
# targeted edits of extracted (school / NESA) solutions
E = {
6519: ([(r'71409 \times 0.8^{27} = 175.66', r'71409 \times 0.8^{27} = 172.66')], 'the working line for n = 27 read 175.66 (it is 172.66); the answer, 27 years, is unchanged'),
6476: ([(r'&= 4.4 + 1.0 + 1.8 + 1.3 \\ &= 8.5 \text{ km}^2 \\ &\approx 9 \text{ km}^2', r'&= 4.4 + 1.0 + 1.8 + 1.2701\ldots \\ &= 8.47\ldots \text{ km}^2 \\ &\approx 8 \text{ km}^2'), (r'$$\therefore\ \text{Area} \approx 9 \text{ km}^2$$', r'$$\therefore\ \text{Area} \approx 8 \text{ km}^2$$')], 'the school rounded triangle DOC to 1.3 before adding, which gave 9 km²; unrounded the total is 8.47, so 8 km²'),
6545: ([(r'The saving is' + '\n' + r'$$10\,700 - 10\,150.64 = \$549.36$$', r'The final repayment is not a full $\$2140$: it is only $\$1621.28$ (see the spreadsheet), so the remaining payments total' + '\n' + r'$$4\times 2140 + 1621.28 = \$10\,181.28$$' + '\n' + r'The saving is' + '\n' + r'$$10\,181.28 - 10\,150.64 = \$30.64$$'),
            (r'(1 mark deducted for this error). The two answers differ because the final repayment is not actually $\$2140$, it is only $\$1621.27$ (see spreadsheet).', r'$$\therefore\ \text{He saves } \$30.64$$' + '\n' + r'(The school''s guideline gave $10\,700 - 10\,150.64 = \$549.36$, assuming five full repayments.)')],
         'the school''s answer $549.36 assumed five full $2140 repayments; the loan ends with $1621.28, so the saving is $30.64'),
6522: ([(r'$$\therefore\ 150 \text{ km} = 93.75 \text{ miles}$$', r'$$\therefore\ 150 \text{ km} = 93.75 \text{ miles (axes as intended), or } 240 \text{ (axes as printed); both were accepted}$$')], 'the paper''s axes were mislabelled and the guideline accepted both answers; the final line now says so'),
}
for sid, (new, why) in F.items():
    l, m = db.execute('select latex, meta_json from solutions where id=?', (sid,)).fetchone()
    meta = json.loads(m or '{}'); meta.setdefault('source_original', l); meta['correction_note'] = NOTE + why
    db.execute('update solutions set latex=?, meta_json=? where id=?', (new, json.dumps(meta, ensure_ascii=False), sid))
for sid, (subs, why) in E.items():
    l, m = db.execute('select latex, meta_json from solutions where id=?', (sid,)).fetchone()
    l0 = l
    for o, n in subs:
        assert o in l, (sid, o[:60]); l = l.replace(o, n)
    meta = json.loads(m or '{}'); meta.setdefault('source_original', l0); meta['correction_note'] = NOTE + why
    db.execute('update solutions set latex=?, meta_json=? where id=?', (l, json.dumps(meta, ensure_ascii=False), sid))
# 6545 criteria: reward the correct saving
c = json.loads(db.execute('select criteria_json from solutions where id=6545').fetchone()[0])
c = [[2, 'Correct answer, $\\$30.64$'], [1, 'Finds the total of the remaining repayments ($\\$10\\,181.28$), or equivalent merit']]
db.execute('update solutions set criteria_json=? where id=6545', (json.dumps(c, ensure_ascii=False),))
# 6579 (CHHS 2024 Q5): the school keyed B and D; keep both, say so in the solution
l, m = db.execute('select latex, meta_json from solutions where id=6579').fetchone()
if 'also accepted' not in l:
    meta = json.loads(m or '{}'); meta.setdefault('source_original', l); meta['correction_note'] = NOTE + 'the school accepted B and D; the solution argued only D'
    db.execute('update solutions set latex=?, meta_json=? where id=6579', (l + '\n' + r'(The school accepted both B and D: $r$ is about $-0.92$ for B and about $-1.00$ for D, so D is the closer match.)', json.dumps(meta, ensure_ascii=False)))
db.commit(); print('fixed', len(F) + len(E) + 1, 'solutions')
