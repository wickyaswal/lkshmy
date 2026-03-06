import { NextRequest, NextResponse } from "next/server";

import { callOpenAiAssistant } from "@/lib/assistant/ai/openai-client";
import { enforceViableMessaging, buildFallbackAiResponse, normalizeModelResponse } from "@/lib/assistant/ai/response-builder";
import { aiAssistantRequestSchema, aiAssistantResponseSchema } from "@/lib/assistant/ai/schema";
import { buildAiSnapshot } from "@/lib/assistant/ai/snapshot-builder";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 12;
const rateLimitStore = new Map<string, number[]>();

const getClientKey = (request: NextRequest): string => {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  return "unknown";
};

const checkRateLimit = (key: string): { allowed: boolean; retryAfterMs: number } => {
  const now = Date.now();
  const existing = rateLimitStore.get(key) ?? [];
  const fresh = existing.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);

  if (fresh.length >= RATE_LIMIT_MAX) {
    const oldest = fresh[0] ?? now;
    const retryAfterMs = Math.max(0, RATE_LIMIT_WINDOW_MS - (now - oldest));
    rateLimitStore.set(key, fresh);
    return {
      allowed: false,
      retryAfterMs
    };
  }

  fresh.push(now);
  rateLimitStore.set(key, fresh);
  return {
    allowed: true,
    retryAfterMs: 0
  };
};

const parseModelJson = (rawText: string): unknown => {
  try {
    return JSON.parse(rawText);
  } catch {
    const firstBrace = rawText.indexOf("{");
    const lastBrace = rawText.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const slice = rawText.slice(firstBrace, lastBrace + 1);
      return JSON.parse(slice);
    }
  }

  throw new Error("Model response was not valid JSON.");
};

export async function POST(request: NextRequest) {
  const key = getClientKey(request);
  const rate = checkRateLimit(key);
  if (!rate.allowed) {
    return NextResponse.json(
      {
        message: "Rate limit exceeded. Please retry shortly."
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000))
        }
      }
    );
  }

  const startedAt = Date.now();

  try {
    const payload = await request.json();
    const parsed = aiAssistantRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        {
          message: "Invalid request payload."
        },
        {
          status: 400
        }
      );
    }

    const snapshot = await buildAiSnapshot({
      includeRawCandles: parsed.data.includeRawCandles,
      context: parsed.data.context
    });

    const env = getEnv();
    let aiResponse = buildFallbackAiResponse({
      question: parsed.data.question,
      simpleLanguage: parsed.data.simpleLanguage,
      snapshot
    });
    let model = "deterministic-fallback";
    let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;

    if (env.openaiApiKey) {
      const modelReply = await callOpenAiAssistant({
        question: parsed.data.question,
        simpleLanguage: parsed.data.simpleLanguage,
        snapshot
      });
      const parsedModel = parseModelJson(modelReply.rawText);
      const normalized = normalizeModelResponse(parsedModel, aiResponse);
      const validated = aiAssistantResponseSchema.safeParse(normalized);

      if (!validated.success) {
        console.warn("[assistant-ai] invalid model format, using fallback response", {
          issues: validated.error.issues.length
        });
        model = `${env.openaiModel}-invalid-fallback`;
      } else {
        aiResponse = validated.data;
      }
      usage = modelReply.usage;
    }

    aiResponse = enforceViableMessaging(aiResponse, snapshot);

    const elapsedMs = Date.now() - startedAt;
    console.info("[assistant-ai] response", {
      model,
      elapsedMs,
      usage
    });

    return NextResponse.json({
      asOf: snapshot.generatedAt,
      response: aiResponse,
      snapshot: parsed.data.includeSnapshot ? snapshot : undefined
    });
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    console.error("[assistant-ai] failed", {
      elapsedMs,
      error: error instanceof Error ? error.message : "unknown"
    });

    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Unable to generate assistant response."
      },
      {
        status: 500
      }
    );
  }
}
