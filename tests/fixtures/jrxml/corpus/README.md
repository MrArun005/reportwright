# JasperReports design corpus

Real JasperReports designs (`.jrxml`) from the demo samples of the JasperReports Library, used by
`tests/engine/import-jrxml.test.js`: each one is imported, validated and rendered with sample rows, and the notes are counted
by kind. They are copied unchanged; the file name is the format, the sample folder and the file (`jr6-<sample>-<file>`).

Licence: the JasperReports Library and its samples are published by TIBCO Software (Jaspersoft) under the
[GNU Lesser General Public License, version 3](https://github.com/TIBCOSoftware/jasperreports/blob/master/LICENSE)
(Copyright (C) 2005–2025 TIBCO Software Inc. / Cloud Software Group, Inc. and the JasperReports contributors). The LGPL
permits copying and redistributing them unchanged with this notice; they are test data here, not linked into ReportWright.
Downloaded 2026-10-05.

- `jr6-*`: the JasperReports 6 XML format (`<textField><reportElement …/>`), from the tag
  [`jr-6-10-0`](https://github.com/TIBCOSoftware/jasperreports/tree/jr-6-10-0/jasperreports/demo/samples), path
  `jasperreports/demo/samples/<sample>/reports/<file>`.
- `jr7-*`: the JasperReports 7 format (`<element kind="…">`), from
  [`master`](https://github.com/TIBCOSoftware/jasperreports/tree/master/demo/samples), path `demo/samples/<sample>/reports/<file>`.

| File | Format | Sample |
|---|---|---|
| `jr6-barbecue-BarbecueReport.jrxml` | JR 6 | barbecue/reports/BarbecueReport.jrxml |
| `jr6-book-BookReport.jrxml` | JR 6 | book/reports/BookReport.jrxml |
| `jr6-charts-AreaChartReport.jrxml` | JR 6 | charts/reports/AreaChartReport.jrxml |
| `jr6-charts-BarChartReport.jrxml` | JR 6 | charts/reports/BarChartReport.jrxml |
| `jr6-charts-LineChartReport.jrxml` | JR 6 | charts/reports/LineChartReport.jrxml |
| `jr6-charts-MeterChartReport.jrxml` | JR 6 | charts/reports/MeterChartReport.jrxml |
| `jr6-charts-PieChartReport.jrxml` | JR 6 | charts/reports/PieChartReport.jrxml |
| `jr6-charts-StackedBarChartReport.jrxml` | JR 6 | charts/reports/StackedBarChartReport.jrxml |
| `jr6-charts-TimeSeriesChartReport.jrxml` | JR 6 | charts/reports/TimeSeriesChartReport.jrxml |
| `jr6-charts-XYLineChartReport.jrxml` | JR 6 | charts/reports/XYLineChartReport.jrxml |
| `jr6-crosstabs-ShipmentsReport.jrxml` | JR 6 | crosstabs/reports/ShipmentsReport.jrxml |
| `jr6-csvdatasource-CsvDataSourceReport.jrxml` | JR 6 | csvdatasource/reports/CsvDataSourceReport.jrxml |
| `jr6-datasource-DataSourceReport.jrxml` | JR 6 | datasource/reports/DataSourceReport.jrxml |
| `jr6-fonts-FontsReport.jrxml` | JR 6 | fonts/reports/FontsReport.jrxml |
| `jr6-functions-FunctionsReport.jrxml` | JR 6 | functions/reports/FunctionsReport.jrxml |
| `jr6-groovy-GroovyReport.jrxml` | JR 6 | groovy/reports/GroovyReport.jrxml |
| `jr6-horizontal-HorizontalReport.jrxml` | JR 6 | horizontal/reports/HorizontalReport.jrxml |
| `jr6-hyperlink-HyperlinkReport.jrxml` | JR 6 | hyperlink/reports/HyperlinkReport.jrxml |
| `jr6-i18n-I18nReport.jrxml` | JR 6 | i18n/reports/I18nReport.jrxml |
| `jr6-jasper-FirstJasper.jrxml` | JR 6 | jasper/reports/FirstJasper.jrxml |
| `jr6-landscape-LandscapeReport.jrxml` | JR 6 | landscape/reports/LandscapeReport.jrxml |
| `jr6-list-ListReport.jrxml` | JR 6 | list/reports/ListReport.jrxml |
| `jr6-markup-MarkupReport.jrxml` | JR 6 | markup/reports/MarkupReport.jrxml |
| `jr6-nopagebreak-NoPageBreakReport.jrxml` | JR 6 | nopagebreak/reports/NoPageBreakReport.jrxml |
| `jr6-paragraphs-ParagraphsReport.jrxml` | JR 6 | paragraphs/reports/ParagraphsReport.jrxml |
| `jr6-query-QueryReport.jrxml` | JR 6 | query/reports/QueryReport.jrxml |
| `jr6-rotation-RotationReport.jrxml` | JR 6 | rotation/reports/RotationReport.jrxml |
| `jr6-scriptlet-ScriptletReport.jrxml` | JR 6 | scriptlet/reports/ScriptletReport.jrxml |
| `jr6-shapes-ShapesReport.jrxml` | JR 6 | shapes/reports/ShapesReport.jrxml |
| `jr6-stretch-StretchReport.jrxml` | JR 6 | stretch/reports/StretchReport.jrxml |
| `jr6-subreport-AddressReport.jrxml` | JR 6 | subreport/reports/AddressReport.jrxml |
| `jr6-subreport-MasterReport.jrxml` | JR 6 | subreport/reports/MasterReport.jrxml |
| `jr6-subreport-ProductReport.jrxml` | JR 6 | subreport/reports/ProductReport.jrxml |
| `jr6-table-TableReport.jrxml` | JR 6 | table/reports/TableReport.jrxml |
| `jr6-tableofcontents-TableOfContentsReport.jrxml` | JR 6 | tableofcontents/reports/TableOfContentsReport.jrxml |
| `jr6-tabular-TabularReport.jrxml` | JR 6 | tabular/reports/TabularReport.jrxml |
| `jr6-text-TextReport.jrxml` | JR 6 | text/reports/TextReport.jrxml |
| `jr6-unicode-UnicodeReport.jrxml` | JR 6 | unicode/reports/UnicodeReport.jrxml |
| `jr6-xmldatasource-CustomersReport.jrxml` | JR 6 | xmldatasource/reports/CustomersReport.jrxml |
| `jr7-charts-BarChartReport.jrxml` | JR 7 | charts/reports/BarChartReport.jrxml |
| `jr7-csvdatasource-CsvDataSourceReport.jrxml` | JR 7 | csvdatasource/reports/CsvDataSourceReport.jrxml |
| `jr7-i18n-I18nReport.jrxml` | JR 7 | i18n/reports/I18nReport.jrxml |
| `jr7-jasper-FirstJasper.jrxml` | JR 7 | jasper/reports/FirstJasper.jrxml |
| `jr7-list-ListReport.jrxml` | JR 7 | list/reports/ListReport.jrxml |
| `jr7-query-QueryReport.jrxml` | JR 7 | query/reports/QueryReport.jrxml |
| `jr7-shapes-ShapesReport.jrxml` | JR 7 | shapes/reports/ShapesReport.jrxml |
| `jr7-stretch-StretchReport.jrxml` | JR 7 | stretch/reports/StretchReport.jrxml |
| `jr7-subreport-MasterReport.jrxml` | JR 7 | subreport/reports/MasterReport.jrxml |
| `jr7-tabular-TabularReport.jrxml` | JR 7 | tabular/reports/TabularReport.jrxml |
