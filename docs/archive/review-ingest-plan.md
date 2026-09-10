# Review Ingest — 외부 검수 결과를 OddEyes 검수 UI에 주입

## 목적

외부 에이전트(trans_agent의 Claude)가 만든 번역 검수 결과(이슈 리스트: 누락·오역·직역투·문법·용어 등)를
OddEyes MCP를 통해 이 앱(translation-editor)의 **기존 검수(Review) UI에 그대로 띄운다.**
앱의 AI 검수를 돌리는 대신, 외부에서 만든 finding을 review store에 주입해 하이라이트·이슈 테이블에 표시한다.

이 문서는 별도 세션이 이것만 읽고 구현에 들어갈 수 있도록 자족적으로 작성됨.

> **관련 문서**: `docs/context-sync-plan.md` — 페르소나·번역규칙·프로젝트컨텍스트를 MCP로 읽고 쓰기(같은 bridge/MCP 패턴, chatStore 도메인). 독립 작업이며 서로 의존하지 않음.

> **검증 상태(2026-06-01)**: 아래 모든 line:number 참조와 함정을 현재 소스로 교차검증 완료.
> 원안 대비 **버그 1건(함정 4: severityFilter 경합)** + 보강 6건을 반영했다. 변경 이력은 문서 끝 "리비전 노트" 참조.

## 채택 접근법 (ROI 우선, 정확성 8/10)

- **세그먼트 매칭**: 하이브리드. `segmentGroupId`(UUID)가 있으면 정확 매칭, 없으면 `targetExcerpt` 문자열 검색 fallback.
  외부 검수 산출물엔 보통 UUID가 없으므로 실질적으로 excerpt 매칭이 주 경로다.
- **범위(이번 단계)**: MCP 도구 1개 + bridge 메서드 1개 + review store **전용 주입 액션 1개**. SQLite 영속화는 범위 밖(휘발성 허용).
- 변경은 **100% 이 저장소(translation-editor)** 안에서만 일어난다. trans_agent 쪽 코드 변경 없음.

### 하이라이트 정확도 전략 (이번 범위 — excerpt verbatim 강제)

`segmentGroupId` 없는 주 경로의 하이라이트는 `targetExcerpt`를 번역문에서 **정규화 후 부분 문자열 검색**(`ReviewHighlight.ts:50, 66`)으로 찾는다.
즉 정확도는 거의 전적으로 **외부 에이전트가 `targetExcerpt`를 얼마나 verbatim으로(글자 그대로) 뽑느냐**에 달려 있다.

- excerpt가 정확하면 정확도 ~90%+ (긴 산문 문서 기준). `normalizeForSearch`가 마크다운·공백 차이를 흡수하고, `buildTextWithPositions`가 노드 경계를 넘는 매칭도 처리하므로 글자만 맞으면 잡힌다.
- excerpt를 LLM이 의역·축약·재구성하면 `indexOf`는 all-or-nothing이라 **조용히 매칭 0**(false negative)이 된다. 이게 정확도를 깎는 거의 유일한 요인(긴 문서엔 중복 매칭 거의 없음).

**대응(레버 4, 제로/저비용)** — 매칭 로직을 손대지 않고 **입력 단계에서 verbatim을 강제**해 정확도를 끌어올린다:
1. **MCP 도구 `description`에 verbatim 요구사항을 못박는다** (아래 3번). 외부 Claude가 도구 스키마를 읽을 때 자연히 따르게 된다.
2. **bridge 반환값에 `dropped`(누락 excerpt 수)를 실어** 외부가 "몇 개가 매칭 불가로 버려졌는지" 즉시 알 수 있게 한다 (아래 2번). → 외부 에이전트가 재시도/보정 가능.
3. **trans_agent SKILL.md 지침**(후속이지만 권장): "`targetExcerpt`는 번역문에서 글자 그대로 복사, 의역·축약 금지, 20~40자의 고유 구절."

> 매칭 로직 자체 개선(`segmentGroupId` 정확 매칭=레버 1, excerpt 길이 캡=레버 2)은 동작 검증 후 **후속 단계**로 미룬다. 이번 단계는 레버 4만으로 충분.

## 현재 구조 (확인된 사실)

```
trans_agent(Claude) → oddeyes-desktop-mcp(도구) → WebSocket bridge → 이 앱(__ODDEYES_APP_BRIDGE__) → zustand store
```

