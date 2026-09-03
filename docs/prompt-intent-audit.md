# 프롬프트 ↔ 의도 정합성 감사 (붙여넣어 쓰는 프롬프트)

> 이 파일 전체가 프롬프트다. 새 세션에 `docs/prompt-intent-audit.md 읽고 그대로 실행해줘. 범위: 전체`
> 라고 입력하면 된다(붙여넣어도 동작은 같다). `.claude/commands/prompt-audit.md`로 복사하면 `/prompt-audit`.

---

**범위**: (비우면 전체. 예: "검수만", "선택 폴리싱과 문서 폴리싱 대조만", "새로 추가한 표 셀 재번역만")

## 0. 임무

이 저장소(OddEyes.ai)의 **모델에게 실제로 전달되는 문자열**이, 그 기능이 하기로 되어 있는 일을
유도하고 있는지 감사한다. 감사 대상은 프롬프트 **문구**다. 조립 코드는 문구가 실제로 그렇게
전달되는지 확인할 때만 본다.

판정 질문은 하나다:

> **이 문구가 없거나 반대로 쓰여 있으면, 모델 출력이 실제로 어떻게 달라지는가?**

답이 "달라지지 않는다"면 그 문구는 토큰만 먹는 것이고, "모르겠다"면 그것은 발견이 아니라 취향이다.
둘 다 보고 대상이지만 라벨이 다르다(§7).

**고치지 않는다. 보고만 한다.** 수정은 사용자가 발견 목록을 보고 지시할 때 착수한다.

## 1. 의도의 출처 — 이 순서로만 인용한다

감사자의 프롬프트 취향은 기준이 아니다. "의도에 맞다/틀리다"는 아래에 **적혀 있는 것**으로만 판정한다.

1. `docs/adr/` — 되돌리기 비싼 결정. 프롬프트에 직접 걸리는 것:
   - ADR-0002 TipTap JSON canonical / 번역은 Markdown 경유
   - ADR-0003 No Auto-Apply, Preview→Apply
   - ADR-0004 승인 기반 Project Memory (AI는 저장하지 못한다)
   - ADR-0005 워크플로우별 ContextSnapshot 고정
   - ADR-0012/0017 provider 단일 선택 + 용도별 모델은 앱이 고정
   - ADR-0020/0021 번역 방향은 `resolveDirection` 한 곳에서만 푼다
2. `.claude/CLAUDE.md` Core Principles
3. `src/ai/README.md` — 모드 구분, 도구 정책, **"정의는 tool description 한 곳에만"** 규칙
4. **코드 주석에 적힌 설계 불변식** — 특히 "왜 여기 뒀는지"를 설명하는 주석. 예:
   `reviewTool.ts:405-408`(문맥 지시를 무조건 붙이면 안 되는 이유), `runReview.ts:59-63`(캐시 경계),
   `retranslateSelection.ts:195-196`(디렉티브를 영어로 두는 이유), `translateDocument.ts:309-311`(이어서 번역의 유일한 오작동 경로)
5. 해당 기능의 UI 라벨·i18n(`src/i18n/locales/ko.json`·`en.json`) — 사용자에게 한 약속

**위 다섯 곳 어디에도 없으면 그것은 "의도 미기재"다.** 스스로 정하지 말고 §7의 별도 절에
질문으로 올린다. 프롬프트 실패의 1순위 유형이 바로 이것이다(§3-A).

## 2. 감사 대상 인벤토리

아래는 2026-09-03 기준이다. **먼저 이 목록이 아직 전부인지 확인하고 시작한다** — 목록은 썩는다:

```bash
grep -rn --include='*.ts' --include='*.tsx' -E "role: ?'system'|new SystemMessage|You are |당신은 " src/ | grep -v '\.test\.'
```

