# ReportLab's showcase: platypus flowing a long document (headings, justified paragraphs, page numbers).
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from gen import DOC
ss = getSampleStyleSheet()
body = ss['BodyText']; body.alignment = 4  # justified
story = []
for h, ps in DOC:
    story.append(Paragraph(h, ss['Heading2']))
    story += [Paragraph(p, body) for p in ps]
def num(c, d):
    c.setFont('Helvetica', 8); c.drawRightString(A4[0] - 40, 20, f'Page {d.page}')
SimpleDocTemplate(os.environ['OUT'] + '/theirs.pdf', pagesize=A4, leftMargin=40, rightMargin=40, topMargin=40, bottomMargin=40).build(story, onFirstPage=num, onLaterPages=num)
