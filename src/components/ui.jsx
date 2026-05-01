import React from "react";
import { renderIcon } from "./icons";
import { allowedRoles } from "../services/permissions";

export function Card({ title, icon, right, children, bodyClassName = "", className = "" }) {
  return (
    <div className={`cd ${className}`.trim()}>
      {(title || right) && (
        <div className="cd-h">
          <h3>
            {icon ? renderIcon(icon, 14) : null}
            {title}
          </h3>
          {right}
        </div>
      )}
      <div className={`cd-b ${bodyClassName}`.trim()}>{children}</div>
    </div>
  );
}

export function MetricGrid({ columns = 4, items }) {
  return (
    <div className={`sts g${columns} mb8`}>
      {items.map((item) => (
        <div className={`si ${item.color}`} key={item.label}>
          <div className="sl">{item.label}</div>
          <div className="sv">{item.value}</div>
          {item.subtle ? <div className="ss">{item.subtle}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function Badge({ tone, children, className = "" }) {
  return <span className={`bg ${tone} ${className}`.trim()}>{children}</span>;
}

export function EmptyState({ icon, title = "Nothing here yet", description = "When records are created, they will appear here.", action = null }) {
  return (
    <div className="empty-state">
      {icon ? <div className="empty-state-icon">{renderIcon(icon, 22)}</div> : null}
      <div className="empty-state-title">{title}</div>
      <div className="empty-state-copy">{description}</div>
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}

export function Button({ tone = "", small = false, icon, children, className = "", ...props }) {
  return (
    <button className={`bt ${tone} ${small ? "bt-s" : ""} ${className}`.trim()} {...props}>
      {icon ? renderIcon(icon, small ? 11 : 13) : null}
      {children}
    </button>
  );
}

export function IconButton({ icon, className = "", ...props }) {
  return (
    <button className={`bt-i ${className}`.trim()} {...props}>
      {renderIcon(icon, 13)}
    </button>
  );
}

export function Modal({ open, close, title, wide, children }) {
  if (!open) return null;
  return (
    <div className="mo" onClick={close}>
      <div className={`ml fin ${wide ? "ml-wide" : ""}`.trim()} onClick={(event) => event.stopPropagation()}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function Tabs({ items, value, onChange }) {
  return (
    <div className="fx mb8" style={{ gap: 3, flexWrap: "wrap" }}>
      {items.map((item) => (
        <button
          key={item.value}
          className={`ft ${value === item.value ? "on" : ""}`}
          onClick={() => onChange(item.value)}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function PanelList({ items, empty = "Nothing to show." }) {
  if (!items.length) {
    return <div className="ct3 sm empty">{empty}</div>;
  }

  return (
    <div className="list-stack">
      {items.map((item) => (
        <div className="act" key={item.id || item.title || item.label}>
          {item.dot ? <div className="dot" style={{ background: item.dot }} /> : null}
          <div style={{ flex: 1 }}>
            <div className="b">{item.title || item.label}</div>
            {item.meta ? <div className="act-t">{item.meta}</div> : null}
            {item.body ? <div className="xs ct2" style={{ marginTop: 2 }}>{item.body}</div> : null}
          </div>
          {item.right}
        </div>
      ))}
    </div>
  );
}

export function Timeline({ entries }) {
  return (
    <div className="timeline">
      {entries.map((entry, index) => (
        <div className="timeline-item" key={`${entry.at}-${index}`}>
          <div className="timeline-dot" />
          <div className="timeline-body">
            <div className="fb">
              <div className="b sm">
                {entry.actor} <span className="ct3">· {entry.role}</span>
              </div>
              <div className="act-t">{entry.at}</div>
            </div>
            <div className="xs ct2" style={{ marginTop: 3 }}>{entry.text}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function LinkedRecordsPanel({ title = "Linked Records", records = [], resolveRecord }) {
  return (
    <Card title={title}>
      {records.length === 0 ? (
        <div className="ct3 sm empty">No linked records yet.</div>
      ) : (
        <div className="list-stack">
          {records.map((record, index) => {
            const linked = resolveRecord?.(record) || null;
            return (
              <div className="linked-row" key={`${record.type}-${record.id}-${index}`}>
                <div>
                  <div className="xs ct3">{record.type.toUpperCase()}</div>
                  <div className="b sm">{record.label}</div>
                  {linked?.st ? <div className="act-t">Status: {linked.st}</div> : null}
                </div>
                {linked?.pr ? <Badge tone={linked.pr}>{linked.pr}</Badge> : null}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export function RestrictedPanel({ title = "Restricted", body = "Your current role cannot view this panel." }) {
  return (
    <div className="restricted">
      <div className="restricted-badge">Role Restricted</div>
      <div className="b md" style={{ marginTop: 8 }}>{title}</div>
      <div className="sm ct2" style={{ marginTop: 5 }}>{body}</div>
    </div>
  );
}

export function AccessDenied({ permission, title = "You don't have access to this feature." }) {
  const roles = allowedRoles(permission);
  return (
    <div className="restricted access-denied">
      <div className="restricted-badge">Permission Required</div>
      <div className="b md" style={{ marginTop: 8 }}>{title}</div>
      <div className="sm ct2" style={{ marginTop: 5 }}>
        This route requires <span className="mono">{permission}</span>.
      </div>
      <div className="xs ct3" style={{ marginTop: 8 }}>
        Allowed roles: {roles.length ? roles.join(", ") : "No roles configured"}
      </div>
    </div>
  );
}

export function QrBadge({ code }) {
  const cells = Array.from(code).slice(0, 25);
  return (
    <div className="qr-card">
      <div className="qr-grid">
        {cells.map((char, index) => (
          <span className={`qr-cell ${char.charCodeAt(0) % 2 === 0 ? "on" : ""}`} key={`${char}-${index}`} />
        ))}
      </div>
      <div className="mono xs ct3" style={{ marginTop: 8 }}>{code}</div>
    </div>
  );
}

export function DetailHeader({ title, subtitle, badges = [], actions = [] }) {
  return (
    <div className="detail-head">
      <div>
        <div className="md bb">{title}</div>
        {subtitle ? <div className="xs ct3">{subtitle}</div> : null}
        {badges.length ? (
          <div className="fx" style={{ gap: 4, marginTop: 5, flexWrap: "wrap" }}>
            {badges.map((badge, index) => (
              <Badge tone={badge.tone} key={`${badge.label}-${index}`}>
                {badge.label}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
      <div className="fx" style={{ gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {actions.map((action) => (
          <Button key={action.label} tone={action.tone} small={action.small} icon={action.icon} onClick={action.onClick}>
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
