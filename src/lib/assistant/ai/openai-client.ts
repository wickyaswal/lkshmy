import { getEnv } from "@/lib/env";

import type { AiAssistantResponse } from "@/lib/assistant/ai/schema";
import type { AiSnapshot } from "@/lib/assistant/ai/types";

type OpenAiUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type OpenAiChoice = {
  message?: {
    content?: string;
  };
};

type OpenAiChatResponse = {
  choices?: OpenAiChoice[];
  usage?: OpenAiUsage;
};

const systemPrompt = `You are a trading study assistant. Educational only, not financial advice.
You can suggest "interesting candidates to consider/watch" but you cannot tell the user to buy/sell, and you cannot output the app's BUY decision.
You must not invent prices, spreads, MA, or any numeric values. Only use snapshot numbers.
Always consider feasibility with small balances: min order size and notional constraints matter.
When market sentiment is RED, emphasize selectivity and risk.
Always include:
1) Direct answer to the user's question (simple language if requested)
2) Top candidates to consider (per the deterministic rules) ranked using deterministic metrics already computed
3) Why these are interesting grounded in net edge/spread/deviation/viability
4) What could go wrong (fees, spread widening, slippage, whipsaw)
5) Learning corner: explain 3-5 terms (very short)
Return JSON only.
Never include markdown or HTML.
Use this exact top-level shape and keys:
{
  "answer": string,
  "top_candidates": [{ "pair": string, "status": "VIABLE"|"MARGINAL"|"NOT_VIABLE", "why_interesting": string, "numbers": { "spread_bps": number, "deviation_bps": number, "net_edge_bps": number }, "feasibility": { "min_order_ok": boolean, "notes": string[] }, "if_user_wants_to_simulate": { "entry": number, "tp": number, "sl": number, "notional": number, "qty": number } }],
  "risks": string[],
  "learning_corner": [{ "term": string, "simple": string }],
  "disclaimer": string
}
Do not add extra keys.`;

export const callOpenAiAssistant = async (input: {
  question: string;
  simpleLanguage: boolean;
  snapshot: AiSnapshot;
}): Promise<{
  rawText: string;
  usage: OpenAiUsage | null;
}> => {
  const env = getEnv();
  if (!env.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const userPrompt = JSON.stringify(
    {
      question: input.question,
      simpleLanguage: input.simpleLanguage,
      snapshot: input.snapshot
    },
    null,
    2
  );

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.openaiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.openaiModel,
      response_format: {
        type: "json_object"
      },
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userPrompt
        }
      ]
    })
  });
  const payload = (await response.json()) as OpenAiChatResponse & {
    error?: {
      message?: string;
    };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenAI API failed: ${response.status}`);
  }

  const rawText = payload.choices?.[0]?.message?.content ?? "";
  if (!rawText) {
    throw new Error("OpenAI returned an empty response.");
  }

  return {
    rawText,
    usage: payload.usage ?? null
  };
};