| # | 표면 | 위치 | 그 기능이 하기로 된 일 |
|---|------|------|------------------------|
| 1 | 채팅 base/translate/question/general system | `src/ai/prompt.ts:151,176,190,223` | 번역사 주도, 요청 시에만 응답 |
| 2 | 채팅 컨텍스트 포매터·상한 | `src/ai/prompt.ts:233-314`, `buildLangChainMessages:392` | 지식 블록을 역할과 함께 주입 |
| 3 | 채팅 도구 가이드 | `src/ai/chat.ts:237 buildToolGuideMessage` | 바인딩된 도구만, 추측 대신 조회 |
| 4 | 전체 번역 system | `src/ai/translateDocument.ts:166 buildTranslationSetup` (systemLines 215~) | 구조 보존 + 마커 안에만 출력 |
| 5 | 문서 폴리싱 system | `src/ai/polishDocument.ts:50 buildPolishSystemPrompt` | 번역투만 제거, 무변경도 성공 |
| 6 | 선택 재번역/폴리싱 system+user | `src/ai/retranslateSelection.ts:257 buildMessages` | 선택 범위만, 두 모드가 갈려야 함 |
| 7 | 선택 세그먼트(다중) | `src/ai/retranslateSelection.ts:554 buildSegmentMessages` | 6번과 같은 작업, 범위만 다름 |
| 8 | 선택 워크플로우 지식 디렉티브(영문) | `src/ai/retranslateSelection.ts:180 buildOptionalContext` | 지식 블록의 역할 명시 |
| 9 | 검수 본문 | `src/ai/tools/reviewTool.ts:280 / :347 / :362 / :421` | 실질적 결함만, 마커 형식 |
| 10 | 문맥 한계 지시(조건부) | `src/ai/tools/reviewTool.ts:409 PARTIAL_CONTEXT_DIRECTIVE` | **조건부여야 함**(§5) |
| 11 | 검수 실행 조립 | `src/ai/review/runReview.ts:58 buildReviewMessages` | system=런 내 불변, user=가변 |
| 12 | 채팅 경유 검수 | `src/ai/tools/reviewTool.ts:488` (`review_translation`이 반환하는 instructions) | 11번과 같은 검수인가? |
| 13 | 대화 요약 | `src/ai/chatContext/summarizeConversation.ts:63` | 사실 보존, 추측 금지 |
| 14 | 지식 디렉티브(한글 원본) | `src/ai/context/projectKnowledgeRender.ts:21 KNOWLEDGE_DIRECTIVES` | 4개 지식의 역할 정의 |
| 15 | 도구 description/schema describe | `src/ai/tools/*.ts` — documentTools:229,251,386 / selectionTools:308,337 / suggestionTools:15 / proposalTools:7,21,54,67 / projectGuidanceTools:77,109 / confluenceTools:363,477,503 / reviewTool:512,573 | **정의의 단일 진실 공급원** |
| 16 | Desktop MCP 도구 설명 | `oddeyes-desktop-mcp/src/tools/{documents,preview,review}.ts` | 외부 Claude에게 주는 계약 |
| 17 | 개발 패널 | `src/components/dev/ReviewTestPanel.tsx:58` | 9번을 재구현하지 않고 재사용하는가 |

출력 계약의 반대편(파서)도 같이 본다: `parseReviewResult.ts`,
`translateDocument.ts:393 processTranslationResponse`, `polishDocument.ts:38 extractPolishedMarkdown`,
`retranslateSelection.ts:101 extractReplacement` · `:548 parseSegmentReplacements`.

## 3. 점검 항목

각 항목은 표면마다 **예/아니오/해당없음**으로 판정한다. "대체로 괜찮다"는 판정이 아니다.

**A. 목적이 적혀 있는가**
그 기능의 주 목표가 프롬프트에 **문장으로** 있는가. 결과만 적고 목표를 빼면 모델은 안전한 쪽으로 기운다.
› 실사례: 폴리싱의 목표는 "어색한 문장 구조를 타겟 언어에 맞게"인데 프롬프트엔 "자연스럽게 읽히도록"만
있었다 → 모델이 어휘 치환으로만 도망갔다.

