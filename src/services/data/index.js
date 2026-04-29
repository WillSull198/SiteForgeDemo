export { DEFAULT_ORG_ID, createLocalResource } from "./client.local";
export { supabaseClient } from "./client.supabase";
export { enqueueOperation, getSyncStatus, processSyncQueue, subscribeSyncStatus, uuid } from "./syncQueue";
export { Approvals } from "./resources/approvals";
export { Documents } from "./resources/documents";
export { Plans } from "./resources/plans";
export { Diary } from "./resources/diary";
export { Problems } from "./resources/problems";
export { RFIs } from "./resources/rfis";
export { Tasks } from "./resources/tasks";
export { QA } from "./resources/qa";
export { Safety } from "./resources/safety";
export { Workforce } from "./resources/workforce";
export { Contracts } from "./resources/contracts";
export { Templates } from "./resources/templates";
export { Photos } from "./resources/photos";
export { Notifications } from "./resources/notifications";
export { Audit } from "./resources/audit";
export { Settings } from "./resources/settings";
export { Users } from "./resources/users";
export { Clients } from "./resources/clients";
export { Sites } from "./resources/sites";
export { Projects } from "./resources/projects";
export { Suppliers } from "./resources/suppliers";
export { PurchaseOrders } from "./resources/purchaseOrders";

import { Approvals } from "./resources/approvals";
import { Documents } from "./resources/documents";
import { Plans } from "./resources/plans";
import { Photos } from "./resources/photos";
import { Settings } from "./resources/settings";
import { Audit } from "./resources/audit";

export async function bootstrapLocalDataLayer(state) {
  const orgId = state?.org?.id || "org-default";
  await Promise.all([
    Approvals.importMany(state?.approvals || [], { orgId }),
    Documents.importMany(state?.documents || [], { orgId }),
    Plans.importMany((state?.documents || []).filter((document) => /plan|drawing/i.test(`${document.category || ""} ${document.title || ""}`)), { orgId }),
    Photos.importMany((state?.files?.records || []).filter((file) => file.classification === "Photo / Site Image"), { orgId }),
    Settings.importMany([{ id: "settings", key: "settings", value: state?.settings || {}, orgId }], { orgId }),
  ]);
  const existingAudit = await Audit.list({ limit: 1 });
  if (!existingAudit.rows.length) {
    for (const entry of [...(state?.auditTrail || [])].reverse().slice(-100)) {
      await Audit.create({ ...entry, orgId });
    }
  }
}
