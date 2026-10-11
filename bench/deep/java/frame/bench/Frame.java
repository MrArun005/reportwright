package bench;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/**
 * The Java side of the harness contract: java ... bench.Libs <lib> <job> <size> <outdir> -> one JSON line.
 * Inputs are read before the clock starts; "ms" is the job in this process; REPS=n runs it n times ("warm_ms": the
 * median of the last 40). Low-level writers draw the create jobs through {@link Canvas}, a port of
 * common/canvas-jobs.mjs, so every one of them gets the same drawing operations.
 */
public final class Frame {
  public static final Path FX = Paths.get(System.getenv().getOrDefault("BENCH_FIXTURES", "."));
  public static final Map<String, Object> SPEC = obj(parse(read(Paths.get(System.getenv().getOrDefault("BENCH_SPEC", FX.resolve("spec.json").toString())))));
  public static final Map<String, Object> P = obj(SPEC.get("page")), R = obj(SPEC.get("report")), EDIT = obj(SPEC.get("edit"));
  public static final double W = num(P.get("w")), H = num(P.get("h")), M = num(P.get("margin"));
  public static final double BOTTOM = H - M - num(P.get("footer"));

  public interface Canvas {
    void page() throws Exception;
    void text(String s, double x, double y, double size, String font, boolean rtl) throws Exception;
    double width(String s, double size, String font) throws Exception;
    void rect(double x, double y, double w, double h, String hex) throws Exception;
    void hline(double x1, double x2, double y, double w, String hex) throws Exception;
    Object image(String path) throws Exception;
    void draw(Object img, double x, double y, double w, double h) throws Exception;
    void end() throws Exception;
  }
  public interface CanvasFactory { Canvas open(String out, List<String> fonts, String title, boolean pdfa) throws Exception; }
  public record Cert(String key, String cert, String p12, String pass) {}

  /** A contestant: the jobs it overrides are the jobs it does (contestants.json lists them for the driver). */
  public static abstract class Lib {
    public abstract String version() throws Exception;
    public CanvasFactory canvas() { return null; }
    public void setup(String job, Map<String, Object> ctx) throws Exception {}
    public String plain(Map<String, Object> c, String out) throws Exception { return Jobs.plain(canvas(), c, out); }
    public String report(Map<String, Object> c, String out) throws Exception { return Jobs.report(canvas(), c, out); }
    public String invoice(Map<String, Object> c, String out) throws Exception { return Jobs.invoice(canvas(), out, false); }
    public String pdfa(Map<String, Object> c, String out) throws Exception { return Jobs.invoice(canvas(), out, true); }
    public String unicode(Map<String, Object> c, String out) throws Exception { return Jobs.unicode(canvas(), out); }
    public String images(Map<String, Object> c, String out) throws Exception { return Jobs.images(canvas(), out); }
    public String extract(String file) throws Exception { throw new UnsupportedOperationException(); }
    public void parse(String file) throws Exception { extract(file); }
    public void merge(List<String> files, String out) throws Exception { throw new UnsupportedOperationException(); }
    public void split(String file, String dir) throws Exception { throw new UnsupportedOperationException(); }
    public void encrypt(String file, String out, String user, String owner) throws Exception { throw new UnsupportedOperationException(); }
    public void metadata(String file, String out, String title) throws Exception { throw new UnsupportedOperationException(); }
    public void form(String file, String out, Map<String, Object> values) throws Exception { throw new UnsupportedOperationException(); }
    public void sign(String file, String out, Cert c) throws Exception { throw new UnsupportedOperationException(); }
  }

