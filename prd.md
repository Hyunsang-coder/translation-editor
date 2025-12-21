prd.md는 제품의 목적, 가치, 그리고 사용자 경험의 핵심을 정의하는 문서입니다. 개발 과정에서 길을 잃지 않게 해주는 나침반 역할을 하죠. 사용자님의 비전과 전문 번역가로서의 요구사항을 반영하여 실무 수준으로 작성했습니다.

이 내용을 프로젝트 루트의 prd.md로 저장하세요.

📝 [PRD] Integrated Translation Editor (ITE)
1. 제품 개요 (Product Overview)
제품명: Integrated Translation Editor (ITE)

비전: "전문 번역가를 위한 Cursor AI". AI와의 협업이 번역가 본연의 리듬을 방해하지 않으면서, 편집 효율을 극대화하는 지능형 워크스테이션.

핵심 컨셉: 전통적인 CAT(Computer-Assisted Translation) Tool의 경직된 그리드 구조를 탈피하고, 자유로운 에디팅 환경 위에서 AI와 상호작용하는 Range-based AI Workflow를 지향함.

2. 타겟 사용자 (Target Audience)
게임, IT, 마케팅 분야의 인하우스 및 전문 프리랜서 번역가.

단순 번역을 넘어 AI를 활용한 스타일 교정, 용어 일관성 검수, 문맥 최적화가 필요한 전문가.

브라우저(검색/사전)와 에디터를 오가는 Alt-Tab 비용을 줄이고 싶은 생산성 중시 개발자 겸 번역가.

3. 핵심 기능 (Core Features)
3.1 Monaco 기반 "Document-First" 에디터
Target 중심 편집: 코딩 에디터의 강력한 기능을 유지하되, 행 번호와 복잡한 UI를 제거하여 일반 문서(Notion/Ulysses)와 같은 가독성 제공.

Source 참조 패널: 원문은 참고용으로 왼쪽에 배치하되, AI에게는 항상 최우선 맥락(Context)으로 제공됨.

Focus Mode: 원문 패널을 숨기고 오직 번역문과 AI 대화에만 집중할 수 있는 레이아웃 전환 지원.

3.2 Cursor 스타일의 AI 인터랙션
Inline Command (Cmd+K): 텍스트를 드래그한 후 즉시 명령을 내리고, 해당 위치에 AI 제안을 실시간 스트리밍으로 수신.

Smart Apply & Diff: AI 제안을 본문에 적용하기 전, 변경 사항을 초록색(추가)/빨간색(삭제)으로 시각화하여 검토.

One-Click Accept/Reject: 변경 사항을 직관적으로 확인하고 단축키나 클릭 한 번으로 최종 확정.

3.3 전문가용 컨텍스트 및 리소스 관리
Ghost Chips (태그 보호): {user_name}, <br> 등의 게임 태그를 시각적 칩으로 보호하여 AI나 사용자의 오염 방지.

Smart Context Memory: 이전 대화의 핵심 결정 사항(용어, 톤앤매너)을 요약하여 장기적인 일관성 유지.

Integrated Glossary RAG: 대규모 용어집을 로컬 벡터 DB로 관리하여, 현재 문장과 연관된 용어만 AI에게 자동 주입.

3.4 로컬 기반 프로젝트 관리
All-in-one Project File: SQLite 기반의 .ite 파일 하나에 텍스트, 이력, 대화 로그, 설정을 모두 통합 저장.

Snapshot History: 단순히 텍스트 수정 내역뿐 아니라, 해당 결정을 내릴 때 AI와 나눈 대화 맥락까지 함께 보존.

4. 사용자 경험 (UX) 원칙
Non-Intrusive AI: AI는 사용자가 명시적으로 요청(Cmd+K, Cmd+L)할 때만 개입함.

Keyboard-First: 거의 모든 기능(Apply, Accept, 패널 전환 등)은 마우스 없이 단축키로 제어 가능해야 함.

Visual Clarity: Diff 시각화 시 가독성을 해치지 않는 깔끔한 하이라이트와 폰트 가이드라인 준수.

5. 성공 지표 (Success Metrics)
Task Efficiency: 기존 방식 대비 문장당 번역/수정 소요 시간 30% 이상 단축.

Context Retention: AI가 이전 대화에서 결정된 용어나 스타일을 위반하는 사례(Hallucination) 최소화.

Focus Continuity: 작업 중 브라우저나 외부 툴로 창을 전환하는 횟수 70% 감소.

6. 사용자 시나리오 (User Scenario)
프로젝트 시작: 번역가가 원문 파일과 용어집을 ITE에 임포트하고 '게임 번역' 프리셋을 선택함.

집중 번역: 원문을 보며 Target 패널에 번역문을 작성함. 어려운 문장은 드래그 후 Cmd+K를 눌러 "이 문장을 더 비장한 톤으로 바꿔줘"라고 요청함.

검토 및 적용: AI가 제안한 문장이 본문에 Diff 형태로 나타남. 바뀐 단어가 용어집과 일치하는지 확인 후 Cmd+Y(Accept)를 눌러 반영함.

검수 모드: 원문 패널을 숨기고(Focus Mode) 전체 번역문만 읽으며 가독성을 점검함. 오타가 발견되면 AI에게 전체 맞춤법 검사를 요청하고 한 번에 Apply함.

완료 및 공유: 모든 이력이 포함된 .ite 파일을 저장하여 나중에 다시 열어도 당시의 모든 대화 맥락을 복구함.