// QuestPDF's showcase: the fluent invoice (its README example, with a 40-line table).
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

QuestPDF.Settings.License = LicenseType.Community;
var lines = Enumerable.Range(1, 40).Select(i => (Name: $"Item {i}", Qty: i * 7 % 13 + 1, Price: (i * 37 % 500) / 10m + 5)).ToList();
var total = lines.Sum(l => l.Qty * l.Price);
Document.Create(c => c.Page(p =>
{
    p.Size(PageSizes.A4); p.Margin(40); p.DefaultTextStyle(x => x.FontSize(10));
    p.Header().Row(r =>
    {
        r.RelativeItem().Column(col =>
        {
            col.Item().Text("Invoice #2026-0042").FontSize(20).SemiBold().FontColor(Colors.Blue.Darken2);
            col.Item().Text("Issue date: 2026-10-01");
            col.Item().Text("Due date: 2026-10-31");
        });
        r.RelativeItem().AlignRight().Column(col =>
        {
            col.Item().Text("Acme Supplies Ltd").SemiBold();
            col.Item().Text("12 Market Street");
            col.Item().Text("Bengaluru 560001");
        });
    });
    p.Content().PaddingVertical(20).Column(col =>
    {
        col.Item().Table(t =>
        {
            t.ColumnsDefinition(d => { d.ConstantColumn(30); d.RelativeColumn(3); d.RelativeColumn(); d.RelativeColumn(); d.RelativeColumn(); });
            t.Header(h =>
            {
                foreach (var s in new[] { "#", "Product", "Price", "Qty", "Total" })
                    h.Cell().Background(Colors.Grey.Lighten2).Padding(4).Text(s).SemiBold();
            });
            var n = 0;
            foreach (var l in lines)
            {
                n++;
                t.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten1).Padding(4).Text($"{n}");
                t.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten1).Padding(4).Text(l.Name);
                t.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten1).Padding(4).AlignRight().Text($"{l.Price:F2}");
                t.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten1).Padding(4).AlignRight().Text($"{l.Qty}");
                t.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten1).Padding(4).AlignRight().Text($"{l.Qty * l.Price:F2}");
            }
        });
        col.Item().PaddingTop(10).AlignRight().Text($"Grand total: {total:F2}").FontSize(14).SemiBold();
    });
    p.Footer().AlignCenter().Text(x => { x.Span("Page "); x.CurrentPageNumber(); x.Span(" of "); x.TotalPages(); });
})).GeneratePdf(args[0]);
