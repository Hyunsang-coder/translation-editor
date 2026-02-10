import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/noto-sans-kr/300.css';
import '@fontsource/noto-sans-kr/400.css';
import '@fontsource/noto-sans-kr/500.css';
import '@fontsource/noto-sans-kr/600.css';
import '@fontsource/noto-sans-kr/700.css';
import App from './App';
import './index.css';
import i18n from './i18n/config';
import { useUIStore } from './stores/uiStore';

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

