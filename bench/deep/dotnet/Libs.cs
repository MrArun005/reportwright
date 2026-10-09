using System.Globalization;
using System.Text.Json.Nodes;
using QuestPDF.Fluent; // the extension methods (Page, Column, Table, FontFamily...)
using static Program;

// ---------------------------------------------------------------- the create jobs over a drawing surface
interface ICanvas
{
    void Page();
    void Text(string s, double x, double y, double size, string font, bool rtl = false);
    double Width(string s, double size, string font);
    void Rect(double x, double y, double w, double h, string hex);
    void HLine(double x1, double x2, double y, double w, string hex);
    object Image(string path);
    void Draw(object img, double x, double y, double w, double h);
    void End();
}

static class CanvasJobs
{
    public static string? Plain(Func<string, string[], string, ICanvas> open, Ctx c, string out_)
    {
        var s = S["plain"]!;
        int lpp = (int)D(s["linesPerPage"]);
        var cv = open(out_, new[] { "r" }, "Plain");
        for (int p = 0; p < c.Pages; p++)
        {
            cv.Page();
            for (int k = 0; k < lpp; k++) cv.Text(c.Pool[(p * lpp + k) % c.Pool.Count], D(s["x"]), D(s["y"]) + k * D(s["leading"]), D(s["size"]), "r");
        }
        cv.End();
        return null;
    }

    record Op(char K, double Y, object? A = null, int Count = 0, double Sum = 0);
    static List<List<Op>> Plan(List<Row> rows)
    {
        double headH = D(R["headH"]), groupH = D(R["groupH"]), rowH = D(R["rowH"]);
        var pages = new List<List<Op>>();
        List<Op> cur = null!;
        double y = 0;
        void NewPage() { cur = new List<Op>(); pages.Add(cur); y = M + headH; }
        void Need(double h) { if (y + h > BOTTOM) NewPage(); }
        NewPage();
        int count = 0; double sum = 0;
        foreach (var g in Groups(rows))
        {
            Need(groupH + rowH); cur.Add(new Op('G', y, g.Region)); y += groupH;
            foreach (var r in g.Rows) { Need(rowH); cur.Add(new Op('R', y, r)); y += rowH; }
            Need(rowH); cur.Add(new Op('S', y, "Region total", g.Rows.Count, g.Sum)); y += rowH;
            count += g.Rows.Count; sum += g.Sum;
        }
        Need(rowH); cur.Add(new Op('S', y, "Grand total", count, sum));
        return pages;
    }

    static void Cells(ICanvas cv, double y, double h, string[] vals, bool bold)
    {
        double x = M, size = D(R["size"]);
        var f = bold ? "b" : "r";
        var cols = R["cols"]!.AsArray();
        for (int i = 0; i < cols.Count; i++)
        {
            double w = D(cols[i]!["w"]);
            if (vals[i].Length > 0) cv.Text(vals[i], B(cols[i]!["right"]) ? x + w - 2 - cv.Width(vals[i], size, f) : x + 2, y + (h - size) / 2, size, f);
            x += w;
        }
    }