- MCP 도구 등록 패턴은 단순 1:1 (화이트리스트 없음):
  `oddeyes-desktop-mcp/src/tools/preview.ts` — `server.registerTool(name, schema, async (args) => textResult(await callBridge("oddeyes.X", args)))`
- 도구 모듈은 `oddeyes-desktop-mcp/src/index.ts:23-33`의 `createMcpServer()`에서 `registerDocumentTools` / `registerPreviewTools`로 등록됨.
  → **신규 모듈을 추가하려면 `createMcpServer()`에 `registerReviewTools(server, callBridge)` 한 줄을 더해야 한다(아래 3번 참조).**
- bridge dispatch는 `src/desktop/oddeyesAppBridge.ts:162`의 `methods` 객체 + `handleRequest`(207). 키 하나 추가하면 자동 인식.
- bridge 초기화: `src/App.tsx:232`의 `initializeOddEyesAppBridge()`. 앱 부팅 시 1회. 프로젝트/에디터 마운트와 무관하게 `window.__ODDEYES_APP_BRIDGE__`는 항상 존재.
- review store: `src/stores/reviewStore.ts`. 핵심 타입은 `ReviewIssue`(52-63), `ReviewResult`(65-69), `IssueType`(14-20), `IssueSeverity`(23).
- 하이라이트 렌더: `src/editor/extensions/ReviewHighlight.ts`. `getCheckedIssues()`가 거른 이슈만 그린다.
- **하이라이트 갱신 트리거**: store의 `highlightNonce` 증가 → `TipTapEditor.tsx:197` / `TranslationBlock.tsx:41` / `useBlockEditor.ts:164`의 `useEffect`가 `refreshEditorHighlight(editor)` 호출 → ProseMirror plugin이 `reviewHighlightRefresh` meta로 decoration 재계산(`ReviewHighlight.ts:162`). **주입 액션은 반드시 `highlightNonce`를 증가시켜야 즉시 반영된다.**

### ReviewIssue 형태 (reviewStore.ts:52-63)

```ts
export interface ReviewIssue {
  id: string;                          // 결정적 ID (generateIssueId로 생성)
  segmentOrder: number;
  segmentGroupId: string | undefined;  // 없으면 excerpt 문자열 검색 fallback
  sourceExcerpt: string;
  targetExcerpt: string;               // 하이라이트 대상 (번역문에서 그대로 복사할 것)
  suggestedFix: string;
  type: IssueType;                     // omission|addition|mistranslation|grammar|awkward|terminology
  severity: IssueSeverity;             // critical|major|minor
  description: string;
  checked: boolean;                    // ★ false면 하이라이트 안 됨
}
```

`generateIssueId(segmentOrder, type, sourceExcerpt, targetExcerpt)` (reviewStore.ts:43-50) — 주입 시 이걸로 id 생성할 것.

## 검증에서 드러난 함정 (반드시 반영)

### 함정 1 — `addResult` 재활용 ❌, 전용 주입 액션이 필요하다

`ReviewHighlight`는 `getCheckedIssues()`만 그린다(reviewStore.ts:375-379):
```ts
allIssues.filter((issue) => issue.checked && severityFilter.includes(issue.severity))
```
- 주입 finding의 `checked`가 false면 **하이라이트 0개**.
- `severity`가 `critical|major|minor` 셋 중 하나가 아니면 **필터에서 통째로 탈락**.
→ 주입 시 `checked: true` 강제 + severity를 반드시 3값으로 정규화해야 함.

### 함정 2 — `initializeReview`가 주입 결과를 덮어쓴다 (경합)

`ReviewPanel.tsx:123-127`이 패널 마운트 시 `initializeReview(project)` 호출.
`initializeReview`(reviewStore.ts:225-243)는 스킵 조건이 `initializedProjectId === project.id && results.length > 0`이고,
아니면 **`results: []`로 리셋**한다.
- 검수 패널을 아직 안 열었다면 `results.length === 0` → 패널 여는 순간 주입 결과가 날아감.
→ 주입 액션이 `results` 채움과 **동시에** `initializedProjectId`를 현재 프로젝트 id로 세팅하고 `highlightEnabled: true`까지 한 번의 `set()`으로 처리해야, 이후 `initializeReview`의 스킵 조건에 걸려 보존된다.

### 함정 3 — chunkIndex는 우리에게 의미 없음

주입엔 청크 개념이 없다. `ReviewResult.chunkIndex`는 더미(예: 0)로 둔다. `getAllIssues`가 `flatMap`이라 무해.

