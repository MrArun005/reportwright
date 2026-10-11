# WeasyPrint's showcase: CSS paged media (margin boxes, page counters, two-column flow)
import os
from weasyprint import HTML
from gen import body_html
html = open('brochure.html').read().replace('<div class="cols" id="body"></div>', f'<div class="cols">{body_html()}</div>')
HTML(string=html, base_url='.').write_pdf(os.environ['OUT'] + '/theirs.pdf')
