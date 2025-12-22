# 환경 변수 설정 (Vite)

이 프로젝트는 Vite 환경 변수를 사용합니다. 로컬에서 `.env.local`을 만들어 아래 값을 설정하세요.

## AI Provider 설정

```bash
# mock | openai | anthropic
VITE_AI_PROVIDER=mock

# provider별 모델명 (Main)
VITE_AI_MODEL=gpt-5.2

# 번역 적용 여부 및 텍스트 정제 판단 모델 (Judge)
# - 설정하지 않으면 OpenAI는 'gpt-5-mini', Anthropic은 'claude-3-haiku'를 사용합니다.
VITE_AI_JUDGE_MODEL=gpt-5-mini

# (선택) temperature
# - 최신 모델/엔드포인트 중에는 temperature를 무시/제약하는 경우가 있어
#   설정하지 않는 것을 기본으로 둡니다.
# - 설정하고 싶으면 숫자를 넣으세요 (0.0 ~ 1.0 권장)
# VITE_AI_TEMPERATURE=0.2

# 최근 대화 몇 개를 프롬프트에 포함할지
VITE_AI_MAX_RECENT_MESSAGES=12
```

## API Key

```bash
VITE_OPENAI_API_KEY=
VITE_ANTHROPIC_API_KEY=
```

## 보안 주의 (PRD/TRD 기준)

`prd.md`/`trd.md`의 방향성상, API Key는 가능한 한 **클라이언트에 직접 노출되지 않도록** 관리하는 것을 목표로 합니다.

- **권장(목표)**: Tauri(Rust) 백엔드에서 모델 호출/프록시를 담당하고, 프론트엔드는 IPC로만 요청합니다.
- **주의(현재)**: 개발 단계에서는 구현 편의상 클라이언트에서 호출하는 구성이 있을 수 있습니다. 이 경우
  - API 키를 커밋하지 말고 `.env.local` 로만 관리하세요.
  - 개인/로컬 개발 환경에서만 사용하세요.