  public static String fx(String p) { return FX.resolve(p).toString(); }
  public static String font(String k) { return fx(str(obj(SPEC.get("fonts")).get(k))); }
  public static String money(double v) { return String.format(Locale.US, "%,.2f", v); }
  public static float[] rgb(String hex) {
    return new float[] { Integer.parseInt(hex.substring(1, 3), 16) / 255f, Integer.parseInt(hex.substring(3, 5), 16) / 255f, Integer.parseInt(hex.substring(5, 7), 16) / 255f };
  }
  /** a jar's version from its Maven metadata */
  public static String mavenVersion(String group, String artifact) {
    try (InputStream in = Frame.class.getResourceAsStream("/META-INF/maven/" + group + "/" + artifact + "/pom.properties")) {
      Properties p = new Properties();
      p.load(in);
      return p.getProperty("version");
    } catch (Exception e) { return "?"; }
  }

  // ---------------------------------------------------------------- inputs
  public record Row(int id, String account, String region, String type, String date, double amount, String reference) {}
  public static List<Row> rows(int n) throws IOException {
    List<Row> rows = new ArrayList<>(n);
    try (BufferedReader r = Files.newBufferedReader(FX.resolve("rows-" + n + ".csv"))) {
      r.readLine();
      for (String l; (l = r.readLine()) != null; ) {
        if (l.isEmpty()) continue;
        String[] c = l.split(",", -1);
        rows.add(new Row(Integer.parseInt(c[0]), c[1], c[2], c[3], c[4], Double.parseDouble(c[5]), c[6]));
      }
    }
    return rows;
  }
  static List<String> pdfsIn(String dir) throws IOException {
    try (var s = Files.list(FX.resolve(dir))) { return s.map(Path::toString).filter(f -> f.endsWith(".pdf")).sorted().toList(); }
  }
  static Map<String, Object> inputs(String job, int size) throws IOException {
    Map<String, Object> c = new HashMap<>();
    switch (job) {
      case "report" -> c.put("rows", rows(size));
      case "plain" -> { c.put("pool", Files.readAllLines(FX.resolve(str(obj(SPEC.get("plain")).get("pool")))).stream().filter(s -> !s.isEmpty()).toList()); c.put("pages", size); }
      case "read-big" -> c.put("files", List.of(fx(str(obj(SPEC.get("read")).get("big")))));
      case "read-mixed" -> c.put("files", pdfsIn(str(obj(SPEC.get("read")).get("mixedDir"))));
      case "merge" -> c.put("files", pdfsIn(str(EDIT.get("mergeDir"))).subList(0, size));
      case "split", "encrypt", "metadata" -> c.put("file", fx(str(EDIT.get("doc"))));
      case "form" -> c.put("file", fx(str(EDIT.get("form"))));
      case "sign" -> c.put("file", fx(str(EDIT.get("signDoc"))));
      case "parse" -> c.put("file", System.getenv("BENCH_INPUT"));
      default -> {}
    }
    return c;
  }

  @SuppressWarnings("unchecked")
  static String run(Lib a, String job, Map<String, Object> c, String out) throws Exception {
    String pdf = Paths.get(out, "out.pdf").toString();
    Map<String, Object> pw = obj(EDIT.get("passwords"));
    switch (job) {
      case "plain": return a.plain(c, pdf);
      case "report": return a.report(c, pdf);
      case "invoice": case "invoice-warm": return a.invoice(c, pdf);
      case "pdfa": return a.pdfa(c, pdf);
      case "unicode": return a.unicode(c, pdf);
      case "images": return a.images(c, pdf);
      case "read-big": Files.writeString(Paths.get(out, "out.txt"), a.extract(((List<String>) c.get("files")).get(0))); return null;
      case "read-mixed":
        for (String f : (List<String>) c.get("files")) Files.writeString(Paths.get(out, Paths.get(f).getFileName().toString().replace(".pdf", ".txt")), a.extract(f));
        return null;
      case "parse": a.parse((String) c.get("file")); return null;
      case "merge": a.merge((List<String>) c.get("files"), pdf); return null;
      case "split": a.split((String) c.get("file"), out); return null;
      case "encrypt": a.encrypt((String) c.get("file"), pdf, str(pw.get("user")), str(pw.get("owner"))); return null;
      case "metadata": a.metadata((String) c.get("file"), pdf, str(EDIT.get("title"))); return null;
      case "form": a.form((String) c.get("file"), pdf, obj(EDIT.get("formValues"))); return null;
      case "sign": {
        Map<String, Object> k = obj(EDIT.get("cert"));
        a.sign((String) c.get("file"), pdf, new Cert(fx(str(k.get("key"))), fx(str(k.get("cert"))), fx(str(k.get("p12"))), str(k.get("p12pass"))));
        return null;
      }
      default: throw new IllegalArgumentException("unknown job " + job);
    }
  }

