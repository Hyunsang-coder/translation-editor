# 웹 버전 이행 조사 — 2026-09-04

> 데스크톱(Tauri) 앱을 유지하면서 웹 버전을 추가할 때의 비용·구조·기능 정리를 조사한 결과.
> **구현은 아직 없다.** 이 문서는 착수 전 근거이며, 수치는 전부 실측이다.
> 측정 대상: `~/Library/Application Support/com.oddeyes.desktop/ite.db` (22MB, 프로젝트 111개),
> 코드베이스 v3.13.1.

## 1. 왜

팀원(주로 번역가)이 앱을 쓰지 않는 이유가 둘이다.

1. **API 키를 발급받아 입력하는 과정이 번거롭다**
2. **앱을 내려받아 설치하는 것 자체가 번거롭다**

두 문제는 해법이 다르다. **1번은 웹 앱이 필요 없다** — 서버 측 키 하나면 된다.
2번만 웹이 필요하다. 이 구분이 아래 단계 순서의 근거다.

참고: 설치 마찰이 플랫폼 부재 때문은 아니다. `build.yml`이 macOS universal +
Windows MSVC를 이미 빌드한다.

## 2. 프론트엔드는 이미 웹이다

- `src/components`·`src/stores`·`src/editor`·`src/ai` 약 **70k LOC이 순수 React/TipTap/Zustand**.
  포팅 대상이 아니다.
- Tauri는 시스템 웹뷰(macOS는 WKWebView)다. 네이티브 UI에서 웹으로 내려가는 게 아니라
  **웹뷰에서 브라우저 탭으로 옮기는 것**이다. 렌더링 성능 손실은 없다.
- `npm run test:e2e:web`이 이미 순수 Vite로 앱을 띄우고 Playwright로 구동한다.
- 네이티브 의존이 **`src/tauri/invoke.ts:50` 한 함수**로 모인다. 커맨드 88개가 전부 이 관문을 지난다.
  `src/tauri/` 밖에서 `@tauri-apps/api`를 직접 import 하는 건 6곳뿐이고 전부 윈도우 크롬
  (트래픽 라이트, 드래그앤드롭, 메뉴)이다.
- `e2e/tauri-mock.ts`(774줄)가 **비-Tauri 구현으로 앱 전체가 동작한다는 증거**다.

### 결론: 프론트를 포팅하지 말고 트랜스포트를 바꾼다

```ts
// src/tauri/invoke.ts
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauriRuntime()) return tauriInvoke<T>(cmd, args);
  return httpInvoke<T>(cmd, args);   // POST /api/cmd/{cmd}
}
```

하나의 코드베이스, 두 개의 트랜스포트. 듀얼 타깃 프로젝트를 죽이는 건 프론트가 두 벌로
갈라지는 것인데, 이 구조가 그걸 구조적으로 막는다.
`Channel` 기반 스트리밍 2곳(`ai_stream`, `http_proxy_stream`)은 SSE에 자연스럽게 대응된다.

## 3. 재구축 대상 (Rust → 서버)

| 그룹 | 커맨드 수 | 성격 |
|---|---:|---|
| SQLite CRUD | ~55 | 17개 테이블, `db/mod.rs` 4,737줄. 기계적이지만 물량이 가장 크다 |
| AI 호출 | 5 | 이행의 핵심. 아래 별도 |
| 파일 포맷 | ~8 | `calamine`·`pdf-extract`·`docx-rs`·`rust_xlsxwriter`. JS 등가물이 부실해 소형 Rust Lambda 유지 권장 |
| Secrets vault | 8 | 웹에선 **대부분 소멸**. 키 하나가 Secrets Manager에 있고 사용자는 보지 않는다 |
| MCP / Confluence | ~10 | 잘 넘어간다. `mcp/client.rs`가 이미 stdio가 아니라 HTTP+SSE. OAuth는 웹 리다이렉트로 오히려 단순해진다 |
| 데스크톱 전용 | ~10 | 네이티브 다이얼로그·클립보드·파일 IO·앱 메뉴·업데이터·Claude Desktop 브리지. 폐기 또는 브라우저 API로 강등 |

### AI 호출의 방향이 뒤집힌다

