import type { ViewerOptions, ViewerHandle } from '@reportwright/viewer';
import type { DesignerOptions, DesignerHandle } from '@reportwright/viewer/designer';

/** Register <reportwright-viewer> and <reportwright-designer>. Use them with CUSTOM_ELEMENTS_SCHEMA. */
export function defineReportWrightElements(): void;

export interface ReportWrightViewerElement extends HTMLElement { options: ViewerOptions }
export interface ReportWrightDesignerElement extends HTMLElement { options: DesignerOptions }
export interface ReportWrightReadyEvent<H> extends CustomEvent<H> {}
export type { ViewerHandle, DesignerHandle };
/** @deprecated renamed defineReportWrightElements */ export function definePagewrightElements(): void;
/** @deprecated renamed ReportWrightViewerElement */ export type PagewrightViewerElement = ReportWrightViewerElement;
/** @deprecated renamed ReportWrightDesignerElement */ export type PagewrightDesignerElement = ReportWrightDesignerElement;
/** @deprecated renamed ReportWrightReadyEvent */ export type PagewrightReadyEvent<H> = ReportWrightReadyEvent<H>;

declare global {
  interface HTMLElementTagNameMap {
    'reportwright-viewer': ReportWrightViewerElement;
    'reportwright-designer': ReportWrightDesignerElement;
    /** @deprecated use reportwright-viewer */ 'pagewright-viewer': ReportWrightViewerElement;
    /** @deprecated use reportwright-designer */ 'pagewright-designer': ReportWrightDesignerElement;
  }
}
