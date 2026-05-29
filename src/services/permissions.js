/* SiteForge production audit: centralised role permissions so PM/Contract Admin/
   Director capability checks are no longer scattered across pages. */

export const PERMISSIONS = {
  "clientflow.view": ["Supervisor", "Project Manager", "Contract Admin", "Director"],
  "clientflow.create": ["Project Manager", "Contract Admin", "Director"],
  "clientflow.send": ["Project Manager", "Contract Admin", "Director"],
  "clientflow.send_to_client": ["Project Manager", "Contract Admin", "Director"],
  "clientflow.review_pm": ["Project Manager", "Director"],
  "clientflow.review_ca": ["Contract Admin", "Director"],
  "clientflow.approve": ["Project Manager", "Contract Admin", "Director"],
  "clientflow.mark_approved": ["Project Manager", "Contract Admin", "Director"],
  "clientflow.mark_declined": ["Project Manager", "Contract Admin", "Director"],
  "clientflow.generate_contract": ["Project Manager", "Contract Admin", "Director"],
  "problems.view": ["Supervisor", "Project Manager", "Contract Admin", "Director"],
  "problems.create": ["Supervisor", "Project Manager", "Director"],
  "problems.resolve": ["Supervisor", "Project Manager", "Director"],
  "problems.escalate": ["Project Manager", "Director"],
  "problems.escalate_to_approval": ["Project Manager", "Director"],
  "problems.delete": ["Project Manager", "Director"],
  "variations.view": ["Supervisor", "Project Manager", "Contract Admin", "Director"],
  "variations.create": ["Supervisor", "Project Manager", "Director"],
  "variations.approve": ["Project Manager", "Director"],
  "rfis.view": ["Supervisor", "Project Manager", "Contract Admin", "Director", "Subcontractor"],
  "rfis.create": ["Supervisor", "Project Manager", "Subcontractor"],
  "rfis.respond": ["Project Manager", "Contract Admin", "Director"],
  "procurement.view": ["Supervisor", "Project Manager", "Contract Admin", "Director"],
  "procurement.create": ["Supervisor", "Project Manager"],
  "procurement.approve": ["Project Manager", "Director"],
  "contracts.view": ["Project Manager", "Contract Admin", "Director"],
  "contracts.edit_draft": ["Contract Admin", "Director"],
  "contracts.sign_builder": ["Project Manager", "Contract Admin", "Director"],
  "contracts.archive": ["Contract Admin", "Director"],
  "budget.view": ["Project Manager", "Contract Admin", "Director"],
  "budget.edit": ["Director"],
  "budget.override": ["Director"],
  "schedule.view": ["Supervisor", "Project Manager", "Contract Admin", "Director"],
  "schedule.edit": ["Project Manager", "Director"],
  "authority.writeoff": ["Director"],
  "authority.terminate": ["Director"],
  "authority.terminate_site": ["Director"],
  "authority.override_budget": ["Director"],
  "presence.view": ["Supervisor", "Project Manager", "Director"],
  "presence.resolve_anomaly": ["Supervisor", "Project Manager", "Director"],
  "presence.export_payroll": ["Project Manager", "Director"],
  "integrations.view": ["Project Manager", "Contract Admin", "Director"],
  "integrations.configure": ["Contract Admin", "Director"],
  "tasks.create": ["Supervisor", "Project Manager", "Director", "Subcontractor"],
  "tasks.view": ["Supervisor", "Project Manager", "Director", "Subcontractor", "Worker"],
  "tasks.edit": ["Supervisor", "Project Manager", "Director", "Subcontractor"],
  "tasks.complete": ["Supervisor", "Project Manager", "Director", "Subcontractor", "Worker"],
  "diary.create": ["Supervisor", "Project Manager"],
  "safety.create": ["Supervisor", "Project Manager", "Director"],
  "checkin.manage": ["Supervisor", "Project Manager"],
  "passport.admin": ["Supervisor", "Project Manager", "Director"],
  "passport.scan": ["Supervisor", "Project Manager", "Director"],
  "passport.block": ["Supervisor", "Project Manager", "Director"],
  "documents.view": ["Supervisor", "Project Manager", "Contract Admin", "Director"],
  "documents.upload": ["Supervisor", "Project Manager", "Contract Admin", "Director"],
  "documents.delete": ["Contract Admin", "Director"],
  "audit.view": ["Contract Admin", "Director"],
};

export function allowedRoles(permission) {
  return PERMISSIONS[permission] || [];
}

