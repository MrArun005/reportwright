// Ground truth for tests/diff: run and render every <id>.rptdesign in a folder with the real BIRT runtime, one JVM
// for the whole batch. The design's scripted data source parses the JSON text in the app context key "JSON"
// (<id>.json, an array of rows); locale: <id>.locale (a BCP 47 tag). Writes <id>.birt.pdf, or <id>.birt.err.
// The time zone is UTC (the Node side renders with timeZone: 'UTC').
// usage: java -Djava.awt.headless=true -cp <classes>:<birt res>:<ReportEngine/lib>/* DiffBirt <dir> [<id>…]
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.logging.Level;
import org.eclipse.birt.core.framework.Platform;
import org.eclipse.birt.report.engine.api.*;

public class DiffBirt {
  public static void main(String[] a) throws Exception {
    TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
    Path dir = Paths.get(a[0]);
    List<String> ids = new ArrayList<>();
    if (a.length > 1) ids.addAll(Arrays.asList(a).subList(1, a.length));
    else try (DirectoryStream<Path> ds = Files.newDirectoryStream(dir, "*.rptdesign")) { for (Path p : ds) ids.add(p.getFileName().toString().replaceAll("\\.rptdesign$", "")); }
    Collections.sort(ids);
    EngineConfig cfg = new EngineConfig();
    cfg.setLogConfig(null, Level.SEVERE);
    Platform.startup(cfg);
    IReportEngine engine = ((IReportEngineFactory) Platform.createFactoryObject(IReportEngineFactory.EXTENSION_REPORT_ENGINE_FACTORY)).createReportEngine(cfg);
    int ok = 0, bad = 0;
    for (String id : ids) {
      Path err = dir.resolve(id + ".birt.err"), pdf = dir.resolve(id + ".birt.pdf");
      Files.deleteIfExists(err); Files.deleteIfExists(pdf);
      try {
        Locale loc = Locale.forLanguageTag(Files.readString(dir.resolve(id + ".locale")).trim());
        IReportRunnable design = engine.openReportDesign(dir.resolve(id + ".rptdesign").toString());
        IRunAndRenderTask task = engine.createRunAndRenderTask(design);
        try {
          Map<String, Object> ctx = new HashMap<>();
          ctx.put("JSON", Files.readString(dir.resolve(id + ".json"), StandardCharsets.UTF_8));
          task.setAppContext(ctx);
          task.setLocale(loc);
          task.setTimeZone(com.ibm.icu.util.TimeZone.getTimeZone("UTC"));
          ByteArrayOutputStream out = new ByteArrayOutputStream();
          PDFRenderOption o = new PDFRenderOption();
          o.setOutputFormat("pdf");
          o.setOutputStream(out);
          task.setRenderOption(o);
          task.run();
          if (!task.getErrors().isEmpty()) {
            StringBuilder sb = new StringBuilder();
            for (Object e : task.getErrors()) { for (Throwable c = (Throwable) e; c != null; c = c.getCause()) sb.append(c).append(" <- "); sb.append('\n'); }
            Files.writeString(err, sb.toString());
            bad++;
            continue;
          }
          Files.write(pdf, out.toByteArray());
          // the same content as HTML: the exact formatted strings, which pdftotext cannot read when the PDF font
          // lacks the glyphs (Arabic-Indic digits, Japanese dates)
          IRunAndRenderTask ht = engine.createRunAndRenderTask(design);
          try {
            ht.setAppContext(ctx); ht.setLocale(loc); ht.setTimeZone(com.ibm.icu.util.TimeZone.getTimeZone("UTC"));
            HTMLRenderOption h = new HTMLRenderOption();
            h.setOutputFormat("html"); h.setOutputFileName(dir.resolve(id + ".birt.html").toString()); h.setHtmlPagination(false);
            ht.setRenderOption(h);
            ht.run();
          } finally { ht.close(); }
          ok++;
        } finally { task.close(); }
      } catch (Throwable t) {
        StringWriter sw = new StringWriter(); t.printStackTrace(new PrintWriter(sw));
        Files.writeString(err, sw.toString());
        bad++;
      }
    }
    System.out.println("@@DONE birt ok=" + ok + " failed=" + bad);
    engine.destroy();
    Platform.shutdown();
    System.exit(0);
  }
}
