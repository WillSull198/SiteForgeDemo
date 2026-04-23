import React, { useMemo } from "react";
import { Icons, renderIcon } from "../components/icons";

export function AppShell({ store, title, nav, children }) {
  const { data, session, actions, derived } = store;
  const site = derived.site;

  const notifications = useMemo(
    () => [
      {
        id: "n1",
        title: "Water ingress issue still open",
        time: "7:32 AM",
        unread: true,
      },
      {
        id: "n2",
        title: `${data.approvals.filter((approval) => approval.status === "awaiting-client").length} approvals awaiting client response`,
        time: "Now",
        unread: true,
      },
      {
        id: "n3",
        title: `${data.presence.attendance.filter((entry) => entry.anomalies.length > 0).length} presence anomalies require review`,
        time: "Today",
        unread: true,
      },
      {
        id: "n4",
        title: `${data.passport.scanEvents.filter((event) => event.result === "blocked").length} blocked passport scans today`,
        time: "Today",
        unread: false,
      },
    ],
    [data.approvals, data.passport.scanEvents, data.presence.attendance],
  );

  return (
    <div className="A">
      <div className="S">
        <div className="S-h">
          <h1>
            <span className="lg">SF</span> SiteForge
          </h1>
          <p>Construction OS · v4</p>
        </div>
        {session.view === "site" ? (
          <div className="S-st" onClick={() => actions.setView("portfolio")}>
            <div className="sn">
              {renderIcon(Icons.back, 11)} <span className="cam">{site.name}</span>
            </div>
            <div className="sa">{site.addr}</div>
          </div>
        ) : (
          <div className="S-st" onClick={() => actions.pickSite("s1")}>
            <div className="sn">{renderIcon(Icons.briefcase, 11)} Portfolio View</div>
            <div className="sa">{data.sites.length} sites</div>
          </div>
        )}
        <div className="S-n">
          {session.view === "site"
            ? nav.map((entry, index) => {
                if (entry.sep) {
                  return (
                    <div className="S-sep" key={`${entry.label}-${index}`}>
                      {entry.label}
                    </div>
                  );
                }

                return (
                  <button key={entry.key} className={`N ${session.page === entry.key ? "on" : ""}`} onClick={() => actions.setPage(entry.key)}>
                    {renderIcon(entry.icon, 14)} {entry.label}
                    {entry.badge > 0 ? <span className={`nb ${entry.badgeTone || ""}`}>{entry.badge}</span> : null}
                  </button>
                );
              })
            : (
              <>
                <div className="S-sep">SITES</div>
                {data.sites.map((entry) => (
                  <button
                    key={entry.id}
                    className="N"
                    onClick={() => actions.pickSite(entry.id)}
                    style={{ flexDirection: "column", alignItems: "flex-start", gap: 0, padding: "6px 7px" }}
                  >
                    <div className="b xs">{entry.name}</div>
                    <div className="xs ct3">{entry.client}</div>
                  </button>
                ))}
              </>
            )}
        </div>
        <div className="S-u">
          <div className="ua">DM</div>
          <div>
            <div className="b" style={{ fontSize: 10 }}>
              Dave Mitchell
            </div>
            <div className="xs ct3">{session.role}</div>
          </div>
        </div>
      </div>

      <div className="M">
        <div className="T">
          <h2>{session.view === "portfolio" ? "Portfolio" : title}</h2>
          <div className="tr">
            <select
              value={session.role}
              onChange={(event) => actions.setRole(event.target.value)}
              style={{
                background: "var(--pu2)",
                color: "var(--pu)",
                border: "none",
                cursor: "pointer",
                fontSize: 8,
                padding: "3px 6px",
                borderRadius: 3,
                fontWeight: 600,
                fontFamily: "inherit",
              }}
            >
              {store.config.roles.map((role) => (
                <option key={role}>{role}</option>
              ))}
            </select>
            <div className="wp">
              {renderIcon(Icons.sun, 11)}
              <span>Brisbane</span>
              <b>24°C</b>
            </div>
            <div className="sb">
              {renderIcon(Icons.search, 12)}
              <input placeholder="Search modules, approvals, workers..." />
            </div>
            <div style={{ position: "relative" }}>
              <button className="nb2" onClick={() => actions.toggleNotifications()}>
                {renderIcon(Icons.bell, 13)}
                <div className="dot" />
              </button>
              {session.notifOpen ? (
                <div className="notif-pop fin">
                  <div className="notif-head">Notifications</div>
                  {notifications.map((notification) => (
                    <div className="notif-item" key={notification.id}>
                      {notification.title}
                      <div className="act-t" style={{ marginTop: 1 }}>
                        {notification.time}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="C" onClick={() => session.notifOpen && actions.toggleNotifications(false)}>
          {children}
        </div>
      </div>
    </div>
  );
}
