import { findGhostChips } from '@/utils/ghostChip';

export interface GhostMaskSession {
  /**
   * token -> original
   */
  tokenToValue: Record<string, string>;
  /**
   * original -> token
   */
  valueToToken: Map<string, string>;
}

function makeToken(sessionId: string, idx: number): string {
  // 사람이 입력할 가능성이 낮고, 모델이 “의미 있는 텍스트”로 바꾸지 않게 안전한 토큰 형태
  return `⟦ITE_GHOST:${sessionId}:${idx}⟧`;
}

export function createGhostMaskSession(): GhostMaskSession {
  return {
    tokenToValue: {},
    valueToToken: new Map<string, string>(),
    // sessionId는 token 생성 시에만 사용하므로 클로저로 숨깁니다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as GhostMaskSession & { __sessionId?: string };
}

function getSessionId(session: GhostMaskSession): string {
  const anySession = session as GhostMaskSession & { __sessionId?: string };
  if (!anySession.__sessionId) {
    anySession.__sessionId = crypto.randomUUID();
  }
  return anySession.__sessionId;
}

export function maskGhostChips(text: string, session: GhostMaskSession): string {
  const matches = findGhostChips(text);
  if (matches.length === 0) return text;

  const sessionId = getSessionId(session);

  let out = '';
  let last = 0;

  for (const m of matches) {
    const original = m.value;
    let token = session.valueToToken.get(original);
    if (!token) {
      const idx = session.valueToToken.size + 1;
      token = makeToken(sessionId, idx);
      session.valueToToken.set(original, token);
      session.tokenToValue[token] = original;
    }

    out += text.slice(last, m.start);
    out += token;
    last = m.end;
  }

  out += text.slice(last);
  return out;
}

export function restoreGhostChips(text: string, session: GhostMaskSession): string {
  let out = text;
  for (const [token, original] of Object.entries(session.tokenToValue)) {
    if (!token) continue;
    out = out.split(token).join(original);
  }
  return out;
}

export function collectGhostChipSet(text: string): Set<string> {
  const matches = findGhostChips(text);
  return new Set(matches.map((m) => m.value));
}

export function diffMissingGhostChips(required: Set<string>, text: string): string[] {
  const missing: string[] = [];
  for (const v of required) {
    if (!text.includes(v)) missing.push(v);
  }
  return missing;
}


