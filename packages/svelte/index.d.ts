import type { ViewerOptions, ViewerHandle } from '@reportwright/viewer';
import type { DesignerOptions, DesignerHandle } from '@reportwright/viewer/designer';

/** Same shape as Svelte's Action (no svelte import needed). */
export interface ReportWrightAction<O> {
  (node: HTMLElement, options: O): { update?: (options: O) => void; destroy?: () => void };
}
export const reportWrightViewer: ReportWrightAction<ViewerOptions & { onReady?: (handle: ViewerHandle) => void; /** the viewer did not load (its element shows the message) */ onError?: (error: unknown) => void }>;
export const reportWrightDesigner: ReportWrightAction<DesignerOptions & { onReady?: (handle: DesignerHandle) => void; onError?: (error: unknown) => void }>;

/** @deprecated renamed ReportWrightAction */ export type PagewrightAction<O> = ReportWrightAction<O>;
/** @deprecated renamed reportWrightViewer */ export const pagewrightViewer: typeof reportWrightViewer;
/** @deprecated renamed reportWrightDesigner */ export const pagewrightDesigner: typeof reportWrightDesigner;
