import { useEffect, useState } from 'react';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { MODEL_PRESETS, type AiProvider } from '@/ai/config';

interface AppSettingsModalProps {
  onClose: () => void;
}

export function AppSettingsModal({ onClose }: AppSettingsModalProps): JSX.Element {
  const { provider, translationModel, chatModel, setProvider, setTranslationModel, setChatModel } = useAiConfigStore();

  // 커스텀 입력 모드 상태 (드롭다운에 없는 값이면 커스텀 모드)
  const isCustomTranslation = !MODEL_PRESETS[provider === 'mock' ? 'openai' : provider]?.some(p => p.value === translationModel);
  const isCustomChat = !MODEL_PRESETS[provider === 'mock' ? 'openai' : provider]?.some(p => p.value === chatModel);

  // 모달 외부 클릭 시 닫기
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  // ESC 키로 닫기
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  // Provider 변경 시 모델 목록이 달라지므로, 적절한 기본값으로 재설정
  const handleProviderChange = (newProvider: AiProvider) => {
    setProvider(newProvider);
    
    // Mock은 모델 설정 불필요하거나 OpenAI 프리셋 따름
    const targetPresets = newProvider === 'mock' ? MODEL_PRESETS.openai : MODEL_PRESETS[newProvider];
    
    // 현재 모델이 새 프리셋에 없으면 첫 번째 프리셋으로 변경
    if (targetPresets && targetPresets.length > 0) {
        // 번역 모델 리셋
        setTranslationModel(targetPresets[0].value);
        // 채팅 모델 리셋 (보통 haiku/mini 같은 경량 모델이 두 번째에 위치)
        setChatModel(targetPresets[1]?.value ?? targetPresets[0].value);
    }
  };

  const renderModelSelector = (
    label: string, 
    currentModel: string, 
    setModel: (m: string) => void,
    isCustom: boolean
  ) => {
    const presets = provider === 'mock' ? MODEL_PRESETS.openai : MODEL_PRESETS[provider];
    if (!presets) return null;

    return (
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-editor-text">{label}</label>
        <div className="flex flex-col gap-2">
            {/* 드롭다운 */}
            <select
                className="w-full h-9 px-2 text-sm rounded bg-editor-bg border border-editor-border text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500"
                value={isCustom ? 'custom' : currentModel}
                onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'custom') {
                        // 커스텀 모드로 진입 시 모델명은 유지하되 입력창 포커스 유도 가능
                        // 여기서는 상태만 변경됨
                        // 실제 모델값 변경은 안 함 (기존 값 유지 or 빈 값)
                    } else {
                        setModel(val);
                    }
                }}
            >
                {presets.map(p => (
                    <option key={p.value} value={p.value}>
                        {p.label} - {p.description}
                    </option>
                ))}
                <option value="custom">Custom Input...</option>
            </select>

            {/* 커스텀 입력창 (isCustom일 때만 표시하거나, 항상 표시하되 비활성화?) 
                -> 드롭다운이 'custom'일 때만 활성화되는 인풋이 직관적
            */}
            {isCustom && (
                <input
                    type="text"
                    className="w-full h-9 px-3 text-sm rounded bg-editor-bg border border-editor-border text-editor-text focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder-editor-muted"
                    placeholder="Enter model name (e.g. gpt-5.2)"
                    value={currentModel}
                    onChange={(e) => setModel(e.target.value)}
                    autoFocus
                />
            )}
        </div>
      </div>
    );
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={handleOverlayClick}
    >
      <div className="w-full max-w-lg max-h-[85vh] flex flex-col bg-editor-surface border border-editor-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="h-14 px-5 flex items-center justify-between border-b border-editor-border bg-editor-bg shrink-0">
          <h2 className="text-lg font-bold text-editor-text">App Settings</h2>
          <button 
            onClick={onClose}
            className="p-2 rounded-md hover:bg-editor-border text-editor-muted hover:text-editor-text transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-8">
            
            {/* 1. AI Provider & Models */}
            <section className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-editor-border/50">
                    <span className="text-lg">🤖</span>
                    <h3 className="font-semibold text-editor-text">AI Provider & Models</h3>
                </div>

                {/* Provider Selection (Radio Group) */}
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-editor-muted uppercase tracking-wider">Provider</label>
                    <div className="flex items-center gap-4">
                        {(['openai', 'anthropic', 'mock'] as AiProvider[]).map((p) => (
                            <label key={p} className="flex items-center gap-2 cursor-pointer group">
                                <input 
                                    type="radio" 
                                    name="provider" 
                                    value={p} 
                                    checked={provider === p}
                                    onChange={() => handleProviderChange(p)}
                                    className="accent-primary-500 w-4 h-4 cursor-pointer"
                                />
                                <span className={`text-sm font-medium transition-colors ${provider === p ? 'text-editor-text' : 'text-editor-muted group-hover:text-editor-text'}`}>
                                    {p === 'openai' ? 'OpenAI' : p === 'anthropic' ? 'Anthropic' : 'Mock'}
                                </span>
                            </label>
                        ))}
                    </div>
                </div>

                {/* Model Selection */}
                {provider !== 'mock' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                        {renderModelSelector(
                            "Translation Model", 
                            translationModel, 
                            setTranslationModel,
                            isCustomTranslation
                        )}
                        {renderModelSelector(
                            "Chat Model", 
                            chatModel, 
                            setChatModel,
                            isCustomChat
                        )}
                    </div>
                )}
                {provider === 'mock' && (
                     <div className="text-sm text-editor-muted bg-editor-bg/50 p-3 rounded border border-editor-border border-dashed">
                        Mock Provider is selected. Using dummy responses for testing.
                     </div>
                )}
            </section>

            {/* 2. API Keys (Placeholder) */}
            <section className="space-y-3 opacity-60">
                <div className="flex items-center gap-2 pb-2 border-b border-editor-border/50">
                    <span className="text-lg">🔑</span>
                    <h3 className="font-semibold text-editor-text">API Keys</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-editor-border text-editor-muted">Coming soon</span>
                </div>
                <div className="p-4 bg-editor-bg rounded border border-editor-border border-dashed text-center text-sm text-editor-muted">
                    API Key management will be available here. <br/>
                    Currently using .env.local configuration.
                </div>
            </section>

             {/* 3. Integrations (Placeholder) */}
             <section className="space-y-3 opacity-60">
                <div className="flex items-center gap-2 pb-2 border-b border-editor-border/50">
                    <span className="text-lg">🔌</span>
                    <h3 className="font-semibold text-editor-text">Integrations</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-editor-border text-editor-muted">Coming soon</span>
                </div>
                <div className="text-sm text-editor-muted pl-1">
                    Manage external tools like Google Drive, Atlassian, etc.
                </div>
            </section>

            {/* 4. Help & Info (Placeholder) */}
            <section className="space-y-3 opacity-60">
                <div className="flex items-center gap-2 pb-2 border-b border-editor-border/50">
                    <span className="text-lg">ℹ️</span>
                    <h3 className="font-semibold text-editor-text">Help & Info</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-editor-border text-editor-muted">Coming soon</span>
                </div>
                <div className="text-sm text-editor-muted pl-1">
                    Version: 0.1.0-alpha <br/>
                    Tutorials and FAQ will be added soon.
                </div>
            </section>

        </div>
        
        {/* Footer */}
        <div className="h-12 px-5 flex items-center justify-end bg-editor-bg border-t border-editor-border shrink-0">
             <span className="text-xs text-editor-muted mr-auto">Changes are saved automatically.</span>
             <button 
                onClick={onClose}
                className="px-4 py-1.5 rounded-md bg-editor-surface border border-editor-border hover:bg-editor-border text-sm font-medium transition-colors"
            >
                Close
            </button>
        </div>
      </div>
    </div>
  );
}

