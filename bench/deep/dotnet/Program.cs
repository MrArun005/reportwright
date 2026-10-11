// .NET contestants: dotnet Bench.dll <QuestPDF|PDFsharp|PdfPig> <job> <size> <outdir> -> one JSON line.
// The same contract as common/frame.mjs: inputs read before the clock; "ms" is the job in this process; REPS=n runs
// it n times ("warm_ms": the median of the last 40). PDFsharp draws the create jobs through ICanvas (a port of
// common/canvas-jobs.mjs); QuestPDF lays out its own document (its fluent API: table, header, footer, page numbers).
using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

static class Program
{
    static readonly string FX = Environment.GetEnvironmentVariable("BENCH_FIXTURES") ?? ".";
    public static readonly JsonNode S = JsonNode.Parse(File.ReadAllText(Environment.GetEnvironmentVariable("BENCH_SPEC") ?? Path.Combine(FX, "spec.json")))!;
    public static readonly JsonNode P = S["page"]!, R = S["report"]!, E = S["edit"]!;
    public static readonly double W = D(P["w"]), H = D(P["h"]), M = D(P["margin"]), BOTTOM = H - M - D(P["footer"]);
    public static double D(JsonNode? n) => n!.GetValue<double>();
    public static string Str(JsonNode? n) => n!.GetValue<string>();
    public static bool B(JsonNode? n) => n is not null && n.GetValue<bool>();
    public static string Fx(string p) => Path.Combine(FX, p);
    public static string Font(string k) => Fx(Str(S["fonts"]![k]));
    public static string Money(double v) => v.ToString("N2", CultureInfo.InvariantCulture);
    public static string PageFile(string dir, int i) => Path.Combine(dir, $"p-{i:D4}.pdf");

    public record Row(int Id, string Account, string Region, string Type, string Date, double Amount, string Reference);
    static List<Row> Rows(int n)
    {
        var rows = new List<Row>(n);
        foreach (var l in File.ReadLines(Fx($"rows-{n}.csv")).Skip(1))
        {
            if (l.Length == 0) continue;
            var c = l.Split(',');
            rows.Add(new Row(int.Parse(c[0]), c[1], c[2], c[3], c[4], double.Parse(c[5], CultureInfo.InvariantCulture), c[6]));
        }
        return rows;
    }
    public static List<(string Region, List<Row> Rows, double Sum)> Groups(List<Row> rows)
    {
        var g = new List<(string, List<Row>, double)>();
        foreach (var r in rows)
        {
            if (g.Count == 0 || g[^1].Item1 != r.Region) g.Add((r.Region, new List<Row>(), 0));
            var last = g[^1];
            last.Item2.Add(r);
            g[^1] = (last.Item1, last.Item2, last.Item3 + r.Amount);
        }
        return g;
    }

    public class Ctx { public List<Row> Rows = new(); public List<string> Pool = new(); public int Pages; public List<string> Files = new(); public string File = ""; }

    static Ctx Inputs(string job, int size)
    {
        var c = new Ctx();
        List<string> Pdfs(string dir) => Directory.GetFiles(Fx(dir), "*.pdf").OrderBy(f => f, StringComparer.Ordinal).ToList();
        switch (job)
        {
            case "report": c.Rows = Rows(size); break;
            case "plain": c.Pool = File.ReadAllLines(Fx(Str(S["plain"]!["pool"]))).Where(l => l.Length > 0).ToList(); c.Pages = size; break;
            case "read-big": c.Files = new() { Fx(Str(S["read"]!["big"])) }; break;
            case "read-mixed": c.Files = Pdfs(Str(S["read"]!["mixedDir"])); break;
            case "merge": c.Files = Pdfs(Str(E["mergeDir"])).Take(size).ToList(); break;
            case "split": case "encrypt": case "metadata": c.File = Fx(Str(E["doc"])); break;
            case "form": c.File = Fx(Str(E["form"])); break;
            case "parse": c.File = Environment.GetEnvironmentVariable("BENCH_INPUT")!; break;
        }
        return c;
    }

