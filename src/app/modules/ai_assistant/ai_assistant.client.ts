/**
 * The only place that talks to OpenAI. The key stays on the server (.env): the app
 * never sees it. One small model, a short answer, a timeout, one retry.
 */
import OpenAI from "openai";
import { configs } from "../../config";
import { logger } from "../../utils/logger";
import { AssistantRole, type IAssistantAnswer } from "./ai_assistant.interface";
import { parseAnswer } from "./ai_assistant.prompt";

let client: OpenAI | null = null;

const getClient = (): OpenAI | null => {
  if (!configs.OPENAI.api_key) return null;
  client ??= new OpenAI({
    apiKey: configs.OPENAI.api_key,
    baseURL: configs.OPENAI.base_url,
    timeout: 25_000,
    maxRetries: 1,
  });
  return client;
};

export const assistantConfigured = (): boolean => Boolean(configs.OPENAI.api_key);

// The answer always comes back as { reply, needsHuman }
const ANSWER_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "assistant_answer",
    strict: true,
    schema: {
      type: "object",
      properties: {
        reply: { type: "string", description: "The answer shown to the person" },
        needsHuman: { type: "boolean", description: "True when the support team should take over" },
      },
      required: ["reply", "needsHuman"],
      additionalProperties: false,
    },
  },
};

export interface AssistantTurn {
  role: AssistantRole;
  text: string;
}

/** Null when the assistant has no key or OpenAI failed (the caller answers with an error) */
export async function askModel(system: string, history: AssistantTurn[], safetyId: string): Promise<IAssistantAnswer | null> {
  const openai = getClient();
  if (!openai) return null;
  try {
    const completion = await openai.chat.completions.create({
      model: configs.OPENAI.model,
      messages: [
        { role: "system", content: system },
        ...history.map((m) => ({ role: m.role === AssistantRole.user ? ("user" as const) : ("assistant" as const), content: m.text })),
      ],
      response_format: ANSWER_FORMAT,
      max_completion_tokens: 500,
      temperature: 0.3,
      // Lets OpenAI spot abuse per person without knowing who they are
      safety_identifier: safetyId,
    });
    const message = completion.choices[0]?.message;
    if (message?.refusal) return { reply: message.refusal, needsHuman: true };
    const answer = parseAnswer(message?.content);
    return answer.reply ? answer : null;
  } catch (error) {
    // Never log the key or the conversation: the status and code are enough
    const e = error as { status?: number; code?: string; name?: string };
    logger.error("Assistant: OpenAI call failed", { status: e.status, code: e.code, name: e.name });
    return null;
  }
}