### 함정 4 — `severityFilter`가 좁혀져 있으면 주입해도 안 보인다 ★ (원안 누락, 신규)

`getCheckedIssues()`(reviewStore.ts:375-379)는 `checked` **그리고** `severityFilter.includes(severity)` **둘 다** 통과해야 그린다.
`severityFilter` 기본값은 `['critical','major','minor']`(reviewStore.ts:206) 전체라 첫 진입은 문제 없지만,
**사용자가 이전 AI 검수 세션에서 필터를 좁혀놨다면**(예: minor 토글 off → `severityFilter`에서 'minor' 제거됨) 그 상태가 store에 남아 있다.
그 상태에서 minor 이슈를 주입하면 `checked: true`라도 **severity 필터에서 탈락 → 하이라이트도 테이블도 안 뜬다.**

→ 주입 액션은 같은 `set()`에서 **`severityFilter`를 3값 전체로 리셋**해, 외부 주입 결과가 항상 온전히 보이도록 한다.
(외부 검수는 "전체를 그대로 보여준다"가 목적이므로 필터 리셋이 의미상 옳다.)

### 함정 5 — 프로젝트 전환 후 주입 (stale projectId)

주입은 비동기 RPC다. 외부 에이전트가 검수를 만드는 사이 사용자가 다른 프로젝트로 전환할 수 있다.
주입 시점의 `useProjectStore.getState().project.id`를 신뢰하되, 외부가 `projectId`를 함께 보냈으면(옵션) 일치 검증해 mismatch면 거부한다.
→ 잘못된 프로젝트에 남의 검수를 덮어쓰는 사고 방지. (검증은 bridge 헬퍼에서, 아래 2번.)

## 구현 (3개 파일)

### 1) `src/stores/reviewStore.ts` — 전용 주입 액션 추가

`ReviewActions` 인터페이스(93-189 사이, 예: `setStreamingText` 선언 근처)에 선언 추가:
```ts
/**
 * 외부(MCP) 검수 결과 주입: 기존 results를 1회 전체 교체하고 하이라이트 즉시 활성화.
 * initializeReview 경합(함정 2)·severityFilter 경합(함정 4) 방지를 한 set()에서 처리.
 */
ingestExternalReview: (params: {
  projectId: string;
  issues: Array<{
    segmentOrder?: number;
    segmentGroupId?: string;
    sourceExcerpt: string;
    targetExcerpt: string;
    suggestedFix?: string;
    type: IssueType;
    severity: IssueSeverity;
    description: string;
  }>;
}) => void;
```

구현(`create(...)` 본문, 예: `addResult` 근처):
```ts
ingestExternalReview: ({ projectId, issues }) => {
  const { highlightNonce } = get();
  const normalized: ReviewIssue[] = issues.map((it, i) => {
    const segmentOrder = it.segmentOrder ?? i;
    return {
      id: generateIssueId(segmentOrder, it.type, it.sourceExcerpt, it.targetExcerpt),
      segmentOrder,
      segmentGroupId: it.segmentGroupId,           // 없으면 undefined → excerpt fallback
      sourceExcerpt: it.sourceExcerpt,
      targetExcerpt: it.targetExcerpt,
      suggestedFix: it.suggestedFix ?? '',
      type: it.type,
      severity: it.severity,
      description: it.description,
      checked: true,                               // ★ 함정 1
    };
  });
  set({
    results: [{ chunkIndex: 0, issues: normalized }],   // 덮어쓰기(append 아님): 외부 주입은 1회 전체 교체
    currentChunkIndex: 1,
    progress: { completed: 1, total: 1 },
    isReviewing: false,
    totalIssuesFound: normalized.length,
    initializedProjectId: projectId,               // ★ 함정 2: initializeReview 스킵 유도
    severityFilter: ['critical', 'major', 'minor'],// ★ 함정 4: 필터 좁혀져 있어도 전부 보이게 리셋
    highlightEnabled: true,                        // ★ 함정 1
    highlightNonce: highlightNonce + 1,            // ★ 에디터 decoration 재계산 트리거
    streamingText: '',                             // 이전 AI 응답 잔상 제거
  });
},
```
주의:
- `generateIssueId`는 파일 상단에 이미 export됨(43-50). `ReviewIssue`/`ReviewResult`/`IssueType`/`IssueSeverity` 동일 파일 내 타입 사용.
- 빈 배열(`issues.length === 0`) 주입도 허용한다: `results`에 빈 issues 블록이 들어가 `results.length > 0`이 되어 패널이 "결과 표시" 모드로 전환되고 테이블은 비어 있다(= "검출된 이슈 없음"). 0건 주입을 거부하려면 bridge 헬퍼에서 막을 것(현재는 허용).
- `id` 충돌: `generateIssueId`는 `segmentOrder|type|source|target` 해시다. 외부가 `segmentOrder`를 안 주면 `i`(배열 인덱스)로 대체되므로, **동일 type+source+target이 같은 인덱스에 오지 않는 한** 충돌 없음. `getAllIssues`의 dedup(reviewStore.ts:332-337)이 동일 id를 1개로 합치므로, 진짜 중복 이슈는 자연히 1개만 표시된다(의도된 동작).

