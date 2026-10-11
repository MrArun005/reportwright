# the input: 500 pages x 50 lines, written by PyMuPDF (untimed)
import os, fitz
d = fitz.open()
for p in range(500):
    pg = d.new_page()
    for l in range(50):
        pg.insert_text((40, 50 + l * 15), f'Page {p + 1} line {l + 1}: invoice ledger balance {p * 50 + l}', fontsize=10)
d.save(os.environ['OUT'] + '/in.pdf')
