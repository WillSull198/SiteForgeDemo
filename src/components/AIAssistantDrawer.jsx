/* SiteForge audit: Expanded the assistant from static suggestions into a working
   AI chat drawer that can call the configured AI provider and falls back to
   SiteForge's local drafting intelligence during demos. */

import { useEffect, useMemo, useState } from "react";
import { detectSaveTargets, extractSaveFieldsFallback, extractSaveFieldsSmart } from "../services/aiDraftService";
import { askSiteForgeAi, getStoredAiConfig } from "../services/aiService";
import { mustHandUpForApproval, routeKindForRole } from "../services/permissions";
import { useSiteForge } from "../services/siteforgeStore";
import { Icons, renderIcon } from "./icons";
import { Button, Badge, Modal } from "./ui";

const SAVE_TARGET_LABELS = {
  variation: "Save as Variation",
  rfi: "Save as RFI",
  diary: "Save as Diary",
  problem: "Save as Problem",
  procurement: "Save as Procurement",
  clientMessage: "Save as Client Message",
};

function canSaveAiTarget(role, target) {
  if (role === "Client" || role === "Worker") return false;
  if (role === "Subcontractor") return ["rfi", "problem"].includes(target);
  return ["Supervisor", "Project Manager", "Contract Admin", "Director"].includes(role);
}