### 2) `src/desktop/oddeyesAppBridge.ts` — bridge 메서드 추가

`methods` 객체(162-203)에 키 추가. severity/type 정규화는 여기서(입력 신뢰 못 함):
```ts
'oddeyes.setReviewIssues': async (params) => await setReviewIssues(params ?? {}),
```

파일 상단 import에 추가(현재 `useProjectStore`는 이미 import됨, line 3):
```ts
import { useReviewStore, type IssueType, type IssueSeverity } from '@/stores/reviewStore';
```

파일 내 헬퍼 함수로:
```ts
const SEVERITY_MAP: Record<string, IssueSeverity> = {
  '🔴': 'critical', critical: 'critical', error: 'critical', '5': 'critical',
  '4': 'major', major: 'major',
  '🟡': 'minor', minor: 'minor', warning: 'minor', '3': 'minor', '2': 'minor', '1': 'minor',
  // 🟢/OK 라벨은 애초에 이슈로 보내지 않음
};
const TYPE_MAP: Record<string, IssueType> = {
  '누락': 'omission', omission: 'omission',
  '추가': 'addition', addition: 'addition',
  '오역': 'mistranslation', mistranslation: 'mistranslation',
  '문법': 'grammar', grammar: 'grammar',
  '직역투': 'awkward', awkward: 'awkward',
  '용어': 'terminology', terminology: 'terminology',
};

// 입력은 신뢰 못 함 → Record<string, unknown> 가드로 좁힌다 (레포 스타일: any 회피)
function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

async function setReviewIssues(params: BridgeParams): Promise<unknown> {
  const project = useProjectStore.getState().project;
  if (!project) throw new Error('No project loaded');

  // 함정 5: 외부가 projectId를 보냈으면 일치 검증 (stale 프로젝트 덮어쓰기 방지)
  if (typeof params.projectId === 'string' && params.projectId.length > 0 && params.projectId !== project.id) {
    throw new Error(`Project mismatch: expected ${project.id}, got ${params.projectId}`);
  }

  const rawIssues = Array.isArray(params.issues) ? params.issues : [];
  const issues = rawIssues.map((raw) => {
    const r = asRecord(raw);
    return {
      segmentOrder: typeof r.segmentOrder === 'number' ? r.segmentOrder : undefined,
      segmentGroupId: typeof r.segmentGroupId === 'string' ? r.segmentGroupId : undefined,
      sourceExcerpt: String(r.sourceExcerpt ?? ''),
      targetExcerpt: String(r.targetExcerpt ?? ''),
      suggestedFix: typeof r.suggestedFix === 'string' ? r.suggestedFix : undefined,
      type: TYPE_MAP[String(r.type)] ?? 'mistranslation',
      severity: SEVERITY_MAP[String(r.severity)] ?? 'minor',
      description: String(r.description ?? ''),
    };
  }).filter((i) => i.targetExcerpt.trim().length > 0);   // excerpt 없으면 하이라이트 불가 → 드롭

  useReviewStore.getState().ingestExternalReview({ projectId: project.id, issues });
  return { ok: true, count: issues.length, dropped: rawIssues.length - issues.length };
}
```

주의:
- `BridgeParams = Record<string, unknown>`는 이미 파일에 정의됨(line 14). `any` 미사용 — 레포 전체가 `Record<string, unknown>` + 가드 패턴을 일관 사용한다(`src/`에 비-test `: any`는 단 1곳).
- `targetExcerpt`가 공백뿐인 경우도 드롭(`trim()`). 하이라이트 검색 대상이 없으면 무의미.
- 반환값에 `dropped` 추가 — 외부 에이전트가 "몇 개가 누락 excerpt로 버려졌는지" 알 수 있게.

