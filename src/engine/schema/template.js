// @ts-check
/** A blank A4 report: header with title, empty body, footer with page numbers. */
export function blankReport(name = 'Untitled report') {
  const W = 523.28;
  return {
    $schema: 'pagewright/report@1',
    name,
    locale: 'en-IN', currency: 'INR',
    page: { size: 'A4', orientation: 'portrait', margins: [36, 36, 36, 36] },
    parameters: [],
    dataSources: [],
    dataSets: [],
    styles: { base: { fontFamily: 'Inter', fontSize: 9, color: '#1f2937' } },
    sections: {
      pageHeader: { height: 36, items: [
        { id: 'h1', type: 'textbox', name: 'ReportTitle', x: 0, y: 0, w: 320, h: 22, value: name, canGrow: true, style: { fontSize: 14, fontWeight: 'bold' } },
      ] },
      body: { height: 420, items: [] },
      pageFooter: { height: 24, items: [
        { id: 'f1', type: 'textbox', name: 'PageNumber', x: W - 200, y: 6, w: 200, h: 12, value: 'Page {Globals.PageNumber} of {Globals.TotalPages}', canGrow: false, style: { fontSize: 7.5, color: '#6b7280', textAlign: 'right' } },
      ] },
    },
  };
}
