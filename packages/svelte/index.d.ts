import type { ViewerOptions, ViewerHandle } from '@pagewright/viewer';
import type { DesignerOptions, DesignerHandle } from '@pagewright/viewer/designer';

/** Same shape as Svelte's Action (no svelte import needed). */
export interface PagewrightAction<O> {
  (node: HTMLElement, options: O): { update?: (options: O) => void; destroy?: () => void };
}
export const pagewrightViewer: PagewrightAction<ViewerOptions & { onReady?: (handle: ViewerHandle) => void }>;
export const pagewrightDesigner: PagewrightAction<DesignerOptions & { onReady?: (handle: DesignerHandle) => void }>;
