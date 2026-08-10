/**
 * 앱 전역 스타일 상수 — UI 일관성 규칙의 단일 소스.
 *
 * 컨트롤 높이 사다리 (6단):
 *   22px  비인터랙티브 배지·칩·카운트
 *   26px  밀집 인디케이터 (줌 표시)
 *   30px  패널 내부 컴팩트 컨트롤 (좁은 사이드바 안의 입력·버튼)
 *   34px  표준 인터랙티브 컨트롤 (툴바 버튼, 워크플로 버튼, 셀렉트, 탭, 검색 필드)
 *   40px  모달 내부 서브헤더, 플로팅 패널 타이틀바
 *   48px  모달 최상단 헤더 / 최하단 푸터
 * 28px(h-7)은 사다리에서 제외 — 기존 h-7은 전부 h-[30px]로 올린다.
 */

/** 포커스 링 — 앱 전체에서 이 문자열 하나만 쓴다.
 *  focus:는 마우스 클릭에도 반응하므로 focus-visible:만 쓴다.
 *  ring은 레이아웃 밖으로 번지므로 outline을 쓴다. */
export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2';

/** 누름 상태 — 클릭 가능한 모든 요소에 붙인다. 예외 없음. */
export const PRESS = 'active:scale-95 transition-colors';

/** 섹션 캡션 전용 (11/700/.08em/uppercase) — 컨트롤 라벨·본문에는 금지 */
export const CAPTION =
  'text-[11px] font-bold uppercase tracking-[0.08em] text-editor-muted';

/** 컨트롤 높이 사다리 */
export const H_BADGE = 'h-[22px]';
export const H_INDICATOR = 'h-[26px]';
export const H_COMPACT = 'h-[30px]';
export const H_CONTROL = 'h-[34px]';
export const H_SUBHEADER = 'h-10';
export const H_MODAL_CHROME = 'h-12';

/** 밴드 1 (36px) — 사이드바 탭 바 / 에디터 보기 모드 줄. 세 컬럼이 같은 선을 공유한다. */
export const BAND_1 = 'h-9';
/** 밴드 2 (34px) — 사이드바 캡션 줄 / 에디터 패널 헤더. */
export const BAND_2 = 'h-[34px]';

/** 툴바 3분할 — 좌측 슬롯은 좌측 사이드바(296), 우측 슬롯은 도구 영역(308)과 정렬 */
export const TOOLBAR_LEFT_WIDTH = 296;
export const TOOLBAR_RIGHT_WIDTH = 308;