  public static void main(String[] args, Map<String, java.util.function.Supplier<Lib>> libs) {
    String lib = args[0], job = args[1], out = args[3];
    int size = Integer.parseInt(args[2]);
    String line;
    try {
      Lib a = libs.get(lib).get();
      if (job.equals("version")) {
        line = "{\"ok\":true,\"version\":" + q(a.version()) + "}";
      } else {
        Files.createDirectories(Paths.get(out));
        Map<String, Object> c = inputs(job, size);
        a.setup(job, c);
        int reps = Integer.parseInt(System.getenv().getOrDefault("REPS", "1"));
        double[] t = new double[reps];
        String note = null;
        for (int i = 0; i < reps; i++) {
          long t0 = System.nanoTime();
          note = run(a, job, c, out);
          t[i] = (System.nanoTime() - t0) / 1e6;
        }
        StringBuilder sb = new StringBuilder("{\"ok\":true,\"ms\":").append(t[0]);
        if (reps > 1) {
          double[] w = Arrays.copyOfRange(t, reps >= 50 ? reps - 40 : (int) (reps * 0.2), reps);
          Arrays.sort(w);
          sb.append(",\"warm_ms\":").append(w[w.length / 2]);
        }
        if (note != null) sb.append(",\"note\":").append(q(note));
        line = sb.append('}').toString();
      }
    } catch (Throwable e) {
      if (e instanceof OutOfMemoryError) { System.err.println("OutOfMemoryError"); System.exit(3); }
      StringWriter sw = new StringWriter();
      e.printStackTrace(new PrintWriter(sw));
      String s = sw.toString();
      line = "{\"ok\":false,\"error\":" + q(s.substring(0, Math.min(600, s.length()))) + "}";
    }
    System.out.println(line);
    System.out.flush();
    System.exit(0);
  }

  // ---------------------------------------------------------------- the create jobs over a Canvas
  static final class Jobs {
    static String plain(CanvasFactory f, Map<String, Object> c, String out) throws Exception {
      Map<String, Object> s = obj(SPEC.get("plain"));
      @SuppressWarnings("unchecked") List<String> pool = (List<String>) c.get("pool");
      int lpp = (int) num(s.get("linesPerPage")), pages = (int) c.get("pages");
      double x = num(s.get("x")), y = num(s.get("y")), lead = num(s.get("leading")), size = num(s.get("size"));
      Canvas cv = f.open(out, List.of("r"), "Plain", false);
      for (int p = 0; p < pages; p++) {
        cv.page();
        for (int k = 0; k < lpp; k++) cv.text(pool.get((p * lpp + k) % pool.size()), x, y + k * lead, size, "r", false);
      }
      cv.end();
      return null;
    }

