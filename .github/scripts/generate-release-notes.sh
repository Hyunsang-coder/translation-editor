#!/bin/bash
# AI 기반 릴리즈 노트 생성 스크립트

set -e

CURRENT_TAG=${1:-${GITHUB_REF#refs/tags/}}
REPO=${2:-$GITHUB_REPOSITORY}

# 이전 태그 찾기
PREV_TAG=$(git describe --tags --abbrev=0 ${CURRENT_TAG}^ 2>/dev/null || echo "")

# 커밋 로그 가져오기
if [ -n "$PREV_TAG" ]; then
  COMMITS=$(git log ${PREV_TAG}..${CURRENT_TAG} --pretty=format:"- %s" | head -20)
else
  COMMITS=$(git log -10 --pretty=format:"- %s")
fi

echo "=== Commits ===" >&2
echo "$COMMITS" >&2

# 프롬프트 구성
PROMPT="다음 커밋 목록을 분석해서 사용자 친화적인 한국어 릴리즈 노트를 작성해줘.

규칙:
- 마크다운 형식 사용
- 이모지로 카테고리 구분 (🚀 Features, 🐛 Bug Fixes, 🔧 Improvements, 📝 Documentation 등)
- 기술적 내용은 이해하기 쉽게 풀어서 설명
- chore, ci 같은 내부 작업은 '내부 개선' 카테고리로 간단히 정리
- 버전 범프 커밋은 제외

커밋 목록:
${COMMITS}"

# JSON 이스케이프
PROMPT_ESCAPED=$(echo "$PROMPT" | jq -Rs .)

# API 호출
RESPONSE=$(curl -s https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"gpt-5-nano\",
    \"messages\": [{\"role\": \"user\", \"content\": $PROMPT_ESCAPED}]
  }")

NOTES=$(echo "$RESPONSE" | jq -r '.choices[0].message.content // empty')

if [ -n "$NOTES" ]; then
  # Full Changelog 링크 추가
  if [ -n "$PREV_TAG" ]; then
    NOTES="${NOTES}

---
**Full Changelog**: https://github.com/${REPO}/compare/${PREV_TAG}...${CURRENT_TAG}"
  fi

  # 릴리즈 노트 업데이트
  gh release edit "$CURRENT_TAG" --notes "$NOTES"
  echo "✅ Release notes updated successfully" >&2
else
  echo "⚠️ Failed to generate release notes, keeping default" >&2
  echo "Response: $RESPONSE" >&2
  exit 1
fi
