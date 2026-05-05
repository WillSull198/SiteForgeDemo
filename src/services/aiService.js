/* SiteForge audit: Configurable AI service with Claude, ChatGPT/OpenAI, and a
   deterministic local fallback. Keys stay on-device and demos never call
   external providers. */

import { draftApproval, suggestRFI, summariseDiary } from "./aiDraftService";

export const AI_PROVIDERS = {
  ANTHROPIC: "anthropic",
  OPENAI: "openai",
};

export const AI_STORAGE_KEYS = {
  provider: "siteforge-ai-provider",
  anthropic: "siteforge-anthropic-key",
  openai: "siteforge-openai-key",
};

export const DEFAULT_AI_MODELS = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-5.2",
};

export function normaliseAiProvider(provider) {
  return provider === AI_PROVIDERS.OPENAI ? AI_PROVIDERS.OPENAI : AI_PROVIDERS.ANTHROPIC;
}

export function getStoredAiConfig(settings = {}) {
  const integrations = settings?.integrations || settings || {};
  const storedProvider = typeof window !== "undefined" ? window.localStorage.getItem(AI_STORAGE_KEYS.provider) : "";
  const provider = normaliseAiProvider(storedProvider || integrations.aiProvider || AI_PROVIDERS.ANTHROPIC);
  const anthropicKey = typeof window !== "undefined" ? window.localStorage.getItem(AI_STORAGE_KEYS.anthropic) || "" : "";
  const openaiKey = typeof window !== "undefined" ? window.localStorage.getItem(AI_STORAGE_KEYS.openai) || "" : "";
  return {
    provider,
    apiKey: provider === AI_PROVIDERS.OPENAI ? openaiKey : anthropicKey,
    model:
      provider === AI_PROVIDERS.OPENAI
        ? integrations.openaiModel || DEFAULT_AI_MODELS.openai
        : integrations.anthropicModel || integrations.aiModel || DEFAULT_AI_MODELS.anthropic,
    anthropicKey,
    openaiKey,
  };
}

function localFallback(userMessage, projectContext = {}) {
  const message = String(userMessage || "").toLowerCase();
  if (message.includes("rfi") || message.includes("clarify")) {
    const problem = projectContext.openProblems?.[0] || { title: "Field clarification", description: userMessage };
    const rfi = suggestRFI(problem);
    return `${rfi.title}\n\n${rfi.description}\n\nSuggested action: raise this as an RFI and link it to any cost/time exposure before work proceeds.`;
  }
  if (message.includes("variation") || message.includes("client")) {
    const source = projectContext.openProblems?.[0] || projectContext.pendingVariations?.[0] || { title: userMessage, costImpact: 0, timeImpact: 0 };
    const draft = draftApproval(source, "Variation");
    return `${draft.summary}\n\nReason: ${draft.reason}\n\nRecommendation: ${draft.recommendation}`;
  }
  if (message.includes("rain") || message.includes("eot")) {
    const rainEntries = (projectContext.diary || []).filter((entry) => entry.rainEvent);
    return rainEntries.length
      ? `EOT draft: ${rainEntries[0].date} recorded weather disruption. Claim ${rainEntries.length} rain day(s), reference the diary weather notes, and reserve programme rights under the contract.`
      : "No rain diary entry is currently logged for this site. Add a diary rain event first, then SiteForge can draft the EOT notice.";
  }
  if (message.includes("summary") || message.includes("week")) {
    return summariseDiary(projectContext.diary || []);
  }
  return "SiteForge AI recommendation: preserve the chain of evidence. Link the field event to an approval, select the right contract template, send it to the client promptly, and keep the audit trail clean.";
}

function buildSystemPrompt(projectContext) {
  return `You are SiteForge AI, a construction operations assistant for Australian builders.
You have access to the following project context: ${JSON.stringify(projectContext)}.
You help with: drafting variations, EOT notices, client communications, and searching plans.
Use Australian construction terminology. Reference AS4000/HIA/MBA contracts where relevant.
Be concise, practical, and commercially sharp.`;
}

function extractOpenAiText(data) {
  if (data?.output_text) return data.output_text;
  const parts = [];
  (data?.output || []).forEach((item) => {
    (item?.content || []).forEach((content) => {
      if (content?.type === "output_text" && content.text) parts.push(content.text);
      if (content?.text && content.type !== "refusal") parts.push(content.text);
    });
  });
  return parts.join("\n").trim();
}

async function askClaude({ userMessage, projectContext, apiKey, model }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: model || DEFAULT_AI_MODELS.anthropic,
      max_tokens: 1000,
      system: buildSystemPrompt(projectContext),
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    return {
      text: `Claude request failed with HTTP ${response.status}${errorText ? `: ${errorText.slice(0, 400)}` : ""}`,
      source: "claude-error",
    };
  }
  const data = await response.json();
  return {
    text: data.content?.[0]?.text || localFallback(userMessage, projectContext),
    source: "claude",
  };
}

async function askOpenAi({ userMessage, projectContext, apiKey, model }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || DEFAULT_AI_MODELS.openai,
      instructions: buildSystemPrompt(projectContext),
      input: userMessage,
      max_output_tokens: 1000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    return {
      text: `OpenAI request failed with HTTP ${response.status}${errorText ? `: ${errorText.slice(0, 400)}` : ""}`,
      source: "openai-error",
    };
  }

  const data = await response.json();
  return {
    text: extractOpenAiText(data) || localFallback(userMessage, projectContext),
    source: "openai",
  };
}

export async function askSiteForgeAi({ userMessage, projectContext, apiKey, provider, model }) {
  const resolvedProvider = normaliseAiProvider(provider);
  if (projectContext?.orgMode === "demo" || projectContext?.mode === "demo") {
    return {
      text: `Demo mode: external AI requests are skipped. ${localFallback(userMessage, projectContext)}`,
      source: "skipped-demo",
    };
  }

  if (!apiKey) {
    return {
      text: localFallback(userMessage, projectContext),
      source: "local-fallback",
    };
  }

  try {
    if (resolvedProvider === AI_PROVIDERS.OPENAI) {
      return await askOpenAi({ userMessage, projectContext, apiKey, model });
    }
    return await askClaude({ userMessage, projectContext, apiKey, model });
  } catch (error) {
    const providerLabel = resolvedProvider === AI_PROVIDERS.OPENAI ? "OpenAI" : "Claude";
    return {
      text: `${providerLabel} request failed: ${error?.message || "Unknown browser/API error"}`,
      source: resolvedProvider === AI_PROVIDERS.OPENAI ? "openai-error" : "claude-error",
    };
  }
}