현재 `ai_complete`는 프론트에서 `api_key: String`을 받는다(`src-tauri/src/commands/ai.rs:61`).
브라우저가 키를 쥐고 LangChain을 직접 돌리며, Rust는 CORS 우회 폴백이다.

웹에서는 브라우저가 **아무것도 쥐지 않는다.** 서버가 회사 키 하나로 호출하고 SSE로 되돌려준다.
이 전환이 §1의 1번 문제를 해결하는 지점이다.

## 4. 예산에 안 잡히는 비용

포팅 비용이 아니라 여기가 실제 원가다.

- **멀티테넌시** — 스키마가 단일 사용자다. `projects`를 포함해 **어느 테이블에도 owner 컬럼이 없다.**
  전 테이블에 테넌트 컬럼과 `WHERE user_id = ?`가 필요하다. 한 번 틀리면 번역가 A가 B의
  미출시 스트링을 본다. 이행 전체에서 가장 위험하고 밖에서 안 보인다.
- **인증** — 사내 SSO(Azure AD/Okta) 연동. Cognito federation 또는 ALB OIDC. 계정을 직접 만들지 않는다.
  부수 효과로 사내 인원만 접근 가능해져 보안 질문의 상당 부분이 함께 해결된다.
- **비용 통제** — 공유 키에서는 한 사람이 대형 문서를 고비용 모델로 돌리면 실제 돈이 나간다.
  `ai_usage_records` + `src/ai/pricing.ts`가 이미 있는 게 출발점이지만, **표시용에서
  서버 집행 쿼터로 승격**해야 한다.
- **동시성** — 데스크톱은 단일 작성자를 전제한다. 두 탭에서 같은 프로젝트를 열면 조용히 덮어쓴다.
  프로젝트당 단일 편집자 잠금이 가장 단순하다.
- **보안 검토** — 미출시 스트링이 사내 경계를 나간다. 정적 SPA는 데이터가 없어 무관하지만
  API·DB는 사내 VPC에 둔다. **착수 전에** 보안팀과 합의할 것.

## 5. 스택 검토 (Vercel + AWS 가정)

**Vercel** — 가능하지만 실질은 Vite SPA 정적 호스팅이다. SSR/엣지는 쓰이지 않는다.
프리뷰 배포는 실익이 있다. 대신 크로스 오리진이라 CORS와 `SameSite=None; Secure` 쿠키가 따라온다.
S3+CloudFront를 같은 AWS 계정에 두면 경계·청구·보안검토가 하나로 유지된다.

**Lambda — 스트리밍 제약이 여기서 걸린다.**

- API Gateway는 REST·HTTP API **모두 응답 스트리밍을 지원하지 않는다**(버퍼링).
- Lambda에서 스트리밍하려면 **Function URL + `InvokeMode: RESPONSE_STREAM`** +
  `awslambda.streamifyResponse`가 필요하다. 즉 스트리밍 경로는 API Gateway 뒤에 둘 수 없다.
- RDS + Lambda는 커넥션 고갈을 부른다. RDS Proxy 또는 Aurora Serverless v2가 필요하다.
- 전체 문서 번역이 15분을 넘길 수 있으면 요청이 아니라 큐 작업이 되어야 한다.

**권장**: API는 **App Runner 또는 Fargate**. 상주 Node 프로세스 하나면 스트리밍·커넥션 풀링·
LangChain의 상태 있는 부분이 전부 자연스럽게 동작하고, 데스크톱 코드의 가정에 가깝다.
Lambda도 정당한 선택지이나 위 네 가지를 감수해야 한다.

## 6. 실측 — 성능·비용의 실제 모양

### 6.1 문서 크기 (프로젝트 111개)

| | 크기 |
|---|---|
| 중앙값 | **10 KB** |
| 평균 | 21.8 KB |
| 상위 10% 경계 | 48 KB |
| 최대 | 290 KB |

### 6.2 저장 동작

- `projectStore.ts:523` — 1.5초 idle 디바운스 후 `saveProject()`
- `src/tauri/project.ts:18` — **프로젝트 객체 전체**를 전송
- `upsertAutoSnapshot` — 별도로 blocks JSON 전체를 전송

로컬에서는 ~1ms라 무해하다. 네트워크로 나가면 문서 크기에 비례한다.

