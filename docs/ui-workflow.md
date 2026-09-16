# UI 수정 워크플로 (2026-09-16 합의)

실행 중인 앱을 기준으로 돌린다.

## 지시 형식

`위치 + 기준 + 기대 상태` — 스크린샷 불필요 (미적 판단·렌더 차이 확인 때만 첨부).

- 좋음: "⑥ 모달에서 m-save 버튼이 모달 우측 경계 밖으로 삐져나와 보여. 우측 패딩 32 맞춰줘"
- 나쁨: "m-save-t가 어긋난 것 같은데" (何 기준인지 없음)

## 에이전트 루프

1. 요소 특정 (컴포넌트명·testid·OpenPencil 노드명)
2. dev 서버 + Playwright로 해당 상태 스크린샷 캡처 (직접 확인)
3. React 코드 수정 (`src/components/...`)
4. 스크린샷 재캡처로 검증 (필요시 `npm run test:run` 관련 케이스)
5. 방향 탐색이 필요하면 OpenPencil 목업을 쓸 수도 있음 (선택 사항, 스펙으로 유지하지 않음)

## 연결 상태

- OpenPencil MCP (선택): opencode 전역 등록됨 (`http://localhost:7600/mcp`, Bearer 토큰은
  `~/Library/Application Support/OpenPencil/mcp.json`). 브릿지가 wedged되면
  프로세스 재시작 + 세션 정리(DELETE) 필요. 디자인 목업: `/Users/joo/OddEyes-user-journey.fig`
- Figma: 없음
