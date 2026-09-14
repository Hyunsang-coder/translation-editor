/**
 * 설정 패널의 한 줄 입력란과 "추가" 버튼 규격.
 * 섹션마다 따로 적다 보니 모서리·높이·포커스 표시가 세 갈래로 갈라져 있었다.
 */
export const SETTINGS_INPUT_CLASS =
  'min-w-0 rounded-md border border-editor-border bg-editor-surface px-3 py-1.5 text-xs text-editor-text focus:outline-none focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2';

/** 비활성일 땐 강조색을 쓰지 않는다 — 누를 수 없는 버튼이 패널에서 가장 진한 색이 되던 문제. */
export const SETTINGS_ADD_BUTTON_CLASS =
  'shrink-0 rounded-md border border-transparent bg-primary-fill px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-fill-hover disabled:border-editor-border disabled:bg-transparent disabled:text-editor-muted';
