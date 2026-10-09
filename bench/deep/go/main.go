// Go contestants: bench <fpdf|pdfcpu> <job> <size> <outdir> -> one JSON line (the contract of common/frame.mjs).
// go-pdf/fpdf draws the create jobs through the same operations as every low-level writer (a port of
// common/canvas-jobs.mjs); pdfcpu does the structure jobs (merge, split, AES-256) and parses for the robustness jobs.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-pdf/fpdf"
	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

type col struct {
	Key, Label string
	W          float64
	Right      bool
}
type Spec struct {
	Page  struct{ W, H, Margin, Footer float64 }
	Fonts map[string]string
	Plain struct {
		Size, Leading, X, Y float64
		LinesPerPage        int
		Pool                string
	}
	Report struct {
		Size, HeadH, GroupH, RowH, FooterSize float64
		HeadBg, GroupBg, Rule, FooterText     string
		Cols                                  []col
	}
	Invoice struct {
		Texts []struct {
			X, Y, Size, W float64
			Bold, Right   bool
			Text          string
		}
		Logo  struct{ File string; X, Y, W, H float64 }
		Table struct {
			X, Y, RowH, Size float64
			Cols             []col
			Rows, Totals     [][]string
		}
	}
	Unicode struct {
		Size  float64
		Lines []struct {
			Font, Text string
			X, Y       float64
		}
	}
	Images struct {
		Png, Jpeg string
		X, Y, W   float64
	}
	Edit struct {
		MergeDir, Doc string
		Passwords     struct{ User, Owner string }
	}
}

var (
	fx = os.Getenv("BENCH_FIXTURES")
	S  Spec
)

type row struct {
	id                                   int
	account, region, typ, date, reference string
	amount                               float64
}

func money(v float64) string {
	s := strconv.FormatFloat(v, 'f', 2, 64)
	neg := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(s, "-")
	i, frac := s[:len(s)-3], s[len(s)-3:]
	var b strings.Builder
	for k, c := range i {
		if k > 0 && (len(i)-k)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(c)
	}
	if neg {
		return "-" + b.String() + frac
	}
	return b.String() + frac
}

func readRows(n int) []row {
	f, err := os.Open(filepath.Join(fx, fmt.Sprintf("rows-%d.csv", n)))
	must(err)
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Scan()
	rows := make([]row, 0, n)
	for sc.Scan() {
		c := strings.Split(sc.Text(), ",")
		if len(c) < 7 {
			continue
		}
		id, _ := strconv.Atoi(c[0])
		a, _ := strconv.ParseFloat(c[5], 64)
		rows = append(rows, row{id, c[1], c[2], c[3], c[4], c[6], a})
	}
	return rows
}

// benchErr: an error the harness raises itself (reported as a clean error). Any other panic is a library crash.
type benchErr struct{ error }

func must(err error) {
	if err != nil {
		panic(benchErr{err})
	}
}

// ---------------------------------------------------------------- the drawing surface and the create jobs
type canvas struct {
	pdf *fpdf.Fpdf
	out string
}

func open(out string, fonts []string, title string) *canvas {
	p := fpdf.NewCustom(&fpdf.InitType{UnitStr: "pt", Size: fpdf.SizeType{Wd: S.Page.W, Ht: S.Page.H}})
	p.SetMargins(0, 0, 0)
	p.SetAutoPageBreak(false, 0)
	p.SetTitle(title, true)
	for _, k := range fonts {
		p.AddUTF8Font(k, "", filepath.Join(fx, S.Fonts[k]))
	}
	return &canvas{p, out}
}
func (c *canvas) page() { c.pdf.AddPage() }
func (c *canvas) text(s string, x, y, size float64, k string) {
	c.pdf.SetFont(k, "", size)
	c.pdf.Text(x, y+0.8*size, s)
}
func (c *canvas) width(s string, size float64, k string) float64 {
	c.pdf.SetFont(k, "", size)
	return c.pdf.GetStringWidth(s)
}
func hex(h string) (int, int, int) {
	v, _ := strconv.ParseUint(h[1:], 16, 32)
	return int(v >> 16 & 255), int(v >> 8 & 255), int(v & 255)
}
func (c *canvas) rect(x, y, w, h float64, col string) {
	c.pdf.SetFillColor(hex(col))
	c.pdf.Rect(x, y, w, h, "F")
}
func (c *canvas) hline(x1, x2, y, w float64, col string) {
	c.pdf.SetDrawColor(hex(col))
	c.pdf.SetLineWidth(w)
	c.pdf.Line(x1, y, x2, y)
}
func (c *canvas) image(path string, x, y, w, h float64) {
	c.pdf.ImageOptions(path, x, y, w, h, false, fpdf.ImageOptions{ReadDpi: false}, 0, "")
}
func (c *canvas) end() { must(c.pdf.OutputFileAndClose(c.out)) }

func plain(pool []string, pages int, out string) {
	s := S.Plain
	c := open(out, []string{"r"}, "Plain")
	for p := 0; p < pages; p++ {
		c.page()
		for k := 0; k < s.LinesPerPage; k++ {
			c.text(pool[(p*s.LinesPerPage+k)%len(pool)], s.X, s.Y+float64(k)*s.Leading, s.Size, "r")
		}
	}
	c.end()
}