**B. 같은 작업인데 경로마다 지시가 다른가**
범위만 다른 같은 작업이면 지시도 같아야 한다. 대조할 쌍: 4↔6(재번역), 5↔6(폴리싱), 6↔7(단일↔세그먼트),
9/11↔12(패널 검수↔채팅 검수), 14↔8(한글 디렉티브↔영문 디렉티브). 문구를 나란히 놓고 **차이를 표로** 만든 뒤,
각 차이가 의도된 것인지 표류인지 판정한다.

**C. 금지에 조건이 달려 있는가**
조건부 금지는 모델이 그 조건으로 빠져나간다.
› 실사례: `never silently fix a mistranslation by guessing` — 원문이 프롬프트에 있으면 "추측"이 아니게 되어
예외가 열렸다. 금지문마다 "이 조건이 거짓이면 허용되는가"를 물어본다.

**D. 참조물의 역할이 명시돼 있는가 (앵커링)**
기존 결과·주변 문맥·표 헤더·직전 번역쌍을 넣을 때, 그것이 **기준인지 표시자인지** 적혀 있는가.
› 실사례: 재번역의 `use the current Target only as an editing reference`가 최소 수정을 유도했다.
현재 문구(`retranslateSelection.ts:298`)가 이 함정을 피했는지 확인한다.

**E. 우선순위 사다리가 서로 맞는가**
폴리싱(`polishDocument.ts` Instruction priority 6단)·검수(`reviewTool.ts` Instruction priority 6단)·
선택(§8 디렉티브, 사다리 없음)·번역(사다리 없음, 삽입 순서만)이 같은 충돌을 다르게 해결하지 않는가.
특히 **금칙어 vs 용어집** 충돌 규칙이 모든 경로에서 같은가.

**F. 출력 계약과 파서가 맞는가**
마커 이름·개수·중첩, "마커 외부 출력 금지"의 유무, 빈 결과 표기(`NO_ISSUES`, 무변경 반환),
그리고 **잘림(truncation) 시 파서가 어떻게 되는가**. 프롬프트가 약속한 형식과 파서가 받는 형식의 차이를 찾는다.

**G. 신뢰 경계가 모든 표면에 있는가**
`<untrusted>`/reference-data 취급이 문서·용어집·컨텍스트·첨부·도구 결과·Confluence 본문·검수 이슈까지
빠짐없이 걸려 있는가. **한 표면이라도 빠지면 그 경로가 주입 통로다.** 1·5·9·13에는 있다 — 4·6·7·12는?

**H. 조건부여야 할 블록이 무조건 붙는가 (그리고 반대도)**
무조건 붙이면 해로운 것: 문맥 한계 지시(§5), 이어서-번역 블록, 검수 이슈 블록, 표 헤더.
붙어야 하는데 조건이 너무 좁아 안 붙는 것도 같이 본다. 조건식을 코드에서 직접 읽고 실제 참/거짓 경우를 센다.

**I. 캐시 경계를 깨지 않는가**
런 내 불변인 것만 system, 청크·요청마다 달라지는 것은 user(`runReview.ts:59-63`).
**수정 제안이 이 경계를 옮기면 프롬프트 캐시가 깨진다** — 제안마다 어느 쪽에 놓을지 명시한다.

**J. 언어·방향이 해석기를 거치는가**
`'Source'`/`'Target'` 리터럴이 프롬프트에 새어나가는 자리가 남았는가(ADR-0020/0021).
방향 판정 표본이 실제로 비어 있지 않은가. 검수의 Explanation 언어(앱 언어)와 Suggestion 언어(타겟)가
프롬프트와 UI에서 같은 약속인가.

**K. 사용자 지시가 어디에, 얼마나 세게 들어가는가**
`userInstruction`·`retranslateMessage`·`polishMessage`·`instruction`·`userComments`가
우선순위 사다리에 **이름으로** 등장하는가, 아니면 본문 어딘가에 던져져 있는가.

**L. 정의의 단일 진실 공급원이 지켜지는가**
`src/ai/README.md`가 정한 규칙: Translation Rules vs Project Context 같은 **구분 정의는 tool description에만**,
system 프롬프트는 "tool description을 따르라" + UX 안전장치만. 정의가 두 곳에 복제된 자리를 찾는다.
도구 가이드(3번)와 도구 description(15번)이 서로 다른 말을 하면 그것이 드리프트다.

