import type { ViewerOptions, ViewerHandle } from '@pagewrightjs/viewer';
import type { DesignerOptions, DesignerHandle } from '@pagewrightjs/viewer/designer';

/** Same shape as Svelte's Action (no svelte import needed). */
export interface PagewrightAction<O> {
  (node: HTMLElement, options: O): { update?: (options: O) => void; destroy?: () => void };
}
export const pagewrightViewer: PagewrightAction<ViewerOptions & { onReady?: (handle: ViewerHandle) => void }>;
export const pagewrightDesigner: PagewrightAction<DesignerOptions & { onReady?: (handle: DesignerHandle) => void }>;
