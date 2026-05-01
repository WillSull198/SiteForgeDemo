/* SiteForge audit: Removed console-only crash logging and connected saved company
   branding to the live shell header so Settings changes are visible immediately. */

import { Component, useEffect, useMemo, useRef, useState } from "react";
import AIAssistantDrawer from "./components/AIAssistantDrawer";
import Breadcrumbs from "./components/Breadcrumbs";
import GlobalSearch from "./components/GlobalSearch";
import NotificationBell from "./components/NotificationBell";
import RoleSelector from "./components/RoleSelector";
import { Icons, renderIcon } from "./components/icons";
import { AccessDenied, Button, Modal } from "./components/ui";
import { APP_CONFIG } from "./data/seedData";
import ClientFlowPage from "./pages/ClientFlowPage";
import ClientPortalPage from "./pages/ClientPortalPage";
import ContractStudio from "./pages/ContractStudio";
import DirectorBoardroom from "./pages/DirectorBoardroom";
import IntegrationsPage from "./pages/IntegrationsPage";
import OperationsPages from "./pages/OperationsPages";
import PresencePage from "./pages/PresencePage";
import SitePassportPage from "./pages/SitePassportPage";
import SubcontractorPortal from "./pages/SubcontractorPortal";
import WorkerMobileView from "./pages/WorkerMobileView";
import { can, getNavForRole, mustHandUpForApproval, routeKindForRole } from "./services/permissions";
import { SiteForgeProvider, useSiteForge } from "./services/siteforgeStore";
import { getSyncStatus, subscribeSyncStatus } from "./services/data";
import { captureException, track } from "./services/observability";

const PAGE_TITLES = {
  boardroom: "Boardroom",
  portfolio: "Portfolio",
  dash: "Command Centre",
  tasks: "Tasks",
  probs: "Problems",
  wf: "Workforce",
  diary: "Site Diary",
  safety: "Safety",
  rfis: "RFIs",
  mats: "Procurement",
  qa: "QA / Inspections",
  plans: "Plans",
  docs: "Document Control",
  team: "Team",
  calc: "Calculators",
  clientflow: "ClientFlow",
  passport: "Site Passport",
  sched: "Schedule",
  budget: "Budget",
  vos: "Variations",
  presence: "Attendance Intelligence",
  rpts: "Reports",
  contracts: "Contract Studio",
  integrations: "Integrations",
  admin: "Configuration",
  audit: "Audit Trail",
  "financial-summary": "Financial Summary",
  "commercial-risk": "Commercial Risk",
  "safety-record": "Safety Record",
};

const PAGE_PERMISSIONS = {
  clientflow: "clientflow.view",
  probs: "problems.view",
  tasks: "tasks.view",
  wf: "checkin.manage",
  diary: "diary.create",
  rfis: "rfis.view",
  mats: "procurement.view",
  vos: "variations.view",
  contracts: "contracts.view",
  budget: "budget.view",
  sched: "schedule.view",
  passport: "passport.admin",
  presence: "presence.view",
  integrations: "integrations.view",
  docs: "documents.view",
  plans: "documents.view",
  audit: "audit.view",
};

class ViewBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    captureException(error, { componentStack: info?.componentStack, boundary: "ViewBoundary" });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="restricted">
          <div className="restricted-badge">View Recovery</div>
          <div className="b md" style={{ marginTop: 8 }}>This view hit an unexpected error.</div>
          <div className="sm ct2" style={{ marginTop: 5 }}>
            You can recover without reloading the whole app. If this keeps happening, reset the demo state.
          </div>
          <div className="fx" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <Button onClick={this.props.onRecover}>Return to safe page</Button>
            <Button tone="bt-p" onClick={this.props.onReset}>Reset demo state</Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function Shell() {
  const { state, actions, derived } = useSiteForge();
  const route = state.session.route;
  const role = state.session.role;
  const user = derived.currentUser;
  const goPrefixRef = useRef("");
  const goPrefixTimerRef = useRef(null);
  const [showSplash, setShowSplash] = useState(() => {
    try {
      return !window.sessionStorage.getItem("siteforge-splash-seen");
    } catch (error) {
      return true;
    }
  });
  const [quickNewOpen, setQuickNewOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [quickForm, setQuickForm] = useState({ title: "", description: "" });
  const [supportForm, setSupportForm] = useState({ subject: "", body: "" });
  const [syncStatus, setSyncStatus] = useState({ state: "synced", pending: 0, stuck: 0 });
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState(null);
  const company = state.settings?.company || state.company || APP_CONFIG.builder;

  useEffect(() => {
    const onKeyDown = (event) => {
      const isMeta = event.metaKey || event.ctrlKey;
      if (isMeta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        actions.openCommandPalette();
      }
      if (isMeta && event.key === "/") {
        event.preventDefault();
        actions.toggleAIAssistant();
      }
      if (isMeta && event.key === ".") {
        event.preventDefault();
        actions.setDemoMode(!state.demo.mode);
      }
      if (isMeta && event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        actions.toggleDemoScriptMode();
      }
      if (!isMeta && event.key.toLowerCase() === "n" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
        event.preventDefault();
        setQuickNewOpen(true);
      }
      if (!isMeta && /^[1-7]$/.test(event.key) && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
        event.preventDefault();
        const roles = ["Supervisor", "Project Manager", "Contract Admin", "Director", "Subcontractor", "Client", "Worker"];
        actions.setRole(roles[Number(event.key) - 1]);
        track("role.switched", { role: roles[Number(event.key) - 1], shortcut: true });
      }
      if (!isMeta && event.key.toLowerCase() === "g") {
        goPrefixRef.current = "g";
        if (goPrefixTimerRef.current) window.clearTimeout(goPrefixTimerRef.current);
        goPrefixTimerRef.current = window.setTimeout(() => {
          goPrefixRef.current = "";
          goPrefixTimerRef.current = null;
        }, 900);
      } else if (!isMeta && goPrefixRef.current === "g") {
        const routeKind = routeKindForRole(role);
        const directorRoute = routeKind === "director";
        const shortcuts = {
          t: { kind: routeKind, page: directorRoute ? "boardroom" : "tasks", siteId: state.session.siteId },
          p: { kind: routeKind, page: directorRoute ? "portfolio" : "probs", siteId: state.session.siteId },
          c: { kind: routeKind, page: directorRoute ? "commercial-risk" : "clientflow", siteId: state.session.siteId },
          d: { kind: routeKind, page: directorRoute ? "boardroom" : "dash", siteId: state.session.siteId },
          a: { kind: routeKind, page: directorRoute ? "commercial-risk" : "clientflow", siteId: state.session.siteId },
        };
        const target = shortcuts[event.key.toLowerCase()];
        if (target) {
          event.preventDefault();
          actions.navigate({ ...target, entityId: null });
        }
        goPrefixRef.current = "";
      }
      if (!isMeta && event.key === "?") {
        event.preventDefault();
        setHelpOpen(true);
      }
      if (event.key === "Escape") {
        setQuickNewOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (goPrefixTimerRef.current) {
        window.clearTimeout(goPrefixTimerRef.current);
        goPrefixTimerRef.current = null;
      }
    };
  }, [actions, role, state.demo.mode, state.session.siteId]);

  useEffect(() => {
    document.title = route.kind === "director" ? `${APP_CONFIG.appTitle} Boardroom` : `${APP_CONFIG.appTitle} · ${PAGE_TITLES[route.page] || route.page}`;
    document.body.dataset.role = role.toLowerCase().replace(/\s+/g, "-");
  }, [role, route.page]);

  useEffect(() => {
    const requestedTheme = state.settings?.appearance?.theme || state.settings?.theme || "light";
    const resolvedTheme =
      requestedTheme === "system"
        ? window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
          ? "dark"
          : "light"
        : requestedTheme;
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.classList.toggle("theme-dark", resolvedTheme === "dark");
  }, [state.settings?.appearance?.theme, state.settings?.theme]);

  useEffect(() => {
    if (!showSplash) return undefined;
    const timer = window.setTimeout(() => {
      setShowSplash(false);
      try {
        window.sessionStorage.setItem("siteforge-splash-seen", "true");
      } catch (error) {
        // Ignore storage issues in restricted/private contexts.
      }
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [showSplash]);

  useEffect(() => {
    let mounted = true;
    getSyncStatus().then((status) => mounted && setSyncStatus(status));
    const unsubscribe = subscribeSyncStatus((status) => mounted && setSyncStatus(status));
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const updateOnline = () => setIsOnline(navigator.onLine);
    const onInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
    };
  }, []);

  const isClient = route.kind === "client";
  const isWorker = route.kind === "worker";
  const isSubcontractor = route.kind === "subcontractor";
  const navSections = useMemo(() => getNavForRole(role), [role]);
  const routeKey = `${route.kind || "internal"}:${route.page || "dash"}:${route.siteId || ""}:${route.entityId || ""}:${state.session.userId || ""}`;

  const navBadgeFor = (badge) => {
    const siteId = state.session.siteId;
    if (badge === "tasks") return state.tasks.filter((task) => task.siteId === siteId && task.status !== "done" && !task.archived).length;
    if (badge === "problems") return state.problems.filter((problem) => problem.siteId === siteId && ["open", "under-review", "in-progress"].includes(problem.status)).length;
    if (badge === "approvals") return state.approvals.filter((approval) => approval.siteId === siteId && !["signed", "declined", "archived", "withdrawn"].includes(approval.status)).length;
    if (badge === "rfis") return state.rfis.filter((rfi) => rfi.siteId === siteId && !["closed", "responded"].includes(rfi.status)).length;
    return 0;
  };

  const iconFor = (iconName) => Icons[iconName] || Icons.grid;

  if (!user) {
    return (
      <div className="A">
        <main className="M">
          <div className="C">
            <div className="restricted">
              <div className="restricted-badge">Session Recovery</div>
              <div className="b md" style={{ marginTop: 8 }}>We couldn't restore this role session cleanly.</div>
              <div className="sm ct2" style={{ marginTop: 5 }}>The demo state has likely drifted. Resetting will restore a clean workspace.</div>
              <Button tone="bt-p" onClick={() => actions.resetDemo()} style={{ marginTop: 12 }}>
                Reset Demo State
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const breadcrumbItems = useMemo(() => {
    if (isClient || isWorker || isSubcontractor) return [];
    const items = [];
    if (route.kind === "director") {
      items.push({ label: "Portfolio", route: { kind: "director", page: "boardroom", siteId: null }, active: route.page === "boardroom" });
      if (route.siteId) {
        items.push({ label: state.sites.find((site) => site.id === route.siteId)?.name || route.siteId, route: { kind: "director", page: route.page, siteId: route.siteId } });
      }
      if (route.page !== "boardroom") {
        items.push({ label: PAGE_TITLES[route.page] || route.page, active: true });
      }
      return items;
    }
    items.push({ label: "Portfolio", route: { kind: "internal", siteId: state.session.siteId, page: "portfolio", entityId: null } });
    items.push({ label: derived.currentSite.name, route: { kind: "internal", siteId: derived.currentSite.id, page: "dash", entityId: null } });
    items.push({ label: PAGE_TITLES[route.page] || route.page, active: !route.entityId });
    if (route.entityId) {
      items.push({ label: route.entityId, active: true });
    }
    return items;
  }, [derived.currentSite, isClient, isSubcontractor, isWorker, role, route, state.session.siteId, state.sites]);

  const renderInternalPage = () => {
    const permission = PAGE_PERMISSIONS[route.page];
    if (permission && !can(role, permission)) {
      return <AccessDenied permission={permission} />;
    }
    if (route.page === "clientflow") return <ClientFlowPage />;
    if (route.page === "passport") return <SitePassportPage />;
    if (route.page === "presence") return <PresencePage />;
    if (route.page === "integrations") return <IntegrationsPage />;
    if (route.page === "contracts") return <ContractStudio />;
    if (route.page === "boardroom") return <DirectorBoardroom />;
    return <OperationsPages page={route.page} />;
  };

  const submitQuickNew = () => {
    const page = route.page;
    if (page === "tasks") {
      actions.addTask(quickForm);
    } else if (page === "probs") {
      actions.addProblem({ title: quickForm.title, description: quickForm.description, priority: "medium" });
    } else if (page === "rfis") {
      actions.createRfi({ title: quickForm.title, description: quickForm.description, to: "Consultant", trade: user.trade || "General" });
    } else if (page === "mats") {
      actions.addProcurementRequest({ item: quickForm.title, quantity: quickForm.description || "1", requestedBy: user.id });
    } else if (page === "clientflow") {
      const fallbackSource = state.problems.find((problem) => problem.siteId === state.session.siteId);
      if (fallbackSource) {
        actions.createApprovalFromSource({ sourceType: "problem", sourceId: fallbackSource.id, approvalType: "Variation", handUp: mustHandUpForApproval(role) });
      }
    } else {
      actions.addTask({ title: quickForm.title, description: quickForm.description, trade: user.trade || "General" });
    }
    setQuickNewOpen(false);
    setQuickForm({ title: "", description: "" });
  };

  if (isClient) {
    return (
      <ViewBoundary key={routeKey} onRecover={() => actions.setRole("Client")} onReset={actions.resetDemo}>
        <ClientPortalPage />
      </ViewBoundary>
    );
  }
  if (isWorker) {
    return (
      <ViewBoundary key={routeKey} onRecover={() => actions.setRole("Worker")} onReset={actions.resetDemo}>
        <WorkerMobileView />
      </ViewBoundary>
    );
  }
  if (isSubcontractor) {
    return (
      <ViewBoundary key={routeKey} onRecover={() => actions.setRole("Subcontractor")} onReset={actions.resetDemo}>
        <SubcontractorPortal />
      </ViewBoundary>
    );
  }

  return (
    <>
      <div className="A">
        <aside className="S">
          <div className="S-h">
            <h1>
              <span className="lg">{company.logoDataUrl ? <img alt="" src={company.logoDataUrl} /> : "SF"}</span> {company.name || "SiteForge"}
            </h1>
            <p>Construction operating layer</p>
          </div>
          {route.kind !== "director" ? (
            <div className="S-st" onClick={() => actions.navigate({ kind: "internal", siteId: state.session.siteId, page: "portfolio", entityId: null })}>
              <div className="sn">{renderIcon(Icons.briefcase, 12)} Portfolio View</div>
              <div className="sa">{state.sites.length} sites</div>
            </div>
          ) : null}
          <div className="S-n">
            {navSections.map((section) => (
              <div className="nav-section" key={section.section}>
                <div className="nav-section-header">{section.section}</div>
                {section.items.map((item) => {
                  const badge = navBadgeFor(item.badge);
                  return (
                    <button
                      key={item.key}
                      className={`N ${route.page === item.page ? "on" : ""}`.trim()}
                      onClick={() =>
                        actions.navigate({
                          kind: routeKindForRole(role),
                          page: item.page,
                          siteId: route.kind === "director" ? route.siteId : state.session.siteId,
                          entityId: null,
                        })
                      }
                      type="button"
                    >
                      {renderIcon(iconFor(item.icon), 14)}
                      <span>{item.label}</span>
                      {badge ? <span className="nb">{badge}</span> : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="S-u">
            <div className="ua">{user.avatar}</div>
            <div>
              <div className="b" style={{ fontSize: 10 }}>
                {user.name}
              </div>
              <div className="xs ct3">{role}</div>
            </div>
          </div>
        </aside>

        <main className="M">
          <div className="T">
            <div>
              <h2>{PAGE_TITLES[route.page] || route.page}</h2>
              <Breadcrumbs items={breadcrumbItems} onNavigate={actions.navigate} />
            </div>
            <div className="tr">
              <RoleSelector value={role} onChange={actions.setRole} roles={["Supervisor", "Project Manager", "Contract Admin", "Director", "Subcontractor", "Client", "Worker"]} currentUser={user} />
              {route.kind !== "director" ? (
                <select className="role-select" value={state.session.siteId} onChange={(event) => actions.setSite(event.target.value)}>
                  {derived.accessibleSites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <button className="sb top-search" onClick={() => actions.openCommandPalette()} type="button">
                {renderIcon(Icons.search, 13)}
                <span>Search or run a command...</span>
              </button>
              <Button small tone={state.demo.mode ? "bt-p" : ""} icon={Icons.clock} onClick={() => actions.setDemoMode(!state.demo.mode)}>
                {state.demo.mode ? "Demo Mode" : "Live Mode"}
              </Button>
              {installPrompt ? (
                <Button
                  small
                  icon={Icons.download}
                  onClick={async () => {
                    await installPrompt.prompt();
                    setInstallPrompt(null);
                  }}
                >
                  Install
                </Button>
              ) : null}
              <div className="wp">
                {renderIcon(Icons.sun, 11)}
                <span>Brisbane</span>
                <b>{derived.currentSite.weather?.split(",").pop()?.trim() || "24°C"}</b>
              </div>
              <NotificationBell
                open={state.ui.notificationsOpen}
                unreadCount={derived.unreadNotifications}
                notifications={derived.notificationsForUser}
                onToggle={actions.toggleNotifications}
                onRead={actions.markNotificationRead}
                onMarkAllRead={actions.markAllNotificationsRead}
                onNavigate={(targetRoute) => targetRoute && actions.navigate(targetRoute)}
              />
              <Button small icon={Icons.help} onClick={() => setHelpOpen(true)}>
                Help
              </Button>
              <span className={`sync-pill ${syncStatus.state}`} title={`${syncStatus.pending} pending, ${syncStatus.stuck} stuck`}>
                <span className="sync-dot" />
                {!isOnline ? "Offline" : syncStatus.state === "synced" ? "Synced" : syncStatus.state === "syncing" ? "Syncing" : "Review"}
              </span>
            </div>
          </div>

          {!state.onboarding?.completedTours?.includes(role) ? (
            <div className="notice-banner" style={{ margin: "0 24px 12px" }}>
              <b>{role} tour:</b> Use the sidebar to move through your role-specific workspace. ClientFlow recovers money, Passport controls access, and Reports stores operational PDFs.
              <Button small style={{ marginLeft: 10 }} onClick={() => actions.markTourComplete(role)}>
                Got it
              </Button>
            </div>
          ) : null}

          <div className="C">
            <ViewBoundary
              key={routeKey}
              onRecover={() => actions.setRole(role)}
              onReset={actions.resetDemo}
            >
              {renderInternalPage()}
            </ViewBoundary>
          </div>
        </main>
      </div>

      {(can(role, "tasks.create") || can(role, "problems.create")) && route.kind === "internal" && (
        <button className="mobile-fab" type="button" onClick={() => setQuickNewOpen(true)}>
          {renderIcon(Icons.plus, 18)} New
        </button>
      )}

      <GlobalSearch
        open={state.ui.searchOpen}
        onClose={actions.closeSearch}
        onNavigate={actions.navigate}
        onRemember={actions.rememberSearch}
        search={derived.search}
        recentSearches={state.session.recentSearches}
        role={role}
        onAction={(action) => {
          if (action.type === "role") actions.setRole(action.value);
          if (action.type === "navigate") actions.navigate(action.route);
          if (action.type === "demo") actions.setDemoMode(!state.demo.mode);
          if (action.type === "board-report") actions.generateBoardReport();
        }}
      />

      <Modal open={quickNewOpen} close={() => setQuickNewOpen(false)} title="Quick Create">
        <div className="ff">
          <label>Title</label>
          <input value={quickForm.title} onChange={(event) => setQuickForm((current) => ({ ...current, title: event.target.value }))} />
        </div>
        <div className="ff">
          <label>Description / Quantity</label>
          <textarea value={quickForm.description} onChange={(event) => setQuickForm((current) => ({ ...current, description: event.target.value }))} />
        </div>
        <div className="fa">
          <Button onClick={() => setQuickNewOpen(false)}>Cancel</Button>
          <Button tone="bt-p" onClick={submitQuickNew}>
            Create
          </Button>
        </div>
      </Modal>

      <Modal open={!state.onboarding?.complete} close={() => actions.completeOnboarding("demo")} title="Welcome to SiteForge" wide>
        <div className="g2">
          <div className="onboarding-panel">
            <div className="b md">Try the demo</div>
            <div className="sm ct2">Explore SiteForge with realistic Australian construction data, including ClientFlow, Passport, Presence and Buildxact workflows.</div>
            <Button tone="bt-p" onClick={() => actions.completeOnboarding("demo")} style={{ marginTop: 12 }}>
              Start Demo
            </Button>
          </div>
          <div className="onboarding-panel">
            <div className="b md">Set up my company</div>
            <div className="sm ct2">Add company details, ABN, logo, AI key and integration settings before creating your first real project.</div>
            <Button
              onClick={() => {
                actions.completeOnboarding("real-account");
                actions.navigate({ kind: "internal", siteId: state.session.siteId, page: "admin", entityId: null });
              }}
              style={{ marginTop: 12 }}
            >
              Set Up Company
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={helpOpen} close={() => setHelpOpen(false)} title="SiteForge Help" wide>
        <div className="g2">
          <div>
            <div className="b sm mb8">Quick guide</div>
            <div className="list-stack">
              {[
                ["ClientFlow", "Turn site events into signed client approvals."],
                ["Site Passport", "Control access with induction, SWMS, tickets and COI evidence."],
                ["Presence", "Use disclosed attendance only after the 14-day notice gate."],
                ["Recovery Engine", "Find forgotten events that should become commercial recovery."],
                ["Buildxact", "Keep cost, supplier and PO workflows in Buildxact; SiteForge syncs outcomes."],
              ].map(([title, body]) => (
                <div className="linked-row" key={title}>
                  <div>
                    <div className="b sm">{title}</div>
                    <div className="xs ct3">{body}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="b sm mb8">Contact support</div>
            <div className="ff">
              <label>Subject</label>
              <input value={supportForm.subject} onChange={(event) => setSupportForm((current) => ({ ...current, subject: event.target.value }))} />
            </div>
            <div className="ff">
              <label>What do you need?</label>
              <textarea value={supportForm.body} onChange={(event) => setSupportForm((current) => ({ ...current, body: event.target.value }))} />
            </div>
            <Button
              tone="bt-p"
              onClick={() => {
                actions.submitSupportRequest(supportForm);
                setSupportForm({ subject: "", body: "" });
              }}
            >
              Queue Support Request
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={state.ui.shortcutsOpen} close={actions.toggleShortcuts} title="Keyboard Shortcuts">
        <div className="list-stack">
          <div className="linked-row">
            <div>
              <div className="b sm">⌘K / Ctrl+K</div>
              <div className="xs ct3">Open global search</div>
            </div>
          </div>
          <div className="linked-row">
            <div>
              <div className="b sm">N</div>
              <div className="xs ct3">Open quick create</div>
            </div>
          </div>
          <div className="linked-row">
            <div>
              <div className="b sm">?</div>
              <div className="xs ct3">Show shortcuts</div>
            </div>
          </div>
          <div className="linked-row">
            <div>
              <div className="b sm">G then T / P / C / D / A</div>
              <div className="xs ct3">Go to Tasks, Problems, ClientFlow, Dashboard, or Approvals</div>
            </div>
          </div>
          <div className="linked-row">
            <div>
              <div className="b sm">1-7</div>
              <div className="xs ct3">Switch roles</div>
            </div>
          </div>
          <div className="linked-row">
            <div>
              <div className="b sm">⌘/</div>
              <div className="xs ct3">Toggle AI assistant</div>
            </div>
          </div>
          <div className="linked-row">
            <div>
              <div className="b sm">⌘.</div>
              <div className="xs ct3">Toggle demo mode</div>
            </div>
          </div>
          <div className="linked-row">
            <div>
              <div className="b sm">⌘⇧D</div>
              <div className="xs ct3">Toggle demo script mode</div>
            </div>
          </div>
          <div className="linked-row">
            <div>
              <div className="b sm">Esc</div>
              <div className="xs ct3">Close modal or overlay</div>
            </div>
          </div>
        </div>
      </Modal>

      {["Supervisor", "Project Manager", "Contract Admin", "Director"].includes(role) ? (
        <>
          <button className="ai-fab" type="button" onClick={() => actions.toggleAIAssistant()}>
            {renderIcon(Icons.zap, 18)}
          </button>
          <AIAssistantDrawer open={state.ui.aiAssistantOpen} onClose={() => actions.toggleAIAssistant()} />
        </>
      ) : null}

      {state.demo.recentToasts.length ? (
        <div className="toast-stack">
          {state.demo.recentToasts.map((toast) => (
            <button className={`toast-card ${toast.tone || "medium"}`.trim()} key={toast.id} onClick={() => actions.dismissToast(toast.id)} type="button">
              <div className="b sm">{toast.title}</div>
              <div className="xs ct2" style={{ marginTop: 4 }}>{toast.body}</div>
            </button>
          ))}
        </div>
      ) : null}

      {state.ui.bootRoleSelectorOpen ? (
        <div className="boot-overlay">
          <div className="boot-card">
            <div className="boot-mark">SF</div>
            <div className="boot-kicker">SiteForge Enterprise</div>
            <h1>Select a demo role</h1>
            <div className="boot-role-grid">
              {["Supervisor", "Project Manager", "Contract Admin", "Director", "Subcontractor", "Client", "Worker"].map((entry) => (
                <button
                  className={`boot-role ${entry === role ? "active" : ""}`.trim()}
                  key={entry}
                  onClick={() => {
                    actions.setRole(entry);
                    actions.dismissBootRoleSelector();
                  }}
                  type="button"
                >
                  <div className="b sm">{entry}</div>
                </button>
              ))}
            </div>
            <div className="fa" style={{ marginTop: 14, justifyContent: "center" }}>
              <Button onClick={() => actions.dismissBootRoleSelector()}>Continue with {role}</Button>
            </div>
          </div>
        </div>
      ) : null}

      {state.demo.demoScriptMode ? (
        <div className="demo-script-panel">
          <div className="xs ct3">Demo Script Mode</div>
          <div className="b sm" style={{ marginTop: 4 }}>
            Step {state.demo.demoScriptStep + 1}
          </div>
          <div className="xs ct2" style={{ marginTop: 6 }}>
            Use Next to cycle through the prepared showcase flow.
          </div>
          <div className="fa" style={{ marginTop: 10 }}>
            <Button
              small
              onClick={() => {
                const sequence = [
                  { role: "Supervisor", route: { kind: "internal", siteId: "s1", page: "dash", entityId: null } },
                  { role: "Project Manager", route: { kind: "internal", siteId: "s1", page: "clientflow", entityId: null } },
                  { role: "Contract Admin", route: { kind: "internal", siteId: "s1", page: "contracts", entityId: null } },
                  { role: "Director", route: { kind: "director", page: "boardroom", siteId: null, entityId: null } },
                  { role: "Client", route: { kind: "client", clientId: "c1", page: "approvals", entityId: null } },
                  { role: "Worker", route: { kind: "worker", userId: "u_worker_1", page: "home", entityId: null } },
                ];
                const nextStep = sequence[state.demo.demoScriptStep % sequence.length];
                actions.setRole(nextStep.role);
                actions.navigate(nextStep.route);
                actions.advanceDemoScript();
              }}
            >
              Next
            </Button>
            <Button small onClick={() => actions.toggleDemoScriptMode()}>
              Exit
            </Button>
          </div>
        </div>
      ) : null}

      {showSplash ? (
        <div className="splash-screen">
          <div className="splash-logo">SF</div>
          <div className="splash-title">{APP_CONFIG.appTitle}</div>
          <div className="splash-copy">Construction operating layer for field, client, contract, and commercial recovery.</div>
        </div>
      ) : null}
    </>
  );
}

export default function App() {
  return (
    <SiteForgeProvider>
      <Shell />
    </SiteForgeProvider>
  );
}