### 3) `oddeyes-desktop-mcp/src/tools/review.ts` (신규 모듈) — MCP 도구 추가

기존 도구는 `documents.ts`(4개)·`preview.ts`(4개)로 도메인 분리돼 있다. 검수는 별도 도메인이므로 **신규 모듈 `review.ts`**로 추가하는 게 일관적이다.
(원안의 "preview.ts에 끼워넣기"도 동작은 하지만 도메인 혼선. 신규 모듈 권장.)

`oddeyes-desktop-mcp/src/tools/review.ts`:
```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const textResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

export function registerReviewTools(
  server: McpServer,
  callBridge: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): void {
  server.registerTool(
    "oddeyes_set_review_issues",
    {
      // ★ 레버 4: description에 verbatim 요구사항을 못박아 외부 에이전트가 정확한 excerpt를 보내게 유도.
      //   반환값의 `dropped`로 매칭 불가(빈 excerpt) 개수를 회신하므로 외부가 보정 가능.
      description:
        "Push an external translation review (issue list) into the OddEyes review panel. " +
        "Each issue is shown in the review table AND highlighted in the editor. " +
        "CRITICAL for highlighting: `targetExcerpt` MUST be copied VERBATIM (character-for-character) " +
        "from the current target document — do NOT paraphrase, summarize, translate, or reformat it. " +
        "Prefer a short, unique span of ~20-40 characters that appears exactly once. " +
        "If unsure, first read the target via oddeyes_get_target_document. " +
        "The tool returns { count, dropped }: `dropped` counts issues skipped due to empty/unmatchable excerpts — " +
        "if dropped > 0, re-extract those excerpts verbatim and call again.",
      inputSchema: {
        projectId: z.string().optional(),   // 있으면 앱이 현재 프로젝트와 일치 검증 (stale 방지)
        issues: z.array(z.object({
          segmentOrder: z.number().optional(),
          segmentGroupId: z.string().optional(),
          sourceExcerpt: z.string(),
          targetExcerpt: z.string()
            .describe("VERBATIM span copied from the target document — used as the highlight search key. No paraphrasing."),
          suggestedFix: z.string().optional(),
          type: z.string(),              // 누락/오역/직역투/문법/용어/추가 또는 영문 enum
          severity: z.string(),          // 🔴/🟡 또는 critical/major/minor 또는 1~5
          description: z.string(),
        })),
      },
    },
    async ({ projectId, issues }) =>
      textResult(await callBridge("oddeyes.setReviewIssues", { projectId, issues })),
  );
}
```

`oddeyes-desktop-mcp/src/index.ts`에 등록(2곳):
```ts
import { registerReviewTools } from "./tools/review.js";   // 상단 import에 추가 (line 7-8 근처)
// ...
function createMcpServer(): McpServer {
  const server = new McpServer({ name: "oddeyes-desktop", version: "0.1.0" });
  registerDocumentTools(server, callBridge);
  registerPreviewTools(server, callBridge);
  registerReviewTools(server, callBridge);   // ★ 추가 (line 29-30 근처)
  return server;
}
```

## severity / type 변환표 (외부 → editor)

| 외부 라벨 | editor severity | 비고 |
|---|---|---|
| 🔴 오류 / error / 5 | `critical` | |
| 4 / major | `major` | |
| 🟡 개선가능 / warning / 1~3 | `minor` | |
| (그 외/미상) | `minor` (기본값) | `SEVERITY_MAP` 미스 시 fallback |
| 🟢 OK | (전송 안 함) | 이슈 아님 |

| 외부 유형 | editor type |
|---|---|
| 누락 | `omission` |
| 추가 | `addition` |
| 오역 | `mistranslation` |
| 문법 | `grammar` |
| 직역투 | `awkward` |
| 용어 | `terminology` |
| (그 외/미상) | `mistranslation` (기본값) |

## 단위 테스트 (구현과 함께 추가 — 두 파일 모두 이미 존재)

