import { useMemo } from "react";
import { groupNotifications } from "../services/notificationEngine";
import { Icons, renderIcon } from "./icons";
import { Button } from "./ui";

export default function NotificationBell({
  open,
  unreadCount,
  notifications,
  onToggle,
  onRead,
  onMarkAllRead,
  onNavigate,
}) {
  const grouped = useMemo(() => groupNotifications(notifications || []), [notifications]);

  return (
    <div className="notif-wrap">
      <button className="nb2" onClick={onToggle} type="button">
        {renderIcon(Icons.bell, 14)}
        {unreadCount ? <span className="notif-dot" /> : null}
      </button>
      {open ? (
        <div className="notif-panel">
          <div className="notif-head">
            <div>
              <div className="b sm">Notification Centre</div>
              <div className="xs ct3">{unreadCount} unread</div>
            </div>
            <Button small onClick={onMarkAllRead}>
              Mark all read
            </Button>
          </div>
          <div className="notif-body">
            {Object.keys(grouped).length ? (
              Object.entries(grouped).map(([group, items]) => (
                <div className="notif-group" key={group}>
                  <div className="notif-group-title">{group}</div>
                  {items.slice(0, 8).map((item) => (
                    <button
                      className={`notif-item ${item.readAt ? "" : "unread"}`.trim()}
                      key={item.id}
                      onClick={() => {
                        onRead?.(item.id);
                        onNavigate?.(item.route);
                      }}
                      type="button"
                    >
                      <div className="fb" style={{ alignItems: "flex-start", gap: 8 }}>
                        <div>
                          <div className="b sm">{item.title}</div>
                          <div className="xs ct2" style={{ marginTop: 3, lineHeight: 1.5 }}>
                            {item.body}
                          </div>
                        </div>
                        <span className={`bg ${item.severity === "critical" ? "critical" : item.severity === "high" ? "high" : "medium"}`}>
                          {item.channel}
                        </span>
                      </div>
                      <div className="act-t" style={{ marginTop: 5 }}>
                        {item.createdAt}
                      </div>
                    </button>
                  ))}
                </div>
              ))
            ) : (
              <div className="ct3 sm empty">No notifications for this role yet.</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