    public static string? Report(Func<string, string[], string, ICanvas> open, Ctx c, string out_)
    {
        var cv = open(out_, new[] { "r", "b" }, "Ledger");
        var pages = Plan(c.Rows);
        var cols = R["cols"]!.AsArray();
        double Wt = cols.Sum(k => D(k!["w"])), headH = D(R["headH"]), groupH = D(R["groupH"]), rowH = D(R["rowH"]), size = D(R["size"]), fs = D(R["footerSize"]);
        var labels = cols.Select(k => Str(k!["label"])).ToArray();
        for (int i = 0; i < pages.Count; i++)
        {
            cv.Page();
            cv.Rect(M, M, Wt, headH, Str(R["headBg"]));
            Cells(cv, M, headH, labels, true);
            foreach (var o in pages[i])
            {
                if (o.K == 'G') { cv.Rect(M, o.Y, Wt, groupH, Str(R["groupBg"])); cv.Text($"Region {o.A}", M + 2, o.Y + 3.5, size, "b"); }
                else if (o.K == 'R')
                {
                    var r = (Row)o.A!;
                    Cells(cv, o.Y, rowH, new[] { r.Id.ToString(CultureInfo.InvariantCulture), r.Account, r.Region, r.Type, r.Date, Money(r.Amount), r.Reference }, false);
                    cv.HLine(M, M + Wt, o.Y + rowH, 0.5, Str(R["rule"]));
                }
                else Cells(cv, o.Y, rowH, new[] { (string)o.A!, "", o.Count.ToString(CultureInfo.InvariantCulture), "", "", Money(o.Sum), "" }, true);
            }
            var ft = Str(R["footerText"]).Replace("{n}", (i + 1).ToString()).Replace("{m}", pages.Count.ToString());
            cv.Text(ft, M + Wt - cv.Width(ft, fs, "r"), BOTTOM + 4, fs, "r");
        }
        cv.End();
        return $"{pages.Count} pages";
    }

    public static string? Invoice(Func<string, string[], string, ICanvas> open, string out_)
    {
        var I = S["invoice"]!; var T = I["table"]!; var L = I["logo"]!;
        var cv = open(out_, new[] { "r", "b" }, "Invoice");
        cv.Page();
        foreach (var t in I["texts"]!.AsArray())
        {
            var f = B(t!["bold"]) ? "b" : "r"; var s = Str(t["text"]); var size = D(t["size"]);
            cv.Text(s, B(t["right"]) ? D(t["x"]) + D(t["w"]) - cv.Width(s, size, f) : D(t["x"]), D(t["y"]), size, f);
        }
        cv.Draw(cv.Image(Fx(Str(L["file"]))), D(L["x"]), D(L["y"]), D(L["w"]), D(L["h"]));
        var cols = T["cols"]!.AsArray();
        double tx = D(T["x"]), rowH = D(T["rowH"]), tsize = D(T["size"]), Wt = cols.Sum(k => D(k!["w"])), y = D(T["y"]);
        void Row(double yy, string[] vals, bool bold)
        {
            double x = tx; var f = bold ? "b" : "r";
            for (int i = 0; i < cols.Count; i++)
            {
                double w = D(cols[i]!["w"]);
                if (vals[i].Length > 0) cv.Text(vals[i], B(cols[i]!["right"]) ? x + w - 2 - cv.Width(vals[i], tsize, f) : x + 2, yy + 5, tsize, f);
                x += w;
            }
        }
        cv.Rect(tx, y, Wt, rowH, Str(R["headBg"]));
        Row(y, cols.Select(k => Str(k!["label"])).ToArray(), true); y += rowH;
        foreach (var r in T["rows"]!.AsArray()) { Row(y, r!.AsArray().Select(v => Str(v)).ToArray(), false); cv.HLine(tx, tx + Wt, y + rowH, 0.5, Str(R["rule"])); y += rowH; }
        var tot = T["totals"]!.AsArray();
        for (int i = 0; i < tot.Count; i++) { Row(y, new[] { "", "", Str(tot[i]![0]), Str(tot[i]![1]) }, i == 2); y += rowH; }
        cv.End();
        return null;
    }

    public static string? Unicode(Func<string, string[], string, ICanvas> open, string out_)
    {
        var U = S["unicode"]!;
        var lines = U["lines"]!.AsArray();
        var cv = open(out_, lines.Select(l => Str(l!["font"])).ToArray(), "Unicode");
        cv.Page();
        foreach (var l in lines) cv.Text(Str(l!["text"]), D(l["x"]), D(l["y"]), D(U["size"]), Str(l["font"]), B(l["rtl"]));
        cv.End();
        return null;
    }