### `src/stores/reviewStore.test.ts`에 추가
기존 패턴: `beforeEach(() => useReviewStore.getState().resetReview())`, `useReviewStore.getState().X(...)` 호출 후 `getState()` 단언.
```ts
describe('reviewStore ingestExternalReview', () => {
  beforeEach(() => useReviewStore.getState().resetReview());

  it('주입 시 checked:true·highlightEnabled·initializedProjectId가 한 번에 세팅된다', () => {
    useReviewStore.getState().ingestExternalReview({
      projectId: 'p1',
      issues: [{
        sourceExcerpt: 'src', targetExcerpt: 'tgt',
        type: 'mistranslation', severity: 'major', description: 'd',
      }],
    });
    const s = useReviewStore.getState();
    expect(s.results).toHaveLength(1);
    expect(s.results[0]!.issues[0]!.checked).toBe(true);
    expect(s.highlightEnabled).toBe(true);
    expect(s.initializedProjectId).toBe('p1');
    expect(s.totalIssuesFound).toBe(1);
  });

  it('severityFilter가 좁혀져 있어도 주입이 3값 전체로 리셋한다 (함정 4)', () => {
    useReviewStore.setState({ severityFilter: ['critical'] });
    useReviewStore.getState().ingestExternalReview({
      projectId: 'p1',
      issues: [{ sourceExcerpt: 's', targetExcerpt: 't', type: 'omission', severity: 'minor', description: 'd' }],
    });
    expect(useReviewStore.getState().severityFilter).toEqual(['critical', 'major', 'minor']);
    // minor 이슈가 getCheckedIssues에 포함되는지
    expect(useReviewStore.getState().getCheckedIssues()).toHaveLength(1);
  });

  it('주입은 append가 아니라 전체 교체다', () => {
    const inject = (txt: string) => useReviewStore.getState().ingestExternalReview({
      projectId: 'p1',
      issues: [{ sourceExcerpt: 's', targetExcerpt: txt, type: 'grammar', severity: 'major', description: 'd' }],
    });
    inject('first'); inject('second');
    const issues = useReviewStore.getState().getAllIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]!.targetExcerpt).toBe('second');
  });
});
```

### `src/desktop/oddeyesAppBridge.test.ts`에 추가
기존은 `useReviewStore`를 mock하지 않으므로(현재 import 안 함), 케이스 추가 시 **실제 store를 쓰거나** `vi.mock('@/stores/reviewStore', ...)`로 `ingestExternalReview: vi.fn()` 스파이를 노출한다. 후자가 격리에 유리:
```ts
const ingestSpy = vi.fn();
vi.mock('@/stores/reviewStore', () => ({
  useReviewStore: { getState: () => ({ ingestExternalReview: ingestSpy }) },
}));
// ...
it('setReviewIssues: severity/type 정규화 + excerpt 없는 항목 드롭', async () => {
  const res = await callBridge('oddeyes.setReviewIssues', {
    issues: [
      { sourceExcerpt: 's1', targetExcerpt: 't1', type: '오역', severity: '🔴', description: 'd1' },
      { sourceExcerpt: 's2', targetExcerpt: '',   type: '누락', severity: '🟡', description: 'd2' }, // 드롭
    ],
  }) as Record<string, unknown>;
  expect(res.count).toBe(1);
  expect(res.dropped).toBe(1);
  expect(ingestSpy).toHaveBeenCalledWith(expect.objectContaining({
    issues: [expect.objectContaining({ type: 'mistranslation', severity: 'critical' })],
  }));
});

it('setReviewIssues: projectId 불일치 시 거부 (함정 5)', async () => {
  await expect(callBridge('oddeyes.setReviewIssues', { projectId: 'other', issues: [] }))
    .rejects.toThrow('Project mismatch');
});
```
> 주의: `oddeyesAppBridge.test.ts`의 `useProjectStore` mock은 `project: { id: 'test-project', ... }`를 반환한다(test line 13-15). projectId 불일치 테스트의 `'other'`는 이와 달라야 한다.

## 빌드 · 검증 절차

1. **타입 체크(이 레포의 유일한 정적 게이트)**: `npx tsc --noEmit` 통과 확인. (ESLint·lint 스크립트 없음. `any` 회피는 컨벤션이지 강제 아님.)
2. **단위테스트**: `npm run test:run` — 위에서 추가한 `reviewStore`/`oddeyesAppBridge` 케이스 포함 그린.
3. **MCP 빌드**: `cd oddeyes-desktop-mcp && npm run build` (tsc + bundle). stdio 모드면 **Claude 클라이언트 재연결**해야 새 도구(`oddeyes_set_review_issues`) 인식.
4. **수동 E2E**:
   - 앱에서 프로젝트 열고 번역문이 있는 상태.
   - MCP `oddeyes_set_review_issues` 호출 — `targetExcerpt`에 현재 번역문에 실제 존재하는 구절을 넣을 것.
   - 검수 패널에서 이슈 테이블에 뜨고, 에디터에서 해당 구절이 하이라이트되는지 확인.
   - **검수 패널을 안 연 상태에서 주입 → 그 다음 패널을 처음 열어도** 이슈가 보이는지 확인(함정 2 핵심 회귀).
   - 검수 패널을 **닫았다 다시 열어도** 이슈가 유지되는지 확인(함정 2 회귀).
   - (함정 4 회귀) 패널에서 severity 필터를 minor만 끄고 → minor 이슈를 주입 → 그래도 보이는지 확인.
   - **(레버 4 / verbatim 검증)** `targetExcerpt`를 번역문에서 **글자 그대로** 넣었을 때 하이라이트가 걸리는지 확인. 일부러 의역한 excerpt(예: 동의어 치환)를 섞어 보내 → 그 항목만 하이라이트가 **안 걸리고**(false negative), 테이블엔 그대로 뜨는지 확인. 빈 `targetExcerpt`를 섞으면 응답 `dropped`가 그만큼 증가하는지 확인.
