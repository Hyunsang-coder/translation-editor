/**
 * 검수 파이프라인 디버그/테스트 패널
 *
 * 기능:
 * 1. 청킹 결과 확인 (AI에게 전달되는 마크다운)
 * 2. AI 응답 원본 확인
 * 3. 파싱된 이슈 목록 확인
 * 4. 각 targetExcerpt의 검색 테스트
 * 5. 검색 실패 원인 분석
 */

import { useState, useMemo } from 'react';
import { useProjectStore } from '@/stores/projectStore';
import { useReviewStore } from '@/stores/reviewStore';
import { useChatStore } from '@/stores/chatStore';
import { buildAlignedChunks, buildReviewPrompt, type AlignedSegment } from '@/ai/tools/reviewTool';
import { runReview } from '@/ai/review/runReview';
import { parseReviewResult } from '@/ai/review/parseReviewResult';
import { normalizeForSearch, buildNormalizedTextWithMapping } from '@/utils/normalizeForSearch';
import { extractTextFromTipTap } from '@/utils/tipTapText';
import type { ReviewIssue } from '@/stores/reviewStore';

/**
 * Source 텍스트의 언어를 감지 (간단한 휴리스틱)
 */
function detectSourceLanguage(segments: AlignedSegment[]): string {
  const sampleText = segments
    .slice(0, 3)
    .map((s) => s.sourceText)
    .join(' ')
    .slice(0, 500);

  if (!sampleText.trim()) return '원문';

  const koreanChars = (sampleText.match(/[\uAC00-\uD7AF\u1100-\u11FF]/g) || []).length;
  const japaneseChars = (sampleText.match(/[\u3040-\u309F\u30A0-\u30FF]/g) || []).length;
  const chineseChars = (sampleText.match(/[\u4E00-\u9FFF]/g) || []).length;
  const latinChars = (sampleText.match(/[a-zA-Z]/g) || []).length;

  const total = koreanChars + japaneseChars + chineseChars + latinChars;
  if (total === 0) return '원문';

  if (koreanChars / total > 0.3) return 'Korean';
  if (japaneseChars / total > 0.3) return 'Japanese';
  if (chineseChars / total > 0.3) return 'Chinese';
  if (latinChars / total > 0.5) return 'English';

  return '원문';
}

interface SearchTestResult {
  issueId: string;
  targetExcerpt: string;
  normalizedExcerpt: string;
  found: boolean;
  editorTextSnippet: string | undefined;
  normalizedEditorSnippet: string | undefined;
  possibleMatch: string | undefined;
  reason: string | undefined;
}

