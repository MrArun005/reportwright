//! Rust contestants: bench <printpdf|lopdf|pdf-extract> <job> <size> <outdir> -> one JSON line (common/frame.mjs).
//! printpdf draws the create jobs through the same operations as every low-level writer (a port of
//! common/canvas-jobs.mjs); text widths come from ttf-parser, as printpdf has no measuring call. lopdf splits and
//! parses; pdf-extract reads. A Rust panic is not caught: it exits 101 with no result line, which the driver records
//! as a crash (an Err is a clean error).
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

type Res<T> = Result<T, Box<dyn std::error::Error>>;

struct Ctx {
    s: Value,
    fx: PathBuf,
}
impl Ctx {
    fn f(&self, p: &str) -> PathBuf {
        self.fx.join(p)
    }
    fn n(&self, path: &[&str]) -> f64 {
        path.iter().fold(&self.s, |v, k| &v[*k]).as_f64().unwrap()
    }
    fn st(&self, path: &[&str]) -> String {
        path.iter().fold(&self.s, |v, k| &v[*k]).as_str().unwrap().to_string()
    }
}
fn num(v: &Value) -> f64 {
    v.as_f64().unwrap()
}
fn s(v: &Value) -> String {
    v.as_str().unwrap().to_string()
}

fn money(v: f64) -> String {
    let t = format!("{:.2}", v.abs());
    let (i, frac) = t.split_at(t.len() - 3);
    let mut out = String::new();
    for (k, c) in i.chars().enumerate() {
        if k > 0 && (i.len() - k) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    format!("{}{}{}", if v < 0.0 && t != "0.00" { "-" } else { "" }, out, frac)
}

// ---------------------------------------------------------------- printpdf as a drawing surface
/// A font: its printpdf id, its bytes, and the advance widths measured so far (ttf-parser, per character).
struct Font {
    id: printpdf::FontId,
    bytes: Vec<u8>,
    upem: f64,
    adv: std::cell::RefCell<HashMap<char, u16>>,
}
struct Canvas {
    doc: printpdf::PdfDocument,
    pages: Vec<printpdf::PdfPage>,
    ops: Vec<printpdf::Op>,
    fonts: HashMap<String, Font>,
    out: PathBuf,
    w: f64,
    h: f64,
}
fn pt(v: f64) -> printpdf::Pt {
    printpdf::Pt(v as f32)
}
fn rgb(hex: &str) -> printpdf::Color {
    let v = u32::from_str_radix(&hex[1..], 16).unwrap();
    let c = |sh: u32| ((v >> sh) & 255) as f32 / 255.0;
    printpdf::Color::Rgb(printpdf::Rgb::new(c(16), c(8), c(0), None))
}
fn lp(x: f64, y: f64) -> printpdf::LinePoint {
    printpdf::LinePoint { p: printpdf::Point { x: pt(x), y: pt(y) }, bezier: false }
}
impl Canvas {
    fn open(c: &Ctx, out: &Path, keys: &[String], title: &str) -> Res<Canvas> {
        let mut doc = printpdf::PdfDocument::new(title);
        let mut fonts = HashMap::new();
        for k in keys {
            let bytes = std::fs::read(c.f(&c.st(&["fonts", k])))?;
            let mut warn = Vec::new();
            let pf = printpdf::ParsedFont::from_bytes(&bytes, 0, &mut warn).ok_or("font")?;
            let upem = ttf_parser::Face::parse(&bytes, 0)?.units_per_em() as f64;
            fonts.insert(k.clone(), Font { id: doc.add_font(&pf), bytes, upem, adv: Default::default() });
        }
        Ok(Canvas { doc, pages: vec![], ops: vec![], fonts, out: out.into(), w: c.n(&["page", "w"]), h: c.n(&["page", "h"]) })
    }
    fn flush(&mut self) {
        if !self.ops.is_empty() {
            let mm = |v: f64| printpdf::Mm((v * 25.4 / 72.0) as f32);
            self.pages.push(printpdf::PdfPage::new(mm(self.w), mm(self.h), std::mem::take(&mut self.ops)));
        }
    }
    fn page(&mut self) {
        self.flush();
        self.ops.push(printpdf::Op::Marker { id: "page".into() });
    }
    fn text(&mut self, t: &str, x: f64, y: f64, size: f64, k: &str) {
        use printpdf::Op;
        let id = self.fonts[k].id.clone();
        self.ops.extend([
            Op::StartTextSection,
            Op::SetTextCursor { pos: printpdf::Point { x: pt(x), y: pt(self.h - y - 0.8 * size) } },
            Op::SetFont { font: printpdf::PdfFontHandle::External(id), size: pt(size) },
            Op::ShowText { items: vec![printpdf::TextItem::Text(t.to_string())] },
            Op::EndTextSection,
        ]);
    }
    fn width(&self, t: &str, size: f64, k: &str) -> f64 {
        let f = &self.fonts[k];
        let mut cache = f.adv.borrow_mut();
        let adv: u32 = t
            .chars()
            .map(|ch| {
                *cache.entry(ch).or_insert_with(|| {
                    let face = ttf_parser::Face::parse(&f.bytes, 0).unwrap();
                    face.glyph_index(ch).and_then(|g| face.glyph_hor_advance(g)).unwrap_or(0)
                }) as u32
            })
            .sum();
        adv as f64 / f.upem * size
    }
    fn rect(&mut self, x: f64, y: f64, w: f64, h: f64, hex: &str) {
        use printpdf::*;
        let (y0, y1) = (self.h - y - h, self.h - y);
        self.ops.extend([
            Op::SetFillColor { col: rgb(hex) },
            Op::DrawPolygon {
                polygon: Polygon {
                    rings: vec![PolygonRing { points: vec![lp(x, y0), lp(x + w, y0), lp(x + w, y1), lp(x, y1)] }],
                    mode: PaintMode::Fill,
                    winding_order: WindingOrder::NonZero,
                },
            },
            Op::SetFillColor { col: rgb("#000000") },
        ]);
    }
    fn hline(&mut self, x1: f64, x2: f64, y: f64, w: f64, hex: &str) {
        use printpdf::*;
        let yy = self.h - y;
        self.ops.extend([
            Op::SetOutlineColor { col: rgb(hex) },
            Op::SetOutlineThickness { pt: pt(w) },
            Op::DrawLine { line: Line { points: vec![lp(x1, yy), lp(x2, yy)], is_closed: false } },
        ]);
    }
    fn image(&mut self, path: &Path, x: f64, y: f64, w: f64) -> Res<f64> {
        let mut warn = Vec::new();
        let img = printpdf::RawImage::decode_from_bytes(&std::fs::read(path)?, &mut warn)?;
        let (pw, ph) = (img.width as f64, img.height as f64);
        let id = self.doc.add_image(&img);
        let scale = w / (pw / 300.0 * 72.0); // printpdf places one pixel per dot at 300 dpi
        let h = w * ph / pw;
        self.ops.push(printpdf::Op::UseXobject {
            id,
            transform: printpdf::XObjectTransform {
                translate_x: Some(pt(x)),
                translate_y: Some(pt(self.h - y - h)),
                scale_x: Some(scale as f32),
                scale_y: Some(scale as f32),
                dpi: Some(300.0),
                ..Default::default()
            },
        });
        Ok(h)
    }
    fn end(mut self) -> Res<()> {
        self.flush();
        let mut warn = Vec::new();
        let opts = printpdf::PdfSaveOptions { subset_fonts: true, ..Default::default() };
        let bytes = self.doc.with_pages(std::mem::take(&mut self.pages)).save(&opts, &mut warn);
        std::fs::write(&self.out, bytes)?;
        Ok(())
    }
}

fn keys(k: &[&str]) -> Vec<String> {
    k.iter().map(|s| s.to_string()).collect()
}

fn plain(c: &Ctx, pool: &[String], pages: usize, out: &Path) -> Res<()> {
    let p = &c.s["plain"];
    let lpp = num(&p["linesPerPage"]) as usize;
    let mut cv = Canvas::open(c, out, &keys(&["r"]), "Plain")?;
    for pg in 0..pages {
        cv.page();
        for k in 0..lpp {
            cv.text(&pool[(pg * lpp + k) % pool.len()], num(&p["x"]), num(&p["y"]) + k as f64 * num(&p["leading"]), num(&p["size"]), "r");
        }
    }
    cv.end()
}

struct Row {
    v: [String; 7],
    region: String,
    amount: f64,
}
enum Op {
    G(f64, String),
    R(f64, usize),
    S(f64, &'static str, usize, f64),
}

fn report(c: &Ctx, rows: &[Row], out: &Path) -> Res<String> {
    let r = &c.s["report"];
    let (m, rh, gh, hh, size) = (c.n(&["page", "margin"]), num(&r["rowH"]), num(&r["groupH"]), num(&r["headH"]), num(&r["size"]));
    let bottom = c.n(&["page", "h"]) - m - c.n(&["page", "footer"]);
    // the page plan
    let mut pages: Vec<Vec<Op>> = vec![vec![]];
    let mut y = m + hh;
    let need = |pages: &mut Vec<Vec<Op>>, y: &mut f64, h: f64| {
        if *y + h > bottom {
            pages.push(vec![]);
            *y = m + hh;
        }
    };
    let (mut count, mut total, mut i) = (0usize, 0f64, 0usize);
    while i < rows.len() {
        let mut j = i;
        let mut gs = 0.0;
        while j < rows.len() && rows[j].region == rows[i].region {
            j += 1;
        }
        need(&mut pages, &mut y, gh + rh);
        pages.last_mut().unwrap().push(Op::G(y, rows[i].region.clone()));
        y += gh;
        for k in i..j {
            need(&mut pages, &mut y, rh);
            pages.last_mut().unwrap().push(Op::R(y, k));
            y += rh;
            gs += rows[k].amount;
        }
        need(&mut pages, &mut y, rh);
        pages.last_mut().unwrap().push(Op::S(y, "Region total", j - i, gs));
        y += rh;
        count += j - i;
        total += gs;
        i = j;
    }
    need(&mut pages, &mut y, rh);
    pages.last_mut().unwrap().push(Op::S(y, "Grand total", count, total));
    // drawing
    let cols: Vec<(f64, bool, String)> = r["cols"].as_array().unwrap().iter().map(|k| (num(&k["w"]), k["right"].as_bool().unwrap(), s(&k["label"]))).collect();
    let wt: f64 = cols.iter().map(|k| k.0).sum();
    let mut cv = Canvas::open(c, out, &keys(&["r", "b"]), "Ledger")?;
    let cells = |cv: &mut Canvas, y: f64, h: f64, vals: &[&str], bold: bool| {
        let (mut x, f) = (m, if bold { "b" } else { "r" });
        for (k, v) in cols.iter().zip(vals) {
            if !v.is_empty() {
                let tx = if k.1 { x + k.0 - 2.0 - cv.width(v, size, f) } else { x + 2.0 };
                cv.text(v, tx, y + (h - size) / 2.0, size, f);
            }
            x += k.0;
        }
    };
    let labels: Vec<&str> = cols.iter().map(|k| k.2.as_str()).collect();
    let n = pages.len();
    for (pi, ops) in pages.iter().enumerate() {
        cv.page();
        cv.rect(m, m, wt, hh, &s(&r["headBg"]));
        cells(&mut cv, m, hh, &labels, true);
        for o in ops {
            match o {
                Op::G(y, g) => {
                    cv.rect(m, *y, wt, gh, &s(&r["groupBg"]));
                    cv.text(&format!("Region {}", g), m + 2.0, y + 3.5, size, "b");
                }
                Op::R(y, k) => {
                    let row = &rows[*k];
                    let amount = money(row.amount); // formatted while drawing, as every other contestant does
                    let mut v: Vec<&str> = row.v.iter().map(|x| x.as_str()).collect();
                    v[5] = &amount;
                    cells(&mut cv, *y, rh, &v, false);
                    cv.hline(m, m + wt, y + rh, 0.5, &s(&r["rule"]));
                }
                Op::S(y, label, cnt, sum) => {
                    let (cs, ms) = (cnt.to_string(), money(*sum));
                    cells(&mut cv, *y, rh, &[*label, "", &cs, "", "", &ms, ""], true);
                }
            }
        }
        let ft = s(&r["footerText"]).replace("{n}", &(pi + 1).to_string()).replace("{m}", &n.to_string());
        let fs = num(&r["footerSize"]);
        let x = m + wt - cv.width(&ft, fs, "r");
        cv.text(&ft, x, bottom + 4.0, fs, "r");
    }
    cv.end()?;
    Ok(format!("{} pages", n))
}

fn invoice(c: &Ctx, out: &Path) -> Res<()> {
    let (i, r) = (&c.s["invoice"], &c.s["report"]);
    let t = &i["table"];
    let mut cv = Canvas::open(c, out, &keys(&["r", "b"]), "Invoice")?;
    cv.page();
    for tx in i["texts"].as_array().unwrap() {
        let f = if tx["bold"].as_bool().unwrap() { "b" } else { "r" };
        let (txt, size) = (s(&tx["text"]), num(&tx["size"]));
        let x = if tx["right"].as_bool().unwrap() { num(&tx["x"]) + num(&tx["w"]) - cv.width(&txt, size, f) } else { num(&tx["x"]) };
        cv.text(&txt, x, num(&tx["y"]), size, f);
    }
    let l = &i["logo"];
    cv.image(&c.f(&s(&l["file"])), num(&l["x"]), num(&l["y"]), num(&l["w"]))?;
    let cols: Vec<(f64, bool)> = t["cols"].as_array().unwrap().iter().map(|k| (num(&k["w"]), k["right"].as_bool().unwrap())).collect();
    let (tx0, rowh, size) = (num(&t["x"]), num(&t["rowH"]), num(&t["size"]));
    let wt: f64 = cols.iter().map(|k| k.0).sum();
    let row = |cv: &mut Canvas, y: f64, vals: &[String], bold: bool| {
        let (mut x, f) = (tx0, if bold { "b" } else { "r" });
        for (k, v) in cols.iter().zip(vals) {
            if !v.is_empty() {
                let px = if k.1 { x + k.0 - 2.0 - cv.width(v, size, f) } else { x + 2.0 };
                cv.text(v, px, y + 5.0, size, f);
            }
            x += k.0;
        }
    };
    let mut y = num(&t["y"]);
    cv.rect(tx0, y, wt, rowh, &s(&r["headBg"]));
    let labels: Vec<String> = t["cols"].as_array().unwrap().iter().map(|k| s(&k["label"])).collect();
    row(&mut cv, y, &labels, true);
    y += rowh;
    for rr in t["rows"].as_array().unwrap() {
        let v: Vec<String> = rr.as_array().unwrap().iter().map(s).collect();
        row(&mut cv, y, &v, false);
        cv.hline(tx0, tx0 + wt, y + rowh, 0.5, &s(&r["rule"]));
        y += rowh;
    }
    for (k, tt) in t["totals"].as_array().unwrap().iter().enumerate() {
        row(&mut cv, y, &[String::new(), String::new(), s(&tt[0]), s(&tt[1])], k == 2);
        y += rowh;
    }
    cv.end()
}

fn unicode(c: &Ctx, out: &Path) -> Res<()> {
    let u = &c.s["unicode"];
    let lines = u["lines"].as_array().unwrap();
    let fonts: Vec<String> = lines.iter().map(|l| s(&l["font"])).collect();
    let mut cv = Canvas::open(c, out, &fonts, "Unicode")?;
    cv.page();
    for l in lines {
        cv.text(&s(&l["text"]), num(&l["x"]), num(&l["y"]), num(&u["size"]), &s(&l["font"]));
    }
    cv.end()
}

fn images(c: &Ctx, out: &Path) -> Res<()> {
    let im = &c.s["images"];
    let mut cv = Canvas::open(c, out, &[], "Images")?;
    for k in ["png", "jpeg"] {
        cv.page();
        cv.image(&c.f(&s(&im[k])), num(&im["x"]), num(&im["y"]), num(&im["w"]))?;
    }
    cv.end()
}

// ---------------------------------------------------------------- the frame
fn read_rows(c: &Ctx, n: usize) -> Res<Vec<Row>> {
    let text = std::fs::read_to_string(c.f(&format!("rows-{}.csv", n)))?;
    let mut rows = Vec::with_capacity(n);
    for l in text.lines().skip(1).filter(|l| !l.is_empty()) {
        let p: Vec<&str> = l.split(',').collect();
        let amount: f64 = p[5].parse()?;
        rows.push(Row { v: [p[0].into(), p[1].into(), p[2].into(), p[3].into(), p[4].into(), String::new(), p[6].into()], region: p[2].into(), amount });
    }
    Ok(rows)
}

fn pdfs(dir: &Path) -> Res<Vec<PathBuf>> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)?.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().map_or(false, |e| e == "pdf")).collect();
    v.sort();
    Ok(v)
}

