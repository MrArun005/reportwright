import type { ViewerOptions, ViewerHandle } from '@pagewright/viewer';
import type { DesignerOptions, DesignerHandle } from '@pagewright/viewer/designer';

/** Register <pagewright-viewer> and <pagewright-designer>. Use them with CUSTOM_ELEMENTS_SCHEMA. */
export function definePagewrightElements(): void;

export interface PagewrightViewerElement extends HTMLElement { options: ViewerOptions }
export interface PagewrightDesignerElement extends HTMLElement { options: DesignerOptions }
export interface PagewrightReadyEvent<H> extends CustomEvent<H> {}
export type { ViewerHandle, DesignerHandle };

declare global {
  interface HTMLElementTagNameMap {
    'pagewright-viewer': PagewrightViewerElement;
    'pagewright-designer': PagewrightDesignerElement;
  }
}
