/**
 * chatStore 순수 헬퍼 함수 (상태 의존성 없음)
 */
import { restoreGhostChips, type GhostMaskSession } from '@/utils/ghostMask';

// Ghost 토큰 형태: ⟦ITE_GHOST:<uuid>:<idx>⟧ (약 55자). 여유를 둔 상한.
const GHOST_TOKEN_MAX_LEN = 96;
const GHOST_TOKEN_OPEN = '⟦';
const GHOST_TOKEN_CLOSE = '⟧';
// 스트림 연속성 검증용 suffix 길이 (도구 호출 스텝 전환 등으로 누적 텍스트가 리셋되는 경우 감지).
// suffix window만 비교하므로, 재시작 텍스트가 같은 길이로 이 window를 우연히 재현하면서
// 앞부분만 다르면 리셋을 놓쳐 스트리밍 버블이 일시적으로 깨진다(finalize가 전체 재계산으로
// 교정하는 표시 글리치, 데이터 손실 없음). window를 넉넉히(128) 잡아 우연 충돌 확률을 낮춘다.
// O(L) 전체 prefix 비교는 incremental 복원의 목적(토큰당 O(1))을 해치므로 하지 않는다.
const CONTINUITY_CHECK_LEN = 128;

/**
 * 스트리밍 onToken(full)마다 전체 텍스트를 다시 복원하면 O(L^2)이 되므로,
 * 이미 복원이 확정된 prefix는 캐시하고 "미완성 ghost 토큰 가능 구간"만 보류하는
 * 증분 복원기를 생성합니다. (P3: 토큰마다 restoreGhostChips(full) 재처리 방지)
 *
 * - 마지막 여는 괄호(⟦)가 닫히지 않았고 토큰 최대 길이 이내면 해당 구간의 복원을 보류합니다.
 * - 누적 텍스트가 줄어들거나 연속성이 깨지면(도구 호출 스텝 재시작 등) 전체를 재계산합니다.
 */
export function createIncrementalGhostRestorer(
  session: GhostMaskSession,
): (fullMaskedText: string) => string {
  let committedRawLength = 0;
  let committedRawSuffix = '';
  let restoredPrefix = '';

  return (fullMaskedText: string): string => {
    // 스트림 재시작(도구 호출 스텝 전환, 이미지 fallback 등) 감지 시 전체 재계산
    const suffixStart = Math.max(0, committedRawLength - committedRawSuffix.length);
    if (
      fullMaskedText.length < committedRawLength ||
      (committedRawLength > 0 &&
        fullMaskedText.slice(suffixStart, committedRawLength) !== committedRawSuffix)
    ) {
      committedRawLength = 0;
      committedRawSuffix = '';
      restoredPrefix = '';
    }

    const tail = fullMaskedText.slice(committedRawLength);
    const lastOpen = tail.lastIndexOf(GHOST_TOKEN_OPEN);

    let safeLength: number;
    if (lastOpen === -1) {
      safeLength = tail.length;
    } else if (tail.indexOf(GHOST_TOKEN_CLOSE, lastOpen) !== -1) {
      // 마지막 여는 괄호가 닫혔으므로 미완성 토큰 없음
      safeLength = tail.length;
    } else if (tail.length - lastOpen > GHOST_TOKEN_MAX_LEN) {
      // ghost 토큰이라기엔 너무 긴 미닫힘 괄호: 일반 텍스트로 간주
      safeLength = tail.length;
    } else {
      // 미완성 ghost 토큰 후보: 닫힐 때까지 복원 보류
      safeLength = lastOpen;
    }

    if (safeLength > 0) {
      restoredPrefix += restoreGhostChips(tail.slice(0, safeLength), session);
      committedRawLength += safeLength;
      committedRawSuffix = fullMaskedText.slice(
        Math.max(0, committedRawLength - CONTINUITY_CHECK_LEN),
        committedRawLength,
      );
    }

    return restoredPrefix + fullMaskedText.slice(committedRawLength);
  };
}

