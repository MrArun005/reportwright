package bench;

import java.awt.GraphicsEnvironment;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

import net.sf.jasperreports.engine.*;

import static bench.Frame.*;

/**
 * JasperReports: the grouped ledger from resources/ledger.jrxml (its column header repeats on every page, the Region
 * group has a header and a footer with Count and Sum variables, the summary band holds the grand total, "Page N of M"
 * is a PAGE_NUMBER text field evaluated at report time). The jrxml is compiled in setup (outside the clock), as an
 * application compiles it once; the clock covers fill + PDF export. Rows come through a JRDataSource over the list.
 */
public final class Jasper {
  public static void main(String[] args) { Frame.main(args, Map.of("jasperreports", J::new)); }

  static final class J extends Lib {
    JasperReport report;
    public String version() { return mavenVersion("net.sf.jasperreports", "jasperreports"); }

    @Override public void setup(String job, Map<String, Object> ctx) throws Exception {
      var ge = GraphicsEnvironment.getLocalGraphicsEnvironment(); // the same Inter files, for Jasper's AWT text measuring
      for (String k : List.of("r", "b")) ge.registerFont(java.awt.Font.createFont(java.awt.Font.TRUETYPE_FONT, new File(font(k))));
      var ctxJ = DefaultJasperReportsContext.getInstance();
      ctxJ.setProperty("net.sf.jasperreports.compiler.java", "net.sf.jasperreports.engine.design.JRJavacCompiler");
      String jrxml;
      try (InputStream in = Jasper.class.getResourceAsStream("/ledger.jrxml")) { jrxml = new String(in.readAllBytes(), StandardCharsets.UTF_8); }
      jrxml = jrxml.replace("@FONTS@", new File(font("r")).getParent());
      report = JasperCompileManager.compileReport(new ByteArrayInputStream(jrxml.getBytes(StandardCharsets.UTF_8)));
    }

    @Override @SuppressWarnings("unchecked")
    public String report(Map<String, Object> c, String out) throws Exception {
      List<Row> rows = (List<Row>) c.get("rows");
      JRDataSource ds = new JRDataSource() {
        int i = -1;
        public boolean next() { return ++i < rows.size(); }
        public Object getFieldValue(JRField f) {
          Row r = rows.get(i);
          return switch (f.getName()) {
            case "id" -> r.id(); case "account" -> r.account(); case "region" -> r.region(); case "type" -> r.type();
            case "date" -> r.date(); case "amount" -> r.amount(); default -> r.reference();
          };
        }
      };
      JasperPrint print = JasperFillManager.fillReport(report, new HashMap<>(), ds);
      JasperExportManager.exportReportToPdfFile(print, out);
      return print.getPages().size() + " pages";
    }
  }
}