type op struct {
	k     byte
	y     float64
	r     *row
	label string
	count int
	sum   float64
}

func plan(rows []row) [][]op {
	R, M := S.Report, S.Page.Margin
	bottom := S.Page.H - M - S.Page.Footer
	var pages [][]op
	y := 0.0
	newPage := func() { pages = append(pages, nil); y = M + R.HeadH }
	add := func(o op) { pages[len(pages)-1] = append(pages[len(pages)-1], o) }
	need := func(h float64) {
		if y+h > bottom {
			newPage()
		}
	}
	newPage()
	count, total := 0, 0.0
	for i := 0; i < len(rows); {
		j, gs := i, 0.0
		for j < len(rows) && rows[j].region == rows[i].region {
			j++
		}
		need(R.GroupH + R.RowH)
		add(op{k: 'G', y: y, label: rows[i].region})
		y += R.GroupH
		for k := i; k < j; k++ {
			need(R.RowH)
			add(op{k: 'R', y: y, r: &rows[k]})
			y += R.RowH
			gs += rows[k].amount
		}
		need(R.RowH)
		add(op{k: 'S', y: y, label: "Region total", count: j - i, sum: gs})
		y += R.RowH
		count, total, i = count+j-i, total+gs, j
	}
	need(R.RowH)
	add(op{k: 'S', y: y, label: "Grand total", count: count, sum: total})
	return pages
}

func cells(c *canvas, y, h float64, vals []string, bold bool) {
	R := S.Report
	x, f := S.Page.Margin, "r"
	if bold {
		f = "b"
	}
	for i, cl := range R.Cols {
		if v := vals[i]; v != "" {
			tx := x + 2
			if cl.Right {
				tx = x + cl.W - 2 - c.width(v, R.Size, f)
			}
			c.text(v, tx, y+(h-R.Size)/2, R.Size, f)
		}
		x += cl.W
	}
}

func report(rows []row, out string) string {
	R, M := S.Report, S.Page.Margin
	bottom := S.Page.H - M - S.Page.Footer
	c := open(out, []string{"r", "b"}, "Ledger")
	pages := plan(rows)
	W := 0.0
	labels := []string{}
	for _, cl := range R.Cols {
		W += cl.W
		labels = append(labels, cl.Label)
	}
	for i, ops := range pages {
		c.page()
		c.rect(M, M, W, R.HeadH, R.HeadBg)
		cells(c, M, R.HeadH, labels, true)
		for _, o := range ops {
			switch o.k {
			case 'G':
				c.rect(M, o.y, W, R.GroupH, R.GroupBg)
				c.text("Region "+o.label, M+2, o.y+3.5, R.Size, "b")
			case 'R':
				r := o.r
				cells(c, o.y, R.RowH, []string{strconv.Itoa(r.id), r.account, r.region, r.typ, r.date, money(r.amount), r.reference}, false)
				c.hline(M, M+W, o.y+R.RowH, 0.5, R.Rule)
			default:
				cells(c, o.y, R.RowH, []string{o.label, "", strconv.Itoa(o.count), "", "", money(o.sum), ""}, true)
			}
		}
		ft := strings.NewReplacer("{n}", strconv.Itoa(i+1), "{m}", strconv.Itoa(len(pages))).Replace(R.FooterText)
		c.text(ft, M+W-c.width(ft, R.FooterSize, "r"), bottom+4, R.FooterSize, "r")
	}
	c.end()
	return fmt.Sprintf("%d pages", len(pages))
}

func invoice(out string) {
	I, R := S.Invoice, S.Report
	T := I.Table
	c := open(out, []string{"r", "b"}, "Invoice")
	c.page()
	for _, t := range I.Texts {
		f := "r"
		if t.Bold {
			f = "b"
		}
		x := t.X
		if t.Right {
			x = t.X + t.W - c.width(t.Text, t.Size, f)
		}
		c.text(t.Text, x, t.Y, t.Size, f)
	}
	c.image(filepath.Join(fx, I.Logo.File), I.Logo.X, I.Logo.Y, I.Logo.W, I.Logo.H)
	W := 0.0
	labels := []string{}
	for _, cl := range T.Cols {
		W += cl.W
		labels = append(labels, cl.Label)
	}
	rowAt := func(y float64, vals []string, bold bool) {
		x, f := T.X, "r"
		if bold {
			f = "b"
		}
		for i, cl := range T.Cols {
			if v := vals[i]; v != "" {
				tx := x + 2
				if cl.Right {
					tx = x + cl.W - 2 - c.width(v, T.Size, f)
				}
				c.text(v, tx, y+5, T.Size, f)
			}
			x += cl.W
		}
	}
	y := T.Y
	c.rect(T.X, y, W, T.RowH, R.HeadBg)
	rowAt(y, labels, true)
	y += T.RowH
	for _, r := range T.Rows {
		rowAt(y, r, false)
		c.hline(T.X, T.X+W, y+T.RowH, 0.5, R.Rule)
		y += T.RowH
	}
	for i, t := range T.Totals {
		rowAt(y, []string{"", "", t[0], t[1]}, i == 2)
		y += T.RowH
	}
	c.end()
}

