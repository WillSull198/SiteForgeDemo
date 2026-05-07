import { askSiteForgeAi, getStoredAiConfig } from "./aiService";

const formatCurrency = (value = 0) =>
  new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);

const sentence = (value) => value.replace(/\s+/g, " ").trim();

const buildReason = (sourceEntity, type) => {
  if (!sourceEntity) {
    return "The builder is recording a formal change so cost, time, and responsibility stay clear for all parties.";
  }

  if (type === "Rain Day") {
    return "Weather conditions materially affected safe external work fronts, so the programme record needs a clean entitlement notice before downstream dates drift further.";
  }

  if (type === "Extension of Time") {
    return "The delay sits outside the builder's direct control and now affects the critical path, so it needs to be documented before recovery options are priced and scheduled.";
  }

  if (type === "Price Escalation") {
    return "Market pricing has moved beyond the original carry, and confirming the current allowance now avoids hidden margin erosion later in the job.";
  }

  if (sourceEntity.category === "Site condition" || sourceEntity.title?.toLowerCase().includes("water")) {
    return "The issue was uncovered in the field and could not be resolved within the original scope without a formal instruction and commercial record.";
  }

  if (sourceEntity.title?.toLowerCase().includes("lintel") || sourceEntity.item?.toLowerCase().includes("lintel")) {
    return "The impacted item now affects sequencing across framing, roof, and following trades, so the record needs both time and recovery context.";
  }

  if (sourceEntity.status === "failed") {
    return "The failed inspection has immediate rework implications and may create additional design, labour, and programme exposure if it is not addressed formally.";
  }

  return "The field event changes either scope, timing, or procurement assumptions and needs a formal record before the business loses recovery leverage.";
};

const buildRecommendation = (sourceEntity, type) => {
  if (type === "Rain Day") {
    return "Approve the rain day now so the programme remains transparent and any future EOT conversation starts from a clean record rather than a disputed diary note.";
  }

  if (type === "Delay Notice") {
    return "Acknowledge the delay notice now so the builder can resequence trades with clarity and avoid compounding disruption costs.";
  }

  if (type === "Selection Upgrade") {
    return "Approve the upgrade now so procurement can be released while the preferred lead time is still achievable.";
  }

  if (sourceEntity?.priority === "critical") {
    return "Approve promptly so the team can stabilise the work front, protect the schedule, and preserve the recovery path while the facts are still current.";
  }

  return "Approve now so the change can be documented cleanly, downstream impacts can be controlled, and the commercial position stays recoverable.";
};

const buildSummary = (sourceEntity, type) => {
  if (!sourceEntity) {
    return `This ${type.toLowerCase()} records a site event that needs formal approval before the builder can safely proceed.`;
  }

  if (type === "Rain Day") {
    return sentence(
      `The site experienced a weather event that limited work to internal activities only. ${sourceEntity.summary || sourceEntity.delays || "External works could not proceed safely."}`,
    );
  }

  if (type === "Extension of Time") {
    return sentence(
      `${sourceEntity.title || sourceEntity.item || "This event"} is affecting the current programme and now requires a formal extension of time record so the critical path impact is visible.`,
    );
  }

  if (type === "Variation") {
    return sentence(
      `${sourceEntity.title || "This scope change"} requires work outside the original carry, with a documented commercial impact of ${formatCurrency(sourceEntity.costImpact || sourceEntity.value || 0)}.`,
    );
  }

  if (type === "Price Escalation") {
    return sentence(
      `${sourceEntity.item || sourceEntity.title || "A supplier package"} has shifted in price beyond the original allowance, so the updated carry needs client acknowledgement before release.`,
    );
  }

  return sentence(
    `${sourceEntity.title || sourceEntity.item || "This event"} now requires formal acknowledgement so scope, cost, and time implications can be managed with clarity.`,
  );
};

