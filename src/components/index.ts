/**
 * Components Barrel Export
 */

// Layout
export { MainLayout } from './layout/MainLayout';
export { Toolbar } from './layout/Toolbar';
export { ProjectSidebar } from './layout/ProjectSidebar';

// Panels
export { SourcePanel } from './panels/SourcePanel';
export { TargetPanel } from './panels/TargetPanel';

// Editor (Legacy - Monaco)
export { TranslationBlock } from './editor/TranslationBlock';

// Editor (New - TipTap)
export { TipTapEditor, SourceTipTapEditor, TargetTipTapEditor } from './editor/TipTapEditor';
export { EditorCanvasTipTap } from './editor/EditorCanvasTipTap';

