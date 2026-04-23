import { useMemo } from "react";
import { useSiteForge } from "../services/siteforgeStore";
import { Icons, renderIcon } from "./icons";
import { Button, Badge } from "./ui";

function buildSuggestions(state, derived, actions) {
  const siteId = state.session.siteId;
  const suggestions = [];
  const overdueProblems = state.problems.filter((problem) => problem.siteId === siteId && ["open", "under-review"].includes(problem.status));
  const delayedProcurement = state.procurement.filter((item) => item.siteId === siteId && ["delayed", "escalated"].includes(item.status));
  const failedQa = state.qa.filter((item) => item.siteId === siteId && item.status === "failed");
  const openRainEvent = state.diary.find((entry) => entry.siteId === siteId && entry.rainEvent);

  if (overdueProblems.length >= 2) {
    suggestions.push({
      id: "raise-approvals",
      tone: "high",
      title: `${overdueProblems.length} problems are still open`,
      body: "Raise a client approval from the oldest open issue to preserve recovery leverage.",
      actionLabel: "Raise Approval",
      onClick: () => actions.createApprovalFromSource({ sourceType: "problem", sourceId: overdueProblems[0].id, approvalType: "Variation", handUp: state.session.role === "Supervisor" }),
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

  if (!suggestions.length) {
    suggestions.push({
      id: "clean",
      tone: "passed",
      title: "No urgent AI suggestions right now",
      body: "The current site data looks balanced. You can still open ClientFlow, Procurement, or QA to push the next action.",
      actionLabel: "Open Dashboard",
      onClick: () => actions.navigate({ kind: state.session.role === "Director" ? "director" : "internal", siteId, page: "dash", entityId: null }),
    });
  }

  return suggestions;
}

export default function AIAssistantDrawer({ open, onClose }) {
  const { state, derived, actions } = useSiteForge();
  const suggestions = useMemo(() => buildSuggestions(state, derived, actions), [actions, derived, state]);

  if (!open) return null;

  return (
    <div className="ai-drawer-shell" onClick={onClose}>
      <div className="ai-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="ai-drawer-head">
          <div>
            <div className="xs ct3">AI-assisted</div>
            <div className="b md">Assistant</div>
          </div>
          <button className="bt-i" onClick={onClose} type="button">
            {renderIcon(Icons.x, 13)}
          </button>
        </div>
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
      </div>
    </div>
  );
}