const buildImpacts = (sourceEntity, type) => {
  const costImpact = Number(sourceEntity?.costImpact ?? sourceEntity?.value ?? sourceEntity?.cost ?? 0);
  const timeImpact = Number(sourceEntity?.timeImpact ?? sourceEntity?.days ?? 0);
  const attachmentsSummary = sourceEntity?.attachments?.length
    ? `${sourceEntity.attachments.length} supporting attachment${sourceEntity.attachments.length === 1 ? "" : "s"} included.`
    : "Supporting site records, diary notes, and linked records are included in the approval pack.";

  return {
    costImpact,
    timeImpact,
    attachmentsSummary:
      type === "Rain Day"
        ? `${attachmentsSummary} Weather evidence and diary records support the entitlement.`
        : attachmentsSummary,
  };
};

export function draftApproval(sourceEntity, type) {
  const impacts = buildImpacts(sourceEntity, type);
  return {
    summary: buildSummary(sourceEntity, type),
    reason: buildReason(sourceEntity, type),
    recommendation: buildRecommendation(sourceEntity, type),
    costImpact: impacts.costImpact,
    timeImpact: impacts.timeImpact,
    attachmentsSummary: impacts.attachmentsSummary,
    source: "local-template",
    upgradeStartedAt: new Date().toISOString(),
  };
}

export async function draftApprovalSmart(sourceEntity, type, projectContext = {}, integrationSettings = {}) {
  const local = draftApproval(sourceEntity, type);
  const aiConfig = getStoredAiConfig(integrationSettings);
  if (!aiConfig.apiKey) return { ...local, source: "local-template" };
  if (projectContext.orgMode === "demo") return { ...local, source: "skipped-demo" };

  const prompt = `You are drafting a formal ${type} approval for an Australian residential building project.

Source event:
${JSON.stringify(sourceEntity)}

Project context:
${JSON.stringify(projectContext)}

Reply ONLY as JSON:
{
  "summary": "2-3 sentence client-facing summary of what is being approved and why",
  "reason": "1-2 sentence explanation of why this is needed, citing the trigger event",
  "recommendation": "1 sentence recommendation to the client",
  "costImpact": ${Number(sourceEntity?.costImpact ?? sourceEntity?.value ?? sourceEntity?.cost ?? local.costImpact ?? 0)},
  "timeImpact": ${Number(sourceEntity?.timeImpact ?? sourceEntity?.days ?? local.timeImpact ?? 0)}
}

Use Australian construction terminology. Reference HIA, AS4000, MBA, or relevant contract administration language only where useful. Be commercially clear, not theatrical.`;

  try {
    const result = await askSiteForgeAi({
      userMessage: prompt,
      projectContext,
      provider: aiConfig.provider,
      apiKey: aiConfig.apiKey,
      model: aiConfig.model,
      openaiProxyUrl: aiConfig.openaiProxyUrl,
    });
    if (result.source === "claude" || result.source === "openai") {
      const match = result.text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match ? match[0] : result.text);
      return {
        summary: parsed.summary || local.summary,
        reason: parsed.reason || local.reason,
        recommendation: parsed.recommendation || local.recommendation,
        costImpact: parsed.costImpact ?? local.costImpact,
        timeImpact: parsed.timeImpact ?? local.timeImpact,
        attachmentsSummary: local.attachmentsSummary,
        source: result.source,
      };
    }
    return { ...local, source: result.source || "local-template", error: result.text };
  } catch (error) {
    return { ...local, source: "ai-parse-error", error: error?.message || "Unable to parse AI draft." };
  }
}

export function summariseDiary(entries = []) {
  if (!entries.length) {
    return "This week focused on safe progression of active work fronts, close-out of inspections, and protecting upcoming milestones.";
  }

  const latest = entries[0];
  const rainDays = entries.filter((entry) => entry.rainEvent).length;
  const totalCrew = entries.reduce((sum, entry) => sum + (Number(entry.crew) || 0), 0);
  return sentence(
    `This week the site averaged ${Math.round(totalCrew / entries.length)} crew per day and remained focused on ${latest.summary.toLowerCase()}. ${
      rainDays
        ? `A total of ${rainDays} weather-related day${rainDays === 1 ? "" : "s"} affected external sequencing, with entitlement records prepared where required.`
        : "No material weather disruptions were recorded in the weekly summary window."
    }`,
  );
}

