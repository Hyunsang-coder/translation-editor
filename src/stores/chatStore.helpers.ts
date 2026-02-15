/**
 * chatStore 순수 헬퍼 함수 (상태 의존성 없음)
 */

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


export function inferSuggestionFromAssistantText(text: string): { suggestedRule?: string; suggestedContext?: string; suggestedPersona?: string } | null {
  const t = (text ?? '').trim();
  if (!t) return null;

  // 사용자가 클릭해야 반영되는 버튼 안내 문구가 있을 때만 "보수적으로" suggestion을 추론합니다.
  // (오탐 방지: 단순 설명/대화에는 버튼을 띄우지 않음)
  // 패턴 확장: [Add to Rules], [Add to Context], [Add to Persona] 같은 명시적 버튼 멘트도 허용
  const ruleTrigger = /(?:원하시면|필요하시면|저장하려면)\s*.*(?:버튼을|\[Add to Rules\]).*번역\s*규칙/i;
  const contextTrigger = /(?:원하시면|필요하시면|저장하려면)\s*.*(?:버튼을|\[Add to Context\]).*(?:project\s*context|컨텍스트|맥락)/i;
  const personaTrigger = /(?:원하시면|필요하시면|저장하려면)\s*.*(?:버튼을|\[Add to Persona\]).*(?:persona|페르소나)/i;

  const hasRule = ruleTrigger.test(t) || t.includes('[Add to Rules]');
  const hasContext = contextTrigger.test(t) || t.includes('[Add to Context]');
  const hasPersona = personaTrigger.test(t) || t.includes('[Add to Persona]');

  if (!hasRule && !hasContext && !hasPersona) return null;

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

  const result: { suggestedRule?: string; suggestedContext?: string; suggestedPersona?: string } = {};
  if (hasRule) result.suggestedRule = content;
  if (hasContext) result.suggestedContext = content;
  if (hasPersona) result.suggestedPersona = content;

  return result;
}