    public static string? Images(Func<string, string[], string, ICanvas> open, string out_)
    {
        var I = S["images"]!;
        var cv = open(out_, Array.Empty<string>(), "Images");
        foreach (var k in new[] { "png", "jpeg" })
        {
            cv.Page();
            var img = cv.Image(Fx(Str(I[k])));
            var (w, h) = ImageSize(Fx(Str(I[k])));
            cv.Draw(img, D(I["x"]), D(I["y"]), D(I["w"]), D(I["w"]) * h / w);
        }
        cv.End();
        return null;
    }

    public static (double, double) ImageSize(string file)
    {
        var b = new byte[65536];
        using (var fs = File.OpenRead(file)) fs.ReadAtLeast(b, Math.Min(b.Length, (int)fs.Length), false);
        int U16(int i) => (b[i] << 8) | b[i + 1];
        if (b[0] == 0x89) return ((b[16] << 24) | (b[17] << 16) | U16(18), (b[20] << 24) | (b[21] << 16) | U16(22));
        for (int i = 2; i < b.Length - 9;)
        {
            int m = b[i + 1], len = U16(i + 2);
            if (m >= 0xC0 && m <= 0xCF && m != 0xC4 && m != 0xC8 && m != 0xCC) return (U16(i + 7), U16(i + 5));
            i += 2 + len;
        }
        throw new InvalidDataException("image size");
    }
}

// ---------------------------------------------------------------- PDFsharp 6 (create, merge, split, encrypt)
sealed class SharpLib : Lib
{
    sealed class Resolver : PdfSharp.Fonts.IFontResolver
    {
        public PdfSharp.Fonts.FontResolverInfo? ResolveTypeface(string family, bool bold, bool italic) =>
            family.StartsWith("bench-") ? new PdfSharp.Fonts.FontResolverInfo(family) : null;
        public byte[]? GetFont(string face) => File.ReadAllBytes(Font(face["bench-".Length..]));
    }
    static SharpLib() { PdfSharp.Fonts.GlobalFontSettings.FontResolver = new Resolver(); }
    public override string Version() => Ver(typeof(PdfSharp.Pdf.PdfDocument));

    sealed class Cv : ICanvas
    {
        readonly PdfSharp.Pdf.PdfDocument doc = new();
        readonly string out_;
        readonly Dictionary<(string, double), PdfSharp.Drawing.XFont> fonts = new();
        PdfSharp.Drawing.XGraphics? g;
        public Cv(string o, string title) { out_ = o; doc.Info.Title = title; }
        PdfSharp.Drawing.XFont F(string k, double size)
        {
            if (!fonts.TryGetValue((k, size), out var f))
                fonts[(k, size)] = f = new PdfSharp.Drawing.XFont("bench-" + k, size, PdfSharp.Drawing.XFontStyleEx.Regular, new PdfSharp.Drawing.XPdfFontOptions(PdfSharp.Pdf.PdfFontEncoding.Unicode));
            return f;
        }
        static PdfSharp.Drawing.XColor C(string hex) => PdfSharp.Drawing.XColor.FromArgb(Convert.ToInt32(hex[1..3], 16), Convert.ToInt32(hex[3..5], 16), Convert.ToInt32(hex[5..7], 16));
        public void Page()
        {
            g?.Dispose();
            var p = doc.AddPage();
            p.Width = PdfSharp.Drawing.XUnit.FromPoint(W);
            p.Height = PdfSharp.Drawing.XUnit.FromPoint(H);
            g = PdfSharp.Drawing.XGraphics.FromPdfPage(p);
        }
        public void Text(string s, double x, double y, double size, string k, bool rtl = false) =>
            g!.DrawString(s, F(k, size), PdfSharp.Drawing.XBrushes.Black, x, y + 0.8 * size, PdfSharp.Drawing.XStringFormats.BaseLineLeft);
        public double Width(string s, double size, string k) => g!.MeasureString(s, F(k, size)).Width;
        public void Rect(double x, double y, double w, double h, string hex) => g!.DrawRectangle(new PdfSharp.Drawing.XSolidBrush(C(hex)), x, y, w, h);
        public void HLine(double x1, double x2, double y, double w, string hex) => g!.DrawLine(new PdfSharp.Drawing.XPen(C(hex), w), x1, y, x2, y);
        public object Image(string path) => PdfSharp.Drawing.XImage.FromFile(path);
        public void Draw(object img, double x, double y, double w, double h) => g!.DrawImage((PdfSharp.Drawing.XImage)img, x, y, w, h);
        public void End() { g?.Dispose(); doc.Save(out_); }
    }
    static ICanvas Open(string o, string[] fonts, string title) => new Cv(o, title);
    public override string? Plain(Ctx c, string o) => CanvasJobs.Plain(Open, c, o);
    public override string? Report(Ctx c, string o) => CanvasJobs.Report(Open, c, o);
    public override string? Invoice(string o) => CanvasJobs.Invoice(Open, o);
    public override string? Unicode(string o) => CanvasJobs.Unicode(Open, o);
    public override string? Images(string o) => CanvasJobs.Images(Open, o);

