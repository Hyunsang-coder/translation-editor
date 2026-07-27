/** 채팅 에이전트 실행의 관측 계약 (chat.ts에서 re-export하여 기존 import 경로 유지) */

/** 이번 요청에서 실제 소비된 토큰 사용량 (provider usage_metadata 집계) */
export interface UsageInfo {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /**
   * usage를 보고한 모델 실행 횟수.
   * 도구 루프는 매 스텝마다 전체 프롬프트를 다시 보내므로, inputTokens를 이 값으로
   * 나눠야 "프롬프트 1회 크기"가 나온다.
   */
  modelCalls?: number;
  /** 캐시에서 읽은 입력 토큰 (~0.1× 과금). prompt caching 실효 검증용. */
  cacheReadInputTokens?: number;
  /** 캐시에 새로 기록한 입력 토큰 (1.25× 과금). */
  cacheCreationInputTokens?: number;
  /**
   * 마지막 모델 호출 1회의 입력 토큰 (uncached+read+write 포함, 누적 아님).
   * inputTokens는 루프 전 스텝 합산(청구 관점)이라 context window 점유율의
   * 분자로 쓰면 부풀려진다 — 점유율 계산은 이 값을 쓸 것.
   */
  lastInputTokens?: number;
}

export interface StreamCallbacks {
  onToken?: (fullText: string, delta: string) => void;
  onToolsUsed?: (toolNames: string[]) => void;
  onToolCall?: (event: {
    phase: 'start' | 'end';
    toolName: string;
    args?: Record<string, unknown>;
    status?: 'success' | 'error';
    result?: string;
  }) => void;
  /** 모델 실행(생각) 시작 시 호출 */
  onModelRun?: (step: number) => void;
  /** 도구 루프 종료 후 집계된 토큰 사용량 전달 */
  onUsage?: (usage: UsageInfo) => void;
}
