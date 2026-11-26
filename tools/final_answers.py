#!/usr/bin/env python3
"""Final answers for written parts, read out of their worked solutions (owner 26 Nov: "Lets run final answer trial, happy for you to do
that"). The exam "Paper with answers" and the worksheet "with answers" print a short final answer only for multiple choice: the bank has
no final answer for a written part, so those fall back to the worked solution (UI_SPEC "Exams: paper with answers ..." 26 Nov).

This tool asks the model to COPY the final answer that the worked solution already reaches: no new maths, nothing invented. A part whose
solution ends in a proof, a "show that", a sketch, or several answers that do not reduce to a short line gets kind "none" (the worked
solution stays). Results go to a JSON file for checking; nothing is written to the database.

    python3 tools/final_answers.py trial [N]     # N parts (default 50), spread over both courses and part types
"""
import json, os, random, re, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import paths, api_import as A

S = str(paths.STATE) + '/'
MODEL = 'claude-sonnet-5-5'   # IMPORT_PLAYBOOK "Models per step": reading and formatting steps run on Sonnet
BATCH = 'fa_trial'

SCHEMA = {'type': 'object', 'properties': {'answers': {'type': 'array', 'items': {'type': 'object', 'properties': {
    'id': {'type': 'integer'},
    'kind': {'type': 'string', 'enum': ['value', 'expression', 'statement', 'none'],
             'description': 'value: a number with or without units; expression: an algebraic answer; statement: a short conclusion '
                            'sentence (e.g. "over the limit"); none: proof, show that, sketch, table to fill, or no single short answer'},
    'final': {'type': 'string', 'description': 'The final answer exactly as the worked solution states it, in LaTeX with $...$ for maths, '
                                              'at most about 15 words. Empty when kind is none.'},
    'confidence': {'type': 'number'}}, 'required': ['id', 'kind', 'final', 'confidence']}}}, 'required': ['answers']}

PROMPT = ("Each item below is one part of an HSC maths question and its worked solution. For each, copy out the FINAL ANSWER the worked "
          "solution reaches, as a student would write it on the answer line: the value with its units and rounding as the solution gives "
          "them, or the final expression, or a short concluding statement. Do NOT do any maths yourself and do not correct the solution: "
          "copy what it concludes. If the part is a proof or 'show that', a sketch or graph to draw, a table to complete, or has no single "
          "short final answer, give kind 'none' and an empty final. Several answers (e.g. x = 2 or x = -3) go on one line. "
          "Call the submit tool once with every item.")


def parts_pool():
    b = json.load(open(str(paths.ROOT) + '/site/data/bank.json'))
    out = []
    for q in b['questions']:
        if q.get('dup_of') or q.get('type') == 'mcq': continue
        sols = q.get('solutions') or []
        for p in q['parts']:
            if any(x.get('parent') == p['id'] for x in q['parts']): continue   # leaf parts only
            s = [x for x in sols if x.get('part_id') == p['id']] or ([x for x in sols if x.get('part_id') is None] if len(q['parts']) == 1 else [])
            if not s or not (s[0].get('latex') or '').strip(): continue
            out.append({'id': p['id'], 'q': q['id'], 'key': q.get('key'), 'std': 'STD' in (q.get('key') or ''), 'marks': p.get('marks'),
                        'part': (q.get('stem') or '')[-600:] + '\n' + (p.get('latex') or ''), 'sol': s[0]['latex']})
    return out


def run(items):
    api = A.client(); res = []
    for i in range(0, len(items), 10):
        chunk = items[i:i + 10]
        A.spend_guard(BATCH, 'fa')
        body = '\n\n'.join(f"### ITEM {x['id']}\nQUESTION PART:\n{x['part']}\n\nWORKED SOLUTION:\n{x['sol']}" for x in chunk)
        t0 = time.time()
        r = api.messages.create(model=MODEL, max_tokens=4000, tools=[A.submit_tool('submit', 'Submit the final answers', SCHEMA)],
                                messages=[{'role': 'user', 'content': PROMPT + '\n\n' + body}])
        u = {k: getattr(r.usage, k, 0) or 0 for k in ('input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens')}
        A.log_call(BATCH, {'t': A.now(), 'batch': BATCH, 'doc': 'fa', 'step': 'final_answers', 'model': MODEL, **u,
                           'usd': A.usd(MODEL, u), 'secs': round(time.time() - t0, 1)})
        got = next((c.input for c in r.content if getattr(c, 'type', '') == 'tool_use'), {}).get('answers', [])
        by = {a['id']: a for a in got}
        for x in chunk: res.append({**x, **(by.get(x['id']) or {'kind': 'missing', 'final': '', 'confidence': 0})})
        print(f'{i + len(chunk)}/{len(items)}  US${A.usd(MODEL, u):.4f}', flush=True)
    return res


def main():
    if len(sys.argv) < 2 or sys.argv[1] != 'trial': sys.exit(__doc__)
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 50
    pool = parts_pool(); rnd = random.Random(1126)
    std = [x for x in pool if x['std']]; adv = [x for x in pool if not x['std']]
    items = rnd.sample(adv, n - n * 2 // 5) + rnd.sample(std, n * 2 // 5)
    res = run(items)
    spent = sum(json.loads(l)['usd'] for l in open(S + f'work/api_import/{BATCH}/calls.jsonl'))
    out = S + 'work/final_answers_trial.json'
    json.dump({'made': A.now(), 'model': MODEL, 'n': len(res), 'pool': len(pool), 'usd': round(spent, 4), 'items': res},
              open(out, 'w'), indent=1, ensure_ascii=False)
    kinds = {}
    for r in res: kinds[r['kind']] = kinds.get(r['kind'], 0) + 1
    print(f'{len(res)} parts of {len(pool)} written parts with a solution; US${spent:.4f}; kinds {kinds}; -> {out}')
    print(f'whole pool at this rate: about US${spent / len(res) * len(pool):.2f}')


if __name__ == '__main__':
    main()
