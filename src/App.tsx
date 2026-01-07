import { useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { useProjectStore } from '@/stores/projectStore';
import { useUIStore } from '@/stores/uiStore';
import { mcpClientManager } from '@/ai/mcp/McpClientManager';
import { initializeSecrets } from '@/tauri/secrets';
import { initializeConnectors } from '@/stores/connectorStore';

function App(): JSX.Element {
  const { theme } = useUIStore();
  const { initializeProject, startAutoSave, stopAutoSave } = useProjectStore();
  const { loadSecureKeys } = useAiConfigStore();

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

  // SecretManager 초기화 및 보안 저장소에서 API 키 로드
  // 앱 시작 시 1회 Keychain 접근으로 마스터키 로드 후 Vault 복호화
  useEffect(() => {
    const initSecrets = async () => {
      try {
        // 1. SecretManager 초기화 (Keychain에서 마스터키 로드)
        await initializeSecrets();
        
        // 2. API 키 로드 (Vault에서 복호화된 캐시 사용)
        await loadSecureKeys();
        
        // 3. 커넥터 상태 동기화 (Vault에서 토큰 상태 확인)
        await initializeConnectors();
      } catch (error) {
        console.error('[App] Failed to initialize secrets:', error);
      }
    };
    
    void initSecrets();
  }, [loadSecureKeys]);

  // MCP 클라이언트 초기화 (저장된 토큰이 있으면 자동 연결)
  useEffect(() => {
    void mcpClientManager.initialize();
  }, []);

  // Auto-save (Phase 4.2 안정화: Monaco 단일 문서 편집에서도 주기 저장)
  useEffect(() => {
    startAutoSave();
    return () => stopAutoSave();
  }, [startAutoSave, stopAutoSave]);

  // Safe Exit: 저장되지 않은 변경사항이 있으면 저장하고 종료
  useEffect(() => {
    const initCloseListener = async () => {
      // Dynamic import to avoid SSR/build issues if any, though standard import is fine
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const unlisten = await getCurrentWindow().onCloseRequested(async (event) => {
        const { isDirty, saveProject } = useProjectStore.getState();
        if (isDirty) {
          // Prevent closing immediately
          event.preventDefault();
          try {
            await saveProject();
          } catch (e) {
            console.error('Failed to save on close:', e);
          } finally {
            // Force close after save attempt
            await getCurrentWindow().destroy();
          }
        }
      });
      return unlisten;
    };

    let cleanup: (() => void) | undefined;
    initCloseListener().then((unlisten) => {
      cleanup = unlisten;
    });

    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  return (
    <div className="min-h-screen bg-editor-bg text-editor-text">
      <MainLayout />
    </div>
  );
}

export default App;
