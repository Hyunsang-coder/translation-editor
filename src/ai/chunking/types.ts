/**
 * 청크 분할 번역을 위한 타입 정의
 *
 * 복잡한 서식 문서(중첩 리스트 등)의 번역 성능 개선을 위해
 * 문서를 논리적 단위로 분할하여 순차 번역 후 병합합니다.
 */

// TipTap 노드 타입 정의
export type TipTapNodeType =
  | 'doc'
  | 'paragraph'
  | 'heading'
  | 'bulletList'
  | 'orderedList'
  | 'listItem'
  | 'blockquote'
  | 'codeBlock'
  | 'horizontalRule'
  | 'hardBreak'
  | 'text';

/**
 * TipTap 노드 구조
 */
export interface TipTapNode {
  type: TipTapNodeType | string;
  content?: TipTapNode[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{
    type: string;
    attrs?: Record<string, unknown>;
  }>;
}

/**
 * TipTap 문서 JSON 구조
 * Record<string, unknown>과 호환성을 위해 인덱스 시그니처 추가
 */
export type TipTapDocJson = Record<string, unknown> & {
  type: 'doc';
  content: TipTapNode[];
};

/**
 * 청크 분할 경계점 정보
 */
export interface ChunkBoundary {
  nodeIndex: number;
  nodeType: string;
  priority: number;  // 낮을수록 좋은 분할점 (1: 최적, 5: 비권장)
  estimatedTokens: number;
}

/**
 * 번역 청크 상태
 */
export type TranslationChunkStatus =
  | 'pending'      // 대기 중
  | 'translating'  // 번역 중
  | 'success'      // 성공
  | 'error';       // 실패

/**
 * 번역 청크 단위
 */
export interface TranslationChunk {
  index: number;
  nodes: TipTapNode[];
  estimatedTokens: number;
  status: TranslationChunkStatus;
  result?: TipTapDocJson;
  error?: string;
}

/**
 * Markdown 기반 청크 (중간 형식)
 */
export interface MarkdownChunk {
  index: number;
  markdown: string;
  estimatedTokens: number;
}

/**
 * 청크 분할 번역 상태
 */
export interface ChunkedTranslationState {
  /** 청킹 활성화 여부 (작은 문서는 단일 호출) */
  isChunked: boolean;
  /** 분할된 청크 목록 */
  chunks: TranslationChunk[];
  /** 진행률 */
  progress: {
    completed: number;
    total: number;
    currentChunkIndex: number;
  };
  /** 병합된 최종 결과 */
  mergedResult?: TipTapDocJson;
}

/**
 * 청크 분할 설정
 */
export interface ChunkConfig {
  /** 최소 청크 크기 (토큰) - 이보다 작으면 청킹하지 않음 */
  minChunkTokens: number;
  /** 최대 청크 크기 (토큰) - 안전 마진 포함 */
  maxChunkTokens: number;
  /** 목표 청크 크기 (토큰) - 이상적인 청크 크기 */
  targetChunkTokens: number;
  /** 청크당 시스템 프롬프트 오버헤드 (토큰) */
  overheadPerChunk: number;
  /** 번역 시 텍스트 확장 계수 (한글→영어 등) */
  expansionFactor: number;
}

/**
 * 기본 청크 설정
 */
export const DEFAULT_CHUNK_CONFIG: ChunkConfig = {
  minChunkTokens: 1000,
  maxChunkTokens: 16384,
  targetChunkTokens: 8192,
  overheadPerChunk: 500,
  expansionFactor: 1.3,
};

/**
 * 청킹 임계값: 이 토큰 수 미만은 단일 호출 유지
 * - 3000 토큰 (약 600-800 단어)으로 낮춤
 * - 리스트/중첩 구조가 많으면 복잡도 보정으로 더 낮아질 수 있음
 */
export const CHUNKING_THRESHOLD = 3000;

/**
 * 복잡도 기반 청킹 임계값 보정 계수
 * - 리스트/중첩 구조가 많을수록 임계값을 낮춤
 */
export const COMPLEXITY_MULTIPLIER = {
  /** 리스트 항목당 복잡도 가중치 (토큰) */
  listItemWeight: 80,
  /** 중첩 레벨당 복잡도 가중치 (토큰) */
  nestingLevelWeight: 150,
  /** 복잡도 보정 최대값 (토큰) */
  maxComplexityPenalty: 2500,
};

/**
 * 분할 우선순위 (낮을수록 좋은 분할점)
 */
export const SPLIT_PRIORITY: Record<string, number> = {
  heading: 1,          // H1-H6: 섹션 경계 (최적)
  horizontalRule: 1,   // --- : 명시적 구분 (최적)
  blockquote: 2,       // 인용문 경계
  bulletList: 3,       // 리스트 경계 (내부 분할 금지)
  orderedList: 3,      // 리스트 경계 (내부 분할 금지)
  codeBlock: 3,        // 코드 블록 경계
  paragraph: 4,        // 문단 단위
  listItem: 5,         // 리스트 항목 (비권장 - 컨텍스트 손실)
};

/**
 * 분할 금지 노드 타입 (내부 분할 금지)
 */
export const NO_SPLIT_TYPES: Set<string> = new Set([
  'bulletList',
  'orderedList',
  'blockquote',
  'codeBlock',
]);

/**
 * 번역 진행률 콜백 타입
 */
export type TranslationProgressCallback = (progress: {
  completed: number;
  total: number;
  currentChunkIndex: number;
  status: TranslationChunkStatus;
}) => void;

/**
 * 청크 번역 결과
 */
export interface ChunkTranslationResult {
  success: boolean;
  doc?: TipTapDocJson;
  raw?: string;
  error?: string;
  chunkIndex: number;
  isPartialSuccess?: boolean;
}

/**
 * 청크 분할 번역 최종 결과
 */
export interface ChunkedTranslationResult {
  success: boolean;
  doc?: TipTapDocJson;
  raw?: string;
  error?: string;
  /** 청킹 사용 여부 */
  wasChunked: boolean;
  /** 청크 수 */
  totalChunks: number;
  /** 성공한 청크 수 */
  successfulChunks: number;
  /** 실패한 청크 인덱스 목록 */
  failedChunkIndices: number[];
}
