import { z } from 'zod';
import { PromptTemplate } from '@langchain/core/prompts';
import { createChatModel } from '@/ai/client';
import { getAiConfig } from '@/ai/config';

export interface JudgeInput {
    userRequest: string;
    aiResponse: string;
}

export interface JudgeResult {
    decision: 'APPLY' | 'REJECT';
    reason: string;
    cleanText?: string;
}

const judgeSchema = z.object({
    decision: z.enum(['APPLY', 'REJECT']).describe('APPLY if the AI response contains a valid translation/modification that can be directly applied. REJECT if it is a refusal, question, or meta-commentary.'),
    reason: z.string().describe('Reason for the decision.'),
    cleanText: z.string().optional().describe('If decision is APPLY, provide the clean text content to be applied, removing any conversational prefixes or suffixes. If the response is already clean, return it as is.'),
});

const JUDGE_PROMPT = `You are a strict judge for an AI translation assistant.
The user asked for a translation or modification, and the AI responded.
Determine if the AI's response is a valid "Applyable" text update or if it is a refusal/question/conversational reply.

Rules:
1. "APPLY" ONLY if the AI provided the requested text content.
2. If the AI provided the text but surrounded it with "Here is the translation: ...", you must EXTRACT the clean text into 'cleanText'.
3. "REJECT" if the AI refused (e.g., "I cannot do that"), asked a clarifying question, or only provided an explanation without the changed text.
4. "REJECT" if the AI's response is just "Okay" or "Understood" without the actual content.

User Request: {userRequest}
AI Response: {aiResponse}
`;

export async function evaluateApplyReadiness(input: JudgeInput): Promise<JudgeResult> {
    const cfg = getAiConfig();

    // mock provider bypass
    if (cfg.provider === 'mock') {
        return { decision: 'APPLY', reason: 'Mock always approves', cleanText: input.aiResponse };
    }

    const judgeModel = createChatModel(cfg.judgeModel);

    // LangChain v1 Best Practice: use withStructuredOutput for extraction
    // This automatically handles tool calling or JSON mode depending on the model
    // enforce 'strict: true' for newer OpenAI models
    const structuredJudge = judgeModel.withStructuredOutput(judgeSchema, {
        name: 'judge_result',
        strict: true,
    });

    const prompt = PromptTemplate.fromTemplate(JUDGE_PROMPT);
    const chain = prompt.pipe(structuredJudge);

    try {
        const result = await chain.invoke({
            userRequest: input.userRequest,
            aiResponse: input.aiResponse,
        });
        return result as JudgeResult;
    } catch (e) {
        console.error('Judge chain failed', e);
        // Fallback: If judge fails, we conservatively Reject
        return {
            decision: 'REJECT',
            reason: `Judge Error: ${e instanceof Error ? e.message : String(e)}`
        };
    }
}