function buildSuggestions(state, derived, actions) {
  const siteId = state.session.siteId;
  const role = state.session.role;
  const suggestions = [];

  if (["Supervisor", "Project Manager"].includes(role)) {
    const overdueProblems = state.problems.filter((problem) => problem.siteId === siteId && ["open", "under-review"].includes(problem.status));
    const delayedProcurement = state.procurement.filter((item) => item.siteId === siteId && ["delayed", "escalated"].includes(item.status));
    const failedQa = state.qa.filter((item) => item.siteId === siteId && item.status === "failed");
    const openRainEvent = state.diary.find((entry) => entry.siteId === siteId && entry.rainEvent && !entry.rainDayClaimId);

    if (overdueProblems.length) {
      suggestions.push({
        id: "raise-approvals",
        tone: "high",
        title: `${overdueProblems.length} open problem${overdueProblems.length === 1 ? "" : "s"}`,
        body: "Raise a client approval from the oldest open issue to preserve recovery leverage.",
        actionLabel: "Raise Approval",
        onClick: () => actions.createApprovalFromSource({ sourceType: "problem", sourceId: overdueProblems[0].id, approvalType: "Variation", handUp: mustHandUpForApproval(role) }),
      });
    }

    if (delayedProcurement.length) {
      suggestions.push({
        id: "eot",
        tone: "medium",
        title: `${delayedProcurement[0].item} is delayed`,
        body: "Draft an EOT from this procurement delay before the programme impact grows.",
        actionLabel: "Draft EOT",
        onClick: () => actions.createEotFromProcurement(delayedProcurement[0].id),
      });
    }

    if (failedQa.length) {
      suggestions.push({
        id: "rework",
        tone: "critical",
        title: `${failedQa[0].title} failed QA`,
        body: "Create a rework task and keep the affected trade moving with a clean record.",
        actionLabel: "Create Rework Task",
        onClick: () => actions.createReworkTaskFromQa(failedQa[0].id),
      });
    }

    if (openRainEvent) {
      suggestions.push({
        id: "rain-day",
        tone: "medium",
        title: `Rain event logged for ${openRainEvent.date}`,
        body: "Turn the diary weather event into a formal rain-day claim.",
        actionLabel: "Claim Rain Day",
        onClick: () => actions.createRainDayClaim(openRainEvent.id),
      });
    }
  }

  if (["Contract Admin", "Director"].includes(role)) {
    const stalled = state.approvals.filter((approval) => approval.siteId === siteId && ["awaiting-pm", "awaiting-ca", "awaiting-client"].includes(approval.status));
    const unsigned = state.approvals.filter((approval) => approval.siteId === siteId && approval.status === "contract-awaiting-builder");
    const openRfis = (state.rfis || []).filter((rfi) => rfi.siteId === siteId && rfi.status === "open");

    if (stalled.length) {
      suggestions.push({
        id: "stalled",
        tone: "high",
        title: `${stalled.length} approval${stalled.length === 1 ? "" : "s"} stalled`,
        body: "Review stalled ClientFlow items to keep the commercial pipeline moving.",
        actionLabel: "Open ClientFlow",
        onClick: () => actions.navigate({ kind: "internal", siteId, page: "clientflow", entityId: null }),
      });
    }
    if (unsigned.length) {
      suggestions.push({
        id: "unsigned",
        tone: "medium",
        title: `${unsigned.length} contract${unsigned.length === 1 ? "" : "s"} need your signature`,
        body: "Builder signature is required before sending to the client.",
        actionLabel: "Go to Contracts",
        onClick: () => actions.navigate({ kind: "internal", siteId, page: "contracts", entityId: null }),
      });
    }
    if (openRfis.length) {
      suggestions.push({
        id: "rfis",
        tone: "medium",
        title: `${openRfis.length} open RFI${openRfis.length === 1 ? "" : "s"}`,
        body: "Respond to keep consultants and trades moving.",
        actionLabel: "Open RFIs",
        onClick: () => actions.navigate({ kind: "internal", siteId, page: "rfis", entityId: null }),
      });
    }
  }

  if (role === "Worker") {
    const myTasks = (state.tasks || []).filter((task) => task.siteId === siteId && task.assigneeId === state.session.userId && task.status !== "complete");
    if (myTasks.length) {
      suggestions.push({
        id: "tasks",
        tone: "medium",
        title: `${myTasks.length} task${myTasks.length === 1 ? "" : "s"} assigned to you`,
        body: `Up next: ${myTasks[0]?.title || "check your task list."}`,
        actionLabel: "View Tasks",
        onClick: () => actions.navigate({ kind: "worker", userId: state.session.userId, page: "home", entityId: null }),
      });
    }
  }

  if (role === "Subcontractor") {
    const myRfis = (state.rfis || []).filter((rfi) => rfi.siteId === siteId && rfi.raisedBy === state.session.userId && rfi.status === "open");
    if (myRfis.length) {
      suggestions.push({
        id: "my-rfis",
        tone: "high",
        title: `${myRfis.length} open RFI${myRfis.length === 1 ? "" : "s"}`,
        body: "Your RFIs are awaiting a formal response.",
        actionLabel: "View RFIs",
        onClick: () => actions.navigate({ kind: "subcontractor", userId: state.session.userId, page: "rfis", entityId: null }),
      });
    }
  }

  if (!suggestions.length) {
    const fallbackRoute =
      role === "Director"
        ? { kind: "director", page: "boardroom", siteId, entityId: null }
        : role === "Worker"
          ? { kind: "worker", userId: state.session.userId, page: "home", entityId: null }
          : role === "Subcontractor"
            ? { kind: "subcontractor", userId: state.session.userId, page: "jobs", entityId: null }
            : { kind: routeKindForRole(role), siteId, page: "dash", entityId: null };
    suggestions.push({
      id: "clean",
      tone: "passed",
      title: "No urgent AI suggestions right now",
      body: "Ask SiteForge AI anything below, or open the dashboard to check the next priority.",
      actionLabel: "Open Dashboard",
      onClick: () => actions.navigate(fallbackRoute),
    });
  }

  return suggestions;
}