export function suggestRFI(problem) {
  if (!problem) {
    return {
      title: "Clarify affected scope and required response",
      description: "Raise an RFI to confirm the correct detail, responsibility, and required next instruction.",
      recommendedRecipient: "Consultant team",
    };
  }

  return {
    title: `Clarify response for: ${problem.title}`,
    description: sentence(
      `The field report suggests a design, procurement, or scope ambiguity. Raise an RFI so the response path is documented before further labour is spent on ${problem.title.toLowerCase()}.`,
    ),
    recommendedRecipient:
      problem.category === "Design clash" ? "Architect / Services Coordinator" : problem.category === "Procurement" ? "Supplier / Engineer" : "Relevant consultant",
  };
}

export async function suggestRfiSmart(problem, projectContext = {}, integrationSettings = {}) {
  const local = suggestRFI(problem);
  const aiConfig = getStoredAiConfig(integrationSettings);
  if (!aiConfig.apiKey) return { ...local, source: "local-template" };
  if (projectContext.orgMode === "demo") return { ...local, source: "skipped-demo" };

  const prompt = `You are drafting a formal RFI (Request for Information) for an Australian residential building project.

Source problem:
${JSON.stringify(problem)}

Project context:
${JSON.stringify(projectContext)}

Reply ONLY as JSON:
{
  "title": "concise RFI title (max 80 chars)",
  "description": "2-3 sentence formal RFI description that asks for the specific clarification needed",
  "recommendedRecipient": "best recipient role (e.g. Architect, Structural Engineer, Services Coordinator)"
}

Use Australian construction terminology. Be specific about what information is needed before work can proceed.`;

  try {
    const result = await askSiteForgeAi({
      userMessage: prompt,
      projectContext,
      provider: aiConfig.provider,
      apiKey: aiConfig.apiKey,
      model: aiConfig.model,
      openaiProxyUrl: aiConfig.openaiProxyUrl,
      allowInDemo: false,
    });
    if (result.source === "claude" || result.source === "openai") {
      const match = result.text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match ? match[0] : result.text);
      return {
        title: parsed.title || local.title,
        description: parsed.description || local.description,
        recommendedRecipient: parsed.recommendedRecipient || local.recommendedRecipient,
        source: result.source,
      };
    }
    return { ...local, source: result.source || "local-template" };
  } catch (error) {
    return { ...local, source: "ai-parse-error", error: error?.message };
  }
}

export function summariseRevision(oldPlan, newPlan) {
  if (!newPlan) {
    return "A new revision has been issued and the linked work fronts should be checked before work continues.";
  }

  if (!oldPlan) {
    return `${newPlan.title} ${newPlan.rev} has been issued. Review linked tasks and acknowledgements before work resumes.`;
  }

  return sentence(
    `${newPlan.title} moved from ${oldPlan.rev} to ${newPlan.rev}. ${
      newPlan.impactAnalysis?.summary || "The latest revision changes linked task assumptions and requires field acknowledgement."
    }`,
  );
}

