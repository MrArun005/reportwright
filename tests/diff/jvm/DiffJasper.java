// Ground truth for tests/diff: fill and export every <id>.jrxml in a folder with the real JasperReports, one JVM for
// the whole batch. Data: <id>.json (an array of rows, read by Jasper's own JsonDataSource); locale: <id>.locale (a BCP 47
// tag). Writes <id>.jasper.pdf, or <id>.jasper.err with the exception when the report does not compile or fill.
// The time zone is UTC (the Node side renders with timeZone: 'UTC').
// usage: java -cp <classes>:<jasper res>:<jasper lib>/* DiffJasper <dir> [<id>…]
import java.io.*;
import java.nio.file.*;
import java.util.*;
import net.sf.jasperreports.engine.*;
import net.sf.jasperreports.json.data.JsonDataSource;
import net.sf.jasperreports.pdf.JRPdfExporter;
import net.sf.jasperreports.export.SimpleExporterInput;
import net.sf.jasperreports.export.SimpleOutputStreamExporterOutput;

public class DiffJasper {
  /** The exact text the exporter draws, font-independent: per page (\f between pages) one "y<TAB>x<TAB>text" line per
   *  text element, frames included, page coordinates. pdftotext cannot read text whose glyphs the font lacks. */
  static String printText(JasperPrint print) {
    StringBuilder sb = new StringBuilder();
    for (JRPrintPage pg : print.getPages()) {
      walk(pg.getElements(), 0, 0, sb);
      sb.append('\f');
    }
    return sb.toString();
  }
  static void walk(List<JRPrintElement> els, int dx, int dy, StringBuilder sb) {
    for (JRPrintElement e : els) {
      if (e instanceof JRPrintFrame f) walk(f.getElements(), dx + f.getX(), dy + f.getY(), sb);
      else if (e instanceof JRPrintText t) {
        String s = t.getFullText();
        sb.append(dy + t.getY()).append('\t').append(dx + t.getX()).append('\t').append(s == null ? "" : s.replace('\n', ' ').replace('\t', ' ')).append('\n');
      }
    }
  }

  public static void main(String[] a) throws Exception {
    TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
    Path dir = Paths.get(a[0]);
    List<String> ids = new ArrayList<>();
    if (a.length > 1) ids.addAll(Arrays.asList(a).subList(1, a.length));
    else try (DirectoryStream<Path> ds = Files.newDirectoryStream(dir, "*.jrxml")) { for (Path p : ds) ids.add(p.getFileName().toString().replaceAll("\\.jrxml$", "")); }
    Collections.sort(ids);
    int ok = 0, bad = 0;
    for (String id : ids) {
      Path err = dir.resolve(id + ".jasper.err"), pdf = dir.resolve(id + ".jasper.pdf");
      Files.deleteIfExists(dir.resolve(id + ".jasper.txt"));
      Files.deleteIfExists(err); Files.deleteIfExists(pdf);
      try {
        Locale loc = Locale.forLanguageTag(Files.readString(dir.resolve(id + ".locale")).trim());
        JasperReport r = JasperCompileManager.compileReport(dir.resolve(id + ".jrxml").toString());
        JsonDataSource ds = new JsonDataSource(new ByteArrayInputStream(Files.readAllBytes(dir.resolve(id + ".json"))));
        ds.setDatePattern("yyyy-MM-dd'T'HH:mm:ss");
        ds.setTimeZone(TimeZone.getTimeZone("UTC"));
        ds.setLocale(Locale.ROOT);
        Map<String, Object> p = new HashMap<>();
        p.put(JRParameter.REPORT_LOCALE, loc);
        p.put(JRParameter.REPORT_TIME_ZONE, TimeZone.getTimeZone("UTC"));
        JasperPrint print = JasperFillManager.fillReport(r, p, ds);
        JRPdfExporter ex = new JRPdfExporter();
        ex.setExporterInput(new SimpleExporterInput(print));
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ex.setExporterOutput(new SimpleOutputStreamExporterOutput(out));
        ex.exportReport();
        Files.write(pdf, out.toByteArray());
        Files.writeString(dir.resolve(id + ".jasper.txt"), printText(print));
        ok++;
      } catch (Throwable t) {
        StringWriter sw = new StringWriter(); t.printStackTrace(new PrintWriter(sw));
        Files.writeString(err, sw.toString());
        bad++;
      }
    }
    System.out.println("@@DONE jasper ok=" + ok + " failed=" + bad);
    System.exit(0);
  }
}