export function tryExtractWebSearchQuery(raw: string): string | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  // 명시적 트리거(Non-Intrusive): 사용자가 /web 또는 웹검색: 형태로 입력했을 때만 실행
  const slash = t.match(/^\/(web|search)\s+([\s\S]+)$/i);
  if (slash?.[2]) return slash[2].trim();
  const colon = t.match(/^(웹검색|웹 검색|web)\s*:\s*([\s\S]+)$/i);
  if (colon?.[2]) return colon[2].trim();
  return null;
}

export function extractTextFromAiMessage(ai: unknown): string {
  const content = (ai as { content?: unknown })?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c;
        if (c && typeof c === 'object' && 'text' in c) {
          const text = (c as { text?: unknown }).text;
          return String(text ?? '');
        }
        return '';
      })
      .join('');
  }
  return content ? String(content) : '';
}


/** Legacy translatorPersona → translationRules 흡수 (hydrate 마이그레이션용) */
export function mergePersonaIntoRules(
  persona: string | undefined | null,
  rules: string | undefined | null,
): string {
  const p = (persona ?? '').trim();
  const r = (rules ?? '').trim();
  if (!p) return r;
  if (r.includes(p)) return r;
  return r.length > 0 ? `${p}\n\n${r}` : p;
}

/**
 * Tool call이 누락됐을 때 응답 텍스트로 [Add to Rules] 제안을 추론합니다.
 *
 * 맥락 정보는 승인 기반 Project Memory(`propose_project_memory_change`)로 대체됐으므로
 * 여기서 추론하지 않습니다. Rules는 시스템 프롬프트에 직접 주입되므로 유지합니다.
 */
export function inferSuggestionFromAssistantText(text: string): { suggestedRule: string } | null {
  const t = (text ?? '').trim();
  if (!t) return null;

  // 사용자가 클릭해야 반영되는 버튼 안내 문구가 있을 때만 "보수적으로" suggestion을 추론합니다.
  // (오탐 방지: 단순 설명/대화에는 버튼을 띄우지 않음)
  const ruleTrigger = /(?:원하시면|필요하시면|저장하려면)\s*.*(?:버튼을|\[Add to Rules\]).*번역\s*규칙/i;

  const hasRule = ruleTrigger.test(t) || t.includes('[Add to Rules]');

  if (!hasRule) return null;

  // AI가 붙이는 서두 문구 제거 (예: "프로젝트 컨텍스트 저장 제안을 올려두었습니다:")
  const preamblePatterns = [
    /^(?:프로젝트\s*)?컨텍스트\s*저장\s*제안을?\s*올려\s*두었습니다[:\s]*/i,
    /^번역\s*규칙\s*저장\s*제안을?\s*올려\s*두었습니다[:\s]*/i,
    /^(?:다음|아래)(?:와 같은|의)?\s*(?:번역\s*규칙|컨텍스트|맥락).*?(?:제안합니다|올려두었습니다)[:\s]*/i,
    /^(?:번역\s*규칙|컨텍스트|맥락)\s*제안[:\s]*/i,
  ];

  // 뒷부분 안내 문구 제거 (예: "원하시면 **", "필요하시면...")
  const suffixPatterns = [
    /(?:원하시면|필요하시면|저장하려면|추가하려면)\s*\**\s*$/i,
    /\s*\*+\s*$/,  // 잘린 마크다운 볼드
  ];

  const cleanContent = (raw: string): string => {
    let core = raw.trim();
    for (const pattern of preamblePatterns) {
      core = core.replace(pattern, '').trim();
    }
    for (const pattern of suffixPatterns) {
      core = core.replace(pattern, '').trim();
    }
    // 마크다운 포맷팅 제거 (**, *, `)
    core = core
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .trim();
    // 저장 필드 폭주 방지
    const maxLen = 3000;
    return core.length > maxLen ? `${core.slice(0, maxLen)}...` : core;
  };

  const content = cleanContent(t);
  if (!content) return null;

  return { suggestedRule: content };
}
