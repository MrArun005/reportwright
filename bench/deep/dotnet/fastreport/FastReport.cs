// FastReport Open Source: the grouped ledger from ledger.frx (the jasper report's layout: a column header band on every
// page, a Region group header and footer with Count and Sum totals, a report summary with the grand total, "Page N of M"
// with the double pass). Setup, outside the clock: the fixture fonts, loading the .frx, registering the rows and compiling
// the report's expressions (FastReport compiles them with Roslyn and caches the assembly; JasperReports likewise compiles
// its jrxml in setup). The clock covers Prepare + export. The open-source PDF export is PDFSimpleExport, which draws each
// page as one image: its output has no text, so the report's text checks cannot pass (README.md).
using System.Reflection;
using FastReport.Export.PdfSimple;
using FrReport = FastReport.Report;
using static Program;

sealed class FastReportLib : Lib
{
    FrReport? rep;
    public override string Version() => Ver(typeof(FrReport));

    public override void Setup(Ctx c)
    {
        foreach (var k in new[] { "r", "b" }) FastReport.FontManager.AddFont(Font(k));
        rep = new FrReport();
        rep.Load(Path.Combine(AppContext.BaseDirectory, "ledger.frx"));
        rep.RegisterData(c.Rows, "Ledger");
        rep.GetDataSource("Ledger").Enabled = true;
        typeof(FrReport).GetMethod("Compile", BindingFlags.NonPublic | BindingFlags.Instance)!.Invoke(rep, null);
    }

    public override string? Report(Ctx c, string out_)
    {
        rep!.Prepare();
        using (var e = new PDFSimpleExport()) rep.Export(e, out_);
        return $"{rep.PreparedPages.Count} pages";
    }
}