    static string? Run(Lib a, string job, Ctx c, string outDir)
    {
        var pdf = Path.Combine(outDir, "out.pdf");
        switch (job)
        {
            case "plain": return a.Plain(c, pdf);
            case "report": return a.Report(c, pdf);
            case "invoice": case "invoice-warm": return a.Invoice(pdf);
            case "unicode": return a.Unicode(pdf);
            case "images": return a.Images(pdf);
            case "read-big": File.WriteAllText(Path.Combine(outDir, "out.txt"), a.Extract(c.Files[0])); return null;
            case "read-mixed":
                foreach (var f in c.Files) File.WriteAllText(Path.Combine(outDir, Path.GetFileNameWithoutExtension(f) + ".txt"), a.Extract(f));
                return null;
            case "parse": a.Parse(c.File); return null;
            case "merge": a.Merge(c.Files, pdf); return null;
            case "split": a.Split(c.File, outDir); return null;
            case "encrypt": a.Encrypt(c.File, pdf, Str(E["passwords"]!["user"]), Str(E["passwords"]!["owner"])); return null;
            default: throw new ArgumentException($"unknown job {job}");
        }
    }

    static int Main(string[] args)
    {
        var (lib, job, size, outDir) = (args[0], args[1], int.Parse(args[2]), args[3]);
        var res = new Dictionary<string, object>();
        try
        {
            Lib a = lib switch { "QuestPDF" => new QuestLib(), "PDFsharp" => new SharpLib(), "PdfPig" => new PigLib(), _ => throw new ArgumentException(lib) };
            if (job == "version") { res["ok"] = true; res["version"] = a.Version(); }
            else
            {
                Directory.CreateDirectory(outDir);
                var c = Inputs(job, size);
                int bulk = int.Parse(Environment.GetEnvironmentVariable("BULK") ?? "0");
                if (bulk > 0) // BULK=n: n separate files b-0000.pdf...; the clock covers the renders, not the renames
                {
                    double ms = 0;
                    for (int i = 0; i < bulk; i++)
                    {
                        var sw = Stopwatch.StartNew();
                        Run(a, job, c, outDir);
                        ms += sw.Elapsed.TotalMilliseconds;
                        File.Move(Path.Combine(outDir, "out.pdf"), Path.Combine(outDir, $"b-{i:D4}.pdf"));
                    }
                    Console.Out.WriteLine(JsonSerializer.Serialize(new Dictionary<string, object> { ["ok"] = true, ["ms"] = ms }));
                    return 0;
                }
                int reps = int.Parse(Environment.GetEnvironmentVariable("REPS") ?? "1");
                var t = new double[reps];
                string? note = null;
                for (int i = 0; i < reps; i++)
                {
                    var sw = Stopwatch.StartNew();
                    note = Run(a, job, c, outDir);
                    t[i] = sw.Elapsed.TotalMilliseconds;
                }
                res["ok"] = true;
                res["ms"] = t[0];
                if (reps > 1) { var w = t.Skip(reps >= 50 ? reps - 40 : (int)(reps * 0.2)).OrderBy(x => x).ToArray(); res["warm_ms"] = w[w.Length / 2]; }
                if (note != null) res["note"] = note;
            }
        }
        catch (OutOfMemoryException) { Console.Error.WriteLine("OutOfMemoryException"); return 3; }
        catch (Exception e) { res = new() { ["ok"] = false, ["error"] = e.ToString()[..Math.Min(600, e.ToString().Length)] }; }
        Console.Out.WriteLine(JsonSerializer.Serialize(res));
        return 0;
    }

    public static string Ver(Type t) => t.Assembly.GetCustomAttributes(typeof(System.Reflection.AssemblyInformationalVersionAttribute), false)
        .OfType<System.Reflection.AssemblyInformationalVersionAttribute>().FirstOrDefault()?.InformationalVersion?.Split('+')[0] ?? t.Assembly.GetName().Version!.ToString();
}

abstract class Lib
{
    public abstract string Version();
    public virtual string? Plain(Program.Ctx c, string out_) => throw new NotSupportedException();
    public virtual string? Report(Program.Ctx c, string out_) => throw new NotSupportedException();
    public virtual string? Invoice(string out_) => throw new NotSupportedException();
    public virtual string? Unicode(string out_) => throw new NotSupportedException();
    public virtual string? Images(string out_) => throw new NotSupportedException();
    public virtual string Extract(string file) => throw new NotSupportedException();
    public virtual void Parse(string file) => Extract(file);
    public virtual void Merge(List<string> files, string out_) => throw new NotSupportedException();
    public virtual void Split(string file, string dir) => throw new NotSupportedException();
    public virtual void Encrypt(string file, string out_, string user, string owner) => throw new NotSupportedException();
}
