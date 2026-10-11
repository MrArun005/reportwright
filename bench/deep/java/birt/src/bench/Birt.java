package bench;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.logging.Level;

import org.eclipse.birt.core.framework.Platform;
import org.eclipse.birt.report.engine.api.*;
import org.eclipse.birt.report.engine.api.script.IUpdatableDataSetRow;
import org.eclipse.birt.report.engine.api.script.eventadapter.ScriptedDataSetEventAdapter;
import org.eclipse.birt.report.engine.api.script.instance.IDataSetInstance;

import static bench.Frame.*;

/**
 * Eclipse BIRT: the grouped ledger from resources/ledger.rptdesign (the jasper report's layout: the table header repeats
 * on every page, the Region group has a header and a footer with COUNT and SUM aggregations, the table footer holds the
 * grand total, "Page N of M" is page-number and total-page auto-text in the master page). The engine starts and the
 * design is opened in setup (outside the clock), as an application does once; the clock covers run + PDF render.
 * Rows come through a scripted data set whose event handler is Java ({@link Rows}), as Jasper's JRDataSource.
 * The PDF emitter gets the fixture fonts through a font config whose font-paths is the fixtures' font folder.
 */
public final class Birt {
  public static void main(String[] args) { Frame.main(args, Map.of("birt", B::new)); }

  static List<Row> rows = List.of();

  /** the data set's event handler (eventHandlerClass in the design) */
  public static final class Rows extends ScriptedDataSetEventAdapter {
    int i;
    @Override public void open(IDataSetInstance ds) { i = 0; }
    @Override public boolean fetch(IDataSetInstance ds, IUpdatableDataSetRow row) {
      if (i >= rows.size()) return false;
      Row r = rows.get(i++);
      try {
        row.setColumnValue("id", r.id()); row.setColumnValue("account", r.account()); row.setColumnValue("region", r.region());
        row.setColumnValue("type", r.type()); row.setColumnValue("date", r.date()); row.setColumnValue("amount", r.amount());
        row.setColumnValue("reference", r.reference());
      } catch (Exception e) { throw new RuntimeException(e); }
      return true;
    }
  }

  static final class B extends Lib {
    IReportEngine engine;
    IReportRunnable design;

    /** the runtime jar is named org.eclipse.birt.runtime_<version>-<build>.jar */
    public String version() {
      String jar = Paths.get(IReportEngine.class.getProtectionDomain().getCodeSource().getLocation().getPath()).getFileName().toString();
      return jar.replaceAll("^org\\.eclipse\\.birt\\.runtime_|\\.jar$", "");
    }

    @Override @SuppressWarnings("unchecked")
    public void setup(String job, Map<String, Object> ctx) throws Exception {
      rows = (List<Row>) ctx.get("rows");
      Path fc = Files.createTempFile("birt-fonts", ".xml");
      Files.writeString(fc, "<?xml version=\"1.0\" encoding=\"UTF-8\"?><font><font-paths><path path=\"" + new File(font("r")).getParent() + "\"/></font-paths></font>");
      EngineConfig cfg = new EngineConfig();
      cfg.setLogConfig(null, Level.WARNING);
      cfg.setFontConfig(fc.toUri().toURL());
      Platform.startup(cfg);
      engine = ((IReportEngineFactory) Platform.createFactoryObject(IReportEngineFactory.EXTENSION_REPORT_ENGINE_FACTORY)).createReportEngine(cfg);
      try (InputStream in = Birt.class.getResourceAsStream("/ledger.rptdesign")) { design = engine.openReportDesign(in); }
    }

    @Override
    public String report(Map<String, Object> c, String out) throws Exception {
      IRunAndRenderTask t = engine.createRunAndRenderTask(design);
      t.setAppContext(new HashMap<>(Map.of(EngineConstants.APPCONTEXT_CLASSLOADER_KEY, Birt.class.getClassLoader())));
      t.setLocale(Locale.US);
      PDFRenderOption o = new PDFRenderOption();
      o.setOutputFormat("pdf");
      o.setOutputFileName(out);
      t.setRenderOption(o);
      t.run();
      List<?> errors = t.getErrors(); // BIRT reports most failures here instead of throwing
      t.close();
      if (!errors.isEmpty()) throw new IllegalStateException("BIRT: " + errors);
      return null;
    }
  }
}
