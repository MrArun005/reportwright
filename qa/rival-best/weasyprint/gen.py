W = 'meadow harvest orchard river valley stone timber craft market season village garden'.split()
SECTIONS = [(f'Chapter {s + 1}', [' '.join(W[(s * 7 + p * 3 + k) % len(W)] for k in range(70)).capitalize() + '.' for p in range(6)]) for s in range(12)]
def body_html():
    return ''.join(f'<h2>{h}</h2>' + ''.join(f'<p>{p}</p>' for p in ps) for h, ps in SECTIONS)
if __name__ == '__main__':
    print(body_html())