    static PdfSharp.Pdf.PdfDocument Import(string f) => PdfSharp.Pdf.IO.PdfReader.Open(f, PdfSharp.Pdf.IO.PdfDocumentOpenMode.Import);
    public override void Parse(string file) { var d = Import(file); foreach (var p in d.Pages) _ = p.Width; }
    public override void Merge(List<string> files, string o)
    {
        using var d = new PdfSharp.Pdf.PdfDocument();
        foreach (var f in files) { var s = Import(f); foreach (var p in s.Pages) d.AddPage(p); }
        d.Save(o);
    }
    public override void Split(string file, string dir)
    {
        var s = Import(file);
        for (int i = 0; i < s.PageCount; i++) { using var d = new PdfSharp.Pdf.PdfDocument(); d.AddPage(s.Pages[i]); d.Save(PageFile(dir, i + 1)); }
    }
    public override void Encrypt(string file, string o, string user, string owner)
    {
        var d = PdfSharp.Pdf.IO.PdfReader.Open(file, PdfSharp.Pdf.IO.PdfDocumentOpenMode.Modify);
        d.SecuritySettings.OwnerPassword = owner;
        if (user.Length > 0) d.SecuritySettings.UserPassword = user;
        d.SecurityHandler.SetEncryptionToV5();
        d.Save(o);
    }
}

// ---------------------------------------------------------------- QuestPDF (Community licence): its own layout
sealed class QuestLib : Lib
{
    static readonly Dictionary<string, string> Family = new() { ["r"] = "Inter", ["b"] = "Inter", ["hi"] = "Noto Sans Devanagari", ["ar"] = "Noto Sans Arabic", ["cjk"] = "Noto Sans SC" };
    static QuestLib()
    {
        QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;
        QuestPDF.Settings.UseEnvironmentFonts = false;
        foreach (var k in new[] { "r", "b", "hi", "ar", "cjk" }) using (var s = File.OpenRead(Font(k))) QuestPDF.Drawing.FontManager.RegisterFont(s);
    }
    public override string Version() => Ver(typeof(QuestPDF.Fluent.Document));

    static string Gen(string out_, string title, Action<QuestPDF.Fluent.PageDescriptor> page)
    {
        QuestPDF.Fluent.Document.Create(c => c.Page(page)).WithMetadata(new QuestPDF.Infrastructure.DocumentMetadata { Title = title }).GeneratePdf(out_);
        return null!;
    }
    static void Base(QuestPDF.Fluent.PageDescriptor p, double margin)
    {
        p.Size((float)W, (float)H, QuestPDF.Infrastructure.Unit.Point);
        p.Margin((float)margin, QuestPDF.Infrastructure.Unit.Point);
        p.DefaultTextStyle(t => t.FontFamily("Inter").FontSize(9));
    }

