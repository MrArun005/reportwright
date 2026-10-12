# PyMuPDF's showcase: fast text extraction
import os, fitz
d = fitz.open(os.environ['OUT'] + '/in.pdf')
open(os.environ['OUT'] + '/theirs.txt', 'w').write('\n'.join(p.get_text() for p in d))
