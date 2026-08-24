import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Circle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import {
  usePromptPresetsStore,
  selectPresets,
  type PromptPresetKind,
} from '@/stores/promptPresetsStore';
import { useUIStore } from '@/stores/uiStore';

interface PromptPresetMenuProps {
  kind: PromptPresetKind;
  /** 현재 입력란 값 (프리셋으로 저장할 대상) */
  currentValue: string;
  /** 프리셋 적용 시 입력란에 채워 넣을 콜백 (기존 setter를 그대로 전달) */
  onApply: (content: string) => void;
  /** 입력란 비우기 (지우기) */
  onClear: () => void;
}

/**
 * 입력란(규칙/컨텍스트) 헤더에 붙는 단일 프리셋 컨트롤.
 *
 * 헤더에는 칩 하나만 노출한다:
 *   - 적용된 프리셋 없음 → "프리셋 ▾"
 *   - 적용됨           → "● 이름 ▾"
 *   - 적용 후 수정됨    → "○ 이름 ▾"
 *
 * 모든 액션(적용 / 새로 저장 / 덮어쓰기 / 이름변경 / 삭제 / 지우기)은 드롭다운 안에 모은다.
 * 네이티브 prompt()/confirm()은 Tauri WebView에서 막힐 수 있어 인라인 입력/2단계 클릭으로 대체.
 */