    record Op(char k, double y, Object a, int count, double sum) {}
    static List<List<Op>> plan(List<Row> rows) {
      double headH = num(R.get("headH")), groupH = num(R.get("groupH")), rowH = num(R.get("rowH"));
      List<List<Op>> pages = new ArrayList<>();
      List<Op>[] cur = new List[1];
      double[] y = new double[1];
      Runnable newPage = () -> { cur[0] = new ArrayList<>(); pages.add(cur[0]); y[0] = M + headH; };
      java.util.function.DoubleConsumer need = h -> { if (y[0] + h > BOTTOM) newPage.run(); };
      newPage.run();
      int count = 0, gCount = 0;
      double sum = 0, gSum = 0;
      String region = null;
      for (int i = 0; i <= rows.size(); i++) {
        Row r = i < rows.size() ? rows.get(i) : null;
        if (region != null && (r == null || !r.region().equals(region))) {
          need.accept(rowH); cur[0].add(new Op('S', y[0], "Region total", gCount, gSum)); y[0] += rowH;
          count += gCount; sum += gSum;
        }
        if (r == null) break;
        if (!r.region().equals(region)) {
          region = r.region(); gCount = 0; gSum = 0;
          need.accept(groupH + rowH); cur[0].add(new Op('G', y[0], region, 0, 0)); y[0] += groupH;
        }
        need.accept(rowH); cur[0].add(new Op('R', y[0], r, 0, 0)); y[0] += rowH;
        gCount++; gSum += r.amount();
      }
      need.accept(rowH); cur[0].add(new Op('S', y[0], "Grand total", count, sum));
      return pages;
    }

    static void cells(Canvas cv, double y, double h, String[] vals, boolean bold) throws Exception {
      double x = M, size = num(R.get("size"));
      String f = bold ? "b" : "r";
      List<Object> cols = list(R.get("cols"));
      for (int i = 0; i < cols.size(); i++) {
        Map<String, Object> c = obj(cols.get(i));
        double w = num(c.get("w"));
        String v = vals[i];
        if (v != null && !v.isEmpty()) cv.text(v, Boolean.TRUE.equals(c.get("right")) ? x + w - 2 - cv.width(v, size, f) : x + 2, y + (h - size) / 2, size, f, false);
        x += w;
      }
    }

    static String report(CanvasFactory f, Map<String, Object> c, String out) throws Exception {
      @SuppressWarnings("unchecked") List<Row> rows = (List<Row>) c.get("rows");
      Canvas cv = f.open(out, List.of("r", "b"), "Ledger", false);
      List<List<Op>> pages = plan(rows);
      List<Object> cols = list(R.get("cols"));
      double Wt = 0;
      String[] labels = new String[cols.size()];
      for (int i = 0; i < cols.size(); i++) { Wt += num(obj(cols.get(i)).get("w")); labels[i] = str(obj(cols.get(i)).get("label")); }
      double headH = num(R.get("headH")), groupH = num(R.get("groupH")), rowH = num(R.get("rowH")), size = num(R.get("size")), fs = num(R.get("footerSize"));
      for (int i = 0; i < pages.size(); i++) {
        cv.page();
        cv.rect(M, M, Wt, headH, str(R.get("headBg")));
        cells(cv, M, headH, labels, true);
        for (Op o : pages.get(i)) {
          if (o.k() == 'G') { cv.rect(M, o.y(), Wt, groupH, str(R.get("groupBg"))); cv.text("Region " + o.a(), M + 2, o.y() + 3.5, size, "b", false); }
          else if (o.k() == 'R') {
            Row r = (Row) o.a();
            cells(cv, o.y(), rowH, new String[] { String.valueOf(r.id()), r.account(), r.region(), r.type(), r.date(), money(r.amount()), r.reference() }, false);
            cv.hline(M, M + Wt, o.y() + rowH, 0.5, str(R.get("rule")));
          } else cells(cv, o.y(), rowH, new String[] { (String) o.a(), "", String.valueOf(o.count()), "", "", money(o.sum()), "" }, true);
        }
        String ft = str(R.get("footerText")).replace("{n}", String.valueOf(i + 1)).replace("{m}", String.valueOf(pages.size()));
        cv.text(ft, M + Wt - cv.width(ft, fs, "r"), BOTTOM + 4, fs, "r", false);
      }
      cv.end();
      return pages.size() + " pages";
    }