5. **회귀**: 기존 AI 검수(`검수 시작`)가 여전히 정상 동작하는지 — 주입 후 AI 검수를 돌리면 `startReview`가 `results:[]`로 깔고 새로 채우므로 충돌 없어야 함. 반대로 AI 검수 후 주입하면 주입이 전체 교체.

## 알려진 한계 (이번 범위에서 수용)

- **휘발성**: SQLite 미저장(`reviewStore`는 메모리 전용, `.claude/rules/stores.md` 참조). 앱 재시작 시 주입 검수 소멸. (필요해지면 후속 단계로 `review_issues` 테이블 + Rust CRUD.)
- **excerpt 중복**: 동일 번역 문구가 문서에 여러 번 나오면 첫 매칭만 하이라이트(ReviewHighlight.ts:101-110 `break`). 표·반복 UI 라벨에서 오타깃 가능. → 정확성이 더 필요하면 후속으로 "검수 전 get_source(tiptap_json)로 세그먼트 UUID 확보 → segmentGroupId 채워 전송" 추가(자료구조 변경 없이 정확성 9/10로 상승).
- **단일 결과 블록**: 주입은 1회 전체 교체(append 아님). 여러 번 호출하면 마지막 것만 남음. 누적이 필요하면 액션을 append 변형으로.
- **0건 주입**: 허용(테이블 빈 채로 "결과 표시" 모드). 외부에서 "검출 0" 신호로 쓸 수 있음.

## 후속 단계 (이번 범위 밖)

> 레버 4(verbatim 강제)는 **이번 범위로 승격**됨 — 도구 description·`dropped` 회신으로 처리. 아래는 매칭 로직 자체 개선·연동.

1. **레버 1 — 정확성 업그레이드(정확성 9/10)**: get_target(tiptap_json)로 세그먼트 ID 확보 → `segmentGroupId` 정확 매칭. `ReviewHighlight.ts:55-61, 99`가 이미 segmentGroupId 경로를 지원하므로 자료구조 변경 불필요. excerpt가 부정확해도 세그먼트 단위로는 정확히 짚는다. **레버 4 다음으로 ROI 높은 개선.**
2. **레버 2 — excerpt 길이 캡/앵커 매칭**: 긴 `targetExcerpt`는 앞 N자(예: 40자)를 검색 키로 쓰고 원래 길이만큼 하이라이트. `createReviewDecorations`에 "검색 키 ≠ 하이라이트 길이" 분리 소수정. 한 글자 차이로 전체 실패하던 케이스 완화.
3. **trans_agent 연동**: `trans_agent/.claude/skills/review-oddeyes/SKILL.md`에 "검수 후 `oddeyes_set_review_issues` 호출" 절차 추가. **지침에 verbatim 규칙 명시**(레버 4의 외부 측 절반): "`targetExcerpt`는 번역문에서 글자 그대로 복사, 의역·축약 금지, 20~40자 고유 구절. 응답 `dropped > 0`이면 해당 항목 재추출 후 재호출." editor 쪽이 동작 확인된 뒤 진행.
4. **영속화**: SQLite `review_issues` 테이블 + Rust CRUD.
5. **누적(append) 변형**: 청크 단위로 검수 결과를 흘려보내는 외부 워크플로 지원 시.

> **레버 3(fuzzy fallback)은 채택 안 함**: 정확 매칭 실패 시 단어 단위 부분 매칭은 false positive(엉뚱한 위치 색칠) 리스크가 있어, 긴 문서에선 레버 1·2 대비 ROI가 낮고 혼란을 유발. 의도적으로 제외.