export function flagBudgetAnomaly(budgetItem) {
  const spent = Number(budgetItem?.spent || 0);
  const budget = Number(budgetItem?.budget || 0);
  const committed = Number(budgetItem?.committed || 0);
  const forecast = Number(budgetItem?.forecast || spent + committed);
  const ratio = budget > 0 ? (spent + committed) / budget : 0;
  const confidence = Math.min(98, Math.round((ratio > 1 ? 0.82 : ratio > 0.85 ? 0.68 : 0.34) * 100));

  return {
    confidence,
    flagged: ratio > 0.85 || forecast > budget,
    reason:
      ratio > 1
        ? `${budgetItem.category} has exceeded budget carry with ${formatCurrency(spent + committed)} already consumed against ${formatCurrency(budget)}.`
        : ratio > 0.85
          ? `${budgetItem.category} is trending high with ${formatCurrency(spent + committed)} already committed and forecast pushing to ${formatCurrency(forecast)}.`
          : `${budgetItem.category} is currently within expected range.`,
  };
}

export function generateEndOfDay(site, tasks = [], problems = [], procurement = [], diaryEntries = [], presence = []) {
  const completeCount = tasks.filter((task) => task.status === "done").length;
  const activeIssues = problems.filter((problem) => ["open", "under-review"].includes(problem.status)).length;
  const materialReceipts = procurement.filter((item) => item.status === "delivered").length;
  const verifiedCrew = presence.filter((record) => record.status === "verified-on-site").length;
  const latestDiary = diaryEntries[0];

  return sentence(
    `${site?.name || "Site"} closed out the day with ${completeCount} completed task${completeCount === 1 ? "" : "s"}, ${activeIssues} active issue${
      activeIssues === 1 ? "" : "s"
    }, and ${materialReceipts} delivered procurement item${materialReceipts === 1 ? "" : "s"}. ${
      latestDiary?.delays && latestDiary.delays !== "Nil"
        ? `Primary delay note: ${latestDiary.delays}.`
        : "No new major delay note was recorded in the latest diary."
    } Presence confidence finished with ${verifiedCrew} verified personnel on record.`,
  );
}

export function structureFieldNote(rawText = "") {
  const text = sentence(rawText || "Crew completed general site activities and closed out field notes.");
  const parts = text.split(".").filter(Boolean);
  return {
    summary: parts.slice(0, 2).join(". ").trim() + (parts.length ? "." : ""),
    safety: text.toLowerCase().includes("safety") ? "Safety item mentioned in field note and should be reviewed in diary close-out." : "No specific safety exception noted in the raw field note.",
    delays: text.toLowerCase().includes("delay") || text.toLowerCase().includes("waiting")
      ? "Potential programme impact referenced in raw note."
      : "Nil",
  };
}

export function boardInsights(portfolio) {
  const sites = portfolio?.sites || [];
  const openApprovals = portfolio?.approvals || [];
  const presence = portfolio?.presence || [];
  const highRiskSites = sites.filter((site) => site.risk === "red" || site.risk === "amber");
  const flaggedPresence = presence.filter((record) => (record.confidence || 0) < 60);

  return {
    summary: sentence(
      `${highRiskSites.length} site${highRiskSites.length === 1 ? "" : "s"} currently need leadership attention. ClientFlow continues to recover value quickly, but unresolved approvals and low-confidence labour records remain the sharpest drag on margin certainty.`,
    ),
    topRisks: [
      highRiskSites[0] ? `${highRiskSites[0].name} remains the portfolio's clearest margin-at-risk site.` : "No immediate portfolio-wide risk flagged.",
      openApprovals[0] ? `${openApprovals[0].title} is still carrying client or contract latency.` : "Approval latency is currently stable.",
      flaggedPresence[0] ? `${flaggedPresence[0].person} requires presence verification before payroll confidence improves.` : "Payroll confidence is broadly stable.",
    ],
    topWins: [
      "ClientFlow is keeping field events commercially visible within the same day they are raised.",
      "Passport controls are actively preventing incomplete inductions from becoming live site risk.",
      "Contract packs now move from approval to signature within one connected workflow.",
    ],
    suggestedActions: [
      "Escalate stale approvals older than 48 hours through the PM and client comms path.",
      "Resolve the lowest-confidence attendance records before payroll export is released.",
      "Push contract-admin review on newly approved items so execution lag does not erase recovery momentum.",
    ],
  };
}