    static String invoice(CanvasFactory f, String out, boolean pdfa) throws Exception {
      Map<String, Object> I = obj(SPEC.get("invoice")), T = obj(I.get("table")), L = obj(I.get("logo"));
      Canvas cv = f.open(out, List.of("r", "b"), "Invoice", pdfa);
      cv.page();
      for (Object o : list(I.get("texts"))) {
        Map<String, Object> t = obj(o);
        String fk = Boolean.TRUE.equals(t.get("bold")) ? "b" : "r", s = str(t.get("text"));
        double size = num(t.get("size"));
        cv.text(s, Boolean.TRUE.equals(t.get("right")) ? num(t.get("x")) + num(t.get("w")) - cv.width(s, size, fk) : num(t.get("x")), num(t.get("y")), size, fk, false);
      }
      cv.draw(cv.image(fx(str(L.get("file")))), num(L.get("x")), num(L.get("y")), num(L.get("w")), num(L.get("h")));
      List<Object> cols = list(T.get("cols"));
      double tx = num(T.get("x")), rowH = num(T.get("rowH")), size = num(T.get("size")), Wt = 0;
      for (Object c : cols) Wt += num(obj(c).get("w"));
      double y = num(T.get("y"));
      String[] labels = cols.stream().map(c -> str(obj(c).get("label"))).toArray(String[]::new);
      cv.rect(tx, y, Wt, rowH, str(R.get("headBg")));
      invRow(cv, cols, tx, y, size, labels, true); y += rowH;
      for (Object r : list(T.get("rows"))) {
        invRow(cv, cols, tx, y, size, list(r).stream().map(Frame::str).toArray(String[]::new), false);
        cv.hline(tx, tx + Wt, y + rowH, 0.5, str(R.get("rule")));
        y += rowH;
      }
      List<Object> totals = list(T.get("totals"));
      for (int i = 0; i < totals.size(); i++) {
        List<Object> lv = list(totals.get(i));
        invRow(cv, cols, tx, y, size, new String[] { "", "", str(lv.get(0)), str(lv.get(1)) }, i == 2);
        y += rowH;
      }
      cv.end();
      return null;
    }
    static void invRow(Canvas cv, List<Object> cols, double x, double y, double size, String[] vals, boolean bold) throws Exception {
      String f = bold ? "b" : "r";
      for (int i = 0; i < cols.size(); i++) {
        Map<String, Object> c = obj(cols.get(i));
        double w = num(c.get("w"));
        if (!vals[i].isEmpty()) cv.text(vals[i], Boolean.TRUE.equals(c.get("right")) ? x + w - 2 - cv.width(vals[i], size, f) : x + 2, y + 5, size, f, false);
        x += w;
      }
    }

    static String unicode(CanvasFactory f, String out) throws Exception {
      Map<String, Object> U = obj(SPEC.get("unicode"));
      List<String> fonts = new ArrayList<>();
      for (Object l : list(U.get("lines"))) fonts.add(str(obj(l).get("font")));
      Canvas cv = f.open(out, fonts, "Unicode", false);
      cv.page();
      for (Object o : list(U.get("lines"))) {
        Map<String, Object> l = obj(o);
        cv.text(str(l.get("text")), num(l.get("x")), num(l.get("y")), num(U.get("size")), str(l.get("font")), Boolean.TRUE.equals(l.get("rtl")));
      }
      cv.end();
      return null;
    }

    static String images(CanvasFactory f, String out) throws Exception {
      Map<String, Object> I = obj(SPEC.get("images"));
      Canvas cv = f.open(out, List.of(), "Images", false);
      for (String k : List.of("png", "jpeg")) {
        cv.page();
        String file = fx(str(I.get(k)));
        int[] wh = imageSize(file);
        double w = num(I.get("w"));
        cv.draw(cv.image(file), num(I.get("x")), num(I.get("y")), w, w * wh[1] / wh[0]);
      }
      cv.end();
      return null;
    }
  }