    public override string? Plain(Ctx c, string o)
    {
        var s = S["plain"]!;
        int lpp = (int)D(s["linesPerPage"]);
        return Gen(o, "Plain", p =>
        {
            Base(p, M);
            p.Content().Column(col =>
            {
                for (int pg = 0; pg < c.Pages; pg++)
                {
                    for (int k = 0; k < lpp; k++) col.Item().Height((float)D(s["leading"])).Text(c.Pool[(pg * lpp + k) % c.Pool.Count]).FontSize((float)D(s["size"]));
                    if (pg < c.Pages - 1) col.Item().PageBreak();
                }
            });
        });
    }

    public override string? Report(Ctx c, string o)
    {
        var cols = R["cols"]!.AsArray();
        string headBg = Str(R["headBg"]), groupBg = Str(R["groupBg"]), rule = Str(R["rule"]);
        float headH = (float)D(R["headH"]), groupH = (float)D(R["groupH"]), rowH = (float)D(R["rowH"]);
        Gen(o, "Ledger", p =>
        {
            Base(p, M);
            p.Content().Table(t =>
            {
                t.ColumnsDefinition(cd => { foreach (var k in cols) cd.ConstantColumn((float)D(k!["w"])); });
                t.Header(h => { foreach (var k in cols) { var cell = h.Cell().Background(headBg).Height(headH).PaddingHorizontal(2).AlignMiddle(); (B(k!["right"]) ? cell.AlignRight() : cell).Text(Str(k["label"])).Bold(); } });
                void Cell(string v, bool right, bool bold, bool line)
                {
                    var cell = t.Cell().Height(rowH);
                    if (line) cell = cell.BorderBottom(0.5f).BorderColor(rule);
                    cell = cell.PaddingHorizontal(2).AlignMiddle();
                    var tx = (right ? cell.AlignRight() : cell).Text(v);
                    if (bold) tx.Bold();
                }
                void Total(string label, int n, double sum)
                {
                    t.Cell().ColumnSpan(2).Height(rowH).PaddingHorizontal(2).AlignMiddle().Text(label).Bold();
                    Cell(n.ToString(CultureInfo.InvariantCulture), false, true, false); Cell("", false, false, false); Cell("", false, false, false);
                    Cell(Money(sum), true, true, false); Cell("", false, false, false);
                }
                int count = 0; double total = 0;
                foreach (var g in Groups(c.Rows))
                {
                    t.Cell().ColumnSpan(7).Background(groupBg).Height(groupH).PaddingHorizontal(2).AlignMiddle().Text($"Region {g.Region}").Bold();
                    foreach (var r in g.Rows)
                    {
                        Cell(r.Id.ToString(CultureInfo.InvariantCulture), false, false, true); Cell(r.Account, false, false, true); Cell(r.Region, false, false, true);
                        Cell(r.Type, false, false, true); Cell(r.Date, false, false, true); Cell(Money(r.Amount), true, false, true); Cell(r.Reference, false, false, true);
                    }
                    Total("Region total", g.Rows.Count, g.Sum);
                    count += g.Rows.Count; total += g.Sum;
                }
                Total("Grand total", count, total);
            });
            p.Footer().Height((float)D(P["footer"])).PaddingTop(4).AlignRight().Text(x =>
            {
                x.DefaultTextStyle(s => s.FontSize((float)D(R["footerSize"])));
                x.Span("Page "); x.CurrentPageNumber(); x.Span(" of "); x.TotalPages();
            });
        });
        return null;
    }

