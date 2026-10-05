import type { ViewerOptions, ViewerHandle } from '@pagewrightjs/viewer';
import type { DesignerOptions, DesignerHandle } from '@pagewrightjs/viewer/designer';

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
