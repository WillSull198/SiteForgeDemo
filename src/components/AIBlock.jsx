import { useEffect, useState } from "react";
import { Icons, renderIcon } from "./icons";
import { Badge, Button } from "./ui";

const sourceLabel = (source, upgrading = false) => {
  if (source === "openai") return "✓ AI-improved by ChatGPT";
  if (source === "claude") return "✓ AI-improved by Claude";
  if (source === "skipped-demo") return "Demo skipped";
  if (source === "local-template") return upgrading ? "Upgrading draft with AI..." : "Local template";
  if (source === "ai-parse-error" || String(source || "").endsWith("-error")) return "AI draft unavailable, using template";
  return source || "Local template";
};

const sourceTone = (source, upgrading = false) => {
  if (source === "openai" || source === "claude") return "passed";
  if (upgrading) return "medium";
  if (source === "ai-parse-error" || String(source || "").endsWith("-error")) return "medium";
  return "medium";
};

export default function AIBlock({
  title = "AI Draft",
  data,
  fields = ["summary", "reason", "recommendation"],
  onRegenerate,
  onSave,
  disclosure = "AI-assisted. Review before sending externally.",
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data || {});
  const [upgradeTimedOut, setUpgradeTimedOut] = useState(false);

  useEffect(() => {
    setDraft(data || {});
  }, [data]);

  useEffect(() => {
    setUpgradeTimedOut(false);
    if (data?.source !== "local-template") return undefined;
    const started = Date.parse(data?.upgradeStartedAt || "");
    const elapsed = Number.isFinite(started) ? Date.now() - started : 0;
    const remaining = Math.max(0, 30000 - elapsed);
    if (!remaining) {
      setUpgradeTimedOut(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setUpgradeTimedOut(true), remaining);
    return () => window.clearTimeout(timer);
  }, [data?.source, data?.upgradeStartedAt]);

  const save = () => {
    onSave?.(draft);
    setEditing(false);
  };
  const upgrading = data?.source === "local-template" && !upgradeTimedOut;
  const badgeText = sourceLabel(data?.source, upgrading);
  const badgeTone = sourceTone(data?.source, upgrading);

  return (
    <div className="ai-block">
      <div className="ai-head">
        <div>
          <div className="fx" style={{ gap: 6 }}>
            <span className="ai-badge">{renderIcon(Icons.zap, 12)} AI</span>
            <Badge tone={badgeTone} title={data?.error || ""} aria-busy={upgrading ? "true" : undefined}>{badgeText}</Badge>
            <div className="b sm">{title}</div>
          </div>
          <div className="xs ct3" style={{ marginTop: 4 }}>
            {disclosure}
          </div>
        </div>
        <div className="fx" style={{ gap: 4, flexWrap: "wrap" }}>
          <Button small icon={Icons.shuffle} onClick={onRegenerate}>
            Regenerate
          </Button>
          {!editing ? (
            <Button small icon={Icons.file} onClick={() => setEditing(true)}>
              Edit
            </Button>
          ) : (
            <>
              <Button small onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button small tone="bt-p" icon={Icons.check} onClick={save}>
                Save
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="ai-grid">
        {fields.map((field) => (
          <div className="ai-card" key={field}>
            <div className="xs ct3" style={{ textTransform: "uppercase", letterSpacing: ".08em" }}>
              {field.replace(/([A-Z])/g, " $1")}
            </div>
            {editing ? (
              <textarea
                className="ai-input"
                value={draft[field] || ""}
                onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))}
              />
            ) : (
              <div className="sm ct2" style={{ marginTop: 6, lineHeight: 1.6 }}>
                {draft[field] || "No AI content generated yet."}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