### 6.3 AI 기능별 실사용

| 기능 | 호출 | 총 토큰 | 호출당 | 비중 |
|---|---:|---:|---:|---:|
| selection-retranslate | **779** | 750K | **963** | 5% |
| chat | 655 | **12.4M** | 18,896 | **78%** |
| polish | 268 | 845K | 3,152 | 5% |
| translate | 124 | 1.0M | 8,174 | 6% |
| review | 90 | 840K | 9,329 | 5% |

**선택 재번역이 이 앱의 킬러 기능이다.** 최다 사용이면서 호출당 비용이 채팅의 1/20이다.
웹에서 공유 키로 갈 때 가장 안전하면서 가장 사랑받는 기능이므로 여기에 투자한다.

### 6.4 채팅 도구 실사용 (메시지 1,380개)

| 도구 | 호출 |
|---|---:|
| `get_target_document` | 267 |
| `get_source_document` | 220 |
| `get_aligned_selection_context` | 127 |
| `propose_selection_edit` | 57 |
| `get_review_results` | 11 |
| `suggest_translation_rule` | 9 |
| `search`(웹) | 6 |
| 그 외 9종 | 각 1–4 |
| `suggest_forbidden_term`, `web_search` | 0 |

상위 4개가 93%. `review_translation`·`get_review_chunk`의 0은 `c45b38a`(ADR-0022)로
방금 추가됐기 때문이며 폐기 근거가 아니다.

### 6.5 테이블 실사용

```
attachments      0 행      ← 한 번도 사용 안 됨
mcp_servers      0 행      ← 한 번도 사용 안 됨
comments         6 행
segments       111 행      ← 프로젝트당 1개, 전부 자명한 1:1 매핑
glossary_entries 302 행
chat_messages  1380 행
history        474개 (아래 §7.2)
```

## 7. 기능 정리 — 결정 사항

### 7.1 삭제 확정 (근거: 0행이거나 웹에서 원리적 불가)

| 대상 | 근거 | 제거량 |
|---|---|---:|
| Claude Desktop MCP 브리지 | 웹에서 불가 | Rust 558 + TS 3,043 |
| MCP 레지스트리 | `mcp_servers` 0행 | Rust 2,024 + TS 450 |
| 첨부파일 | `attachments` 0행 | Rust 447 |
| Secrets vault | 웹에서 존재 이유 소멸 | Rust 1,167 |
| 세그먼트 모델 | 111개 전부 자명한 1:1 | 테이블 + 인덱스 + 관련 코드 |
| Dev 패널 (`ReviewTestPanel`) | 개발 전용 | TS 532 |
| 네이티브 다이얼로그·메뉴·업데이터·클립보드 | 자동 소멸 | TS ~300 |
| **엑셀 용어집 입출력** | 결정됨 — CSV만 유지 | Rust ~400 |

제거되는 크레이트: `pdf-extract`, `docx-rs`, `quick-xml`, `zip`, `keyring`,
`chacha20poly1305`, `zeroize`, `open` — 빌드 시간과 공격 표면이 함께 줄어든다.

⚠️ 엑셀은 번역가의 실무 표준일 수 있다. **팀 확인 후 확정할 것.**

### 7.2 히스토리 — 메커니즘은 유지, 아카이브는 폐기

스냅샷 474개 전수 분류:

| 출처 | 개수 |
|---|---:|
| 번역 적용 시 자동 | 348 |
| 폴리싱·재번역 적용 시 자동 | ~117 |
| 복원 직전 자동 | 4 |
| 자동 저장(`kind='auto'`) | 2 |
| **사용자가 직접 이름 붙인 것** | **1** |

**복원은 7개월간 111개 프로젝트에서 4회** 사용됐다.

- **유지** — 파괴적 AI 적용 직전 스냅샷. 465개가 이 용도이고, 보험은 청구 횟수로 가치를 재지 않는다.
  단 **프로젝트당 최근 3~5개만** 순환 보관.
- **폐기** — 저장/비교/이름변경/타임라인 UI(`components/history` 1,588줄 + 스토어 일부 + Rust 191줄).
  474개 중 사용자가 이름 붙인 게 1개다.
- **대체** — 적용 결과에 "되돌리기" 하나.

