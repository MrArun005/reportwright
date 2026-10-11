// JasperReports' showcase: a crosstab (rows x columns with totals), compiled from crosstab.jrxml at run time.
import java.util.*;
import net.sf.jasperreports.engine.*;
import net.sf.jasperreports.engine.data.JRMapCollectionDataSource;

public class Crosstab {
    public static void main(String[] a) throws Exception {
        List<Map<String, ?>> rows = new ArrayList<>();
        for (int i = 0; i < 5000; i++) {
            Map<String, Object> m = new HashMap<>();
            m.put("region", String.format("Region %02d", i % 12 + 1));
            m.put("quarter", "Q" + (i * 7 % 4 + 1));
            m.put("amount", (double) ((i * 37) % 1000) / 10 + 5);
            rows.add(m);
        }
        JasperReport r = JasperCompileManager.compileReport(Crosstab.class.getResourceAsStream("/crosstab.jrxml"));
        JasperPrint p = JasperFillManager.fillReport(r, new HashMap<>(), new JRMapCollectionDataSource(rows));
        JasperExportManager.exportReportToPdfFile(p, a[0]);
    }
}
