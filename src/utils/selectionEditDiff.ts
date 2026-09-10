/**
 * 부분 재번역/폴리싱에서 블록의 기존 텍스트와 제안 텍스트가 실질적으로 달라졌는지 판정한다.
 * 앞뒤 공백을 제외한 내용이 완전히 동일하면 변경 없는 것으로 본다.
 */
export function isSegmentChanged(currentText: string, replacementText?: string): boolean {
  if (!replacementText) return false;
  return currentText.trim() !== replacementText.trim();
}
