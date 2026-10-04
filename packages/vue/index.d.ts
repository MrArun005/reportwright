import type { DefineComponent } from 'vue';
import type { ViewerOptions } from '@pagewright/viewer';
import type { DesignerOptions } from '@pagewright/viewer/designer';

export const PagewrightViewer: DefineComponent<{ options: ViewerOptions }>;
export const PagewrightDesigner: DefineComponent<{ options: DesignerOptions }>;
