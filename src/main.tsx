import React from 'react';
import ReactDOM from 'react-dom/client';
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import App from './App';
import './index.css';
import i18n from './i18n/config';
import { useUIStore } from './stores/uiStore';

// Monaco를 CDN(jsDelivr)에서 로드하지 않고, 로컬 npm 패키지(monaco-editor)를 사용하도록 고정합니다.
// - Tauri(WebView) 환경에서 외부 CDN 접근/소스맵 로딩으로 인한 404 노이즈를 제거
loader.config({ monaco });

// Monaco worker 로딩을 Vite의 module worker(?worker)로 고정합니다.
// - Tauri(WebView)에서 `importScripts`(classic worker 전용) 기반 경로(blob)로 떨어지는 경우를 차단
// - vite-plugin-monaco-editor가 주입한 getWorkerUrl보다 getWorker를 우선하도록 override
(self as unknown as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
  getWorker(_moduleId: string, _label: string) {
    return new EditorWorker();
  },
};

// i18n 언어 설정 로드 (uiStore에서 저장된 언어 설정 사용)
const savedLanguage = useUIStore.getState().language;
if (savedLanguage) {
  i18n.changeLanguage(savedLanguage);
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

