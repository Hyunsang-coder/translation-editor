import { vi } from 'vitest';

/**
 * AI 모킹 헬퍼
 * translateDocument 및 채팅 테스트용 API 모킹
 */

// ===== 모의 AI 응답 =====

export const MOCK_TRANSLATION_RESPONSE = `---TRANSLATION_START---
# API Integration Guide

## Introduction

This guide provides detailed instructions for integrating our REST API into your application.

## Prerequisites

- Node.js 14.x or higher
- npm 6.x or higher
- Basic knowledge of JavaScript
---TRANSLATION_END---`;

export const MOCK_REVIEW_RESPONSE = `---REVIEW_START---
[
  {
    "segmentIndex": 0,
    "segmentGroupId": "seg-0",
    "type": "terminology",
    "severity": "major",
    "problem": "Inconsistent terminology: 'aplicación' should be 'application' (already used elsewhere)",
    "suggestedFix": "application",
    "sourceText": "aplicación",
    "targetText": "application"
  }
]
---REVIEW_END---`;

export const MOCK_CHAT_RESPONSE = `Great question! In technical documentation, there's a subtle but important distinction:

**API Endpoint**: Refers specifically to the URL path that handles requests
(e.g., \`/users\`, \`/transactions\`). An endpoint is the entry point for a
specific action or resource.

**API URL**: The complete Uniform Resource Locator, including protocol,
domain, and path (e.g., \`https://api.example.com/users\`).

For consistency in your documentation, I recommend:
- Use "API endpoint" when referring to the specific path or action
- Use "API URL" when describing the complete address
- Alternatively, if you want maximum clarity, use "API endpoint URL"`;

// ===== 모의 LangChain 모델 =====

export function createMockChatModel(response: string = MOCK_TRANSLATION_RESPONSE) {
  return {
    stream: vi.fn().mockImplementation(async function* () {
      // 스트리밍 응답 시뮬레이션
      const chunks = response.split(' ');
      for (const chunk of chunks) {
        yield {
          content: chunk + ' ',
        };
      }
    }),

    invoke: vi.fn().mockResolvedValue({
      content: response,
    }),

    call: vi.fn().mockResolvedValue(response),
  };
}

// ===== 모의 AI 설정 =====

export function createMockAiConfig() {
  return {
    provider: 'openai' as const,
    model: 'gpt-4o',
    openaiApiKey: 'sk-test-key-123',
    temperature: 0.7,
    maxRecentMessages: 20,
  };
}

// ===== 모의 스트림 이벤트 =====

export async function* mockStreamResponse(content: string) {
  const chunks = content.split(' ');
  for (const chunk of chunks) {
    yield {
      content: chunk + ' ',
    };
  }
}