스토리지: 사용자당 **10MB → 약 300KB**.

전면 삭제는 권하지 않는다. 번역 통째 덮어쓰기를 되돌릴 방법이 사라진다.

### 7.3 유지 확정

- **문서 검수(review)** — 사용량 대비 코드 비율은 앱에서 가장 나쁘지만(90회 / 6,316줄),
  `c45b38a`(ADR-0022)로 방금 되살린 기능이고 **필요하다고 결정됨**. 유지.
- **선택 재번역 / 번역 / 용어집 / 프로젝트 메모리** — 실사용 확인됨.
- **usage ledger** — 웹에서는 표시용이 아니라 **쿼터 집행 수단으로 승격**.

### 7.4 미결

- **인라인 코멘트** (`comments` 6행, 672줄) — 웹 v1 포함 여부 미정.

## 8. 자동 저장은 로컬로 (local-first)

**결정: 델타 전송 프로토콜은 만들지 않는다.**

```
편집 → IndexedDB 자동 저장 (즉시, 네트워크 0)     ← 현재와 동일한 체감
        ↓ idle 20~30초 / 탭 닫힘 / 명시적 저장
      서버 (내구성 있는 정본, 기기 간 이동용)
```

중앙값 10KB / 평균 21.8KB이므로, 자동 저장이 로컬로 빠지면 서버 전송은 통째로 보내도
초당 1KB 미만이다. **델타 프로토콜이 불필요해지고 할 일이 줄어든다.**

부수 효과로 **오프라인 동작이 되살아난다**(웹 이행의 손실 항목 하나가 회수된다).

결정해야 할 것:

1. **동기화 주기 = 데이터 유실 창.** 브라우저가 죽으면 그 구간을 잃는다. 30초가 무난.
2. **IndexedDB는 브라우저·오리진별 격리.** 회사 Chrome ≠ 집 Safari.
   서버 사본은 선택이 아니라 필수이며 빈도만 낮아진다.
3. **두 탭 동시 편집**은 local-first에서 오히려 충돌이 커진다. 프로젝트당 단일 편집자 잠금이 단순.

## 9. 채팅 프롬프트 최적화 — 철회 (2026-09-04 재검증)

조사 초기에 채팅 컨텍스트 과주입을 지적했으나 **코드 확인 결과 전부 이미 구현돼 있었다.**
DB 수치만 보고 코드를 확인하지 않은 것이 원인이다. 재제안 방지를 위해 기록한다.

| 주장 | 실제 | 근거 |
|---|---|---|
| 문서 도구에 상한 없음 | **있다.** 8,000자 | `toolRegistry.ts:15,24` → `documentTools.ts:203-212` |
| 도구 20개가 매 호출 고정비 | **필터링된다.** general 15개 | `resolveChatTools.ts:42-52` (profile + requires) |
| 도구 결과가 재전송됨 | **압축 배선됨** | `ToolResultCompactionEdit` → `runAgentStream.ts:269` |
| 원문·번역문 따로 조회 | 사실이나 **낭비 아님** | 모델이 필요한 쪽을 가져오는 정상 동작 |

검증: `documentTools.test.ts`(15) + `resolveChatTools.test.ts`(12) +
`toolResultCompaction.test.ts`(4) = **31 passed**.

**도구 로스터를 턴마다 바꾸는 최적화는 금지.** Anthropic 프리픽스가 `tools → system → messages`
순으로 렌더되므로 목록이 흔들리면 그 뒤 캐시가 전부 무효화된다
(`resolveChatTools.ts` 헤더에 근거 기재). 현재 캐시 적중률 42%가 이 안정성 덕이다.

### 실제 토큰 동인은 루프 수

| 루프(`model_calls`) | 턴 수 | 평균 입력 | 전체 토큰 비중 |
|---:|---:|---:|---:|
| 1 | 132 (20%) | 12,570 | 8% |
| 2 | 380 (58%) | 28,618 | **53%** |
| 3 | 111 (17%) | 47,641 | 26% |
| 4 | 25 (4%) | 73,838 | 9% |
| 6 | 7 (1%) | 141,350 | 5% |