fn timed(reps: usize, times: &mut Vec<f64>, mut f: impl FnMut() -> Res<()>) -> Res<()> {
    for _ in 0..reps {
        let t = Instant::now();
        f()?;
        times.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    Ok(())
}

fn run(c: &Ctx, lib: &str, job: &str, size: usize, out: &Path, reps: usize, times: &mut Vec<f64>) -> Res<Option<String>> {
    let pdf = out.join("out.pdf");
    let doc = c.f(&c.st(&["edit", "doc"]));
    let mut note = None;
    match (lib, job) {
        ("printpdf", "plain") => {
            let pool: Vec<String> = std::fs::read_to_string(c.f(&c.st(&["plain", "pool"])))?.lines().filter(|l| !l.is_empty()).map(String::from).collect();
            timed(reps, times, || plain(c, &pool, size, &pdf))?
        }
        ("printpdf", "report") => {
            let rows = read_rows(c, size)?;
            timed(reps, times, || {
                note = Some(report(c, &rows, &pdf)?);
                Ok(())
            })?
        }
        ("printpdf", "invoice") | ("printpdf", "invoice-warm") => timed(reps, times, || invoice(c, &pdf))?,
        ("printpdf", "unicode") => timed(reps, times, || unicode(c, &pdf))?,
        ("printpdf", "images") => timed(reps, times, || images(c, &pdf))?,
        ("lopdf", "split") => timed(reps, times, || {
            let src = lopdf::Document::load(&doc)?;
            let n = src.get_pages().len() as u32;
            for i in 1..=n {
                let mut d = src.clone();
                let others: Vec<u32> = (1..=n).filter(|&p| p != i).collect();
                d.delete_pages(&others);
                d.prune_objects();
                d.save(out.join(format!("p-{:04}.pdf", i)))?;
            }
            Ok(())
        })?,
        ("lopdf", "parse") => {
            let input = std::env::var("BENCH_INPUT")?;
            timed(reps, times, || {
                let d = lopdf::Document::load(&input)?;
                let pages: Vec<u32> = d.get_pages().keys().copied().collect();
                d.extract_text(&pages)?;
                Ok(())
            })?
        }
        ("pdf-extract", "read-big") => {
            let f = c.f(&c.st(&["read", "big"]));
            timed(reps, times, || Ok(std::fs::write(out.join("out.txt"), pdf_extract::extract_text(&f)?)?))?
        }
        ("pdf-extract", "read-mixed") => {
            let files = pdfs(&c.f(&c.st(&["read", "mixedDir"])))?;
            timed(reps, times, || {
                for f in &files {
                    std::fs::write(out.join(f.file_stem().unwrap()).with_extension("txt"), pdf_extract::extract_text(f)?)?;
                }
                Ok(())
            })?
        }
        ("pdf-extract", "parse") => {
            let input = std::env::var("BENCH_INPUT")?;
            timed(reps, times, || {
                pdf_extract::extract_text(&input)?;
                Ok(())
            })?
        }
        _ => return Err(format!("unsupported {} {}", lib, job).into()),
    }
    Ok(note)
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (lib, job, size, out) = (a[1].as_str(), a[2].as_str(), a[3].parse::<usize>().unwrap(), PathBuf::from(&a[4]));
    let fx = PathBuf::from(std::env::var("BENCH_FIXTURES").unwrap_or(".".into()));
    let spec = std::fs::read_to_string(std::env::var("BENCH_SPEC").map(PathBuf::from).unwrap_or(fx.join("spec.json"))).unwrap();
    let c = Ctx { s: serde_json::from_str(&spec).unwrap(), fx };
    if job == "version" {
        let v = match lib { "printpdf" => env!("V_PRINTPDF"), "lopdf" => env!("V_LOPDF"), _ => env!("V_PDF_EXTRACT") };
        println!("{}", json!({ "ok": true, "version": v }));
        return;
    }
    std::fs::create_dir_all(&out).unwrap();
    let reps = std::env::var("REPS").ok().and_then(|v| v.parse().ok()).unwrap_or(1usize);
    let mut times = Vec::new();
    match run(&c, lib, job, size, &out, reps, &mut times) {
        Ok(note) => {
            let mut r = json!({ "ok": true, "ms": times[0] });
            if times.len() > 1 {
                let from = if times.len() >= 50 { times.len() - 40 } else { times.len() / 5 };
                let mut w = times[from..].to_vec();
                w.sort_by(|x, y| x.partial_cmp(y).unwrap());
                r["warm_ms"] = json!(w[w.len() / 2]);
            }
            if let Some(n) = note {
                r["note"] = json!(n);
            }
            println!("{}", r);
        }
        Err(e) => println!("{}", json!({ "ok": false, "error": e.to_string() })),
    }
}
