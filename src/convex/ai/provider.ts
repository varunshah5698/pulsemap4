import { z } from "zod";

/**
 * One door to every model.
 *
 * Nothing above this file knows which provider answered. Selection happens on
 * the server from environment variables, keys never leave the server, and every
 * structured call is validated against a zod schema before it is trusted. If no
 * provider is configured the layer says so — it never invents an answer.
 *
 * Order of preference:
 *   1. the managed integration gateway already provisioned for this project
 *      (`VLY_INTEGRATION_BASE_URL` + `VLY_INTEGRATION_KEY`),
 *   2. any direct provider whose key is present (OpenAI-compatible, Anthropic,
 *      Gemini, Groq, OpenRouter).
 * `PULSE_AI_PROVIDER` / `PULSE_AI_MODEL` override the choice.
 */

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type Usage = { in: number; out: number };

export type StructuredRequest<T> = {
  /** For observability and logs, never for routing. */
  kind: string;
  system: string;
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  schemaName: string;
  maxOutputTokens?: number;
  temperature?: number;
};

export type StructuredResult<T> =
  | { ok: true; data: T; model: string; usage: Usage }
  | {
      ok: false;
      reason: "unavailable" | "invalid" | "rate-limited" | "network";
      message: string;
    };

type Candidate = {
  id: string;
  model: string;
  url: string;
  headers: Record<string, string>;
  /** Anthropic and Gemini shape their bodies differently. */
  flavour: "openai" | "anthropic" | "gemini";
};

/** Remembered across calls in one isolate: probing a path is a one-off cost. */
let resolved: Candidate | null = null;

function trimmed(value: string | undefined): string | null {
  const next = value?.trim();
  return next && next.length > 8 ? next : null;
}

function baseAndKey(): { base: string; key: string } | null {
  const base = trimmed(process.env.VLY_INTEGRATION_BASE_URL);
  const key = trimmed(process.env.VLY_INTEGRATION_KEY);
  if (!base || !key) return null;
  return { base: base.replace(/\/+$/, ""), key };
}

/**
 * The managed gateway speaks the OpenAI wire format. Its exact mount point is
 * not ours to assume, so the likely ones are tried in order and the winner is
 * remembered for the life of the isolate.
 */
function managedCandidates(): Candidate[] {
  const found = baseAndKey();
  if (!found) return [];
  const override = trimmed(process.env.PULSE_AI_PATH);
  const paths = override
    ? [override]
    : ["/chat/completions", "/v1/chat/completions", "/api/chat/completions", "/ai/chat/completions"];
  const model = trimmed(process.env.PULSE_AI_MODEL) ?? "gpt-4o-mini";
  const headerStyles: Record<string, string>[] = [
    { Authorization: `Bearer ${found.key}` },
    { "x-api-key": found.key },
    { Authorization: found.key },
  ];
  const out: Candidate[] = [];
  for (const path of paths) {
    for (const headers of headerStyles) {
      out.push({
        id: "managed",
        model,
        url: `${found.base}${path}`,
        headers: { "Content-Type": "application/json", ...headers },
        flavour: "openai",
      });
    }
  }
  return out;
}