**스텝당 +16,000~19,000 토큰**으로 거의 선형이다. 에이전트 루프가 매 스텝 누적 메시지를
다시 보내는 구조상 정상이며 버그가 아니다. 바닥값(1루프 12,570 / 최소 6,750)이
시스템 프롬프트 + 도구 정의 + 용어집 + 메모리 다이제스트의 고정비다.

캐시가 20.7M 중 8.7M을 흡수해 **실효 과금은 이미 약 38% 낮다.**

**따라서 웹의 채팅 비용 통제는 프롬프트 절감이 아니라 (1) 사용자별 쿼터, (2) 용도별 모델 선택
두 가지로 좁혀진다.** `DEFAULT_MAX_MODEL_STEPS = 6` 하향은 비용 절감이 아니라 기능 축소이므로
권하지 않는다.

## 10. 단계 순서

큰 한 번의 이행으로 하지 않는다. 각 단계가 그 자체로 가치를 낸다.

| 단계 | 내용 | 규모 |
|---|---|---|
| **0** | **호스팅 AI 프록시 — 기존 데스크톱 앱용.** `ai_complete`/`ai_stream`이 이미 키를 인자로 받으므로, SSO 뒤의 사내 엔드포인트를 보는 모드를 추가한다. **웹 포팅 0줄로 §1의 1번 문제가 사라지고**, 산출물이 그대로 웹의 AI 백엔드가 된다 | 며칠 |
| 1 | `invoke.ts` HTTP 트랜스포트 + 읽기 전용 웹 빌드. 브라우저에서 프로젝트를 열고 읽는 데 필요한 커맨드만. 이음매를 끝단까지 증명 | |
| 2 | 인증 + 멀티테넌트 Postgres + CRUD 커맨드 | **최대 물량** |
| 3 | 파일 입출력, MCP/Confluence, 첨부 | |
| 4 | 데스크톱 앱의 존재 이유를 재정의. 파워유저/오프라인/Claude Desktop 브리지 빌드로 정착할 수 있고 그것도 괜찮지만, **표류가 아니라 결정이어야 한다** | |

1인 기준 대략: 0단계는 며칠, 완전 동등성은 2개월 남짓이며 대부분이 2단계다.
**0단계만으로 접근성 문제의 상당 부분이 해소된다.**

## 11. 절감 요약

| | Rust | TS |
|---|---:|---:|
| §7.1 삭제 확정 | ~4,600 | ~4,300 |
| §7.2 히스토리 아카이브 UI | 191 | ~1,700 |
| §7.3 검수 **유지** | — | (6,316 보존) |
| **합계** | **~4,800 (백엔드의 33%)** | **~6,000** |

## 12. 다음에 결정할 것

1. **웹의 목표가 무엇인가** — "팀원이 마찰 없이 쓴다"면 0단계 + 서명된 DMG로 충분할 수 있다.
   "사내 서비스가 된다"면 멀티테넌시와 보안 검토가 일정 그 자체다.
2. 엑셀 용어집 입출력 제거에 대한 팀 확인
3. 인라인 코멘트의 웹 v1 포함 여부
4. 컴퓨트 선택 — App Runner/Fargate vs Lambda Function URL

---

## 부록: 측정 재현

```bash
DB=~/Library/Application\ Support/com.oddeyes.desktop/ite.db
cp "$DB" /tmp/probe.db

# 기능별 AI 사용
sqlite3 /tmp/probe.db "SELECT feature, COUNT(*), SUM(input_tokens+output_tokens)
  FROM ai_usage_records GROUP BY feature ORDER BY 2 DESC;"

# 루프 수별 입력 토큰
sqlite3 /tmp/probe.db "SELECT model_calls, COUNT(*), ROUND(AVG(input_tokens+cache_read_input_tokens))
  FROM ai_usage_records WHERE feature='chat' GROUP BY model_calls;"

# 문서 크기 분포
sqlite3 /tmp/probe.db "SELECT AVG(s)/1024 FROM (SELECT SUM(LENGTH(content)) s FROM blocks GROUP BY project_id);"

# 스냅샷 출처
sqlite3 /tmp/probe.db "SELECT description, kind FROM history;"
```

관련: [[ai-prompt-audit]](§9의 재제안 금지 근거), ADR-0022(검수 도구 부활),
ADR-0012/0017(모델 선택).
