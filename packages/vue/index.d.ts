import type { DefineComponent } from 'vue';
import type { ViewerOptions } from '@reportwright/viewer';
import type { DesignerOptions } from '@reportwright/viewer/designer';

export const ReportWrightViewer: DefineComponent<{ options: ViewerOptions }>;
export const ReportWrightDesigner: DefineComponent<{ options: DesignerOptions }>;

/** @deprecated renamed ReportWrightViewer */ export const PagewrightViewer: typeof ReportWrightViewer;
/** @deprecated renamed ReportWrightDesigner */ export const PagewrightDesigner: typeof ReportWrightDesigner;
