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
    cleanText: string | null;
}

const judgeSchema = z.object({
    decision: z.enum(['APPLY', 'REJECT']).describe('APPLY if the AI response contains a valid translation/modification that can be directly applied. REJECT if it is a refusal, question, or meta-commentary.'),
    reason: z.string().describe('Reason for the decision.'),
    cleanText: z.string().nullable().describe('If decision is APPLY, provide the clean text content to be applied, removing any conversational prefixes or suffixes. If the response is already clean or decision is REJECT, return null.'),
});

const JUDGE_PROMPT = `You are a semantic intent analyzer for a translation editor.
Your goal is to determine if the User's request implies a modification to the document that should be "Applied".
And if so, extract the content to apply.

Rules:
1. "APPLY" if the user asked to translate, fix, rewrite, modify, or edit the text.
2. "REJECT" if the user asked a question, asked for an explanation, or explicitly said "Don't apply", "Just explaining", "No changes".
3. "REJECT" if the AI's response is a refusal ("I cannot do that") or a clarification question.
4. If "APPLY", you must extract the actual content from the AI response into 'cleanText'. Remove conversational filler ("Sure, here is...", "The translation is...").
5. If the AI response IS the content (no filler), 'cleanText' should be the response itself.

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
            reason: `Judge Error: ${e instanceof Error ? e.message : String(e)}`,
            cleanText: null
        };
    }
}