## 참조 파일 (file:line) — 2026-06-01 교차검증

- `src/stores/reviewStore.ts` — ReviewIssue(52-63), generateIssueId(43-50), initialState/severityFilter 기본값(204-220), initializeReview(225-244), addResult(246-255), startReview(274-287), getAllIssues+dedup(320-344), getCheckedIssues(375-379)
- `src/editor/extensions/ReviewHighlight.ts` — createReviewDecorations(28-118), segmentGroupId 분기(55-61, 99), 첫 매칭 break(109), plugin refresh meta(162-165), refreshEditorHighlight(186-189)
- `src/components/editor/TipTapEditor.tsx` — ReviewHighlight 등록(80), highlightNonce → refresh useEffect(195-200)
- `src/hooks/useBlockEditor.ts` — 동일 패턴(56, 162-167) / `src/components/editor/TranslationBlock.tsx`(38, 41-44)
- `src/components/review/ReviewPanel.tsx` — initializeReview 마운트 호출(123-127), reviewTrigger 패턴(135-140), results 기반 모드 분기(490-613)
- `src/desktop/oddeyesAppBridge.ts` — methods 객체(162-203), handleRequest(205-215), BridgeParams(14), setTranslationPreview 헬퍼 패턴(111-143), useProjectStore import(3)
- `src/desktop/oddeyesAppBridge.test.ts` — store mock 패턴(11-60), callBridge 헬퍼(65-67), 기존 케이스(69-105)
- `src/stores/reviewStore.test.ts` — resetReview beforeEach + getState 단언 패턴(20-56)
- `src/App.tsx:232` — initializeOddEyesAppBridge() 부팅 시 1회
- `oddeyes-desktop-mcp/src/tools/preview.ts` — registerTool 패턴(12-36), textResult(4-6)
- `oddeyes-desktop-mcp/src/tools/documents.ts` — 도구 모듈 구조(8-32)
- `oddeyes-desktop-mcp/src/index.ts` — createMcpServer/도구 등록(23-33), callBridge(19-21), import 위치(7-8)
- `oddeyes-desktop-mcp/src/bridgeRuntime.ts`, `src/client/websocket.ts` — MCP↔앱 WebSocket RPC(이번 변경 불필요)

## 리비전 노트 (원안 → 보강)

- **[정확도/레버 4] verbatim 강제를 이번 범위로 승격**: 하이라이트 정확도가 `targetExcerpt`의 verbatim 여부에 좌우됨을 명시하고, ① MCP 도구 description·필드 `.describe()`에 verbatim 요구 못박기, ② bridge 반환값 `dropped`로 매칭 불가 개수 회신, ③ verbatim/false-negative E2E 회귀 케이스 추가. 매칭 로직 자체 개선(레버 1·2)은 후속으로 분리, 레버 3(fuzzy)은 의도적 제외.
- **[버그] 함정 4 신규**: `severityFilter` 좁혀진 상태에서 주입 시 하이라이트 누락 → 주입 액션이 `severityFilter` 3값 리셋하도록 수정.
- **[보강] 함정 5 신규**: stale `projectId` 검증을 bridge 헬퍼·MCP 스키마(`projectId` 옵션)에 추가.
- **[정확성] 하이라이트 트리거 메커니즘 명시**: `highlightNonce` → `refreshEditorHighlight` 경로(3개 호출처)를 "현재 구조"에 문서화. 원안은 `highlightNonce++`만 적고 이유 누락.
- **[정정] 라인 참조 갱신**: `getCheckedIssues` 375-379(원안 378), `ReviewHighlight` break 109(원안 26/109 혼재) 등 현재 소스로 교정.
- **[구조] MCP 신규 모듈 `review.ts`**: 원안의 "preview.ts에 끼워넣기" 대신 도메인 분리. `index.ts`의 `createMcpServer()` 등록 라인 명시.
- **[스타일] `any` 제거**: 레포 컨벤션(`Record<string, unknown>` + 가드)에 맞춰 `asRecord` 헬퍼 사용. ESLint는 없으나 일관성 위해.
- **[품질] 단위 테스트 케이스 구체화**: 원안의 "가능하면"을 두 테스트 파일의 실제 패턴에 맞춘 구체 케이스로 대체.
- **[견고성] 빈 excerpt `trim()` 드롭, 0건 주입 동작, id 충돌/dedup 동작, `dropped` 반환값** 명시.
