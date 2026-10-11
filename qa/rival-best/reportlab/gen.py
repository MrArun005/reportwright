import json
D = json.load(open('data.json'))
W = D['words']
def para(s, p):
    return ' '.join(W[(s * 31 + p * 7 + k * 13) % len(W)] for k in range(90)).capitalize() + '.'
DOC = [(f'Section {s + 1}', [para(s, p) for p in range(D['paras'])]) for s in range(D['sections'])]
if __name__ == '__main__':
    print(json.dumps([{'section': h, 'text': t} for h, ps in DOC for t in ps]))