export default function AIAssistantDrawer({ open, onClose, attachedDocument = null }) {
  const { state, derived, actions } = useSiteForge();
  const [message, setMessage] = useState("");
  const [chat, setChat] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saveDraft, setSaveDraft] = useState(null);
  const [saveError, setSaveError] = useState("");
  const [attachmentDismissed, setAttachmentDismissed] = useState(false);
  const suggestions = useMemo(() => buildSuggestions(state, derived, actions), [actions, derived, state]);
  const integrationSettings = state.device?.settings?.integrations || state.settings?.integrations || {};
  const aiConfig = getStoredAiConfig(integrationSettings);
  const providerLabel = aiConfig.provider === "openai" ? "ChatGPT" : "Claude";
  const testStatus = integrationSettings.aiLastTestProvider === aiConfig.provider ? integrationSettings.aiLastTestStatus || "untested" : "untested";
  const showSuggestions = !["Worker", "Subcontractor"].includes(state.session.role);
  useEffect(() => {
    setAttachmentDismissed(false);
  }, [attachedDocument?.id]);
  const activeAttachment = attachedDocument && !attachmentDismissed ? attachedDocument : null;
  const sourceLabel = (source) => {
    if (source === "openai") return "ChatGPT";
    if (source === "claude") return "Claude";
    if (source === "local-fallback" || source === "local-template") return "Local template";
    if (source === "skipped-demo") return "Demo mode - AI skipped";
    if (source === "ai-parse-error") return "AI error - using template";
    if (String(source || "").endsWith("-error")) return "AI error";
    return "AI";
  };
  const projectContext = useMemo(() => {
    const siteId = state.session.siteId;
    const site = state.sites.find((entry) => entry.id === siteId);
    return {
      site,
      company: state.company,
      contractType: site?.contractType || site?.type,
      openProblems: state.problems.filter((entry) => entry.siteId === siteId && ["open", "under-review"].includes(entry.status)).slice(0, 5),
      pendingVariations: state.variations.filter((entry) => entry.siteId === siteId && !["signed", "archived"].includes(entry.status)).slice(0, 5),
      diary: state.diary.filter((entry) => entry.siteId === siteId).slice(0, 5),
      activeApprovals: state.approvals.filter((entry) => entry.siteId === siteId && !["signed", "archived", "declined"].includes(entry.status)).slice(0, 5),
      attachedDocument: activeAttachment,
    };
  }, [activeAttachment, state]);

  const openSaveDraft = async (entry, target) => {
    const fallback = extractSaveFieldsFallback(target, entry.userMessage || "", entry.text || "");
    setSaveError("");
    setSaveDraft({ target, entry, fields: fallback, loading: true });
    const extracted = await extractSaveFieldsSmart({
      target,
      userMessage: entry.userMessage || "",
      aiResponse: entry.text || "",
      projectContext: { ...projectContext, orgMode: state.org?.mode },
      integrationSettings,
    });
    setSaveDraft((current) => (current?.entry?.id === entry.id && current.target === target ? { ...current, fields: extracted, loading: false } : current));
  };

  const updateSaveField = (key, value) => {
    setSaveDraft((current) => (current ? { ...current, fields: { ...(current.fields || {}), [key]: value } } : current));
  };

  const confirmSaveDraft = () => {
    if (!saveDraft) return;
    const result = actions.saveAiChatRecord({
      target: saveDraft.target,
      fields: saveDraft.fields,
      aiOrigin: {
        chatId: saveDraft.entry.id,
        userMessage: saveDraft.entry.userMessage || "",
        generatedAt: saveDraft.entry.generatedAt,
        source: saveDraft.entry.source,
      },
    });
    if (result?.ok) {
      setSaveDraft(null);
      setSaveError("");
    } else {
      setSaveError(result?.error || "Could not save this AI response.");
    }
  };

  if (!open) return null;

  return (
    <div className="ai-drawer-shell" onClick={onClose}>
      <div className="ai-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="ai-drawer-head">
          <div>
            <div className="xs ct3">AI-assisted</div>
            <div className="b md">Assistant</div>
            <div className="xs ct3" style={{ marginTop: 4 }}>
              {providerLabel} ·{" "}
              {testStatus === "ok" ? (
                <Badge tone="passed">connected</Badge>
              ) : testStatus === "failed" ? (
                <Badge tone="critical">test failed</Badge>
              ) : (
                <Badge tone="medium">untested</Badge>
              )}
            </div>
          </div>
          <button className="bt-i" onClick={onClose} type="button">
            {renderIcon(Icons.x, 13)}
          </button>
        </div>
        {showSuggestions ? (
          <div className="list-stack">
            {suggestions.map((suggestion) => (
              <div className={`ai-suggestion ${suggestion.tone}`} key={suggestion.id}>
                <div className="fb" style={{ alignItems: "flex-start", gap: 8 }}>
                  <div>
                    <div className="b sm">{suggestion.title}</div>
                    <div className="sm ct2" style={{ marginTop: 5, lineHeight: 1.6 }}>
                      {suggestion.body}
                    </div>
                  </div>
                  <Badge tone={suggestion.tone}>{suggestion.tone}</Badge>
                </div>
                <Button tone="bt-p" small icon={Icons.zap} onClick={suggestion.onClick} style={{ marginTop: 10 }}>
                  {suggestion.actionLabel}
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        {activeAttachment ? (
          <div className="notice-banner" style={{ marginBottom: 10 }}>
            <div className="fb" style={{ gap: 8 }}>
              <div>
                <div className="xs ct3">Attached document context</div>
                <div className="sm b">{activeAttachment.title}</div>
                <div className="xs ct3">
                  {(activeAttachment.category || "Document")} · Rev {activeAttachment.rev || "current"} · {(activeAttachment.extractedText || "").length || activeAttachment.pages?.length || 0} text signal
                </div>
              </div>
              <Button small onClick={() => setAttachmentDismissed(true)}>
                Dismiss
              </Button>
            </div>
          </div>
        ) : null}
        <div className="ai-chat-panel">
          <div className="xs ct3 mb4">Ask SiteForge AI</div>
          <div className="ai-chat-log">
            {chat.map((entry) => (
              <div className={`ai-chat-msg ${entry.role}`} key={entry.id}>
                <div className="xs ct3">{String(entry.role).toLowerCase() === "user" ? "You" : `SiteForge AI · ${sourceLabel(entry.source)}`}</div>
                <div className="sm">{entry.text}</div>
                {entry.role === "assistant" ? (
                  <div className="fx" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    {detectSaveTargets(entry.userMessage || "", entry.text)
                      .filter((target) => canSaveAiTarget(state.session.role, target))
                      .map((target) => (
                        <Button key={`${entry.id}-${target}`} small onClick={() => openSaveDraft(entry, target)}>
                          {SAVE_TARGET_LABELS[target]}
                        </Button>
                      ))}
                  </div>
                ) : null}
              </div>
            ))}
            {!chat.length ? <div className="xs ct3">Try: “Draft a client variation summary for the footing water ingress.”</div> : null}
          </div>
          <div className="ai-chat-input">
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} />
            <Button
              small
              tone="bt-p"
              disabled={loading}
              onClick={async () => {
                if (!message.trim()) return;
                const outgoing = { id: `u-${Date.now()}`, role: "user", text: message };
                setChat((current) => [...current, outgoing]);
                setMessage("");
                setLoading(true);
                const result = await askSiteForgeAi({
                  userMessage: outgoing.text,
                  projectContext: { ...projectContext, orgMode: state.org?.mode },
                  provider: aiConfig.provider,
                  apiKey: aiConfig.apiKey,
                  model: aiConfig.model,
	                  openaiProxyUrl: aiConfig.openaiProxyUrl,
	                  allowInDemo: true,
	                });
                setChat((current) => [
                  ...current,
                  { id: `a-${Date.now()}`, role: "assistant", text: result.text, source: result.source, userMessage: outgoing.text, generatedAt: new Date().toISOString() },
                ]);
                setLoading(false);
              }}
            >
              {loading ? "Thinking..." : "Ask"}
            </Button>
          </div>
        </div>
        <Modal open={Boolean(saveDraft)} close={() => setSaveDraft(null)} title={saveDraft ? SAVE_TARGET_LABELS[saveDraft.target] : "Save AI response"} wide>
          {saveDraft ? (
            <div>
              <div className="fx mb8" style={{ gap: 8, alignItems: "center" }}>
                <Badge tone={saveDraft.fields?.source === "openai" || saveDraft.fields?.source === "claude" ? "passed" : "medium"}>
                  {saveDraft.loading ? "Extracting fields..." : sourceLabel(saveDraft.fields?.source)}
                </Badge>
                <span className="xs ct3">Review before saving. SiteForge never saves the chat output without confirmation.</span>
              </div>
              <div className="ff">
                <label>Title</label>
                <input value={saveDraft.fields?.title || ""} onChange={(event) => updateSaveField("title", event.target.value)} />
              </div>
              <div className="ff">
                <label>Description</label>
                <textarea value={saveDraft.fields?.description || ""} onChange={(event) => updateSaveField("description", event.target.value)} />
              </div>
              <div className="g2">
                <div className="ff">
                  <label>Cost impact</label>
                  <input value={saveDraft.fields?.costImpact || ""} onChange={(event) => updateSaveField("costImpact", event.target.value)} />
                </div>
                <div className="ff">
                  <label>Time impact (days)</label>
                  <input value={saveDraft.fields?.timeImpact || ""} onChange={(event) => updateSaveField("timeImpact", event.target.value)} />
                </div>
              </div>
              <div className="g2">
                <div className="ff">
                  <label>Trade</label>
                  <input value={saveDraft.fields?.trade || ""} onChange={(event) => updateSaveField("trade", event.target.value)} />
                </div>
                <div className="ff">
                  <label>Priority</label>
                  <select value={saveDraft.fields?.priority || "medium"} onChange={(event) => updateSaveField("priority", event.target.value)}>
                    {["low", "medium", "high", "critical"].map((priority) => (
                      <option key={priority}>{priority}</option>
                    ))}
                  </select>
                </div>
              </div>
              {saveDraft.target === "rfi" ? (
                <div className="ff">
                  <label>To</label>
                  <input value={saveDraft.fields?.to || ""} onChange={(event) => updateSaveField("to", event.target.value)} />
                </div>
              ) : null}
              {saveDraft.target === "procurement" ? (
                <div className="g2">
                  <div className="ff">
                    <label>Quantity</label>
                    <input value={saveDraft.fields?.quantity || ""} onChange={(event) => updateSaveField("quantity", event.target.value)} />
                  </div>
                  <div className="ff">
                    <label>Supplier</label>
                    <input value={saveDraft.fields?.supplier || ""} onChange={(event) => updateSaveField("supplier", event.target.value)} />
                  </div>
                </div>
              ) : null}
              {saveDraft.target === "diary" ? (
                <>
                  <div className="g2">
                    <div className="ff">
                      <label>Weather</label>
                      <input value={saveDraft.fields?.weather || ""} onChange={(event) => updateSaveField("weather", event.target.value)} />
                    </div>
                    <div className="ff">
                      <label>Crew</label>
                      <input value={saveDraft.fields?.crew || ""} onChange={(event) => updateSaveField("crew", event.target.value)} />
                    </div>
                  </div>
                  <div className="ff">
                    <label>Safety</label>
                    <input value={saveDraft.fields?.safety || ""} onChange={(event) => updateSaveField("safety", event.target.value)} />
                  </div>
                  <div className="ff">
                    <label>Delays</label>
                    <input value={saveDraft.fields?.delays || ""} onChange={(event) => updateSaveField("delays", event.target.value)} />
                  </div>
                  <label className="chk">
                    <input type="checkbox" checked={Boolean(saveDraft.fields?.rainEvent)} onChange={(event) => updateSaveField("rainEvent", event.target.checked)} />
                    Rain event
                  </label>
                </>
              ) : null}
              {saveError ? <div className="banner critical">{saveError}</div> : null}
              <div className="fa">
                <Button onClick={() => setSaveDraft(null)}>Cancel</Button>
                <Button tone="bt-p" onClick={confirmSaveDraft} disabled={saveDraft.loading}>
                  Save record
                </Button>
              </div>
            </div>
          ) : null}
        </Modal>
      </div>
    </div>
  );
}
