/* SiteForge audit: Added a configurable Claude-backed assistant service with a
   deterministic local fallback. This gives Settings -> Integrations a real API
   path while keeping demos functional when browser CORS or missing keys block
   direct Anthropic calls. */

import { draftApproval, suggestRFI, summariseDiary } from "./aiDraftService";

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

export async function askSiteForgeAi({ userMessage, projectContext, apiKey }) {
  if (projectContext?.orgMode === "demo" || projectContext?.mode === "demo") {
    return {
      text: `Demo mode: external Claude requests are skipped. ${localFallback(userMessage, projectContext)}`,
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
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: `You are SiteForge AI, a construction operations assistant for Australian builders.
You have access to the following project context: ${JSON.stringify(projectContext)}.
You help with: drafting variations, EOT notices, client communications, and searching plans.
Use Australian construction terminology. Reference AS4000/HIA/MBA contracts where relevant.
Be concise, practical, and commercially sharp.`,
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
  } catch (error) {
    return {
      text: `Claude request failed: ${error?.message || "Unknown browser/API error"}`,
      source: "claude-error",
    };
  }
}
