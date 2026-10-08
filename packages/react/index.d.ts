import type { CSSProperties, ForwardRefExoticComponent, ReactElement, RefAttributes } from 'react';
import type { ViewerOptions, ViewerHandle } from '@reportwright/viewer';
import type { DesignerOptions, DesignerHandle } from '@reportwright/viewer/designer';

interface Common { className?: string; style?: CSSProperties }
/** onReady gets the handle (the ref gets it too); the viewer's own onReady(error) is not passed through this wrapper */
export interface ReportWrightViewerProps extends Omit<ViewerOptions, 'onReady'>, Common { onReady?: (handle: ViewerHandle) => void; /** the viewer did not load (its element shows the message) */ onError?: (error: unknown) => void }
export interface ReportWrightDesignerProps extends DesignerOptions, Common { onReady?: (handle: DesignerHandle) => void; onError?: (error: unknown) => void }

/** A ref gets the ViewerHandle once the viewer is mounted (null after it unmounts). */
export const ReportWrightViewer: ForwardRefExoticComponent<ReportWrightViewerProps & RefAttributes<ViewerHandle>>;
export function ReportWrightDesigner(props: ReportWrightDesignerProps): ReactElement;

/** @deprecated renamed ReportWrightViewerProps */ export type PagewrightViewerProps = ReportWrightViewerProps;
/** @deprecated renamed ReportWrightDesignerProps */ export type PagewrightDesignerProps = ReportWrightDesignerProps;
/** @deprecated renamed ReportWrightViewer */ export declare const PagewrightViewer: typeof ReportWrightViewer;
/** @deprecated renamed ReportWrightDesigner */ export declare const PagewrightDesigner: typeof ReportWrightDesigner;