export function PromptPresetMenu({ kind, currentValue, onApply, onClear }: PromptPresetMenuProps): JSX.Element {
  const { t } = useTranslation();
  const addToast = useUIStore((s) => s.addToast);

  const { presets, addPreset, deletePreset, renamePreset, updatePresetContent } =
    usePromptPresetsStore(
      useShallow((s) => ({
        presets: selectPresets(s, kind),
        addPreset: s.addPreset,
        deletePreset: s.deletePreset,
        renamePreset: s.renamePreset,
        updatePresetContent: s.updatePresetContent,
      })),
    );

  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [appliedId, setAppliedId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const appliedPreset = appliedId ? presets.find((p) => p.id === appliedId) ?? null : null;
  useEffect(() => {
    if (appliedId && !appliedPreset) setAppliedId(null);
  }, [appliedId, appliedPreset]);

  // 적용된 프리셋 내용과 입력란이 달라졌는지(=수정됨)
  const isDirty = appliedPreset ? currentValue.trim() !== appliedPreset.content : false;

  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    }
    // click(버블) 대신 mousedown 사용 — 저장/입력 버튼 클릭이 리렌더로 사라지며
    // 후속 click이 컨테이너 바깥으로 오인되는 경합을 피한다.
    document.addEventListener('mousedown', onDocPointerDown);
    return () => document.removeEventListener('mousedown', onDocPointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (naming) nameInputRef.current?.focus();
  }, [naming]);
  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);

  function close(): void {
    setOpen(false);
    setNaming(false);
    setEditingId(null);
    setPendingDeleteId(null);
  }

  const commitSave = (): void => {
    if (!nameInput.trim()) {
      addToast({ type: 'warning', message: t('settings.presetNameRequired') });
      return;
    }
    let id: string | null;
    try {
      id = addPreset(kind, nameInput, currentValue);
    } catch (err) {
      // addPreset / persist 저장 중 예외(ID 생성 실패, localStorage 쓰기 실패 등)
      console.error('[PromptPreset] save failed:', err);
      addToast({ type: 'error', message: t('settings.presetSaveError') });
      return;
    }
    if (id) {
      addToast({ type: 'success', message: t('settings.presetSaved') });
      setAppliedId(id);
      setNaming(false);
      setNameInput('');
    } else {
      // content가 비어 addPreset이 거부한 경우
      addToast({ type: 'warning', message: t('settings.presetSaveEmptyValue') });
    }
  };

  const overwriteApplied = (): void => {
    if (!appliedPreset) return;
    updatePresetContent(kind, appliedPreset.id, currentValue);
    addToast({ type: 'success', message: t('settings.presetOverwritten', { name: appliedPreset.name }) });
    close();
  };

  const handleApply = (id: string, name: string, content: string): void => {
    onApply(content);
    setAppliedId(id);
    addToast({ type: 'success', message: t('settings.presetApplied', { name }) });
    close();
  };

  const startRename = (id: string, current: string): void => {
    setEditingId(id);
    setEditName(current);
    setPendingDeleteId(null);
  };
  const commitRename = (id: string): void => {
    if (editName.trim()) renamePreset(kind, id, editName);
    setEditingId(null);
    setEditName('');
  };

  const handleDelete = (id: string): void => {
    if (pendingDeleteId === id) {
      deletePreset(kind, id);
      setPendingDeleteId(null);
    } else {
      setPendingDeleteId(id);
      setEditingId(null);
    }
  };

  const startNaming = (): void => {
    if (!currentValue.trim()) {
      addToast({ type: 'warning', message: t('settings.presetSaveEmptyValue') });
      return;
    }
    setNameInput('');
    setNaming(true);
  };

  // ── 헤더 칩 라벨 ── (점: 적용됨=채움, 수정됨=외곽선)
  const chipLabel = appliedPreset ? appliedPreset.name : t('settings.presetMenu');
  const chipDot = appliedPreset
    ? <Circle size={7} className="shrink-0" fill={isDirty ? 'none' : 'currentColor'} />
    : null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className={`flex max-w-[10rem] items-center gap-1 text-xs ${
          appliedPreset ? 'text-editor-text' : 'text-editor-muted'
        } hover:text-primary-600`}
        onClick={() => {
          setOpen((v) => !v);
          setPendingDeleteId(null);
          setEditingId(null);
          setNaming(false);
        }}
        aria-expanded={open}
        data-testid={`preset-menu-toggle-${kind}`}
        title={appliedPreset?.content}
      >
        {chipDot}<span className="truncate">{chipLabel}</span>
        <ChevronDown size={12} className="shrink-0" />
      </button>

      {/* 메뉴 폭은 설정 패널 최소 너비에 맞춘다 — SIDEBAR_MIN(280) - p-4 양쪽(32) - 스크롤바 여유.
          이보다 넓으면 패널의 overflow-y-auto가 가로로도 잘라 메뉴 왼쪽이 잘린다. */}
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-56 overflow-hidden rounded-md border border-editor-border bg-editor-surface shadow-lg">
          {/* 프리셋 목록 */}
          <div className="max-h-56 overflow-y-auto scrollbar-thin py-1">
            {presets.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-editor-muted">
                {t('settings.presetEmpty')}
              </div>
            ) : (
              <ul>
                {presets.map((p) => (
                  <li
                    key={p.id}
                    className="group/item flex items-center justify-between gap-2 px-2 py-1.5 hover:bg-editor-bg"
                  >
                    {editingId === p.id ? (
                      <>
                        <input
                          ref={editInputRef}
                          type="text"
                          className="flex-1 min-w-0 text-xs px-2 py-1 rounded border border-editor-border bg-editor-surface text-editor-text focus:outline-none focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename(p.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                        />
                        <span className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            className="text-[11px] text-primary-500 hover:text-primary-600 disabled:opacity-40"
                            onClick={() => commitRename(p.id)}
                            disabled={!editName.trim()}
                          >
                            {t('common.save')}
                          </button>
                          <button
                            type="button"
                            className="text-[11px] text-editor-muted hover:text-editor-text"
                            onClick={() => setEditingId(null)}
                          >
                            {t('common.cancel')}
                          </button>
                        </span>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs text-editor-text hover:text-primary-600"
                          onClick={() => handleApply(p.id, p.name, p.content)}
                          title={p.content}
                          data-testid={`preset-apply-${kind}`}
                        >
                          <span className="w-3 shrink-0 text-primary-500">
                            {appliedId === p.id ? '✓' : ''}
                          </span>
                          <span className="truncate">{p.name}</span>
                        </button>
                        <span className="flex shrink-0 items-center gap-1.5 opacity-0 group-hover/item:opacity-100 focus-within:opacity-100">
                          <button
                            type="button"
                            className="text-[11px] text-editor-muted hover:text-editor-text"
                            onClick={() => startRename(p.id, p.name)}
                            title={t('common.edit')}
                            data-testid={`preset-rename-${kind}`}
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            className={
                              pendingDeleteId === p.id
                                ? 'text-[11px] text-severity-critical font-semibold'
                                : 'text-[11px] text-editor-muted hover:text-severity-critical'
                            }
                            onClick={() => handleDelete(p.id)}
                            title={
                              pendingDeleteId === p.id
                                ? t('settings.presetDeleteConfirm')
                                : t('common.delete')
                            }
                            data-testid={`preset-delete-${kind}`}
                          >
                            {pendingDeleteId === p.id ? t('common.confirm') : '🗑'}
                          </button>
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 액션 영역 */}
          <div className="border-t border-editor-hairline py-1">
            {naming ? (
              <div className="flex items-center gap-1 px-2 py-1">
                <input
                  ref={nameInputRef}
                  type="text"
                  className="flex-1 min-w-0 text-xs px-2 py-1 rounded border border-editor-border bg-editor-surface text-editor-text focus:outline-none focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitSave();
                    if (e.key === 'Escape') setNaming(false);
                  }}
                  placeholder={t('settings.presetNamePlaceholder')}
                />
                <button
                  type="button"
                  className="text-[11px] text-primary-500 hover:text-primary-600 disabled:opacity-40"
                  onClick={commitSave}
                  disabled={!nameInput.trim()}
                >
                  {t('common.save')}
                </button>
                <button
                  type="button"
                  className="text-[11px] text-editor-muted hover:text-editor-text"
                  onClick={() => setNaming(false)}
                >
                  {t('common.cancel')}
                </button>
              </div>
            ) : (
              <>
                {appliedPreset && isDirty && (
                  <button
                    type="button"
                    className="block w-full px-3 py-1.5 text-left text-xs text-editor-text hover:bg-editor-bg"
                    onClick={overwriteApplied}
                    data-testid={`preset-overwrite-${kind}`}
                  >
                    ↻ {t('settings.presetOverwriteNamed', { name: appliedPreset.name })}
                  </button>
                )}
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-xs text-editor-text hover:bg-editor-bg disabled:opacity-40"
                  onClick={startNaming}
                  data-testid={`preset-save-${kind}`}
                >
                  ＋ {t('settings.presetSaveAsNew')}
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-xs text-editor-muted hover:bg-editor-bg hover:text-severity-critical"
                  onClick={() => {
                    onClear();
                    setAppliedId(null);
                    close();
                  }}
                >
                  ✕ {t('settings.presetClearField')}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
