import type { CSSProperties, ReactElement } from 'react';
import type { ViewerOptions, ViewerHandle } from '@pagewrightjs/viewer';
import type { DesignerOptions, DesignerHandle } from '@pagewrightjs/viewer/designer';

interface Common { className?: string; style?: CSSProperties }
export interface PagewrightViewerProps extends ViewerOptions, Common { onReady?: (handle: ViewerHandle) => void; /** the viewer did not load (its element shows the message) */ onError?: (error: unknown) => void }
export interface PagewrightDesignerProps extends DesignerOptions, Common { onReady?: (handle: DesignerHandle) => void; onError?: (error: unknown) => void }

export function PagewrightViewer(props: PagewrightViewerProps): ReactElement;
export function PagewrightDesigner(props: PagewrightDesignerProps): ReactElement;