func unicode(out string) {
	U := S.Unicode
	fonts := []string{}
	for _, l := range U.Lines {
		fonts = append(fonts, l.Font)
	}
	c := open(out, fonts, "Unicode")
	c.page()
	for _, l := range U.Lines {
		c.text(l.Text, l.X, l.Y, U.Size, l.Font)
	}
	c.end()
}

func images(out string) {
	I := S.Images
	c := open(out, nil, "Images")
	for _, f := range []string{I.Png, I.Jpeg} {
		c.page()
		p := filepath.Join(fx, f)
		info := c.pdf.RegisterImageOptions(p, fpdf.ImageOptions{})
		c.image(p, I.X, I.Y, I.W, I.W*info.Height()/info.Width())
	}
	c.end()
}

// ---------------------------------------------------------------- pdfcpu
func pdfs(dir string) []string {
	m, _ := filepath.Glob(filepath.Join(fx, dir, "*.pdf"))
	sort.Strings(m)
	return m
}

func run(lib, job string, size int, out string) (string, error) {
	pdf := filepath.Join(out, "out.pdf")
	doc := filepath.Join(fx, S.Edit.Doc)
	switch lib + ":" + job {
	case "fpdf:plain":
		var pool []string
		b, err := os.ReadFile(filepath.Join(fx, S.Plain.Pool))
		must(err)
		for _, l := range strings.Split(string(b), "\n") {
			if l != "" {
				pool = append(pool, l)
			}
		}
		return "", timed(func() { plain(pool, size, pdf) })
	case "fpdf:report":
		rows := readRows(size)
		var note string
		err := timed(func() { note = report(rows, pdf) })
		return note, err
	case "fpdf:invoice", "fpdf:invoice-warm":
		return "", timed(func() { invoice(pdf) })
	case "fpdf:unicode":
		return "", timed(func() { unicode(pdf) })
	case "fpdf:images":
		return "", timed(func() { images(pdf) })
	case "pdfcpu:merge":
		files := pdfs(S.Edit.MergeDir)[:size]
		return "", timedErr(func() error { return api.MergeCreateFile(files, pdf, false, nil) })
	case "pdfcpu:split":
		return "", timedErr(func() error { return api.SplitFile(doc, out, 1, nil) })
	case "pdfcpu:encrypt":
		conf := model.NewAESConfiguration(S.Edit.Passwords.User, S.Edit.Passwords.Owner, 256)
		return "", timedErr(func() error { return api.EncryptFile(doc, pdf, conf) })
	case "pdfcpu:parse":
		in := os.Getenv("BENCH_INPUT")
		return "", timedErr(func() error { return api.ValidateFile(in, nil) })
	}
	return "", fmt.Errorf("unsupported %s %s", lib, job)
}

var times []float64

func timedErr(f func() error) error {
	reps, _ := strconv.Atoi(os.Getenv("REPS"))
	if reps < 1 {
		reps = 1
	}
	for i := 0; i < reps; i++ {
		t := time.Now()
		if err := f(); err != nil {
			return err
		}
		times = append(times, float64(time.Since(t).Nanoseconds())/1e6)
	}
	return nil
}
func timed(f func()) error { return timedErr(func() error { f(); return nil }) }

func version(mod string) string {
	if bi, ok := debug.ReadBuildInfo(); ok {
		for _, d := range bi.Deps {
			if d.Path == mod {
				return d.Version
			}
		}
	}
	return "?"
}

func main() {
	lib, job, out := os.Args[1], os.Args[2], os.Args[4]
	size, _ := strconv.Atoi(os.Args[3])
	say := func(m map[string]any) { b, _ := json.Marshal(m); fmt.Println(string(b)) }
	defer func() {
		if r := recover(); r != nil {
			if e, ok := r.(benchErr); ok {
				say(map[string]any{"ok": false, "error": e.Error()})
				return
			}
			fmt.Fprintln(os.Stderr, "panic:", r)
			os.Exit(2)
		}
	}()
	b, err := os.ReadFile(filepath.Join(fx, "spec.json"))
	must(err)
	must(json.Unmarshal(b, &S))
	if job == "version" {
		say(map[string]any{"ok": true, "version": version(map[string]string{"fpdf": "github.com/go-pdf/fpdf", "pdfcpu": "github.com/pdfcpu/pdfcpu"}[lib])})
		return
	}
	must(os.MkdirAll(out, 0o755))
	note, err := run(lib, job, size, out)
	if err != nil {
		say(map[string]any{"ok": false, "error": err.Error()})
		return
	}
	r := map[string]any{"ok": true, "ms": times[0]}
	if len(times) > 1 {
		from := len(times) / 5
		if len(times) >= 50 {
			from = len(times) - 40
		}
		w := append([]float64(nil), times[from:]...)
		sort.Float64s(w)
		r["warm_ms"] = w[len(w)/2]
	}
	if note != "" {
		r["note"] = note
	}
	say(r)
}