  /** width and height from a PNG or JPEG header, without decoding */
  public static int[] imageSize(String file) throws IOException {
    byte[] b = new byte[65536];
    try (InputStream in = new FileInputStream(file)) { in.readNBytes(b, 0, b.length); }
    java.nio.ByteBuffer bb = java.nio.ByteBuffer.wrap(b);
    if ((b[0] & 0xff) == 0x89) return new int[] { bb.getInt(16), bb.getInt(20) };
    int i = 2;
    while (i < b.length - 9) {
      int m = b[i + 1] & 0xff, len = bb.getShort(i + 2) & 0xffff;
      if (m >= 0xC0 && m <= 0xCF && m != 0xC4 && m != 0xC8 && m != 0xCC) return new int[] { bb.getShort(i + 7) & 0xffff, bb.getShort(i + 5) & 0xffff };
      i += 2 + len;
    }
    throw new IOException("image size");
  }

  // ---------------------------------------------------------------- a small JSON reader and writer (no dependency)
  @SuppressWarnings("unchecked") public static Map<String, Object> obj(Object o) { return (Map<String, Object>) o; }
  @SuppressWarnings("unchecked") public static List<Object> list(Object o) { return (List<Object>) o; }
  public static double num(Object o) { return ((Number) o).doubleValue(); }
  public static String str(Object o) { return (String) o; }
  static String read(Path p) { try { return Files.readString(p, StandardCharsets.UTF_8); } catch (IOException e) { throw new UncheckedIOException(e); } }
  public static String q(String s) {
    StringBuilder b = new StringBuilder("\"");
    for (char c : s.toCharArray()) {
      if (c == '"' || c == '\\') b.append('\\').append(c);
      else if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
      else b.append(c);
    }
    return b.append('"').toString();
  }
  static Object parse(String s) { int[] i = { 0 }; return value(s, i); }
  static void ws(String s, int[] i) { while (i[0] < s.length() && Character.isWhitespace(s.charAt(i[0]))) i[0]++; }
  static Object value(String s, int[] i) {
    ws(s, i);
    char c = s.charAt(i[0]);
    if (c == '{') {
      Map<String, Object> m = new LinkedHashMap<>();
      i[0]++; ws(s, i);
      if (s.charAt(i[0]) == '}') { i[0]++; return m; }
      while (true) {
        ws(s, i); String k = (String) value(s, i); ws(s, i); i[0]++; // ':'
        m.put(k, value(s, i)); ws(s, i);
        if (s.charAt(i[0]++) == '}') return m;
      }
    }
    if (c == '[') {
      List<Object> l = new ArrayList<>();
      i[0]++; ws(s, i);
      if (s.charAt(i[0]) == ']') { i[0]++; return l; }
      while (true) { l.add(value(s, i)); ws(s, i); if (s.charAt(i[0]++) == ']') return l; }
    }
    if (c == '"') {
      StringBuilder b = new StringBuilder();
      i[0]++;
      while (true) {
        char d = s.charAt(i[0]++);
        if (d == '"') return b.toString();
        if (d == '\\') {
          char e = s.charAt(i[0]++);
          switch (e) {
            case 'n' -> b.append('\n'); case 't' -> b.append('\t'); case 'r' -> b.append('\r'); case 'b' -> b.append('\b'); case 'f' -> b.append('\f');
            case 'u' -> { b.append((char) Integer.parseInt(s.substring(i[0], i[0] + 4), 16)); i[0] += 4; }
            default -> b.append(e);
          }
        } else b.append(d);
      }
    }
    if (s.startsWith("true", i[0])) { i[0] += 4; return true; }
    if (s.startsWith("false", i[0])) { i[0] += 5; return false; }
    if (s.startsWith("null", i[0])) { i[0] += 4; return null; }
    int st = i[0];
    while (i[0] < s.length() && "+-0123456789.eE".indexOf(s.charAt(i[0])) >= 0) i[0]++;
    return Double.parseDouble(s.substring(st, i[0]));
  }
}
