# Ollama/Local LLM 지원 계획

> **Status**: Planning
> **Created**: 2025-01-24
> **Updated**: 2025-01-24
> **Approach**: B안 (기능별 폴백)

## 개요

OddEyes.ai에서 Ollama 등 로컬 LLM API를 지원하기 위한 구현 계획.

### 목표
- OpenAI 호환 API를 제공하는 로컬 LLM 서버 지원 (Ollama, LM Studio, vLLM 등)
- 기존 OpenAI/Anthropic 기능과의 호환성 유지
- 모델별 제약사항에 대한 우아한 폴백

### 비목표
- Ollama 전용 API (`/api/generate`) 직접 지원
- 모델 다운로드/관리 기능

---

## Ollama 최신 정보 (2025년 1월 기준)

> 출처: [Ollama OpenAI Compatibility](https://ollama.com/blog/openai-compatibility), [Tool Support](https://ollama.com/blog/tool-support), [Ollama Docs](https://docs.ollama.com/capabilities/tool-calling)

### OpenAI 호환 API

Ollama는 OpenAI Chat Completions API와 호환되는 엔드포인트 제공:
- **엔드포인트**: `http://localhost:11434/v1`
- **API 키**: `ollama` (필수이지만 미사용, 아무 값이나 가능)
- **Tool Calling**: 지원 (OpenAI 호환 형식)

### ⚠️ 중요: 컨텍스트 기본값

**Ollama 기본 컨텍스트는 2048 토큰** (모델 최대가 아님!)

모델이 128k를 지원해도 Ollama는 기본적으로 2048만 사용. 변경 방법:

```bash
# 방법 1: 환경변수
OLLAMA_CONTEXT_LENGTH=32768 ollama serve

# 방법 2: 런타임 설정
/set parameter num_ctx 32768

# 방법 3: Modelfile로 커스텀 모델 생성
FROM llama3.1:8b
PARAMETER num_ctx 32768
```

→ **앱에서 `num_ctx` 파라미터 전달 필요** (또는 사용자에게 설정 안내)

### Tool Calling 지원 모델

[Ollama Library](https://ollama.com/library)에서 "tools" 태그 확인:

| 모델 | Tool Calling | 컨텍스트 (최대) | 권장 RAM |
|------|-------------|----------------|----------|
| **llama3.1:8b** | ✅ | 128k | 8GB+ |
| **llama3.2:3b** | ✅ | 128k | 4GB+ |
| **qwen2.5:7b** | ✅ | 32k~128k | 8GB+ |
| **qwen3:8b** | ✅ | 40k | 8GB+ |
| **mistral:7b** | ✅ | 32k | 8GB+ |
| **mixtral:8x7b** | ✅ | 32k | 48GB+ |
| gemma2:9b | ❌ | 8k | 8GB+ |
| phi-3:mini | ❌ | 128k | 4GB+ |
| llava:7b | ❌ (Vision만) | 4k | 8GB+ |

> **권장**: llama3.1:8b (균형), qwen2.5:7b (Tool Calling 우수), mistral:7b (가벼움)

### LangChain 통합 옵션

**옵션 1: ChatOpenAI + baseURL (현재 계획)**
```typescript
import { ChatOpenAI } from '@langchain/openai';

const llm = new ChatOpenAI({
  apiKey: 'ollama',
  model: 'llama3.1',
  configuration: {
    baseURL: 'http://localhost:11434/v1',
  },
});
```

**옵션 2: @langchain/ollama 패키지** (대안)
```typescript
import { ChatOllama } from '@langchain/ollama';

const llm = new ChatOllama({
  model: 'llama3.1',
  baseUrl: 'http://localhost:11434',
});
```

→ **ChatOpenAI 방식 채택** (기존 코드 변경 최소화, OpenAI/Anthropic과 통합 관리)

---

## 기술 분석

### 현재 코드 제약

| 파일 | 제약 | 수정 필요 |
|------|------|----------|
| `src/ai/client.ts` | `configuration.baseURL` 미전달 | Yes |
| `src/stores/aiConfigStore.ts` | baseURL/contextLimit 필드 없음 | Yes |
| `src/ai/translateDocument.ts` | 컨텍스트 크기 하드코딩 (200k/400k) | Yes |
| `src/ai/chat.ts` | `useResponsesApi: true` (OpenAI 전용) | Yes |
| Settings UI | 엔드포인트/컨텍스트 설정 없음 | Yes |

---

## 주요 이슈 및 해결 방안

### 1. Tool Calling

**문제**: Ollama 모델 중 일부만 Tool Calling 지원
- 지원: llama3.1+, qwen2.5, mistral-nemo
- 미지원: llama3.2 (3B 이하), phi-3, gemma2

**해결**:
```typescript
// chat.ts - Tool Calling 실패 시 폴백
try {
  return await runToolCallingLoop({ model, tools, messages });
} catch (e) {
  if (isToolCallingNotSupported(e)) {
    // 폴백: 문서를 컨텍스트에 직접 포함하여 단순 채팅
    return runSimpleChatMode({
      model,
      messages: injectDocumentsToMessages(messages, sourceDoc, targetDoc),
    });
  }
  throw e;
}
```

**UX 영향**:
- Tool Calling 미지원 시 채팅에서 문서 조회 도구 사용 불가
- 문서가 컨텍스트에 직접 포함되어 토큰 소비 증가
- 번역 기능은 영향 없음 (Tool Calling 미사용)

### 2. 컨텍스트 제한

**문제**:
- **Ollama 기본값이 2048 토큰** (모델 최대와 무관!)
- 모델별 실제 컨텍스트 윈도우도 다름 (8k ~ 128k)
- 컨텍스트 증가 시 VRAM 사용량도 증가

**해결**:
```typescript
// 1. 사용자 설정 가능하게
interface AiConfigState {
  contextLimit?: number;  // 토큰 단위 (Ollama num_ctx에 해당)
}

// 2. 보수적 기본값 (Ollama 기본 2048 고려)
function getDefaultContextLimit(baseUrl?: string): number {
  const isLocal = baseUrl?.match(/localhost|127\.0\.0\.1|0\.0\.0\.0/);
  // 로컬: 8k (2048보다 높지만 대부분 모델에서 안전)
  // 단, 사용자에게 Ollama 설정 필요함을 안내
  return isLocal ? 8_000 : (provider === 'anthropic' ? 200_000 : 400_000);
}

// 3. 사전 검증 (Ollama는 초과해도 에러 없이 잘림!)
if (estimatedTokens > contextLimit * 0.9) {
  throw new Error(`컨텍스트 제한 초과: ${estimatedTokens} > ${contextLimit}`);
}

// 4. 자동 청킹 (기존 로직 활용)
if (estimatedTokens > contextLimit * 0.6) {
  return translateSourceDocWithChunking(params);
}
```

**⚠️ Ollama 컨텍스트 초과 시 동작**:
- **에러 없이 조용히 잘림 (truncation)** - 매우 위험!
- 번역 시 문서 뒷부분 누락
- 채팅 시 이전 대화 맥락 손실
- **→ 앱에서 사전 검증 필수**

**사용자 안내 필요**:
```
⚠️ Ollama 사용 시 컨텍스트 설정 필요
Ollama 기본 컨텍스트는 2048 토큰입니다.
더 긴 문서를 번역하려면 Ollama 설정을 변경하세요:
  OLLAMA_CONTEXT_LENGTH=32768 ollama serve
```

### 3. Responses API

**문제**: `useResponsesApi: true`는 OpenAI 전용

**해결**:
```typescript
// client.ts
const useResponsesApi =
  useFor === 'chat' &&
  !isLocalEndpoint(cfg.openaiBaseUrl);  // 로컬이면 비활성화

return new ChatOpenAI({
  apiKey: cfg.openaiApiKey,
  model,
  configuration: cfg.openaiBaseUrl ? { baseURL: cfg.openaiBaseUrl } : undefined,
  ...(useResponsesApi ? { useResponsesApi: true } : {}),
});
```

### 4. 내장 웹 검색

**문제**: `web_search_preview` (OpenAI), `web_search` (Anthropic)는 공식 API 전용

**해결**:
```typescript
// chat.ts
const builtInWebSearchTools =
  webSearchEnabled && !isLocalEndpoint(cfg.openaiBaseUrl)
    ? getBuiltInWebSearchTool(cfg.provider)
    : [];
```

**UX 영향**: 로컬 LLM 사용 시 내장 웹 검색 비활성화 (토글 숨김 또는 비활성화 표시)

### 5. Vision (이미지 입력)

**문제**: 일부 모델만 지원 (llava, llama3.2-vision)

**해결**: 기존 폴백 로직 활용 (이미 구현됨)
```typescript
// chat.ts:702-722 - 이미지 입력 실패 시 이미지 제외하고 재시도
if (usedImages) {
  const fallback = replaceLastHumanMessageText(
    messagesWithGuide,
    `${input.userMessage}\n\n[이미지 입력이 지원되지 않아 제외됨]`,
  );
  ({ finalText } = await runToolCallingLoop({ model, tools, bindTools, messages: fallback }));
}
```

### 6. max_tokens 출력 제한

**문제**: 모델별 출력 토큰 제한 다름

**해결**:
```typescript
// 사용자 설정 또는 보수적 기본값
const maxOutputTokens = cfg.maxOutputTokens ?? (isLocalEndpoint ? 4096 : 65536);
```

---

## 구현 계획

### Phase 1: 설정 인프라 (필수)

#### 1.1 aiConfigStore 확장
```typescript
// src/stores/aiConfigStore.ts
interface AiConfigState {
  // 기존 필드...

  // 신규 필드
  openaiBaseUrl?: string;       // 커스텀 엔드포인트 (예: http://localhost:11434/v1)
  contextLimit?: number;        // 컨텍스트 크기 (토큰), 기본값: 자동
  maxOutputTokens?: number;     // 출력 토큰 제한, 기본값: 4096 (로컬)
  customModelName?: string;     // 커스텀 모델명 (프리셋 외)
}
```

#### 1.2 config.ts 수정
```typescript
// src/ai/config.ts
export function getAiConfig(options?: AiConfigOptions): AiConfig {
  const store = useAiConfigStore.getState();

  return {
    // 기존...
    openaiBaseUrl: store.openaiBaseUrl,
    contextLimit: store.contextLimit ?? getDefaultContextLimit(store.openaiBaseUrl),
    maxOutputTokens: store.maxOutputTokens,
  };
}

function getDefaultContextLimit(baseUrl?: string): number {
  if (isLocalEndpoint(baseUrl)) return 16_000;
  return 400_000;  // OpenAI 기본
}

export function isLocalEndpoint(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.|10\.\d+\./.test(baseUrl);
}
```

#### 1.3 client.ts 수정
```typescript
// src/ai/client.ts
export function createChatModel(modelOverride?: string, options?: ModelOptions): BaseChatModel {
  const cfg = getAiConfig(options);
  const model = modelOverride ?? cfg.model;
  const isLocal = isLocalEndpoint(cfg.openaiBaseUrl);

  if (cfg.provider === 'openai' || cfg.provider === 'mock') {
    // API 키: 로컬이면 더미 값 허용
    const apiKey = isLocal ? (cfg.openaiApiKey || 'ollama') : cfg.openaiApiKey;
    if (!apiKey && !isLocal) throw new Error(i18n.t('errors.openaiApiKeyMissing'));

    const useResponsesApi = !isLocal && useFor === 'chat';

    return new ChatOpenAI({
      apiKey: apiKey || 'ollama',
      model,
      configuration: cfg.openaiBaseUrl ? { baseURL: cfg.openaiBaseUrl } : undefined,
      ...temperatureOption,
      ...maxTokensOption,
      ...(useResponsesApi ? { useResponsesApi: true } : {}),
    });
  }
  // Anthropic은 기존 로직 유지
}
```

#### 1.4 연결 테스트 함수 (신규)
```typescript
// src/ai/ollamaUtils.ts

/**
 * Ollama 서버 연결 테스트
 * Settings UI에서 "Test Connection" 버튼용
 */
export async function testOllamaConnection(baseUrl: string): Promise<{
  success: boolean;
  models?: string[];
  error?: string;
}> {
  try {
    // Ollama는 /api/tags로 모델 목록 조회 가능
    const apiBase = baseUrl.replace('/v1', '');
    const res = await fetch(`${apiBase}/api/tags`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const models = data.models?.map((m: any) => m.name) ?? [];

    return { success: true, models };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Connection failed',
    };
  }
}

/**
 * 특정 모델의 Tool Calling 지원 여부 확인
 * (Ollama API로 모델 정보 조회)
 */
export async function checkModelCapabilities(baseUrl: string, modelName: string): Promise<{
  supportsTools: boolean;
  contextLength?: number;
}> {
  try {
    const apiBase = baseUrl.replace('/v1', '');
    const res = await fetch(`${apiBase}/api/show`, {
      method: 'POST',
      body: JSON.stringify({ name: modelName }),
    });
    if (!res.ok) return { supportsTools: false };

    const data = await res.json();
    // Ollama 응답에서 template에 "tools" 포함 여부로 판단 (휴리스틱)
    const template = data.template ?? '';
    const supportsTools = template.includes('tool') || template.includes('function');

    // 컨텍스트 길이는 modelfile에서 추출
    const contextMatch = data.parameters?.match(/num_ctx\s+(\d+)/);
    const contextLength = contextMatch ? parseInt(contextMatch[1]) : undefined;

    return { supportsTools, contextLength };
  } catch {
    return { supportsTools: false };
  }
}
```

### Phase 2: 번역 기능 (필수)

#### 2.1 translateDocument.ts 수정
```typescript
// 컨텍스트 크기를 설정에서 가져오기
const MAX_CONTEXT = cfg.contextLimit ??
  (cfg.provider === 'anthropic' ? 200_000 : 400_000);

// max_tokens도 설정에서
const maxAllowedTokens = cfg.maxOutputTokens ??
  (cfg.provider === 'anthropic' ? 64000 :
   isLocalEndpoint(cfg.openaiBaseUrl) ? 4096 :
   cfg.model?.startsWith('gpt-5') ? 65536 : 16384);
```

#### 2.2 청킹 임계값 동적 조정
```typescript
// src/ai/chunking.ts
const CHUNK_THRESHOLD_RATIO = 0.6;  // 컨텍스트의 60%

function shouldUseChunking(tokens: number, contextLimit: number): boolean {
  return tokens > contextLimit * CHUNK_THRESHOLD_RATIO;
}
```

### Phase 3: 채팅 기능 (필수)

#### 3.1 Tool Calling 폴백
```typescript
// src/ai/chat.ts

async function runWithToolCallingFallback(params: {
  model: BaseChatModel;
  tools: Tool[];
  messages: BaseMessage[];
  sourceDoc?: string;
  targetDoc?: string;
}): Promise<{ finalText: string; toolsUsed: string[] }> {
  try {
    return await runToolCallingLoop({
      model: params.model,
      tools: params.tools,
      messages: params.messages,
    });
  } catch (e) {
    if (isToolCallingNotSupported(e)) {
      console.warn('[AI] Tool calling not supported, falling back to simple chat');

      // 문서를 시스템 메시지에 직접 포함
      const enrichedMessages = injectDocumentsToSystemMessage(
        params.messages,
        params.sourceDoc,
        params.targetDoc,
      );

      // 단순 invoke (tool calling 없이)
      const result = await params.model.invoke(enrichedMessages);
      return {
        finalText: extractTextContent(result),
        toolsUsed: [],
      };
    }
    throw e;
  }
}

function isToolCallingNotSupported(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('tool') && (
      msg.includes('not supported') ||
      msg.includes('unsupported') ||
      msg.includes('invalid')
    )
  );
}
```

#### 3.2 웹 검색 비활성화
```typescript
// chat.ts
const builtInWebSearchTools =
  webSearchEnabled && !isLocalEndpoint(cfg.openaiBaseUrl)
    ? getBuiltInWebSearchTool(cfg.provider)
    : [];
```

### Phase 4: Settings UI (필수)

#### 4.1 Local LLM 설정 섹션 추가
```tsx
// src/components/settings/AppSettingsModal.tsx

{/* Local LLM Settings */}
<SettingsSection title={t('settings.localLlm.title')}>
  {/* 엔드포인트 입력 */}
  <SettingsRow label={t('settings.localLlm.endpoint')}>
    <div className="flex gap-2">
      <input
        type="text"
        placeholder="http://localhost:11434/v1"
        value={openaiBaseUrl}
        onChange={(e) => setOpenaiBaseUrl(e.target.value)}
        className="flex-1"
      />
      <Button
        onClick={handleTestConnection}
        loading={testing}
      >
        {t('settings.localLlm.testConnection')}
      </Button>
    </div>
    <HelperText>
      Ollama: http://localhost:11434/v1 | LM Studio: http://localhost:1234/v1
    </HelperText>
  </SettingsRow>

  {/* 연결 성공 시 모델 목록 표시 */}
  {availableModels.length > 0 && (
    <SettingsRow label={t('settings.localLlm.model')}>
      <Select
        value={customModelName}
        onChange={setCustomModelName}
        options={availableModels.map(m => ({ value: m, label: m }))}
      />
    </SettingsRow>
  )}

  {/* 컨텍스트 제한 */}
  <SettingsRow label={t('settings.localLlm.contextLimit')}>
    <input
      type="number"
      placeholder="8000"
      value={contextLimit}
      onChange={(e) => setContextLimit(Number(e.target.value))}
    />
    <HelperText>
      ⚠️ Ollama 기본값은 2048입니다. 서버에서 OLLAMA_CONTEXT_LENGTH를 설정하세요.
    </HelperText>
  </SettingsRow>

  {/* 최대 출력 토큰 */}
  <SettingsRow label={t('settings.localLlm.maxOutput')}>
    <input
      type="number"
      placeholder="4096"
      value={maxOutputTokens}
      onChange={(e) => setMaxOutputTokens(Number(e.target.value))}
    />
  </SettingsRow>

  {/* Ollama 설정 안내 */}
  <Callout type="info">
    <strong>💡 Ollama 설정 팁</strong>
    <ul>
      <li>더 긴 문서 번역: <code>OLLAMA_CONTEXT_LENGTH=32768 ollama serve</code></li>
      <li>Tool Calling 지원 모델: llama3.1, qwen2.5, mistral</li>
      <li>추천 모델: <code>ollama pull llama3.1:8b</code></li>
    </ul>
  </Callout>
</SettingsSection>
```

#### 4.2 연결 테스트 핸들러
```typescript
const [testing, setTesting] = useState(false);
const [availableModels, setAvailableModels] = useState<string[]>([]);

const handleTestConnection = async () => {
  if (!openaiBaseUrl) return;

  setTesting(true);
  try {
    const result = await testOllamaConnection(openaiBaseUrl);
    if (result.success) {
      setAvailableModels(result.models ?? []);
      toast.success(t('settings.localLlm.connectionSuccess'));
    } else {
      toast.error(t('settings.localLlm.connectionFailed', { error: result.error }));
    }
  } finally {
    setTesting(false);
  }
};
```

#### 4.3 모델 선택 드롭다운 확장
```typescript
// 커스텀 모델명 입력 허용
const modelOptions = [
  ...presetModels,
  // Ollama 모델 목록 (연결 테스트 후)
  ...(availableModels.length > 0 ? [{
    label: 'Ollama Models',
    options: availableModels.map(m => ({ value: m, label: m })),
  }] : []),
  // 직접 입력한 커스텀 모델
  ...(customModelName && !availableModels.includes(customModelName)
    ? [{ value: customModelName, label: `Custom: ${customModelName}` }]
    : []),
];
```

### Phase 5: i18n (필수)

```json
// src/i18n/locales/ko.json
{
  "settings": {
    "localLlm": {
      "title": "로컬 LLM 설정",
      "endpoint": "API 엔드포인트",
      "endpointHelp": "Ollama, LM Studio 등의 OpenAI 호환 엔드포인트",
      "contextLimit": "컨텍스트 제한 (토큰)",
      "contextLimitHelp": "모델의 최대 컨텍스트 크기. 모르면 16000 권장.",
      "maxOutput": "최대 출력 토큰",
      "customModel": "커스텀 모델명"
    }
  },
  "errors": {
    "contextLimitExceeded": "컨텍스트 제한 초과: {{actual}} > {{limit}} 토큰",
    "toolCallingNotSupported": "이 모델은 도구 호출을 지원하지 않습니다. 일부 기능이 제한됩니다."
  }
}
```

---

## 기능별 영향도

| 기능 | 로컬 LLM 지원 | 제한사항 |
|------|-------------|----------|
| **번역** | ✅ 완전 지원 | 긴 문서는 자동 청킹 |
| **채팅 (기본)** | ✅ 지원 | - |
| **채팅 (문서 조회)** | ⚠️ 조건부 | Tool Calling 미지원 시 문서 직접 포함 |
| **채팅 (웹 검색)** | ❌ 미지원 | 공식 API 전용 기능 |
| **채팅 (이미지)** | ⚠️ 조건부 | Vision 모델만 지원 |
| **번역 검수** | ✅ 지원 | 청킹으로 처리 |
| **규칙/컨텍스트 제안** | ⚠️ 조건부 | Tool Calling 미지원 시 불가 |

---

## 테스트 계획

### 단위 테스트
- [ ] `isLocalEndpoint()` 함수 테스트
- [ ] `getDefaultContextLimit()` 함수 테스트
- [ ] `testOllamaConnection()` 함수 테스트
- [ ] `checkModelCapabilities()` 함수 테스트
- [ ] Tool Calling 폴백 로직 테스트
- [ ] 컨텍스트 초과 감지 테스트

### 통합 테스트
- [ ] Ollama + llama3.1 번역 테스트 (Tool Calling 지원)
- [ ] Ollama + qwen2.5 채팅 테스트 (Tool Calling 지원)
- [ ] Ollama + phi-3 채팅 테스트 (Tool Calling 미지원 → 폴백)
- [ ] LM Studio 연동 테스트
- [ ] 컨텍스트 초과 시 청킹 동작 테스트

### 수동 테스트 시나리오

#### 시나리오 1: 기본 설정
```bash
# 1. Ollama 설치 및 모델 다운로드
ollama pull llama3.1:8b

# 2. 컨텍스트 확장하여 서버 시작
OLLAMA_CONTEXT_LENGTH=32768 ollama serve
```

#### 시나리오 2: 앱에서 테스트
1. Settings → Local LLM → 엔드포인트 입력: `http://localhost:11434/v1`
2. "Test Connection" 클릭 → 모델 목록 표시 확인
3. 모델 선택: `llama3.1:8b`
4. 컨텍스트 제한 설정: `16000`

#### 시나리오 3: 번역 테스트
1. 짧은 문서 (1000자 이하) → 단일 호출 성공
2. 중간 문서 (5000자) → 단일 호출 성공
3. 긴 문서 (20000자) → 청킹 동작 확인 (진행률 표시)

#### 시나리오 4: 채팅 테스트
1. 일반 질문 → 응답 확인
2. "원문을 요약해줘" → Tool Calling (문서 조회) 동작 확인
3. Tool Calling 미지원 모델 → 폴백 동작 확인

#### 시나리오 5: 에러 케이스
1. 서버 미실행 → 연결 실패 에러 표시
2. 잘못된 모델명 → 에러 메시지 표시
3. 컨텍스트 초과 → 청킹으로 자동 전환

---

## 마이그레이션

### 기존 사용자 영향
- 없음 (신규 설정 필드는 옵션)
- `openaiBaseUrl` 미설정 시 기존 동작 유지

### 설정 마이그레이션
```typescript
// aiConfigStore.ts - persist 버전 업데이트
const STORE_VERSION = 2;  // 1 → 2

migrate: (persisted, version) => {
  if (version < 2) {
    return {
      ...persisted,
      openaiBaseUrl: undefined,
      contextLimit: undefined,
      maxOutputTokens: undefined,
      customModelName: undefined,
    };
  }
  return persisted;
}
```

---

## 예상 작업량

| Phase | 작업 | 예상 규모 |
|-------|------|----------|
| 1 | 설정 인프라 | 중 |
| 2 | 번역 기능 | 소 |
| 3 | 채팅 기능 (폴백) | 중 |
| 4 | Settings UI | 중 |
| 5 | i18n | 소 |
| - | 테스트 | 중 |

---

## 참고 자료

### 공식 문서
- [Ollama OpenAI Compatibility](https://ollama.com/blog/openai-compatibility)
- [Ollama Tool Calling](https://docs.ollama.com/capabilities/tool-calling)
- [Ollama Model Library](https://ollama.com/library)
- [LangChain ChatOpenAI](https://js.langchain.com/docs/integrations/chat/openai)
- [LangChain ChatOllama](https://js.langchain.com/docs/integrations/chat/ollama/)

### 관련 가이드
- [Best Ollama Models for Function Calling 2025](https://collabnix.com/best-ollama-models-for-function-calling-tools-complete-guide-2025/)
- [How to Increase Context Length in Ollama](https://localllm.in/blog/local-llm-increase-context-length-ollama)
- [Ollama Context Window](https://blog.driftingruby.com/ollama-context-window/)

### LM Studio / 대안
- [LM Studio](https://lmstudio.ai/) - GUI 기반 로컬 LLM (OpenAI 호환 API 제공)
- [vLLM](https://github.com/vllm-project/vllm) - 고성능 LLM 서빙
