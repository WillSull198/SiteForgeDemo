/* SiteForge production audit: centralised role permissions so PM/Contract Admin/
   Director capability checks are no longer scattered across pages. */

export const PERMISSIONS = {
  "clientflow.view": ["Supervisor", "Project Manager", "Contract Admin", "Director"],
  "clientflow.create": ["Project Manager", "Contract Admin", "Director"],
  "clientflow.send": ["Project Manager", "Contract Admin", "Director"],
  "clientflow.approve": ["Project Manager", "Contract Admin", "Director"],
  "clientflow.generate_contract": ["Project Manager", "Contract Admin", "Director"],
  "problems.view": ["Supervisor", "Project Manager", "Contract Admin", "Director"],
  "problems.create": ["Supervisor", "Project Manager", "Director"],
  "problems.resolve": ["Supervisor", "Project Manager", "Director"],
  "problems.escalate": ["Project Manager", "Director"],
  "contracts.view": ["Project Manager", "Contract Admin", "Director"],
  "contracts.edit_draft": ["Contract Admin", "Director"],
  "contracts.sign_builder": ["Project Manager", "Contract Admin", "Director"],
  "contracts.archive": ["Contract Admin", "Director"],
  "budget.view": ["Project Manager", "Contract Admin", "Director"],
  "budget.edit": ["Director"],
  "budget.override": ["Director"],
  "authority.writeoff": ["Director"],
  "authority.terminate": ["Director"],
  "authority.override_budget": ["Director"],
  "presence.view": ["Supervisor", "Project Manager", "Director"],
  "presence.resolve_anomaly": ["Supervisor", "Project Manager", "Director"],
  "integrations.view": ["Contract Admin", "Director"],
  "tasks.create": ["Supervisor", "Project Manager", "Director", "Subcontractor"],
  "tasks.edit": ["Supervisor", "Project Manager", "Director", "Subcontractor"],
  "diary.create": ["Supervisor", "Project Manager"],
  "safety.create": ["Supervisor", "Project Manager", "Director"],
  "checkin.manage": ["Supervisor", "Project Manager"],
};

export function can(role, permission) {
  return PERMISSIONS[permission]?.includes(role) ?? false;
}

export function canAny(role, permissions = []) {
  return permissions.some((permission) => can(role, permission));
}