function directCandidates(): Candidate[] {
  const out: Candidate[] = [];
  const model = trimmed(process.env.PULSE_AI_MODEL);

  const openai = trimmed(process.env.OPENAI_API_KEY);
  if (openai) {
    out.push({
      id: "openai",
      model: model ?? "gpt-4o-mini",
      url: "https://api.openai.com/v1/chat/completions",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openai}` },
      flavour: "openai",
    });
  }

  const groq = trimmed(process.env.GROQ_API_KEY);
  if (groq) {
    out.push({
      id: "groq",
      model: model ?? "llama-3.3-70b-versatile",
      url: "https://api.groq.com/openai/v1/chat/completions",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${groq}` },
      flavour: "openai",
    });
  }

  const openrouter = trimmed(process.env.OPENROUTER_API_KEY);
  if (openrouter) {
    out.push({
      id: "openrouter",
      model: model ?? "openai/gpt-4o-mini",
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openrouter}`,
      },
      flavour: "openai",
    });
  }

  const anthropic = trimmed(process.env.ANTHROPIC_API_KEY);
  if (anthropic) {
    out.push({
      id: "anthropic",
      model: model ?? "claude-3-5-haiku-latest",
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropic,
        "anthropic-version": "2023-06-01",
      },
      flavour: "anthropic",
    });
  }

  const gemini = trimmed(process.env.GEMINI_API_KEY) ?? trimmed(process.env.GOOGLE_AI_API_KEY);
  if (gemini) {
    const geminiModel = model ?? "gemini-2.0-flash";
    out.push({
      id: "gemini",
      model: geminiModel,
      url: `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${encodeURIComponent(gemini)}`,
      headers: { "Content-Type": "application/json" },
      flavour: "gemini",
    });
  }

  return out;
}

/** Every provider the server could use right now, best first. */
export function candidates(): Candidate[] {
  const forced = trimmed(process.env.PULSE_AI_PROVIDER);
  const all = [...managedCandidates(), ...directCandidates()];
  if (forced) {
    const only = all.filter((candidate) => candidate.id === forced);
    if (only.length > 0) return only;
  }
  return all;
}

export function aiConfigured(): boolean {
  return candidates().length > 0;
}

export function aiProviderIds(): string[] {
  return Array.from(new Set(candidates().map((candidate) => candidate.id)));
}

export function aiDefaultModel(): string | null {
  return candidates()[0]?.model ?? null;
}

/* --- Wire formats ---------------------------------------------------- */

function openAiBody(candidate: Candidate, messages: ChatMessage[], json: boolean, max: number, temperature: number) {
  return {
    model: candidate.model,
    messages,
    max_tokens: max,
    temperature,
    ...(json ? { response_format: { type: "json_object" } } : {}),
  };
}

function anthropicBody(system: string, messages: ChatMessage[], json: boolean, max: number, temperature: number) {
  return {
    model: "",
    system: `${system}${json ? "\n\nReply with a single JSON object and nothing else." : ""}`,
    messages: messages
      .filter((message) => message.role !== "system")
      .map((message) => ({ role: message.role, content: message.content })),
    max_tokens: max,
    temperature,
  };
}

function geminiBody(system: string, messages: ChatMessage[], json: boolean, max: number, temperature: number) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
    generationConfig: {
      maxOutputTokens: max,
      temperature,
      ...(json ? { responseMimeType: "application/json" } : {}),
    },
  };
}

type RawReply = { text: string; usage: Usage };

function replyText(candidate: Candidate, payload: unknown): RawReply {
  const data = payload as {
    choices?: { message?: { content?: unknown } }[];
    content?: { text?: unknown }[];
    candidates?: { content?: { parts?: { text?: unknown }[] } }[];
    usage?: Record<string, number>;
  };

  const usage: Usage = {
    in: data.usage?.prompt_tokens ?? data.usage?.input_tokens ?? 0,
    out: data.usage?.completion_tokens ?? data.usage?.output_tokens ?? 0,
  };

  if (candidate.flavour === "openai") {
    const content = data.choices?.[0]?.message?.content;
    if (typeof content === "string") return { text: content, usage };
    if (Array.isArray(content)) {
      const text = content
        .map((part) => (typeof part === "object" && part && "text" in part ? String((part as { text?: unknown }).text ?? "") : ""))
        .join("");
      return { text, usage };
    }
    return { text: "", usage };
  }

  if (candidate.flavour === "anthropic") {
    const text = (data.content ?? [])
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("");
    return { text, usage };
  }

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
  return {
    text,
    usage: { in: usage.in, out: usage.out },
  };
}

/* --- One call -------------------------------------------------------- */

async function callOnce(
  candidate: Candidate,
  system: string,
  messages: ChatMessage[],
  json: boolean,
  maxOutputTokens: number,
  temperature: number,
): Promise<{ ok: true; reply: RawReply } | { ok: false; status: number; body: string }> {
  const body =
    candidate.flavour === "openai"
      ? openAiBody(candidate, [{ role: "system", content: system }, ...messages], json, maxOutputTokens, temperature)
      : candidate.flavour === "anthropic"
        ? { ...anthropicBody(system, messages, json, maxOutputTokens, temperature), model: candidate.model }
        : geminiBody(system, messages, json, maxOutputTokens, temperature);

  let response: Response;
  try {
    response = await fetch(candidate.url, {
      method: "POST",
      headers: candidate.headers,
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, body: "network" };
  }

  if (!response.ok) {
    return { ok: false, status: response.status, body: (await response.text().catch(() => "")).slice(0, 300) };
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  return { ok: true, reply: replyText(candidate, payload) };
}

/* --- Structured output ---------------------------------------------- */

/** Models wrap JSON in prose or fences often enough to make stripping worth it. */
function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no object in reply");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function shapeHint<T>(schema: z.ZodType<T>, name: string): string {
  try {
    const json = z.toJSONSchema(schema) as Record<string, unknown>;
    delete json.$schema;
    return `Shape of the JSON object you must return (${name}):\n${JSON.stringify(json)}`;
  } catch {
    return `Return a JSON object matching the ${name} shape exactly.`;
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Ask a model for one validated object.
 *
 * A schema miss is retried once with the validator's complaint attached, since
 * that recovers most near-misses for the price of one extra call. Anything
 * still wrong is reported as a failure — callers surface it, they never guess.
 */
export async function structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
  const pool = resolved ? [resolved, ...candidates().filter((c) => c.id !== resolved?.id)] : candidates();
  if (pool.length === 0) {
    return {
      ok: false,
      reason: "unavailable",
      message: "No AI provider is connected on the server yet.",
    };
  }

  const system = `${request.system}\n\n${shapeHint(request.schema, request.schemaName)}\nRules: reply with one JSON object only. No prose, no code fences, no comments. Use null or omit a field rather than inventing a value.`;
  const maxOutputTokens = request.maxOutputTokens ?? 1400;
  const temperature = request.temperature ?? 0.4;

  let lastMessage = "The model did not answer in the expected shape.";
  let sawRateLimit = false;

  for (const candidate of pool) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const messages: ChatMessage[] =
        attempt === 0
          ? request.messages
          : [
              ...request.messages,
              {
                role: "user",
                content: `Your previous reply did not match the required shape (${lastMessage}). Reply again with one valid JSON object only.`,
              },
            ];

      const reply = await callOnce(candidate, system, messages, true, maxOutputTokens, temperature);
      if (!reply.ok) {
        if (reply.status === 401 || reply.status === 403 || reply.status === 404) {
          // Wrong endpoint or wrong credential: try the next candidate.
          if (candidate.id === "managed" && !resolved) continue;
          lastMessage = `provider rejected the request (${reply.status})`;
          break;
        }
        if (reply.status === 429) {
          sawRateLimit = true;
          lastMessage = "the provider is rate limiting right now";
          break;
        }
        lastMessage = `provider error (${reply.status || "network"})`;
        continue;
      }

      if (candidate.id === "managed") resolved = candidate;

      let parsed: unknown;
      try {
        parsed = extractJson(reply.reply.text);
      } catch {
        lastMessage = "the reply contained no JSON object";
        continue;
      }

      const checked = request.schema.safeParse(parsed);
      if (checked.success) {
        return { ok: true, data: checked.data, model: `${candidate.id}:${candidate.model}`, usage: reply.reply.usage };
      }
      lastMessage = checked.error.issues
        .slice(0, 4)
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ");
    }
    await sleep(60);
  }

  if (sawRateLimit) {
    return {
      ok: false,
      reason: "rate-limited",
      message: "The AI service is busy. Try that again in a moment.",
    };
  }
  return { ok: false, reason: "invalid", message: `The model's answer did not validate: ${lastMessage}` };
}

/** Free-form text, used where the output is prose rather than data. */
export async function plainText(
  request: Omit<StructuredRequest<never>, "schema" | "schemaName"> & { schema?: never; schemaName?: never },
): Promise<StructuredResult<string>> {
  const pool = candidates();
  if (pool.length === 0) {
    return { ok: false, reason: "unavailable", message: "No AI provider is connected on the server yet." };
  }
  const candidate = pool[0];
  const reply = await callOnce(
    candidate,
    request.system,
    request.messages,
    false,
    request.maxOutputTokens ?? 600,
    request.temperature ?? 0.6,
  );
  if (!reply.ok) {
    return {
      ok: false,
      reason: reply.status === 429 ? "rate-limited" : "network",
      message: "The AI service could not be reached just now.",
    };
  }
  return { ok: true, data: reply.reply.text.trim(), model: `${candidate.id}:${candidate.model}`, usage: reply.reply.usage };
}
