# 9. 특화 기능 명세 (Specialized Sub-systems)

## 9.1 Ghost Chips (태그 보호)

### What
- 특정 특수 문자나 태그(예: `<tag>`, `{var}`)가 번역 과정에서 손상되지 않도록 보호하기 위해 **Ghost Chips**를 사용합니다.
- `chatStore.ts`와 `ghostMask.ts`를 통해 모델 호출 전 마스킹하고, 응답 후 복원하는 과정을 거칩니다.

---

## 9.2 Smart Context Summarizer

### What
- 대화 토큰 임계치 모니터링과 Project Context 제안 UX는 점진 구현 중이며, Add to Rules / Add to Context 버튼을 통해 수동 반영합니다.
