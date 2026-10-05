import type { DefineComponent } from 'vue';
import type { ViewerOptions } from '@pagewrightjs/viewer';
import type { DesignerOptions } from '@pagewrightjs/viewer/designer';

export const PagewrightViewer: DefineComponent<{ options: ViewerOptions }>;
export const PagewrightDesigner: DefineComponent<{ options: DesignerOptions }>;
