/* SiteForge production audit: centralised role permissions so PM/Contract Admin/
   Director capability checks are no longer scattered across pages. */

export const PERMISSIONS = {
  "clientflow.view": ["Supervisor", "Project Manager", "Contract Admin", "Director"],
  "clientflow.create": ["Project Manager", "Contract Admin", "Director"],
  "clientflow.send": ["Project Manager", "Contract Admin", "Director"],
  "clientflow.send_to_client": ["Project Manager", "Contract Admin", "Director"],
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

export function can(role, permission) {
  return PERMISSIONS[permission]?.includes(role) ?? false;
}

export function canAny(role, permissions = []) {
  return permissions.some((permission) => can(role, permission));
}

export function getNavForRole(role) {
  const sections = [
    {
      section: "OVERVIEW",
      items: [
        { key: "dash", label: "Command Centre" },
        { key: "sched", label: "Schedule", permission: "schedule.view" },
        { key: "budget", label: "Budget", permission: "budget.view" },
      ],
    },
    {
      section: "FIELD OPS",
      items: [
        { key: "tasks", label: "Tasks", permission: "tasks.view" },
        { key: "probs", label: "Problems", permission: "problems.view" },
        { key: "wf", label: "Workforce", permission: "checkin.manage" },
        { key: "diary", label: "Site Diary", permission: "diary.create" },
      ],
    },
    {
      section: "COMMERCIAL",
      items: [
        { key: "clientflow", label: "ClientFlow", permission: "clientflow.view" },
        { key: "vos", label: "Variations", permission: "variations.view" },
        { key: "rfis", label: "RFIs", permission: "rfis.view" },
        { key: "mats", label: "Procurement", permission: "procurement.view" },
        { key: "contracts", label: "Contract Studio", permission: "contracts.view" },
      ],
    },
    {
      section: "QUALITY",
      items: [
        { key: "qa", label: "QA / Inspections" },
        { key: "safety", label: "Safety" },
        { key: "docs", label: "Document Control", permission: "documents.view" },
      ],
    },
    {
      section: "OPERATIONS",
      items: [
        { key: "passport", label: "Site Passport", permission: "passport.admin" },
        { key: "presence", label: "Presence", permission: "presence.view" },
        { key: "integrations", label: "Integrations", permission: "integrations.view" },
      ],
    },
    {
      section: "TOOLS",
      items: [
        { key: "rpts", label: "Reports" },
        { key: "calc", label: "Calculators" },
        { key: "audit", label: "Audit Trail", permission: "audit.view" },
        { key: "admin", label: "Settings" },
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
