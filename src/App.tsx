import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MainLayout } from '@/components/layout/MainLayout';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { useProjectStore, flushPendingEditorSyncs } from '@/stores/projectStore';
import { useUIStore } from '@/stores/uiStore';
import { useShallow } from 'zustand/shallow';
import { mcpClientManager } from '@/ai/mcp/McpClientManager';
import { initializeSecrets } from '@/tauri/secrets';
import { isTauriRuntime } from '@/tauri/invoke';
import { loadProject as tauriLoadProject } from '@/tauri/project';
import { setViewChatMenuChecked } from '@/tauri/menu';
import { initializeConnectors } from '@/stores/connectorStore';
import { cleanupTempImages } from '@/tauri/attachments';
import { useAutoUpdate } from '@/hooks/useAutoUpdate';
import { UpdateModal } from '@/components/ui/UpdateModal';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { AppSettingsModal } from '@/components/settings/AppSettingsModal';
import { useChatStore } from '@/stores/chatStore';
import { flushDebouncedFields } from '@/components/ui/DebouncedTextarea';
import { isChatPanel } from '@/types';
import { useHistoryStore } from '@/stores/historyStore';
import { DesktopTranslationPreviewHost } from '@/components/editor/DesktopTranslationPreviewHost';
import { initializeOddEyesAppBridge } from '@/desktop/oddeyesAppBridge';