**M. 죽은 지시가 있는가**
바인딩되지 않은 도구를 가리키는 지시, 항상 거짓인 조건, 폐기된 기능(ADR-0007 품질 장부, ADR-0011 Notion,
ADR-0013 정렬 리포트, ADR-0019 긴 대화 안내)의 잔재, 이제 아무도 안 읽는 문구.

## 4. 검증 — 두 층 다 한다

**1층. 조립 검증 (무료, 항상)**
지시가 실제로 그 프롬프트에 들어가는지, 조건부 블록이 맞게 붙는지 순수 유닛 테스트로 확인한다.
기존 예: `src/ai/retranslateSelection.test.ts`, `src/ai/prompt.test.ts`, `src/ai/review/runReview.test.ts`.

```bash
npx tsc --noEmit && npm run test:run
```

**2층. 효과 검증 (유료, 사용자 승인 후)**
문구를 바꿨을 때 출력이 실제로 달라지는지는 실 호출로만 안다. 기존 하네스(기본 skip):

```bash
LIVE_AI=1 npx vitest run src/ai/selectionPrompt.live.test.ts
LIVE_AI=1 npx vitest run src/ai/review/reviewPrompt.live.test.ts
LIVE_AI=1 LIVE_AI_PROVIDER=anthropic npx vitest run <파일> -t "<픽스처>"
```

- **돌리기 전에 사용자에게 묻는다.** 실제 API 비용이 든다(픽스처당 1콜).
- `api.openai.com`은 샌드박스 허용 호스트가 아니다 → `dangerouslyDisableSandbox: true`.
- 키는 `.env.local` → `vitest.config.ts` → `config.ts` 테스트 fallback. 새로 붙일 배선 없다.

**하네스를 새로 만든다면 이 두 가지를 지킨다 — 효과가 컸다:**

- **지표를 찍어 눈대중을 반쯤 객관화한다.** 어절 유지율(= 유지된 어절 수 / 원 어절 수), 문장 수 변화,
  절 순서 변경. "어휘만 치환"과 "구조를 손댐"이 숫자로 갈린다. 실측 기준선: 한 단어 결함 수정 0.90,
  직역투 구조 재작성 0.47.
- **두 경로가 갈리는 픽스처를 만든다.** 의미가 반대인 오역을 넣으면 재번역(고쳐야 함)과 폴리싱(둬야 함)이
  갈린다. 결과가 같으면 둘 중 하나가 규칙을 어긴 것이다.
- 단정은 "마커가 새지 않고 빈 응답이 아니다" 수준까지만. **품질 자동 판정은 flaky하다.**
- 고치기 **전에** 베이스라인을 먼저 재둔다. 수정 후만 재면 delta가 없어 효과를 말할 수 없다.

**E2E는 건드리지 않는다** — 스펙을 쓰지도 갱신하지도 않고, 추가를 제안하지도 않는다.

## 5. 이미 결정된 것 — 재제안 금지

아래는 검토가 끝난 사안이다. 다시 제안하면 사용자의 시간을 쓴다. 되살릴 **새 증거**가 있으면
증거를 먼저 제시하고 결정 재확인을 요청한다.

| 제안 | 기각 사유 |
|------|-----------|
| 문맥 한계 지시를 무조건 붙이기 | **설계 불변식 위반.** 문서 전체가 한 청크면 문맥이 이미 다 있다. 거기 "일부만 본다"를 붙이면 진짜 누락을 억누른다. `scope \|\| chunks.length > 1`일 때만 붙인다 |
| 검수 2-pass를 다른 구조로 재구성 | 실패 사례가 없다. 이름 붙인 순차 스캔이 오히려 점검 누락을 줄인다 |
| 검수 섹션 이름 한/영 정합 맞추기 | 모델에게 자명한 매핑이고, 실패 경로를 만들지 못했다 |
| 중복 이슈 억제 규칙 | 이 UI에선 이슈 1개 = 적용 액션 1개다. 반복 오류는 **각각** 보고가 맞다 |
| 최소 수정 규칙에 "구조 결함이면 구조를 바꿔도 된다" 예외 추가 | 막으려던 소심함이 실 호출에서 재현되지 않았다. 검증 안 된 탈출구만 늘어난다. 재제안 전 **유지율 지표로 소심함을 먼저 관측**할 것 |
| 증분 검수 / effort 차등화 / 채팅=번역 모델 통일 / 폴리싱만 medium | ADR-0012에서 기각, ADR-0017 이후에도 유효 |

