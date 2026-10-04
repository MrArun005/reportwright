# SSRS report corpus

Real Microsoft SQL Server Reporting Services reports (`.rdl`), used by `tests/engine/rdl.test.js`: each one is imported,
validated and rendered with sample rows, and the notes are counted by kind. They are copied unchanged (file names are prefixed
by source). All are published by Microsoft under the MIT licence, which permits copying and redistribution with the notice:

> Copyright (c) Microsoft Corporation. Permission is hereby granted, free of charge, to any person obtaining a copy of this
> software and associated documentation files (the "Software"), to deal in the Software without restriction, including without
> limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
> permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and
> this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS",
> WITHOUT WARRANTY OF ANY KIND.

Licences: [Reporting-Services](https://github.com/microsoft/Reporting-Services/blob/master/License.md),
[sql-server-samples](https://github.com/microsoft/sql-server-samples/blob/master/license.txt),
[tigertoolbox](https://github.com/microsoft/tigertoolbox/blob/master/LICENSE.md). Downloaded 2026-10-04.

The `epm-PolicyEvaluation*` and `epm-PolicyDetails` reports come from the framework's 3.0 folder: their 4.0 and 5.0 copies in
the repository are cut off. One cut-off copy is kept as `../truncated.rdl` (from `epm-framework/5.0/.../PolicyEvaluationErrors.rdl`)
to test that a damaged file is refused cleanly.

| File | Version | Source | Licence |
|---|---|---|---|
| `epm-PolicyDashboard.rdl` | RDL 2016 | [microsoft/sql-server-samples](https://github.com/microsoft/sql-server-samples/blob/master/samples/features/epm-framework/5.0/2Reporting/PolicyReports/PolicyDashboard.rdl) | MIT (Microsoft SQL Server Sample Code) |
| `epm-PolicyDashboardFiltered.rdl` | RDL 2016 | [microsoft/sql-server-samples](https://github.com/microsoft/sql-server-samples/blob/master/samples/features/epm-framework/5.0/2Reporting/PolicyReports/PolicyDashboardFiltered.rdl) | MIT (Microsoft SQL Server Sample Code) |
| `epm-PolicyDetails.rdl` | RDL 2008 | [microsoft/sql-server-samples](https://github.com/microsoft/sql-server-samples/blob/master/samples/features/epm-framework/3.0/2Reporting/PolicyReports/PolicyReports/PolicyDetails.rdl) | MIT (Microsoft SQL Server Sample Code) |
| `epm-PolicyEvaluationDetails.rdl` | RDL 2008 | [microsoft/sql-server-samples](https://github.com/microsoft/sql-server-samples/blob/master/samples/features/epm-framework/3.0/2Reporting/PolicyReports/PolicyReports/PolicyEvaluationDetails.rdl) | MIT (Microsoft SQL Server Sample Code) |
| `epm-PolicyEvaluationErrorDetails.rdl` | RDL 2008 | [microsoft/sql-server-samples](https://github.com/microsoft/sql-server-samples/blob/master/samples/features/epm-framework/3.0/2Reporting/PolicyReports/PolicyReports/PolicyEvaluationErrorDetails.rdl) | MIT (Microsoft SQL Server Sample Code) |
| `epm-PolicyEvaluationErrors.rdl` | RDL 2008 | [microsoft/sql-server-samples](https://github.com/microsoft/sql-server-samples/blob/master/samples/features/epm-framework/3.0/2Reporting/PolicyReports/PolicyReports/PolicyEvaluationErrors.rdl) | MIT (Microsoft SQL Server Sample Code) |
| `ml-ActiveSessions.rdl` | RDL 2010 | [microsoft/sql-server-samples](https://github.com/microsoft/sql-server-samples/blob/master/samples/features/machine-learning-services/ssms-custom-reports/ML%20Services%20-%20Active%20Sessions.rdl) | MIT (Microsoft SQL Server Sample Code) |
| `ml-Configuration.rdl` | RDL 2010 | [microsoft/sql-server-samples](https://github.com/microsoft/sql-server-samples/blob/master/samples/features/machine-learning-services/ssms-custom-reports/ML%20Services%20-%20Configuration.rdl) | MIT (Microsoft SQL Server Sample Code) |
| `ml-ConfigureInstance.rdl` | RDL 2010 | [microsoft/sql-server-samples](https://github.com/microsoft/sql-server-samples/blob/master/samples/features/machine-learning-services/ssms-custom-reports/ML%20Services%20-%20Configure%20Instance.rdl) | MIT (Microsoft SQL Server Sample Code) |
| `ml-ExecutionStatistics.rdl` | RDL 2010 | [microsoft/sql-server-samples](https://github.com/microsoft/sql-server-samples/blob/master/samples/features/machine-learning-services/ssms-custom-reports/ML%20Services%20-%20Execution%20Statistics.rdl) | MIT (Microsoft SQL Server Sample Code) |
| `ml-ExtendedEvents.rdl` | RDL 2010 | [microsoft/sql-server-samples](https://github.com/microsoft/sql-server-samples/blob/master/samples/features/machine-learning-services/ssms-custom-reports/ML%20Services%20-%20Extended%20Events.rdl) | MIT (Microsoft SQL Server Sample Code) |
| `ml-Packages.rdl` | RDL 2010 | [microsoft/sql-server-samples](https://github.com/microsoft/sql-server-samples/blob/master/samples/features/machine-learning-services/ssms-custom-reports/ML%20Services%20-%20Packages.rdl) | MIT (Microsoft SQL Server Sample Code) |
| `ml-ResourceUsage.rdl` | RDL 2010 | [microsoft/sql-server-samples](https://github.com/microsoft/sql-server-samples/blob/master/samples/features/machine-learning-services/ssms-custom-reports/ML%20Services%20-%20Resource%20Usage.rdl) | MIT (Microsoft SQL Server Sample Code) |
| `ml-Script.rdl` | RDL 2010 | [microsoft/sql-server-samples](https://github.com/microsoft/sql-server-samples/blob/master/samples/features/machine-learning-services/ssms-custom-reports/ML%20Services%20-%20Script.rdl) | MIT (Microsoft SQL Server Sample Code) |
| `rs-CountrySalesPerformance.rdl` | RDL 2016 | [microsoft/Reporting-Services](https://github.com/microsoft/Reporting-Services/blob/master/PaginatedReportSamples/CountrySalesPerformance.rdl) | MIT (Copyright (c) 2016 Microsoft) |
| `rs-Invoice.rdl` | RDL 2016 | [microsoft/Reporting-Services](https://github.com/microsoft/Reporting-Services/blob/master/PaginatedReportSamples/Invoice.rdl) | MIT (Copyright (c) 2016 Microsoft) |
| `rs-Labels.rdl` | RDL 2016 | [microsoft/Reporting-Services](https://github.com/microsoft/Reporting-Services/blob/master/PaginatedReportSamples/Labels.rdl) | MIT (Copyright (c) 2016 Microsoft) |
| `rs-Letter.rdl` | RDL 2016 | [microsoft/Reporting-Services](https://github.com/microsoft/Reporting-Services/blob/master/PaginatedReportSamples/Letter.rdl) | MIT (Copyright (c) 2016 Microsoft) |
| `rs-OrganizationExpenditures.rdl` | RDL 2016 | [microsoft/Reporting-Services](https://github.com/microsoft/Reporting-Services/blob/master/PaginatedReportSamples/OrganizationExpenditures.rdl) | MIT (Copyright (c) 2016 Microsoft) |
| `rs-RegionalSales.rdl` | RDL 2016 | [microsoft/Reporting-Services](https://github.com/microsoft/Reporting-Services/blob/master/PaginatedReportSamples/RegionalSales.rdl) | MIT (Copyright (c) 2016 Microsoft) |
| `rs-Transcript.rdl` | RDL 2016 | [microsoft/Reporting-Services](https://github.com/microsoft/Reporting-Services/blob/master/PaginatedReportSamples/Transcript.rdl) | MIT (Copyright (c) 2016 Microsoft) |
| `telco-churn.rdl` | RDL 2016 | [microsoft/sql-server-samples](https://github.com/microsoft/sql-server-samples/blob/master/samples/features/r-services/telco-customer-churn-v1/ReportBuilder/telcoChurn-reportBuilder.rdl) | MIT (Microsoft SQL Server Sample Code) |
| `tt-Connectivity_Error.rdl` | RDL 2008 | [microsoft/tigertoolbox](https://github.com/microsoft/tigertoolbox/blob/master/systemhealthsession/ssrs-reports/Connectivity_Error.rdl) | MIT (Microsoft SQL Server Sample Code) |
| `tt-Dashboard_Main.rdl` | RDL 2010 | [microsoft/tigertoolbox](https://github.com/microsoft/tigertoolbox/blob/master/systemhealthsession/ssrs-reports/Dashboard_Main.rdl) | MIT (Microsoft SQL Server Sample Code) |
| `tt-Dashboard_MainF.rdl` | RDL 2010 | [microsoft/tigertoolbox](https://github.com/microsoft/tigertoolbox/blob/master/systemhealthsession/ssrs-reports/Dashboard_MainF.rdl) | MIT (Microsoft SQL Server Sample Code) |
| `tt-Error_reported.rdl` | RDL 2008 | [microsoft/tigertoolbox](https://github.com/microsoft/tigertoolbox/blob/master/systemhealthsession/ssrs-reports/Error_reported.rdl) | MIT (Microsoft SQL Server Sample Code) |
| `tt-Health_Summary.rdl` | RDL 2010 | [microsoft/tigertoolbox](https://github.com/microsoft/tigertoolbox/blob/master/systemhealthsession/ssrs-reports/Health_Summary.rdl) | MIT (Microsoft SQL Server Sample Code) |
| `tt-IOSubSystem_MainF.rdl` | RDL 2010 | [microsoft/tigertoolbox](https://github.com/microsoft/tigertoolbox/blob/master/systemhealthsession/ssrs-reports/IOSubSystem_MainF.rdl) | MIT (Microsoft SQL Server Sample Code) |
| `tt-QueryProcessing_MainF.rdl` | RDL 2010 | [microsoft/tigertoolbox](https://github.com/microsoft/tigertoolbox/blob/master/systemhealthsession/ssrs-reports/QueryProcessing_MainF.rdl) | MIT (Microsoft SQL Server Sample Code) |
| `tt-Resource_MainF.rdl` | RDL 2010 | [microsoft/tigertoolbox](https://github.com/microsoft/tigertoolbox/blob/master/systemhealthsession/ssrs-reports/Resource_MainF.rdl) | MIT (Microsoft SQL Server Sample Code) |
| `tt-Security_Error.rdl` | RDL 2008 | [microsoft/tigertoolbox](https://github.com/microsoft/tigertoolbox/blob/master/systemhealthsession/ssrs-reports/Security_Error.rdl) | MIT (Microsoft SQL Server Sample Code) |
| `tt-System_MainF.rdl` | RDL 2010 | [microsoft/tigertoolbox](https://github.com/microsoft/tigertoolbox/blob/master/systemhealthsession/ssrs-reports/System_MainF.rdl) | MIT (Microsoft SQL Server Sample Code) |
