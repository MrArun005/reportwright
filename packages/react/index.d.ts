import type { CSSProperties, ReactElement } from 'react';
import type { ViewerOptions, ViewerHandle } from '@reportwright/viewer';
import type { DesignerOptions, DesignerHandle } from '@reportwright/viewer/designer';

interface Common { className?: string; style?: CSSProperties }
export interface ReportWrightViewerProps extends ViewerOptions, Common { onReady?: (handle: ViewerHandle) => void; /** the viewer did not load (its element shows the message) */ onError?: (error: unknown) => void }
export interface ReportWrightDesignerProps extends DesignerOptions, Common { onReady?: (handle: DesignerHandle) => void; onError?: (error: unknown) => void }

export function ReportWrightViewer(props: ReportWrightViewerProps): ReactElement;
export function ReportWrightDesigner(props: ReportWrightDesignerProps): ReactElement;

/** @deprecated renamed ReportWrightViewerProps */ export type PagewrightViewerProps = ReportWrightViewerProps;
/** @deprecated renamed ReportWrightDesignerProps */ export type PagewrightDesignerProps = ReportWrightDesignerProps;
/** @deprecated renamed ReportWrightViewer */ export declare const PagewrightViewer: typeof ReportWrightViewer;
/** @deprecated renamed ReportWrightDesigner */ export declare const PagewrightDesigner: typeof ReportWrightDesigner;