이미 알려진 **프롬프트 밖의** 문제(다시 발견해도 새 발견이 아니다):
미번역(원문 잔존) 유형이 `IssueType`에 없어 mistranslation으로 뭉개진다 / 청크 응답이 truncation되면
`parseReviewResult`가 throw해 그 청크가 전량 유실된다(부분 파싱으로 풀 문제).

## 6. 발견 하나에 요구되는 것

증거 없는 발견은 올리지 않는다. 각 발견은 다음을 모두 갖춘다:

1. **위치** — `file.ts:line`
2. **현재 문구** — 그대로 인용(요약 금지)
3. **어긋난 의도** — §1의 출처를 **인용**. 출처가 없으면 발견이 아니라 "의도 미기재" 질문이다
4. **모델이 실제로 어떻게 잘못 행동하는가** — 구체적 입력 → 잘못된 출력. 못 쓰면 버린다
5. **재현 방법** — 유닛으로 잡히는가, 실 호출이 필요한가, 어떤 지표로 갈리는가
6. **고칠 때 깨지는 것** — 캐시 경계(§3-I), 다른 경로와의 일관성(§3-B), 파서(§3-F)

## 7. 출력 형식

```
## 요약
표면 N개 점검, 발견 M개(높음 a / 중간 b / 낮음 c), 의도 미기재 d건.

## 표면별 판정
| # | 표면 | A B C D E F G H I J K L M | 비고 |
(예/아니오/－ 로 표기. 아니오인 칸만 아래 발견으로 전개)

## 발견
### F1. [높음] <한 줄 요약>
- 위치 / 현재 문구 / 어긋난 의도(출처 인용) / 실패 시나리오 / 재현 / 고칠 때 깨지는 것

## 경로 간 문구 대조표
(§3-B의 쌍마다: 항목 | 경로 A 문구 | 경로 B 문구 | 의도된 차이인가)

## 의도 미기재 — 사용자 결정 필요
Q1. <어느 표면의 무엇이 어디에도 안 적혀 있는지> → 선택지와 각각의 결과

## 토큰만 먹는 문구 (효과 미상)
(지우자는 제안이 아니라, 실 호출로 갈라볼 후보 목록)

## 다음 단계 제안
1층으로 잡을 것 / 2층(유료)이 필요한 것 — 비용과 픽스처 설계를 함께
```

## 8. 마지막 적대적 라운드

보고서를 내기 전에 자기 발견을 공격한다. 통과 못 하면 지운다.

- 이 발견이 진짜라면, **왜 지금까지 아무도 못 느꼈나?** 답이 없으면 오탐일 가능성이 높다.
- 이 문구를 지우거나 반대로 바꾼 프롬프트로 실제 픽스처를 돌렸을 때 **출력이 갈릴 것 같은가?**
  갈리는 픽스처를 못 만들면 그건 취향이다 → "토큰만 먹는 문구" 절로 강등.
- 내 수정안이 §5의 기각 목록과 같은 말을 다른 단어로 하고 있지 않은가.
- 내 수정안이 다른 경로의 같은 지시와 어긋나지 않는가(§3-B를 다시 본다).
- **문구를 늘리는 제안인가?** 프롬프트는 반드시 자란다. 늘리는 제안에는 "이걸 빼면 무엇이 깨지는가"를
  같이 적고, 대신 뺄 문장을 하나 지목한다.
