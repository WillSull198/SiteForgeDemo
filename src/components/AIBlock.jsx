import { useEffect, useState } from "react";
import { Icons, renderIcon } from "./icons";
import { Button } from "./ui";

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

  useEffect(() => {
    setDraft(data || {});
  }, [data]);

  const save = () => {
    onSave?.(draft);
    setEditing(false);
  };

  return (
    <div className="ai-block">
      <div className="ai-head">
        <div>
          <div className="fx" style={{ gap: 6 }}>
            <span className="ai-badge">{renderIcon(Icons.zap, 12)} AI</span>
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
