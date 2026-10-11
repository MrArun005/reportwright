// SSRS via the ReportViewer LocalReport: Ssrs.exe ssrs <job> <size> <outdir> -> one JSON line (the harness contract of
// ../Program.cs, which needs .NET 8; ReportViewer needs .NET Framework 4.8). The grouped ledger from ledger.rdlc (the
// jasper report's layout). Setup, outside the clock: rows read, the .rdlc loaded and compiled (GetParameters compiles the
// definition and its expressions; JasperReports likewise compiles its jrxml in setup). The clock covers Render("PDF")
// and writing the bytes.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using Microsoft.Reporting.WinForms;

public sealed class Row
{
    public int Id { get; set; }
    public string Account { get; set; }
    public string Region { get; set; }
    public string Type { get; set; }
    public string Date { get; set; }
    public double Amount { get; set; }
    public string Reference { get; set; }
}

static class Program
{
    static int Main(string[] args)
    {
        string job = args[1], outDir = args[3];
        int size = int.Parse(args[2]);
        string line;
        try
        {
            if (job == "version")
                line = "{\"ok\":true,\"version\":" + Q(FileVersionInfo.GetVersionInfo(typeof(LocalReport).Assembly.Location).ProductVersion) + "}";
            else if (job != "report")
                throw new ArgumentException("unknown job " + job);
            else
            {
                Directory.CreateDirectory(outDir);
                string fx = Environment.GetEnvironmentVariable("BENCH_FIXTURES") ?? ".";
                var rows = File.ReadLines(Path.Combine(fx, $"rows-{size}.csv")).Skip(1).Where(l => l.Length > 0).Select(l =>
                {
                    var c = l.Split(',');
                    return new Row { Id = int.Parse(c[0]), Account = c[1], Region = c[2], Type = c[3], Date = c[4], Amount = double.Parse(c[5], CultureInfo.InvariantCulture), Reference = c[6] };
                }).ToList();
                var lr = new LocalReport();
                using (var s = File.OpenRead(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ledger.rdlc"))) lr.LoadReportDefinition(s);
                lr.DataSources.Add(new ReportDataSource("Ledger", rows));
                lr.GetParameters();
                int reps = int.Parse(Environment.GetEnvironmentVariable("REPS") ?? "1");
                var t = new double[reps];
                for (int i = 0; i < reps; i++)
                {
                    var sw = Stopwatch.StartNew();
                    File.WriteAllBytes(Path.Combine(outDir, "out.pdf"), lr.Render("PDF"));
                    t[i] = sw.Elapsed.TotalMilliseconds;
                }
                line = "{\"ok\":true,\"ms\":" + t[0].ToString("R", CultureInfo.InvariantCulture);
                if (reps > 1)
                {
                    var w = t.Skip(reps >= 50 ? reps - 40 : (int)(reps * 0.2)).OrderBy(x => x).ToArray();
                    line += ",\"warm_ms\":" + w[w.Length / 2].ToString("R", CultureInfo.InvariantCulture);
                }
                line += ",\"note\":" + Q(lr.GetTotalPages() + " pages") + "}";
            }
        }
        catch (OutOfMemoryException) { Console.Error.WriteLine("OutOfMemoryException"); return 3; }
        catch (Exception e) { var s = e.ToString(); line = "{\"ok\":false,\"error\":" + Q(s.Substring(0, Math.Min(600, s.Length))) + "}"; }
        Console.Out.WriteLine(line);
        return 0;
    }

    static string Q(string s) => "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n").Replace("\t", "\\t") + "\"";
}
