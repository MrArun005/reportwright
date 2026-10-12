import type { ViewerOptions, ViewerHandle } from '@reportwright/viewer';
import type { DesignerOptions, DesignerHandle } from '@reportwright/viewer/designer';

/** Register <reportwright-viewer> and <reportwright-designer>. Use them with CUSTOM_ELEMENTS_SCHEMA. */
export function defineReportWrightElements(): void;

export interface ReportWrightViewerElement extends HTMLElement { options: ViewerOptions }
export interface ReportWrightDesignerElement extends HTMLElement { options: DesignerOptions }
export interface ReportWrightReadyEvent<H> extends CustomEvent<H> {}
export type { ViewerHandle, DesignerHandle };

declare global {
  interface HTMLElementTagNameMap {
    'reportwright-viewer': ReportWrightViewerElement;
    'reportwright-designer': ReportWrightDesignerElement;
  }
}
