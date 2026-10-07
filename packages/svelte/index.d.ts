import type { ViewerOptions, ViewerHandle } from '@pagewrightjs/viewer';
import type { DesignerOptions, DesignerHandle } from '@pagewrightjs/viewer/designer';

/** Same shape as Svelte's Action (no svelte import needed). */
export interface PagewrightAction<O> {
  (node: HTMLElement, options: O): { update?: (options: O) => void; destroy?: () => void };
}
export const pagewrightViewer: PagewrightAction<ViewerOptions & { onReady?: (handle: ViewerHandle) => void; /** the viewer did not load (its element shows the message) */ onError?: (error: unknown) => void }>;
export const pagewrightDesigner: PagewrightAction<DesignerOptions & { onReady?: (handle: DesignerHandle) => void; onError?: (error: unknown) => void }>;
