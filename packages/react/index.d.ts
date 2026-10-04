import type { CSSProperties, ReactElement } from 'react';
import type { ViewerOptions, ViewerHandle } from '@pagewright/viewer';
import type { DesignerOptions, DesignerHandle } from '@pagewright/viewer/designer';

interface Common { className?: string; style?: CSSProperties }
export interface PagewrightViewerProps extends ViewerOptions, Common { onReady?: (handle: ViewerHandle) => void }
export interface PagewrightDesignerProps extends DesignerOptions, Common { onReady?: (handle: DesignerHandle) => void }

export function PagewrightViewer(props: PagewrightViewerProps): ReactElement;
export function PagewrightDesigner(props: PagewrightDesignerProps): ReactElement;