export function can(role, permission) {
  return PERMISSIONS[permission]?.includes(role) ?? false;
}

export function canAny(role, permissions = []) {
  return permissions.some((permission) => can(role, permission));
}

export function canSeeAllSites(role) {
  return ["Director", "Contract Admin"].includes(role);
}

export function routeKindForRole(role) {
  if (role === "Director") return "director";
  if (role === "Client") return "client";
  if (role === "Worker") return "worker";
  if (role === "Subcontractor") return "subcontractor";
  return "internal";
}

export function mustHandUpForApproval(role) {
  return role === "Supervisor";
}

export function getNavForRole(role) {
  if (routeKindForRole(role) === "director") {
    return [
      {
        section: "BOARDROOM",
        items: [
          { key: "boardroom", page: "boardroom", label: "Boardroom", icon: "grid" },
          { key: "portfolio", page: "portfolio", label: "Portfolio", icon: "briefcase" },
          { key: "financial-summary", page: "financial-summary", label: "Financial Summary", icon: "dollar", permission: "budget.view" },
          { key: "commercial-risk", page: "commercial-risk", label: "Commercial Risk", icon: "alert" },
          { key: "safety-record", page: "safety-record", label: "Safety Record", icon: "shield" },
          { key: "integrations", page: "integrations", label: "Integrations", icon: "gear", permission: "integrations.view" },
          { key: "rpts", page: "rpts", label: "Reports", icon: "bar" },
        ].filter((item) => !item.permission || can(role, item.permission)),
      },
    ];
  }

  const sections = [
    {
      section: "OVERVIEW",
      items: [
        { key: "dash", page: "dash", label: "Command Centre", icon: "grid" },
        { key: "sched", page: "sched", label: "Schedule", icon: "cal", permission: "schedule.view" },
        { key: "budget", page: "budget", label: "Budget", icon: "dollar", permission: "budget.view" },
      ],
    },
    {
      section: "FIELD OPS",
      items: [
        { key: "tasks", page: "tasks", label: "Tasks", icon: "check", permission: "tasks.view", badge: "tasks" },
        { key: "probs", page: "probs", label: "Problems", icon: "alert", permission: "problems.view", badge: "problems" },
        { key: "wf", page: "wf", label: "Workforce", icon: "users", permission: "checkin.manage" },
        { key: "diary", page: "diary", label: "Site Diary", icon: "book", permission: "diary.create" },
      ],
    },
    {
      section: "COMMERCIAL",
      items: [
        { key: "clientflow", page: "clientflow", label: "ClientFlow", icon: "flag", permission: "clientflow.view", badge: "approvals" },
        { key: "vos", page: "vos", label: "Variations", icon: "shuffle", permission: "variations.view" },
        { key: "rfis", page: "rfis", label: "RFIs", icon: "help", permission: "rfis.view", badge: "rfis" },
        { key: "mats", page: "mats", label: "Procurement", icon: "box", permission: "procurement.view" },
        { key: "contracts", page: "contracts", label: "Contract Studio", icon: "book", permission: "contracts.view" },
      ],
    },
    {
      section: "QUALITY",
      items: [
        { key: "qa", page: "qa", label: "QA / Inspections", icon: "clipboard" },
        { key: "safety", page: "safety", label: "Safety", icon: "shield" },
        { key: "docs", page: "docs", label: "Document Control", icon: "file", permission: "documents.view" },
      ],
    },
    {
      section: "OPERATIONS",
      items: [
        { key: "passport", page: "passport", label: "Site Passport", icon: "qr", permission: "passport.admin" },
        { key: "presence", page: "presence", label: "Presence", icon: "eye", permission: "presence.view" },
        { key: "compliance", page: "compliance", label: "Compliance", icon: "shield", permission: "passport.admin" },
        { key: "integrations", page: "integrations", label: "Integrations", icon: "gear", permission: "integrations.view" },
      ],
    },
    {
      section: "TOOLS",
      items: [
        { key: "team", page: "team", label: "Team", icon: "users" },
        { key: "rpts", page: "rpts", label: "Reports", icon: "bar" },
        { key: "calc", page: "calc", label: "Calculators", icon: "calc" },
        { key: "audit", page: "audit", label: "Audit Trail", icon: "clipboard", permission: "audit.view" },
        { key: "admin", page: "admin", label: "Settings", icon: "gear" },
      ],
    },
  ];

  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.permission || can(role, item.permission)),
    }))
    .filter((section) => section.items.length);
}
