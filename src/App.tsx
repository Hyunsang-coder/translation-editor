import { useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useProjectStore } from '@/stores/projectStore';
import { useUIStore } from '@/stores/uiStore';

function App(): JSX.Element {
  const { theme } = useUIStore();
  const { initializeProject, startAutoSave, stopAutoSave } = useProjectStore();

  // 테마 적용
  useEffect(() => {
    const root = document.documentElement;

    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', prefersDark);
    } else {
      root.classList.toggle('dark', theme === 'dark');
    }
  }, [theme]);

  // 초기 프로젝트 설정
  useEffect(() => {
    initializeProject();
  }, [initializeProject]);

  // Auto-save (Phase 4.2 안정화: Monaco 단일 문서 편집에서도 주기 저장)
  useEffect(() => {
    startAutoSave();
    return () => stopAutoSave();
  }, [startAutoSave, stopAutoSave]);

  return (
    <div className="min-h-screen bg-editor-bg text-editor-text">
      <MainLayout />
    </div>
  );
}

export default App;