    public override string? Invoice(string o)
    {
        var I = S["invoice"]!; var T = I["table"]!; var L = I["logo"]!;
        var cols = T["cols"]!.AsArray();
        float rowH = (float)D(T["rowH"]);
        return Gen(o, "Invoice", p =>
        {
            Base(p, 0);
            p.Content().Layers(l =>
            {
                l.PrimaryLayer().Height((float)H - 1);
                foreach (var t in I["texts"]!.AsArray())
                {
                    var box = l.Layer().PaddingLeft((float)D(t!["x"])).PaddingTop((float)D(t["y"])).Width((float)D(t["w"]));
                    var tx = (B(t["right"]) ? box.AlignRight() : box).Text(Str(t["text"])).FontSize((float)D(t["size"]));
                    if (B(t["bold"])) tx.Bold();
                }
                l.Layer().PaddingLeft((float)D(L["x"])).PaddingTop((float)D(L["y"])).Width((float)D(L["w"])).Height((float)D(L["h"])).Image(Fx(Str(L["file"]))).FitArea();
                l.Layer().PaddingLeft((float)D(T["x"])).PaddingTop((float)D(T["y"])).Width((float)cols.Sum(k => D(k!["w"]))).Table(t =>
                {
                    t.ColumnsDefinition(cd => { foreach (var k in cols) cd.ConstantColumn((float)D(k!["w"])); });
                    void Cell(string v, bool right, bool bold, string? bg, bool line)
                    {
                        var cell = t.Cell().Height(rowH);
                        if (bg != null) cell = cell.Background(bg);
                        if (line) cell = cell.BorderBottom(0.5f).BorderColor(Str(R["rule"]));
                        cell = cell.PaddingHorizontal(2).AlignMiddle();
                        var tx = (right ? cell.AlignRight() : cell).Text(v);
                        if (bold) tx.Bold();
                    }
                    foreach (var k in cols) Cell(Str(k!["label"]), B(k["right"]), true, Str(R["headBg"]), false);
                    foreach (var r in T["rows"]!.AsArray()) { var v = r!.AsArray(); for (int i = 0; i < cols.Count; i++) Cell(Str(v[i]), B(cols[i]!["right"]), false, null, true); }
                    var tot = T["totals"]!.AsArray();
                    for (int i = 0; i < tot.Count; i++) { Cell("", false, false, null, false); Cell("", false, false, null, false); Cell(Str(tot[i]![0]), true, i == 2, null, false); Cell(Str(tot[i]![1]), true, i == 2, null, false); }
                });
            });
        });
    }

    public override string? Unicode(string o)
    {
        var U = S["unicode"]!;
        return Gen(o, "Unicode", p =>
        {
            Base(p, 0);
            p.Content().Layers(l =>
            {
                l.PrimaryLayer().Height((float)H - 1);
                foreach (var ln in U["lines"]!.AsArray())
                {
                    var box = l.Layer().PaddingLeft((float)D(ln!["x"])).PaddingTop((float)D(ln["y"]));
                    if (B(ln["rtl"])) box = box.ContentFromRightToLeft().AlignLeft();
                    box.Text(Str(ln["text"])).FontFamily(Family[Str(ln["font"])]).FontSize((float)D(U["size"]));
                }
            });
        });
    }

    public override string? Images(string o)
    {
        var I = S["images"]!;
        return Gen(o, "Images", p =>
        {
            Base(p, D(I["x"]));
            p.Content().Column(c =>
            {
                c.Item().Width((float)D(I["w"])).Image(Fx(Str(I["png"])));
                c.Item().PageBreak();
                c.Item().Width((float)D(I["w"])).Image(Fx(Str(I["jpeg"])));
            });
        });
    }
}

// ---------------------------------------------------------------- PdfPig (read; merge)
sealed class PigLib : Lib
{
    public override string Version() => Ver(typeof(UglyToad.PdfPig.PdfDocument));
    public override string Extract(string file)
    {
        using var d = UglyToad.PdfPig.PdfDocument.Open(file);
        return string.Join("\n", d.GetPages().Select(p => UglyToad.PdfPig.DocumentLayoutAnalysis.TextExtractor.ContentOrderTextExtractor.GetText(p)));
    }
    public override void Merge(List<string> files, string o) => File.WriteAllBytes(o, UglyToad.PdfPig.Writer.PdfMerger.Merge(files.ToArray()));
}
