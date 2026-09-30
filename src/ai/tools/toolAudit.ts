/**
 * 도구가 LangChain `artifact`로 앱에 넘기는 감사 id 묶음.
 *
 * artifact는 모델에게 전송되지 않으므로, 앱(contextManifest)만 필요한 id는 모델이 읽는
 * content가 아니라 여기에 싣는다. 모델이 직접 써야 하는 id(예: 프로젝트 메모리의
 * `targetItemId`)는 content에도 남겨야 한다.
 */
export interface ToolAuditArtifact {
  projectMemoryItemIds?: string[];
  forbiddenTermIds?: string[];
  glossaryEntryIds?: string[];
}

const AUDIT_ID_FIELDS = ['projectMemoryItemIds', 'forbiddenTermIds', 'glossaryEntryIds'] as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** `onToolCall`의 artifact는 `unknown`으로 도착하므로 경계에서 형태를 검증한다. */
export function isToolAuditArtifact(value: unknown): value is ToolAuditArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return AUDIT_ID_FIELDS.every((field) => record[field] === undefined || isStringArray(record[field]));
}