export function ReviewTestPanel(): JSX.Element {
  const project = useProjectStore((s) => s.project);
  const intensity = useReviewStore((s) => s.intensity);
  const translationRules = useChatStore((s) => s.translationRules);

  const [activeTab, setActiveTab] = useState<'chunks' | 'prompt' | 'response' | 'issues' | 'search' | 'editor'>('chunks');
  const [selectedChunkIndex, setSelectedChunkIndex] = useState(0);
  const [aiResponse, setAiResponse] = useState('');
  const [parsedIssues, setParsedIssues] = useState<ReviewIssue[]>([]);
  const [searchResults, setSearchResults] = useState<SearchTestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 청크 계산
  const chunks = useMemo(() => {
    if (!project) return [];
    return buildAlignedChunks(project);
  }, [project]);

  // 현재 선택된 청크
  const currentChunk = chunks[selectedChunkIndex];

  // 시스템 프롬프트
  const systemPrompt = useMemo(() => {
    return buildReviewPrompt(intensity);
  }, [intensity]);

  // 에디터 텍스트 가져오기 (projectStore의 targetDocJson에서 추출)
  const getEditorText = (): string => {
    const { targetDocJson } = useProjectStore.getState();
    return extractTextFromTipTap(targetDocJson);
  };

  // 에디터 원본 텍스트 (디버깅용)
  const [editorRawText, setEditorRawText] = useState('');

  // 검수 실행 (단일 청크)
  const runSingleChunkReview = async () => {
    if (!currentChunk || !project) return;

    setIsRunning(true);
    setError(null);
    setAiResponse('');
    setParsedIssues([]);
    setSearchResults([]);

    try {
      const response = await runReview({
        segments: currentChunk.segments,
        intensity,
        translationRules,
        sourceLanguage: detectSourceLanguage(currentChunk.segments),
        targetLanguage: project.metadata.targetLanguage,
        onToken: (text) => setAiResponse(text),
      });

      setAiResponse(response);

      // 파싱
      const issues = parseReviewResult(response);
      setParsedIssues(issues);

      // 검색 테스트
      const editorText = getEditorText();
      setEditorRawText(editorText);
      const { normalizedText: normalizedEditorText } = buildNormalizedTextWithMapping(editorText);

      console.log('[ReviewTestPanel] editorText length:', editorText.length);
      console.log('[ReviewTestPanel] normalizedEditorText length:', normalizedEditorText.length);
      console.log('[ReviewTestPanel] editorText sample:', editorText.slice(0, 500));

      const results: SearchTestResult[] = issues.map((issue) => {
        const normalizedExcerpt = normalizeForSearch(issue.targetExcerpt);

        // 대소문자 무시 검색
        const foundIndex = normalizedEditorText.toLowerCase().indexOf(normalizedExcerpt.toLowerCase());
        const found = foundIndex !== -1;

        let reason: string | undefined;
        let possibleMatch: string | undefined;

        // 디버깅: 원본 텍스트에서도 검색
        const rawFoundIndex = editorText.toLowerCase().indexOf(issue.targetExcerpt.toLowerCase());

        if (!found && normalizedExcerpt) {
          // 실패 원인 분석
          if (rawFoundIndex !== -1) {
            reason = `원본에서는 발견(${rawFoundIndex}) but 정규화 후 실패 - 정규화 문제`;
            possibleMatch = editorText.slice(rawFoundIndex, rawFoundIndex + issue.targetExcerpt.length + 30);
          } else {
            // 1. 정확한 매칭 시도 (대소문자 구분)
            const exactIndex = normalizedEditorText.indexOf(normalizedExcerpt);
            if (exactIndex !== -1) {
              reason = '대소문자가 다름 (하지만 대소문자 무시 검색으로 찾아야 함 - 버그?)';
            } else {
              // 2. 부분 매칭 시도 (처음 15자)
              const partialSearch = normalizedExcerpt.slice(0, 15).toLowerCase();
              const partialIndex = normalizedEditorText.toLowerCase().indexOf(partialSearch);
              if (partialIndex !== -1) {
                possibleMatch = normalizedEditorText.slice(partialIndex, partialIndex + normalizedExcerpt.length + 30);
                reason = `부분 매칭 "${partialSearch}" 발견 at ${partialIndex}`;
              } else {
                // 3. 원본에서도 부분 매칭
                const rawPartialIndex = editorText.toLowerCase().indexOf(partialSearch);
                if (rawPartialIndex !== -1) {
                  possibleMatch = editorText.slice(rawPartialIndex, rawPartialIndex + issue.targetExcerpt.length + 30);
                  reason = `원본에서 부분 매칭 발견 at ${rawPartialIndex} - 정규화 문제`;
                } else {
                  reason = `에디터에 텍스트 없음 (검색어 첫 15자: "${partialSearch}")`;
                }
              }
            }
          }
        }

        return {
          issueId: issue.id,
          targetExcerpt: issue.targetExcerpt,
          normalizedExcerpt,
          found,
          editorTextSnippet: found ? normalizedEditorText.slice(foundIndex, foundIndex + normalizedExcerpt.length + 20) : undefined,
          normalizedEditorSnippet: undefined,
          possibleMatch,
          reason,
        };
      });

      setSearchResults(results);
      setActiveTab('search');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setIsRunning(false);
    }
  };

  // 검색만 테스트 (기존 이슈로)
  const testSearchOnly = () => {
    const allIssues = useReviewStore.getState().getAllIssues();
    if (allIssues.length === 0) {
      setError('검수 결과가 없습니다. 먼저 검수를 실행하세요.');
      return;
    }

    const editorText = getEditorText();
    const { normalizedText: normalizedEditorText } = buildNormalizedTextWithMapping(editorText);

    const results: SearchTestResult[] = allIssues.map((issue) => {
      const normalizedExcerpt = normalizeForSearch(issue.targetExcerpt);
      const foundIndex = normalizedEditorText.toLowerCase().indexOf(normalizedExcerpt.toLowerCase());
      const found = foundIndex !== -1;

      let reason: string | undefined;
      let possibleMatch: string | undefined;

      if (!found && normalizedExcerpt) {
        const partialSearch = normalizedExcerpt.slice(0, Math.min(10, normalizedExcerpt.length)).toLowerCase();
        const partialIndex = normalizedEditorText.toLowerCase().indexOf(partialSearch);
        if (partialIndex !== -1) {
          possibleMatch = normalizedEditorText.slice(partialIndex, partialIndex + normalizedExcerpt.length + 30);
          reason = `부분 매칭 "${partialSearch}" 발견, 실제: "${possibleMatch.slice(0, 50)}..."`;
        } else {
          reason = '에디터에서 텍스트를 찾을 수 없음';
        }
      }

      return {
        issueId: issue.id,
        targetExcerpt: issue.targetExcerpt,
        normalizedExcerpt,
        found,
        editorTextSnippet: found ? normalizedEditorText.slice(foundIndex, foundIndex + normalizedExcerpt.length + 20) : undefined,
        normalizedEditorSnippet: undefined,
        possibleMatch,
        reason,
      };
    });

    setSearchResults(results);
    setParsedIssues(allIssues);
    setActiveTab('search');
  };

  if (!project) {
    return (
      <div className="p-4 text-editor-muted">
        프로젝트가 없습니다.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-editor-bg text-editor-text text-sm">
      {/* Header */}
      <div className="p-3 border-b border-editor-border bg-editor-surface">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">검수 테스트 패널</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={testSearchOnly}
              className="px-3 py-1 text-xs rounded border border-editor-border hover:bg-editor-bg"
            >
              검색만 테스트
            </button>
            <button
              type="button"
              onClick={runSingleChunkReview}
              disabled={isRunning || !currentChunk}
              className="px-3 py-1 text-xs rounded bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50"
            >
              {isRunning ? '실행 중...' : '청크 검수 실행'}
            </button>
          </div>
        </div>

        {/* 청크 선택 */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-editor-muted">청크:</span>
          <select
            value={selectedChunkIndex}
            onChange={(e) => setSelectedChunkIndex(Number(e.target.value))}
            className="px-2 py-1 rounded border border-editor-border bg-editor-bg text-editor-text"
          >
            {chunks.map((chunk, idx) => (
              <option key={idx} value={idx}>
                #{idx + 1} ({chunk.segments.length}개 세그먼트, {chunk.totalChars}자)
              </option>
            ))}
          </select>
          <span className="text-editor-muted">강도: {intensity}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-editor-border bg-editor-surface">
        {(['chunks', 'prompt', 'response', 'issues', 'search', 'editor'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-primary-500 text-primary-500'
                : 'border-transparent text-editor-muted hover:text-editor-text'
            }`}
          >
            {tab === 'chunks' && '청크 데이터'}
            {tab === 'prompt' && '시스템 프롬프트'}
            {tab === 'response' && 'AI 응답'}
            {tab === 'issues' && `파싱 결과 (${parsedIssues.length})`}
            {tab === 'search' && `검색 테스트 (${searchResults.filter(r => !r.found).length} 실패)`}
            {tab === 'editor' && '에디터 텍스트'}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-500/10 border-b border-red-500/30 text-red-500 text-xs">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {/* 청크 데이터 */}
        {activeTab === 'chunks' && currentChunk && (
          <div className="space-y-4">
            <div className="text-xs text-editor-muted mb-2">
              AI에게 전달되는 세그먼트 데이터 (마크다운 형식)
            </div>
            {currentChunk.segments.map((seg) => (
              <div key={seg.groupId} className="border border-editor-border rounded p-3 space-y-2">
                <div className="text-xs text-editor-muted font-medium">
                  [#{seg.order}] {seg.groupId}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-editor-muted mb-1">Source:</div>
                    <pre className="text-xs bg-editor-surface p-2 rounded overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                      {seg.sourceText || '(empty)'}
                    </pre>
                  </div>
                  <div>
                    <div className="text-xs text-editor-muted mb-1">Target:</div>
                    <pre className="text-xs bg-editor-surface p-2 rounded overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                      {seg.targetText || '(empty)'}
                    </pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 시스템 프롬프트 */}
        {activeTab === 'prompt' && (
          <pre className="text-xs bg-editor-surface p-3 rounded overflow-auto whitespace-pre-wrap">
            {systemPrompt}
          </pre>
        )}

        {/* AI 응답 */}
        {activeTab === 'response' && (
          <div className="space-y-2">
            <div className="text-xs text-editor-muted">
              AI 응답 원본 ({aiResponse.length}자)
            </div>
            <pre className="text-xs bg-editor-surface p-3 rounded overflow-auto whitespace-pre-wrap max-h-[500px]">
              {aiResponse || '(검수를 실행하세요)'}
            </pre>
          </div>
        )}

        {/* 파싱 결과 */}
        {activeTab === 'issues' && (
          <div className="space-y-3">
            {parsedIssues.length === 0 ? (
              <div className="text-editor-muted text-center py-8">
                파싱된 이슈가 없습니다.
              </div>
            ) : (
              parsedIssues.map((issue, idx) => (
                <div key={issue.id} className="border border-editor-border rounded p-3 text-xs space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">#{idx + 1}</span>
                    <span className={`px-1.5 py-0.5 rounded ${
                      issue.type === 'error' ? 'bg-red-500/10 text-red-500' :
                      issue.type === 'omission' ? 'bg-orange-500/10 text-orange-500' :
                      issue.type === 'distortion' ? 'bg-yellow-500/10 text-yellow-500' :
                      'bg-blue-500/10 text-blue-500'
                    }`}>
                      {issue.type}
                    </span>
                    <span className="text-editor-muted">세그먼트 #{issue.segmentOrder}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-editor-muted mb-1">sourceExcerpt:</div>
                      <div className="bg-editor-surface p-2 rounded break-all">{issue.sourceExcerpt || '-'}</div>
                    </div>
                    <div>
                      <div className="text-editor-muted mb-1">targetExcerpt:</div>
                      <div className="bg-editor-surface p-2 rounded break-all">{issue.targetExcerpt || '-'}</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-editor-muted mb-1">suggestedFix:</div>
                    <div className="bg-green-500/10 p-2 rounded break-all">{issue.suggestedFix || '-'}</div>
                  </div>
                  <div>
                    <div className="text-editor-muted mb-1">description:</div>
                    <div className="text-editor-text">{issue.description || '-'}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* 검색 테스트 */}
        {activeTab === 'search' && (
          <div className="space-y-3">
            <div className="text-xs text-editor-muted mb-2">
              각 targetExcerpt가 에디터에서 검색되는지 테스트
            </div>
            {searchResults.length === 0 ? (
              <div className="text-editor-muted text-center py-8">
                검색 결과가 없습니다. "검색만 테스트" 또는 "청크 검수 실행"을 클릭하세요.
              </div>
            ) : (
              searchResults.map((result, resultIdx) => (
                <div
                  key={result.issueId}
                  className={`border rounded p-3 text-xs space-y-2 ${
                    result.found
                      ? 'border-green-500/30 bg-green-500/5'
                      : 'border-red-500/30 bg-red-500/5'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-white ${result.found ? 'bg-green-500' : 'bg-red-500'}`}>
                      {result.found ? 'FOUND' : 'NOT FOUND'}
                    </span>
                    <span className="font-medium">#{resultIdx + 1}</span>
                  </div>
                  <div>
                    <div className="text-editor-muted mb-1">targetExcerpt (원본):</div>
                    <div className="bg-editor-surface p-2 rounded break-all font-mono">
                      "{result.targetExcerpt}"
                    </div>
                  </div>
                  <div>
                    <div className="text-editor-muted mb-1">정규화 후:</div>
                    <div className="bg-editor-surface p-2 rounded break-all font-mono">
                      "{result.normalizedExcerpt}"
                    </div>
                  </div>
                  {result.found && result.editorTextSnippet && (
                    <div>
                      <div className="text-green-600 mb-1">에디터에서 발견:</div>
                      <div className="bg-green-500/10 p-2 rounded break-all font-mono">
                        "{result.editorTextSnippet}..."
                      </div>
                    </div>
                  )}
                  {!result.found && result.reason && (
                    <div>
                      <div className="text-red-500 mb-1">실패 원인:</div>
                      <div className="text-red-400">{result.reason}</div>
                    </div>
                  )}
                  {!result.found && result.possibleMatch && (
                    <div>
                      <div className="text-yellow-500 mb-1">유사 텍스트:</div>
                      <div className="bg-yellow-500/10 p-2 rounded break-all font-mono">
                        "{result.possibleMatch}"
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* 에디터 텍스트 */}
        {activeTab === 'editor' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditorRawText(getEditorText())}
                className="px-3 py-1 text-xs rounded bg-primary-500 text-white hover:bg-primary-600"
              >
                에디터 텍스트 가져오기
              </button>
              <span className="text-xs text-editor-muted">
                {editorRawText.length}자
              </span>
            </div>
            {editorRawText && (
              <>
                <div>
                  <div className="text-xs text-editor-muted mb-1">에디터 원본 텍스트 (textContent):</div>
                  <pre className="text-xs bg-editor-surface p-3 rounded overflow-auto whitespace-pre-wrap max-h-[300px] font-mono">
                    {editorRawText}
                  </pre>
                </div>
                <div>
                  <div className="text-xs text-editor-muted mb-1">정규화된 텍스트:</div>
                  <pre className="text-xs bg-editor-surface p-3 rounded overflow-auto whitespace-pre-wrap max-h-[300px] font-mono">
                    {buildNormalizedTextWithMapping(editorRawText).normalizedText}
                  </pre>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
