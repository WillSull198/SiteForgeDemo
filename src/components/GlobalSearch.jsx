import { useEffect, useMemo, useRef, useState } from "react";
import { routeKindForRole } from "../services/permissions";
import { Icons, renderIcon } from "./icons";

const ROLE_ORDER = ["Supervisor", "Project Manager", "Contract Admin", "Director", "Subcontractor", "Client", "Worker"];
const INCLUDE_DEMO_DATA = import.meta.env.VITE_INCLUDE_DEMO_DATA !== "false";

function buildCommands(role, query = "") {
  const q = query.trim().toLowerCase();
  const routeKind = routeKindForRole(role);
  const directorRoute = routeKind === "director";
  const commands = [
    { id: "cmd-create-task", title: "Create task", subtitle: "Open Tasks workspace", action: { type: "navigate", route: { kind: routeKind, page: directorRoute ? "boardroom" : "tasks", siteId: "s1", entityId: null } } },
    { id: "cmd-clientflow", title: "Go to ClientFlow", subtitle: "Navigate to approvals", action: { type: "navigate", route: { kind: routeKind, page: directorRoute ? "commercial-risk" : "clientflow", siteId: "s1", entityId: null } } },
    { id: "cmd-board", title: "Generate board report", subtitle: "Run the current board report action", action: { type: "board-report" } },
    INCLUDE_DEMO_DATA ? { id: "cmd-demo", title: "Toggle demo mode", subtitle: "Switch between demo and live modes", action: { type: "demo" } } : null,
    ...ROLE_ORDER.map((entry) => ({
      id: `role-${entry}`,
      title: `Switch to ${entry}`,
      subtitle: "Swap role experience instantly",
      action: { type: "role", value: entry },
    })),
  ].filter(Boolean);

  if (!q) return commands.slice(0, 8);
  return commands.filter((command) => `${command.title} ${command.subtitle}`.toLowerCase().includes(q));
}

export default function GlobalSearch({
  open,
  onClose,
  onNavigate,
  onRemember,
  onAction,
  search,
  recentSearches = [],
  role = "Supervisor",
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const focus = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(focus);
  }, [open]);

  const entityGroups = useMemo(() => search?.(query) || [], [query, search]);
  const commandGroup = useMemo(() => buildCommands(role, query), [query, role]);

  const flatResults = useMemo(() => {
    const flattened = [];
    if (commandGroup.length) {
      commandGroup.forEach((command) => {
        flattened.push({ kind: "command", group: "Commands", ...command });
      });
    }
    entityGroups.forEach((group) => {
      group.results.forEach((result) => {
        flattened.push({ kind: "entity", group: group.type, ...result });
      });
    });
    return flattened;
  }, [commandGroup, entityGroups]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => Math.min(flatResults.length - 1, current + 1));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => Math.max(0, current - 1));
      }
      if (event.key === "Enter" && flatResults[activeIndex]) {
        event.preventDefault();
        const item = flatResults[activeIndex];
        if (query.trim()) onRemember?.(query.trim());
        if (item.kind === "command") {
          onAction?.(item.action);
        } else {
          onNavigate?.(item.route);
        }
        onClose?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, flatResults, onAction, onClose, onNavigate, onRemember, query]);

  if (!open) {
    return null;
  }

  let runningIndex = -1;

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-modal command-palette" onClick={(event) => event.stopPropagation()}>
        <div className="search-input-wrap">
          {renderIcon(Icons.search, 16)}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search records, switch roles, and run commands..."
          />
        </div>
        {!query.trim() ? (
          <div className="search-recent">
            <div className="xs ct3">Recent searches</div>
            <div className="fx" style={{ gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              {recentSearches.map((term) => (
                <button className="ft" key={term} onClick={() => setQuery(term)} type="button">
                  {term}
                </button>
              ))}
            </div>
            <div className="search-group" style={{ marginTop: 18 }}>
              <div className="search-group-title">Suggested commands</div>
              {commandGroup.slice(0, 6).map((command, index) => (
                <button
                  className={`search-item ${activeIndex === index ? "active" : ""}`.trim()}
                  key={command.id}
                  onClick={() => {
                    onAction?.(command.action);
                    onClose?.();
                  }}
                  type="button"
                >
                  <div className="b sm">{command.title}</div>
                  <div className="xs ct3">{command.subtitle}</div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="search-results">
            {commandGroup.length ? (
              <div className="search-group">
                <div className="search-group-title">Commands</div>
                {commandGroup.map((command) => {
                  runningIndex += 1;
                  return (
                    <button
                      className={`search-item ${activeIndex === runningIndex ? "active" : ""}`.trim()}
                      key={command.id}
                      onClick={() => {
                        onRemember?.(query.trim());
                        onAction?.(command.action);
                        onClose?.();
                      }}
                      type="button"
                    >
                      <div className="b sm">{command.title}</div>
                      <div className="xs ct3">{command.subtitle}</div>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {entityGroups.length ? (
              entityGroups.map((group) => (
                <div key={group.type} className="search-group">
                  <div className="search-group-title">{group.type}</div>
                  {group.results.map((result) => {
                    runningIndex += 1;
                    return (
                      <button
                        className={`search-item ${activeIndex === runningIndex ? "active" : ""}`.trim()}
                        key={`${group.type}-${result.id}`}
                        onClick={() => {
                          onRemember?.(query.trim());
                          onNavigate?.(result.route);
                          onClose?.();
                        }}
                        type="button"
                      >
                        <div className="b sm">{result.title}</div>
                        <div className="xs ct3">{result.subtitle}</div>
                      </button>
                    );
                  })}
                </div>
              ))
            ) : !commandGroup.length ? (
              <div className="ct3 sm empty">No results for "{query}".</div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