function App(): JSX.Element {
  const { t } = useTranslation();
  const theme = useUIStore((s) => s.theme);
  const addToast = useUIStore((s) => s.addToast);
  const { leftSidebar, rightSidebar } = useUIStore(useShallow((s) => ({
    leftSidebar: s.leftSidebar,
    rightSidebar: s.rightSidebar,
  })));
  const { initializeProject, startAutoSave, stopAutoSave } = useProjectStore(
    useShallow((s) => ({ initializeProject: s.initializeProject, startAutoSave: s.startAutoSave, stopAutoSave: s.stopAutoSave }))
  );
  const loadSecureKeys = useAiConfigStore((s) => s.loadSecureKeys);
  const { startAutoSnapshotWatch, stopAutoSnapshotWatch, loadHistory } = useHistoryStore(
    useShallow((s) => ({ startAutoSnapshotWatch: s.startAutoSnapshotWatch, stopAutoSnapshotWatch: s.stopAutoSnapshotWatch, loadHistory: s.loadHistory }))
  );
  const projectId = useProjectStore((s) => s.project?.id ?? null);

  // 자동 업데이트
  const {
    available,
    downloading,
    progress,
    error,
    update,
    downloadAndInstall,
    cancelDownload,
    skipVersion,
    dismissUpdate,
    setManualUpdate,
    checkForUpdate,
  } = useAutoUpdate();
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showAppSettingsModal, setShowAppSettingsModal] = useState(false);
  const isViewChatOn = (
    (!leftSidebar.hidden && leftSidebar.activePanel !== null && isChatPanel(leftSidebar.activePanel))
    || (!rightSidebar.hidden && rightSidebar.activePanel !== null && isChatPanel(rightSidebar.activePanel))
  );

  useEffect(() => {
    if (available && update) {
      setShowUpdateModal(true);
    }
  }, [available, update]);

  // 설정 모달에서 수동 업데이트 확인 시 custom event 수신
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        setManualUpdate(detail);
        setShowUpdateModal(true);
      }
    };
    window.addEventListener('app:update-found', handler);
    return () => window.removeEventListener('app:update-found', handler);
  }, [setManualUpdate]);

  // 메뉴바 이벤트 핸들러 (Rust에서 window.eval → CustomEvent 방식)
  useEffect(() => {
    const handler = async (e: Event) => {
      const menuId = (e as CustomEvent<string>).detail;
      switch (menuId) {
        case 'app-settings':
          setShowAppSettingsModal(true);
          break;
        case 'check-updates': {
          const { update: u, error: err, skipped } = await checkForUpdate();
          if (u) {
            setShowUpdateModal(true);
          } else if (err) {
            addToast({ type: 'error', message: t('update.checkFailed', '업데이트 확인에 실패했습니다.') });
          } else if (skipped) {
            addToast({ type: 'info', message: t('update.skipped', '이 버전은 건너뜀 처리되어 있습니다.') });
          } else {
            addToast({ type: 'success', message: t('update.upToDate', '최신 버전입니다.') });
          }
          break;
        }
        case 'file-export':
          window.dispatchEvent(new Event('app:open-export-modal'));
          break;
        case 'file-copy-translation': {
          // 직접 클립보드 복사 (target only, html format)
          const copyExport = async () => {
            const { sourceDocJson, targetDocJson, project } = useProjectStore.getState();
            if (!project || !targetDocJson) {
              addToast({ type: 'warning', message: t('export.noDocument') });
              return;
            }
            try {
              const { copyToClipboard } = await import('@/utils/exportDocument');
              await copyToClipboard(
                { sourceJson: sourceDocJson, targetJson: targetDocJson },
                {
                  contentMode: 'target',
                  bilingualLayout: 'sequential',
                  format: 'html',
                  includeReview: false,
                  projectTitle: project.metadata.title,
                },
              );
              addToast({ type: 'success', message: t('export.copied') });
            } catch {
              addToast({ type: 'error', message: t('export.error') });
            }
          };
          void copyExport();
          break;
        }
        case 'view-toggle-project':
          useUIStore.getState().toggleProjectSidebar();
          break;
        case 'view-toggle-settings':
          useUIStore.getState().toggleSettingsPanel();
          break;
        case 'view-toggle-review':
          useUIStore.getState().toggleReviewPanel();
          break;
        case 'view-toggle-chat':
          useUIStore.getState().toggleChatVisibility();
          break;
      }
    };
    window.addEventListener('tauri-menu', handler);
    return () => window.removeEventListener('tauri-menu', handler);
  }, [checkForUpdate, addToast, t]);

  // MCP bridge: reload project when external tool modifies it in SQLite
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const unlisten = listen<{ projectId: string }>('oddeyes://project-changed', async (event) => {
      const currentId = useProjectStore.getState().project?.id;
      if (event.payload?.projectId && event.payload.projectId === currentId) {
        try {
          const fresh = await tauriLoadProject(event.payload.projectId);
          useProjectStore.getState().loadProject(fresh);
        } catch (err) {
          console.warn('[App] Failed to reload project after MCP change:', err);
        }
      }
    });
    return () => { void unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void setViewChatMenuChecked(isViewChatOn).catch((error) => {
      console.warn('[App] Failed to sync View > Chat menu state:', error);
    });
  }, [isViewChatOn]);

  // 테마 적용 (system 모드일 때 OS 변경도 실시간 반영)
  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      if (theme === 'system') {
        root.classList.toggle('dark', mediaQuery.matches);
      } else {
        root.classList.toggle('dark', theme === 'dark');
      }
    };

    applyTheme();

    if (theme === 'system') {
      mediaQuery.addEventListener('change', applyTheme);
    }

    return () => {
      mediaQuery.removeEventListener('change', applyTheme);
    };
  }, [theme]);

  // 초기 프로젝트 설정
  useEffect(() => {
    void initializeProject();
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

  useEffect(() => {
    initializeOddEyesAppBridge();
  }, []);

  // 임시 파일 정리 (24시간 이상 된 임시 이미지 삭제)
  useEffect(() => {
    cleanupTempImages()
      .then((count) => {
        if (count > 0) {
          console.warn(`[App] Cleaned up ${count} old temp images`);
        }
      })
      .catch((error) => {
        console.warn('[App] Failed to cleanup temp images:', error);
      });
  }, []);

  // Auto-save (Phase 4.2 안정화: Monaco 단일 문서 편집에서도 주기 저장)
  useEffect(() => {
    startAutoSave();
    return () => stopAutoSave();
  }, [startAutoSave, stopAutoSave]);

  // Auto-snapshot: 에디터 변경 후 3초 idle 시 자동 히스토리 스냅샷
  useEffect(() => {
    startAutoSnapshotWatch();
    return () => stopAutoSnapshotWatch();
  }, [startAutoSnapshotWatch, stopAutoSnapshotWatch]);

  // latestBlocksHash 초기화: 프로젝트 전환/로드 시 loadHistory로 hash 캐시를 채워
  // auto snapshot이 히스토리 드로어 오픈 없이도 정상 작동하도록 함
  useEffect(() => {
    void loadHistory(projectId ?? '');
  }, [projectId, loadHistory]);

  // Safe Exit: 저장되지 않은 변경사항이 있으면 저장하고 종료
  useEffect(() => {
    const initCloseListener = async () => {
      const appWindow = getCurrentWindow();
      let allowClose = false;
      const unlisten = await appWindow.onCloseRequested(async (event) => {
        if (allowClose) return;
        // 비동기 flush/저장이 끝나기 전에 창이 닫히지 않도록 우선 종료 보류
        event.preventDefault();

        // C3: 채팅(CHAT_PERSIST_DEBOUNCE_MS)/설정(DebouncedTextarea) debounce 대기분 flush.
        // 종료 직전 ~1.5초 내 변경이 유실되지 않도록 타이머를 취소하고 즉시 저장한다.
        try {
          flushDebouncedFields(); // 설정 필드 pending 값 → chatStore로 동기 커밋
          await useChatStore.getState().flushPersist(); // persist 타이머 취소 + 즉시 저장
        } catch (e) {
          // flush 실패가 종료를 막지는 않음 (best-effort)
          console.warn('[App] Failed to flush chat/settings state on close:', e);
        }

        // P1: TipTap 편집은 250ms 디바운스로 store에 반영된다. 종료 직전
        // 디바운스 창(≤250ms) 안의 마지막 편집이 isDirty 판정에서 누락되지 않도록
        // pending 동기화를 먼저 flush한다.
        flushPendingEditorSyncs();

        const { isDirty, saveProject } = useProjectStore.getState();
        if (isDirty) {
          try {
            await saveProject();
          } catch (e) {
            console.error('Failed to save on close:', e);
            const message = e instanceof Error ? e.message : 'Failed to save project before exit';
            useProjectStore.getState().setError(`저장 실패로 종료가 취소되었습니다: ${message}`);
            return; // 저장 실패 시 종료 취소 (기존 동작 유지)
          }
        }

        allowClose = true;
        await appWindow.close();
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

      {showAppSettingsModal && (
        <AppSettingsModal onClose={() => setShowAppSettingsModal(false)} />
      )}

      <DesktopTranslationPreviewHost />

      <UpdateModal
        isOpen={showUpdateModal}
        version={update?.version ?? ''}
        releaseNotes={update?.body ?? undefined}
        downloading={downloading}
        progress={progress}
        error={error}
        onUpdate={downloadAndInstall}
        onCancel={cancelDownload}
        onSkipVersion={() => {
          if (update?.version) {
            skipVersion(update.version);
          }
          setShowUpdateModal(false);
        }}
        onDismiss={() => {
          dismissUpdate();
          setShowUpdateModal(false);
        }}
      />
    </div>
  );
}

export default App;
