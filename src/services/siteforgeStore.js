/* SiteForge audit: Repaired core workflow wiring for this pass. Project creation,
   company/settings persistence, diary-to-variation conversion, template selection,
   document annotations, and approval contract generation now create durable state,
   audit entries, notifications, and linked records instead of isolated UI changes. */

import React, { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { APP_CONFIG, createInitialData, migrateLegacyState } from "../data/seedData";
import { getReferenceClauseLibrary, getReferenceContractTemplates, getReferenceTemplateMarketplace } from "../data/referenceData";
import { usePersistentState } from "../hooks/usePersistentState";
import {
  boardInsights,
  draftApproval,
  draftApprovalSmart,
  generateEndOfDay,
  suggestRFI,
  structureFieldNote,
  summariseDiary,
  summariseRevision,
} from "./aiDraftService";
import { createAuditEntry, exportAuditCsv, verifyAuditChain } from "./auditTrail";
import { buildContractSummary, generateDraft, signContract } from "./contractService";
import { Audit, bootstrapLocalDataLayer } from "./data";
import { loadPersistedAppState } from "./dbService";
import { generateOperationsReportPdfBlob, generateSignedContractPdfBlob, generateTransmittalPdfBlob } from "./pdfService";
import { diffPlans, parseTemplate, removeFileEverywhere, uploadFile, uploadSeededTextFile, buildTemplatePreviewContent, getBlob, putBlob } from "./documentIntelligence";
import { dispatchNotificationEvent } from "./notificationEngine";
import { askSiteForgeAi, getStoredAiConfig } from "./aiService";
import { can, canSeeAllSites, routeKindForRole } from "./permissions";
import {
  buildBuildxactPullSnapshot,
  createAttachmentPayload,
  createBuildxactSyncHistory,
  createSignedApprovalPushPayload,
  upsertByBuildxactId,
} from "./integrations/buildxact/sync";
import { DEFAULT_TEAMS_CHANNEL_MAP, buildTeamsApprovalDispatch, createTeamsEvent, handleTeamsSlashCommand } from "./integrations/teams/dispatcher";
import {
  getActiveMode,
  getInitialStateStorageKey,
  getStateStorageKey,
  LEGACY_KEYS,
  readStateSlot,
  setActiveMode,
  writeStateSlot,
} from "./storageMode";

const SiteForgeContext = createContext(null);
const INCLUDE_DEMO_DATA = import.meta.env.VITE_INCLUDE_DEMO_DATA !== "false";
const DEMO_TIME_TRAVEL = import.meta.env.VITE_DEMO_TIME_TRAVEL !== "false";

const DEFAULT_ROLE_USERS = {
  Supervisor: "u_sup_1",
  "Project Manager": "u_pm_1",
  "Contract Admin": "u_ca_1",
  Director: "u_dir_1",
  Subcontractor: "u_sub_1",
  Client: "u_client_1",
  Worker: "u_worker_1",
};

const DEFAULT_ORG = {
  id: "org-default",
  name: APP_CONFIG.builder.name,
  slug: "default",
  plan: "demo",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const DEFAULT_CLIENTFLOW_CHANNELS = {
  inPortal: true,
  email: true,
  sms: false,
  teams: false,
  printPdf: true,
};

const DEFAULT_NOTIFICATION_PREFS = {
  inApp: true,
  email: false,
  teams: false,
  sms: false,
  mobile: false,
  quietHours: { enabled: false, from: "18:00", to: "07:00" },
  dailyDigest: false,
  eventChannels: {},
};

const DEFAULT_ROLE_PAGES = {
  Supervisor: { kind: "internal", siteId: "s1", page: "dash", entityId: null },
  "Project Manager": { kind: "internal", siteId: "s1", page: "dash", entityId: null },
  "Contract Admin": { kind: "internal", siteId: "s1", page: "contracts", entityId: null },
  Director: { kind: "director", page: "boardroom", siteId: null, entityId: null },
  Subcontractor: { kind: "subcontractor", userId: "u_sub_1", page: "jobs", entityId: null },
  Client: { kind: "client", clientId: "c1", page: "home", entityId: null },
  Worker: { kind: "worker", userId: "u_worker_1", page: "home", entityId: null },
};

const COLLECTION_MAP = {
  task: "tasks",
  tasks: "tasks",
  problem: "problems",
  issue: "problems",
  problems: "problems",
  procurement: "procurement",
  material: "procurement",
  diary: "diary",
  rfi: "rfis",
  rfis: "rfis",
  variation: "variations",
  variations: "variations",
  approval: "approvals",
  approvals: "approvals",
  qa: "qa",
  safety: "safety",
  document: "documents",
  documents: "documents",
  contract: "contractPacks",
  contractPack: "contractPacks",
  passport: "passports.records",
  presence: "presence.records",
  invoice: "invoices",
  template: "contractTemplates",
  clause: "clauseLibrary",
  boardReport: "boardReports",
  file: "files.records",
  message: "messages",
  site: "sites",
  client: "clients",
};

const MODE_ENTITY_PATHS = [
  "users",
  "companies",
  "clients",
  "sites",
  "schedules",
  "siteBudgets",
  "tasks",
  "problems",
  "rfis",
  "variations",
  "approvals",
  "contractTemplates",
  "clauseLibrary",
  "contractPacks",
  "procurement",
  "qa",
  "diary",
  "safety",
  "toolboxTalks",
  "swms",
  "passports.records",
  "passports.scanLog",
  "passports.siteAccess",
  "passports.expiringTickets",
  "passports.visitorPasses",
  "presence.anomalies",
  "presence.shifts",
  "presence.records",
  "presence.events",
  "presence.exports",
  "presence.siteCompliance",
  "documents",
  "messages",
  "invoices",
  "notifications.items",
  "notifications.eventLog",
  "emailQueue",
  "smsQueue",
  "teamsQueue",
  "buildxact.queue",
  "buildxact.pendingPushes",
  "buildxact.failedPushes",
  "buildxact.syncEvents",
  "buildxact.syncHistory",
  "buildxact.payloadPreviews",
  "auditTrail",
  "boardReports",
  "projectLogs",
  "files.records",
  "callbacks",
  "pmAvailability",
  "weatherForecasts",
  "calculatorHistory",
  "commandHistory",
  "variationRegister",
  "reportSchedules",
  "reportQueue",
  "recoveryOpportunities",
  "transmittals",
  "permits",
];

const INTERNAL_ROLES = new Set(["Supervisor", "Project Manager", "Contract Admin"]);
const COMMERCIAL_APPROVALS = new Set([
  "Variation",
  "Selection Upgrade",
  "Provisional Sum Conversion",
  "Price Escalation",
  "Scope Clarification",
]);
const DELAY_APPROVALS = new Set(["Rain Day", "Extension of Time", "Delay Notice"]);

const SORTABLE_DATE_KEYS = new Set(["date", "createdAt", "updatedAt", "dueDate", "sentAt", "timestamp", "at"]);

const cloneState = (value) => {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

const uuid = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (char) =>
      (Number(char) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(char) / 4)))).toString(16),
    );
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};
const randomId = (prefix) => `${prefix}-${uuid()}`;

function hashString(value = "") {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `h-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

const getRuntimeNow = () => {
  if (typeof window !== "undefined" && window.__siteforgeNow) {
    return new Date(window.__siteforgeNow);
  }
  return new Date();
};

const nowStamp = () => {
  const now = getRuntimeNow();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
};

const formatDate = (value) => value || nowStamp().slice(0, 10);

const addDays = (dateString, days = 0) => {
  if (!dateString) return dateString;
  const base = new Date(dateString.length > 10 ? dateString.replace(" ", "T") : `${dateString}T00:00:00`);
  if (Number.isNaN(base.getTime())) return dateString;
  base.setDate(base.getDate() + Number(days || 0));
  const yyyy = base.getFullYear();
  const mm = String(base.getMonth() + 1).padStart(2, "0");
  const dd = String(base.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const formatCurrency = (value = 0) =>
  new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);

const readCollection = (state, collectionPath) =>
  collectionPath.split(".").reduce((accumulator, key) => (accumulator ? accumulator[key] : null), state);

const findInCollection = (state, type, id) => {
  const collectionPath = COLLECTION_MAP[type] || type;
  const collection = readCollection(state, collectionPath);
  if (!Array.isArray(collection)) {
    return null;
  }
  return collection.find((item) => item.id === id || item.docId === id || item.number === id || item.siteId === id || item.clientId === id) || null;
};

const upsertLinkedRecord = (entity, record) => {
  entity.linkedRecords = entity.linkedRecords || [];
  const exists = entity.linkedRecords.some((item) => item.type === record.type && item.id === record.id);
  if (!exists) {
    entity.linkedRecords.push(record);
  }
};

const removeLinkedRecord = (entity, type, id) => {
  entity.linkedRecords = (entity.linkedRecords || []).filter((record) => !(record.type === type && record.id === id));
};

const buildLink = (type, record, siteId) => ({
  type,
  id: record.id || record.docId,
  label: record.title || record.name || record.number || record.item || record.person || record.topic || record.docId,
  siteId,
});

function buildPortalUrl(token) {
  if (!token || typeof window === "undefined") return "";
  const pathname = window.location.pathname.replace(/index\.html$/, "");
  const base =
    window.location.protocol === "file:"
      ? `${window.location.protocol}//${pathname}`
      : `${window.location.origin}${pathname}`;
  return `${base}${base.endsWith("/") ? "" : "/"}#/approve/${token}`;
}

function linkRecords(left, right, leftType, rightType, siteId = left?.siteId || right?.siteId) {
  if (!left || !right) return;
  upsertLinkedRecord(left, buildLink(rightType, right, siteId));
  upsertLinkedRecord(right, buildLink(leftType, left, siteId));
}

function requireRole(role, permission, fallback = false) {
  return can(role, permission) ? true : fallback;
}

const defaultSession = () => ({
  role: "Supervisor",
  userId: DEFAULT_ROLE_USERS.Supervisor,
  siteId: "s1",
  period: "This Week",
  route: DEFAULT_ROLE_PAGES.Supervisor,
  recentSearches: ["waterproofing", "lintels", "Tower B"],
});

const defaultUi = () => ({
  notificationsOpen: false,
  searchOpen: false,
  shortcutsOpen: false,
  commandPaletteOpen: false,
  aiAssistantOpen: false,
  bootRoleSelectorOpen: true,
  contractPreviewId: null,
  activeApprovalId: "ap-003",
  activeContractId: "cp-004",
});

const blankSession = () => ({
  role: null,
  userId: null,
  siteId: null,
  period: "This Week",
  route: { kind: "internal", siteId: null, page: "dash", entityId: null },
  recentSearches: [],
});

function createBlankSlate() {
  const orgId = uuid();
  return {
    version: APP_CONFIG.storageVersion,
    company: { name: "", abn: "", address: "", phone: "", email: "" },
    settings: {
      company: { name: "", abn: "", address: "", phone: "", email: "", website: "", logoDataUrl: "" },
      user: { name: "", email: "", phone: "", defaultRole: "Director" },
      notifications: DEFAULT_NOTIFICATION_PREFS,
      integrations: {
        aiProvider: "anthropic",
        aiModel: "claude-sonnet-4-20250514",
        anthropicModel: "claude-sonnet-4-20250514",
        openaiModel: "gpt-4.1",
        anthropicApiKey: "",
        anthropicConfigured: false,
        openaiConfigured: false,
        openaiProxyConfigured: false,
        aiLastTestedAt: null,
        aiLastTestStatus: "untested",
        aiLastTestProvider: null,
        aiLastTestMessage: "",
        buildxactApiKey: "",
        buildxactWorkspaceId: "",
        buildxactConnected: false,
        buildxactSyncMode: "disconnected",
        buildxactLastError: null,
        emailProvider: "queued-only",
        smsProvider: "queued-only",
        teamsConnected: false,
      },
      contractDefaults: {
        defaultContractType: "HIA",
        standardVariationTemplate: "tpl-hia-var",
      },
      theme: "light",
      appearance: { theme: "light" },
      developer: { demoDataBanner: false, allowClearData: true },
    },
    onboarding: {
      complete: false,
      mode: null,
      step: "welcome",
      completedAt: null,
      completedTours: [],
    },
    org: {
      id: orgId,
      name: "",
      slug: "",
      plan: "starter",
      mode: "blank",
      createdAt: nowStamp(),
    },
    users: [],
    companies: [],
    clients: [],
    sites: [],
    schedules: [],
    siteBudgets: [],
    tasks: [],
    problems: [],
    rfis: [],
    variations: [],
    approvals: [],
    contractTemplates: getReferenceContractTemplates(),
    clauseLibrary: getReferenceClauseLibrary(),
    contractPacks: [],
    procurement: [],
    qa: [],
    diary: [],
    safety: [],
    toolboxTalks: [],
    swms: [],
    passports: { records: [], scanLog: [], siteAccess: [], expiringTickets: [], visitorPasses: [] },
    presence: { anomalies: [], shifts: [], complianceState: {}, records: [], events: [], exports: [], siteCompliance: [] },
    documents: [],
    messages: [],
    invoices: [],
    notifications: { items: [], eventLog: [] },
    emailQueue: [],
    smsQueue: [],
    teamsQueue: [],
    buildxact: {
      queue: [],
      pendingPushes: [],
      failedPushes: [],
      syncEvents: [],
      syncHistory: [],
      payloadPreviews: [],
      suppliers: [],
      costCodes: [],
      scheduleMilestones: [],
      readOnlyMode: false,
      connection: { status: "disconnected", workspaceId: "", apiKeyMasked: "" },
    },
    teams: { connected: false, outbound: [], commandLog: [], channelMap: DEFAULT_TEAMS_CHANNEL_MAP, oauthStatus: "disconnected", botName: "SiteForge Bot", tenantName: "" },
    auditTrail: [],
    boardReports: [],
    financialPulse: null,
    projectLogs: [],
    files: { records: [], pendingUploads: [], uploadErrors: [], preview: null, indexedDbAvailable: true },
    tableViews: { state: {}, saved: {} },
    demo: {
      mode: false,
      queuedEvents: [],
      recentToasts: [],
      userControlled: false,
    },
    callbacks: [],
    pmAvailability: [],
    weatherForecasts: [],
    calculatorHistory: [],
    commandHistory: [],
    clientSentiment: {},
    templateMarketplace: getReferenceTemplateMarketplace(),
    variationRegister: [],
    boardInsightsCache: null,
    aiCache: { weeklyClientSummary: {}, boardInsights: {} },
    reportSchedules: [],
    reportQueue: [],
    recoveryOpportunities: [],
    transmittals: [],
    permits: [],
    help: { supportQueue: [] },
    billing: { plan: "Starter", usage: { storageMb: 0, aiTokens: 0, activeProjects: 0 } },
    session: blankSession(),
    ui: { ...defaultUi(), activeApprovalId: null, activeContractId: null, bootRoleSelectorOpen: false },
  };
}

function pathValue(root, path) {
  return path.split(".").reduce((cursor, part) => cursor?.[part], root);
}

function setPathValue(root, path, value) {
  const parts = path.split(".");
  let cursor = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

function tagAllRecordsAsDemo(state) {
  MODE_ENTITY_PATHS.forEach((path) => {
    const records = pathValue(state, path);
    if (!Array.isArray(records)) return;
    setPathValue(
      state,
      path,
      records.map((record) => (record && typeof record === "object" ? { ...record, isDemo: true } : record)),
    );
  });
  return state;
}

function createRealOnboardingStore() {
  const slate = createBlankSlate();
  return normaliseState({
    ...slate,
    onboarding: { ...slate.onboarding, mode: "real", step: "company" },
    org: { ...slate.org, mode: "real" },
  });
}

function hydrateModeState(rawState, mode) {
  if (mode === "demo") {
    return normaliseState(migrateLegacyState({
      ...rawState,
      session: { ...defaultSession(), ...(rawState.session || {}) },
      ui: { ...defaultUi(), ...(rawState.ui || {}) },
    }));
  }
  const base = createBlankSlate();
  return normaliseState({
    ...base,
    ...rawState,
    settings: {
      ...base.settings,
      ...(rawState.settings || {}),
      company: { ...base.settings.company, ...(rawState.settings?.company || rawState.company || {}) },
      user: { ...base.settings.user, ...(rawState.settings?.user || {}) },
      notifications: { ...base.settings.notifications, ...(rawState.settings?.notifications || {}) },
      integrations: { ...base.settings.integrations, ...(rawState.settings?.integrations || {}) },
      contractDefaults: { ...base.settings.contractDefaults, ...(rawState.settings?.contractDefaults || {}) },
    },
    org: {
      ...base.org,
      ...(rawState.org || {}),
      mode: "real",
      id: rawState.org?.id && rawState.org.id !== DEFAULT_ORG.id ? rawState.org.id : base.org.id,
    },
    session: { ...blankSession(), ...(rawState.session || {}) },
    ui: { ...base.ui, ...(rawState.ui || {}) },
  });
}

function createDemoStore() {
  return normaliseState(tagAllRecordsAsDemo({
    version: APP_CONFIG.storageVersion,
    ...createInitialData(),
    onboarding: {
      complete: true,
      mode: "demo",
      step: "done",
      completedAt: nowStamp(),
      completedTours: [],
    },
    org: {
      ...DEFAULT_ORG,
      id: DEFAULT_ORG.id,
      mode: "demo",
      plan: "demo",
      createdAt: DEFAULT_ORG.createdAt,
    },
    session: defaultSession(),
    ui: defaultUi(),
  }));
}

const createInitialStore = () => {
  if (typeof window === "undefined") {
    return createBlankSlate();
  }

  const activeMode = getActiveMode();

  for (const legacyKey of LEGACY_KEYS) {
    try {
      const raw = window.localStorage.getItem(legacyKey);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const detectedMode = parsed.org?.mode === "demo" ? "demo" : "real";
      const migrated = hydrateModeState(parsed, detectedMode);
      if (detectedMode === "demo") {
        tagAllRecordsAsDemo(migrated);
        migrated.org = { ...(migrated.org || DEFAULT_ORG), mode: "demo", id: DEFAULT_ORG.id };
      } else {
        migrated.org = {
          ...(migrated.org || {}),
          mode: "real",
          id: migrated.org?.id && migrated.org.id !== DEFAULT_ORG.id ? migrated.org.id : uuid(),
        };
      }
      setActiveMode(detectedMode);
      writeStateSlot(detectedMode, migrated);
      return migrated;
    } catch (error) {
      console.warn("Failed to migrate legacy SiteForge state", error);
    }
  }

  if (activeMode === "demo" || activeMode === "real") {
    const stored = readStateSlot(activeMode);
    if (stored) {
      return hydrateModeState(stored, activeMode);
    }
    return activeMode === "demo" ? createDemoStore() : createRealOnboardingStore();
  }

  return normaliseState(createBlankSlate());
};

function parseHash(hash = "") {
  const cleaned = hash.replace(/^#\/?/, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (!parts.length && typeof window !== "undefined") {
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    if (pathParts[0] === "approve" && pathParts[1]) {
      return { kind: "client-token", approvalToken: pathParts[1], page: "approvals", entityId: null };
    }
  }

  if (!parts.length) {
    return null;
  }

  if (parts[0] === "approve") {
    return { kind: "client-token", approvalToken: parts[1], page: "approvals", entityId: null };
  }
  if (parts[0] === "client") {
    return { kind: "client", clientId: parts[1] || "c1", page: parts[2] || "home", entityId: parts[3] || null };
  }
  if (parts[0] === "worker") {
    return { kind: "worker", userId: parts[1] || "u_worker_1", page: parts[2] || "home", entityId: parts[3] || null };
  }
  if (parts[0] === "subcontractor") {
    return { kind: "subcontractor", userId: parts[1] || "u_sub_1", page: parts[2] || "jobs", entityId: parts[3] || null };
  }
  if (parts[0] === "director") {
    return { kind: "director", page: parts[1] || "boardroom", siteId: parts[2] || null, entityId: parts[3] || null };
  }
  if (parts[0] === "site") {
    return { kind: "internal", siteId: parts[1] || "s1", page: parts[2] || "dash", entityId: parts[3] || null };
  }
  if (parts[0] === "portfolio") {
    return { kind: "internal", siteId: "s1", page: "portfolio", entityId: null };
  }

  return null;
}

function buildHash(route) {
  if (!route) return "#/site/s1/dash";

  if (route.kind === "client") {
    return `#/client/${route.clientId || "c1"}/${route.page || "home"}${route.entityId ? `/${route.entityId}` : ""}`;
  }
  if (route.kind === "worker") {
    return `#/worker/${route.userId || "u_worker_1"}/${route.page || "home"}${route.entityId ? `/${route.entityId}` : ""}`;
  }
  if (route.kind === "subcontractor") {
    return `#/subcontractor/${route.userId || "u_sub_1"}/${route.page || "jobs"}${route.entityId ? `/${route.entityId}` : ""}`;
  }
  if (route.kind === "director") {
    return `#/director/${route.page || "boardroom"}${route.siteId ? `/${route.siteId}` : ""}${route.entityId ? `/${route.entityId}` : ""}`;
  }
  return `#/site/${route.siteId || "s1"}/${route.page || "dash"}${route.entityId ? `/${route.entityId}` : ""}`;
}

function getDefaultRouteForRole(role, state) {
  const base = cloneState(DEFAULT_ROLE_PAGES[role] || DEFAULT_ROLE_PAGES.Supervisor);
  if (routeKindForRole(role) === "client") {
    const clientUser = state?.users?.find((user) => routeKindForRole(user.role) === "client" && user.id === DEFAULT_ROLE_USERS.Client);
    base.clientId = clientUser?.clientId || "c1";
  }
  if (base.kind === "internal") {
    const activeProjectId = state?.settings?.activeProjectId;
    if (activeProjectId && state?.sites?.some((site) => site.id === activeProjectId)) {
      base.siteId = activeProjectId;
    }
  }
  return base;
}

function getCurrentUser(state) {
  return state.users.find((user) => user.id === state.session.userId) || state.users[0];
}

function getUserForRole(state, role) {
  return state.users.find((user) => user.role === role) || state.users.find((user) => user.id === state.session.userId) || state.users[0] || null;
}

function getCurrentClient(state) {
  const routeClientId = state.session.route?.clientId;
  return state.clients.find((client) => client.id === routeClientId || client.id === getCurrentUser(state)?.clientId) || state.clients[0];
}

function getCurrentSite(state) {
  const routeSiteId = state.session.route?.siteId || state.session.siteId;
  return state.sites.find((site) => site.id === routeSiteId) || state.sites[0];
}

function getAccessibleSiteIds(state, role, userId) {
  if (canSeeAllSites(role)) {
    return state.sites.map((site) => site.id);
  }
  if (routeKindForRole(role) === "client") {
    const user = state.users.find((item) => item.id === userId);
    return user?.siteIds || [];
  }
  const user = state.users.find((item) => item.id === userId);
  return user?.siteIds?.length ? user.siteIds : state.sites.map((site) => site.id);
}

function withOrgId(record, orgId) {
  return record && typeof record === "object" ? { ...record, orgId: record.orgId || orgId } : record;
}

function scopeOrgRecords(next) {
  let orgId = next.org?.id || DEFAULT_ORG.id;
  if (next.org?.mode === "real" && (!orgId || orgId === DEFAULT_ORG.id)) {
    orgId = uuid();
    next.org.id = orgId;
  }
  [
    "sites",
    "clients",
    "users",
    "approvals",
    "documents",
    "diary",
    "problems",
    "rfis",
    "tasks",
    "qa",
    "safety",
    "procurement",
    "variations",
    "variationRegister",
    "contractPacks",
    "contractTemplates",
    "notifications.items",
    "auditTrail",
  ].forEach((path) => {
    const parts = path.split(".");
    const target = parts.length === 1 ? next : next[parts[0]];
    const key = parts[parts.length - 1];
    if (Array.isArray(target?.[key])) {
      target[key] = target[key].map((record) => withOrgId(record, orgId));
    }
  });
  if (Array.isArray(next.files?.records)) {
    next.files.records = next.files.records.map((record) => withOrgId(record, orgId));
  }
}

function lintModeIntegrity(state) {
  const mode = state.org?.mode;
  const issues = [];

  if (mode === "demo") {
    tagAllRecordsAsDemo(state);
  }

  if (mode === "real") {
    if (state.org?.id === DEFAULT_ORG.id) {
      state.org.id = uuid();
      issues.push("Real org had reserved org-default id; reassigned a fresh UUID.");
    }
    MODE_ENTITY_PATHS.forEach((path) => {
      const records = pathValue(state, path);
      if (!Array.isArray(records)) return;
      const leaked = records.filter((record) => record?.isDemo === true);
      if (!leaked.length) return;
      state.quarantine = state.quarantine || {};
      state.quarantine[path] = [...(state.quarantine[path] || []), ...leaked].slice(-200);
      setPathValue(state, path, records.filter((record) => record?.isDemo !== true));
      issues.push(`Real mode contains ${leaked.length} demo-tagged records in ${path}. Quarantining.`);
    });
  }

  if (issues.length) {
    console.warn("[SiteForge] Mode integrity lint:", issues);
    state._modeIntegrityWarnings = [
      ...(state._modeIntegrityWarnings || []),
      { at: nowStamp(), issues },
    ].slice(-20);
  }
  return state;
}

function stripInlineBlobPayload(record) {
  if (!record || typeof record !== "object") return record;
  ["data", "dataUrl", "base64", "blobData"].forEach((field) => {
    if (typeof record[field] === "string" && record[field].startsWith("data:")) {
      delete record[field];
    }
  });
  if (typeof record.thumbnailDataUrl === "string" && record.thumbnailDataUrl.startsWith("data:")) {
    delete record.thumbnailDataUrl;
  }
  return record;
}

function stripInlinePhotoPayloads(state) {
  const collections = ["approvals", "diary", "documents", "problems", "qa", "safety", "tasks", "variations"];
  collections.forEach((collection) => {
    const records = state[collection];
    if (!Array.isArray(records)) return;
    records.forEach((record) => {
      if (Array.isArray(record?.photos)) {
        record.photos = record.photos.map((photo) => (photo && typeof photo === "object" ? stripInlineBlobPayload({ ...photo }) : photo));
      }
      if (Array.isArray(record?.attachments)) {
        record.attachments = record.attachments.map((attachment) => (attachment && typeof attachment === "object" ? stripInlineBlobPayload({ ...attachment }) : attachment));
      }
      if (Array.isArray(record?.voiceNotes)) {
        record.voiceNotes = record.voiceNotes.map((note) => (note && typeof note === "object" ? stripInlineBlobPayload({ ...note }) : note));
      }
    });
  });
  if (Array.isArray(state.files?.records)) {
    state.files.records.forEach(stripInlineBlobPayload);
  }
  return state;
}

function normaliseState(state) {
  const next = state;
  const role = next.session.role || "Supervisor";
  const userId = next.session.userId || DEFAULT_ROLE_USERS[role] || DEFAULT_ROLE_USERS.Supervisor;
  const accessibleSiteIds = getAccessibleSiteIds(next, role, userId);
  const fallbackSiteId = accessibleSiteIds[0] || next.sites[0]?.id || "s1";
  const route = next.session.route || getDefaultRouteForRole(role, next);

  next.org = {
    ...DEFAULT_ORG,
    ...(next.org || {}),
    settings: {
      ...(next.org?.settings || {}),
      company: next.settings?.company || next.company || APP_CONFIG.builder,
      contractDefaults: next.settings?.contractDefaults || {},
    },
  };
  next.device = {
    ...(next.device || {}),
    settings: {
      ...(next.device?.settings || {}),
      appearance: next.settings?.appearance || { theme: next.settings?.theme || "light" },
      integrations: next.settings?.integrations || {},
    },
  };
  next.user = {
    ...(next.user || {}),
    settings: {
      ...(next.user?.settings || {}),
      profile: next.settings?.profile || {},
      notifications: next.settings?.notifications || {},
    },
  };
  scopeOrgRecords(next);
  lintModeIntegrity(next);
  stripInlinePhotoPayloads(next);

  next.demo = {
    ...(next.demo || {}),
    userControlled: Boolean(next.demo?.userControlled),
    recentToasts: Array.isArray(next.demo?.recentToasts) ? next.demo.recentToasts.slice(0, 8) : [],
    queuedEvents: Array.isArray(next.demo?.queuedEvents) ? next.demo.queuedEvents : [],
  };
  if (!next.demo.userControlled) {
    next.demo.mode = false;
  }
  next.settings = {
    ...(next.settings || {}),
    clientflow: {
      channelsByType: {},
      stallThresholdBusinessDays: 5,
      escalationRecipients: ["Project Manager", "Director"],
      ...(next.settings?.clientflow || {}),
    },
  };

  next.notifications = next.notifications || { items: [], eventLog: [] };
  next.notifications.items = Array.isArray(next.notifications.items) ? next.notifications.items.slice(0, 180) : [];
  next.notifications.eventLog = Array.isArray(next.notifications.eventLog) ? next.notifications.eventLog.slice(0, 240) : [];
  next.emailQueue = Array.isArray(next.emailQueue) ? next.emailQueue.slice(0, 160) : [];
  next.smsQueue = Array.isArray(next.smsQueue) ? next.smsQueue.slice(0, 160) : [];
  next.teamsQueue = Array.isArray(next.teamsQueue) ? next.teamsQueue.slice(0, 160) : [];
  next.auditTrail = Array.isArray(next.auditTrail) ? next.auditTrail.slice(0, 600) : [];
  next.projectLogs = Array.isArray(next.projectLogs) ? next.projectLogs.slice(0, 240) : [];
  next.aiCache = {
    weeklyClientSummary: { ...(next.aiCache?.weeklyClientSummary || {}) },
    boardInsights: { ...(next.aiCache?.boardInsights || {}) },
  };
  next.transmittals = Array.isArray(next.transmittals) ? next.transmittals.slice(0, 160) : [];
  next.permits = Array.isArray(next.permits) ? next.permits.slice(0, 160) : [];
  next.recoveryOpportunities = Array.isArray(next.recoveryOpportunities) ? next.recoveryOpportunities.slice(0, 180) : [];
  next.recoveryTemplates = {
    "diary-rain-day": "Rain Day",
    "diary-variation": "Variation",
    "problem-variation": "Variation",
    "problem-delay": "Delay Notice",
    "rfi-variation": "Variation",
    "rfi-eot": "Extension of Time",
    "procurement-eot": "Extension of Time",
    "safety-delay": "Delay Notice",
    "drawing-revision": "Variation",
    "weather-rain-day": "Rain Day",
    ...(next.recoveryTemplates || {}),
  };
  next.reportSchedules = Array.isArray(next.reportSchedules)
    ? next.reportSchedules.slice(0, 40)
    : [
        { id: "sched-weekly-ops", reportType: "weekly-site-operations", frequency: "weekly", day: "Friday", time: "18:00", recipients: ["PM"], enabled: true, lastQueuedAt: null },
        { id: "sched-daily-ops", reportType: "daily-site-report", frequency: "daily", day: "Every day", time: "18:00", recipients: ["Supervisor", "PM"], enabled: true, lastQueuedAt: null },
        { id: "sched-clientflow", reportType: "weekly-clientflow", frequency: "weekly", day: "Friday", time: "18:00", recipients: ["PM", "Director"], enabled: true, lastQueuedAt: null },
        { id: "sched-compliance", reportType: "monthly-compliance", frequency: "monthly", day: "1", time: "07:00", recipients: ["Director"], enabled: true, lastQueuedAt: null },
      ];
  next.reportQueue = Array.isArray(next.reportQueue) ? next.reportQueue.slice(0, 80) : [];
  next.onboarding = {
    mode: "demo",
    complete: Boolean(next.onboarding?.complete ?? true),
    completedTours: Array.isArray(next.onboarding?.completedTours) ? next.onboarding.completedTours : [],
    ...(next.onboarding || {}),
  };
  if (!next.org.mode) {
    next.org.mode = next.onboarding.mode === "real" ? "real" : next.settings?.developer?.demoDataBanner ? "demo" : "real";
  }
  next.billing = {
    plan: "Pro",
    usage: {
      storageMb: Math.round(((next.files?.records?.length || 0) + (next.documents?.length || 0)) * 0.8),
      aiTokens: next.billing?.usage?.aiTokens || 0,
      activeProjects: next.sites.filter((site) => site.status === "active").length,
    },
    ...(next.billing || {}),
  };
  next.help = {
    supportQueue: Array.isArray(next.help?.supportQueue) ? next.help.supportQueue.slice(0, 40) : [],
    ...(next.help || {}),
  };
  next.documents = Array.isArray(next.documents)
    ? next.documents.map((document) => ({
        retentionCategory: document.retentionCategory || (document.category === "Contract Pack" ? "signed-contract" : "project-document"),
        retentionUntil: document.retentionUntil || addDays(document.date || formatDate(), 2557),
        expiryDate: document.expiryDate || null,
        acknowledgements: Array.isArray(document.acknowledgements) ? document.acknowledgements : [],
        ...document,
      }))
    : [];
  next.approvalBundles = Array.isArray(next.approvalBundles) ? next.approvalBundles.slice(0, 120) : [];
  next.approvals = Array.isArray(next.approvals)
    ? next.approvals.map((approval) => ({
        ...approval,
        deliveryChannels: approval.deliveryChannels || DEFAULT_CLIENTFLOW_CHANNELS,
        deliveryQueue: Array.isArray(approval.deliveryQueue) ? approval.deliveryQueue.slice(-40) : [],
        complianceTrail: Array.isArray(approval.complianceTrail) ? approval.complianceTrail.slice(-160) : [],
        portalAccessLog: Array.isArray(approval.portalAccessLog) ? approval.portalAccessLog.slice(-40) : [],
      }))
    : [];
  next.buildxact = {
    ...(next.buildxact || {}),
    readOnlyMode: Boolean(next.buildxact?.readOnlyMode),
    lastSyncAt: next.buildxact?.lastSyncAt || next.buildxact?.connection?.lastTestedAt || null,
    suppliers: Array.isArray(next.buildxact?.suppliers) ? next.buildxact.suppliers : [],
    costCodes: Array.isArray(next.buildxact?.costCodes) ? next.buildxact.costCodes : [],
    scheduleMilestones: Array.isArray(next.buildxact?.scheduleMilestones) ? next.buildxact.scheduleMilestones : [],
    manualReview: Array.isArray(next.buildxact?.manualReview) ? next.buildxact.manualReview.slice(0, 80) : [],
    webhookEndpoint:
      next.buildxact?.webhookEndpoint ||
      `${typeof window !== "undefined" ? window.location.origin : "https://yourapp.example.com"}/api/buildxact/webhook/siteforge`,
    entitySync: {
      projects: true,
      clients: true,
      suppliers: true,
      costCodes: true,
      schedule: true,
      variations: true,
      documents: true,
      timeline: true,
      ...(next.buildxact?.entitySync || next.buildxact?.toggles || {}),
    },
    toggles: {
      projects: true,
      clients: true,
      suppliers: true,
      costCodes: true,
      schedule: true,
      variations: true,
      documents: true,
      timeline: true,
      ...(next.buildxact?.toggles || next.buildxact?.entitySync || {}),
    },
    syncFrequency: {
      projects: "15 min",
      clients: "15 min",
      suppliers: "Daily",
      costCodes: "Daily",
      schedule: "15 min",
      variations: "Immediate",
      documents: "Immediate",
      timeline: "Immediate",
      ...(next.buildxact?.syncFrequency || {}),
    },
    queue: Array.isArray(next.buildxact?.queue) ? next.buildxact.queue.slice(0, 120) : [],
    pendingPushes: Array.isArray(next.buildxact?.pendingPushes)
      ? next.buildxact.pendingPushes.slice(0, 120)
      : Array.isArray(next.buildxact?.queue)
        ? next.buildxact.queue.filter((item) => ["pending", "queued", "read-only"].includes(item.status)).slice(0, 120)
        : [],
    failedPushes: Array.isArray(next.buildxact?.failedPushes)
      ? next.buildxact.failedPushes.slice(0, 80)
      : Array.isArray(next.buildxact?.queue)
        ? next.buildxact.queue.filter((item) => item.status === "error" || item.status === "failed").slice(0, 80)
        : [],
    syncHistory: Array.isArray(next.buildxact?.syncHistory) ? next.buildxact.syncHistory.slice(0, 180) : [],
    payloadPreviews: Array.isArray(next.buildxact?.payloadPreviews) ? next.buildxact.payloadPreviews.slice(0, 120) : [],
    connection: {
      status: "disconnected",
      workspaceId: "bx-demo-qld",
      apiKeyMasked: "",
      ...(next.buildxact?.connection || {}),
    },
  };
  next.teams = {
    connected: false,
    botName: "SiteForge Bot",
    tenantName: "Demo Microsoft 365 Tenant",
    oauthStatus: "mocked",
    ...(next.teams || {}),
    channelMap: {
      ...DEFAULT_TEAMS_CHANNEL_MAP,
      ...(next.teams?.channelMap || {}),
    },
    outbound: Array.isArray(next.teams?.outbound) ? next.teams.outbound.slice(0, 120) : [],
    commandLog: Array.isArray(next.teams?.commandLog) ? next.teams.commandLog.slice(0, 80) : [],
  };
  next.presence = {
    ...(next.presence || {}),
    privacy: {
      mode: "disclosed-consent",
      note: "Presence verification is disclosed to workers and subcontractors for payroll confidence, attendance validation, and anomaly detection only.",
      retentionDays: 2557,
      workerAccess: true,
      challengeWindowDays: 30,
      ...(next.presence?.privacy || {}),
    },
    records: Array.isArray(next.presence?.records)
      ? next.presence.records.slice(0, 240).map((record) => ({
          payrollState: record.payrollState || "review",
          anomalyFlags: Array.isArray(record.anomalyFlags) ? record.anomalyFlags : [],
          signals: Array.isArray(record.signals) ? record.signals : [],
          challenges: Array.isArray(record.challenges) ? record.challenges : [],
          manualOverrides: Array.isArray(record.manualOverrides) ? record.manualOverrides : [],
          ...record,
        }))
      : [],
    events: Array.isArray(next.presence?.events) ? next.presence.events.slice(0, 360) : [],
    exports: Array.isArray(next.presence?.exports) ? next.presence.exports.slice(0, 160) : [],
    siteCompliance: Array.isArray(next.presence?.siteCompliance) ? next.presence.siteCompliance.slice(0, 80) : [],
    challenges: Array.isArray(next.presence?.challenges) ? next.presence.challenges.slice(0, 160) : [],
    optOutRequests: Array.isArray(next.presence?.optOutRequests) ? next.presence.optOutRequests.slice(0, 120) : [],
    dataExports: Array.isArray(next.presence?.dataExports) ? next.presence.dataExports.slice(0, 120) : [],
    reviewQueue: Array.isArray(next.presence?.reviewQueue) ? next.presence.reviewQueue.slice(0, 160) : [],
  };
  next.sites.forEach((site) => {
    if (!next.presence.siteCompliance.some((entry) => entry.siteId === site.id)) {
      next.presence.siteCompliance.push({
        id: randomId("presence-compliance"),
        siteId: site.id,
        status: "not-issued",
        enabled: false,
        noticeIssuedAt: null,
        activationDate: null,
        noticeDocumentName: "",
        confirmedNoticeIssued: false,
        lastReviewedAt: null,
      });
    }
  });
  next.messages = Array.isArray(next.messages)
    ? next.messages.slice(0, 120).map((thread) => ({
        ...thread,
        messages: Array.isArray(thread.messages) ? thread.messages.slice(-80) : [],
      }))
    : [];

  next.session.userId = userId;
  next.session.siteId = accessibleSiteIds.includes(next.session.siteId) ? next.session.siteId : fallbackSiteId;

  if (route.kind === "internal" && !accessibleSiteIds.includes(route.siteId)) {
    route.siteId = fallbackSiteId;
  }
  const expectedRouteKind = routeKindForRole(role);
  if (["director", "client", "worker", "subcontractor"].includes(expectedRouteKind) && route.kind !== expectedRouteKind) {
    next.session.route = getDefaultRouteForRole(role, next);
  } else if (INTERNAL_ROLES.has(role) && route.kind !== "internal") {
    next.session.route = getDefaultRouteForRole(role, next);
  }

  return next;
}

function buildMetrics(state) {
  const siteMetrics = state.sites.map((site) => {
    const approvals = state.approvals.filter((approval) => approval.siteId === site.id);
    const problems = state.problems.filter((problem) => problem.siteId === site.id && ["open", "under-review"].includes(problem.status));
    const procurement = state.procurement.filter((item) => item.siteId === site.id);
    const qaFailures = state.qa.filter((item) => item.siteId === site.id && item.status === "failed");
    const presence = state.presence.records.filter((item) => item.siteId === site.id);
    const stalledApprovals = approvals.filter((approval) =>
      ["awaiting-client", "question", "changes-requested", "contract-awaiting-builder", "contract-awaiting-client"].includes(approval.status),
    );
    const costExposure =
      stalledApprovals.reduce((sum, approval) => sum + (approval.costImpact || 0), 0) +
      problems.reduce((sum, problem) => sum + (problem.costImpact || 0), 0);
    const timeExposure =
      stalledApprovals.reduce((sum, approval) => sum + (approval.timeImpact || 0), 0) +
      problems.reduce((sum, problem) => sum + (problem.timeImpact || 0), 0);
    const presenceConfidence = presence.length
      ? Math.round(presence.reduce((sum, entry) => sum + (entry.confidence || 0), 0) / presence.length)
      : 100;
    const approvalCount = approvals.length;
    const openProcurementRisk = procurement.filter((item) => ["pending", "requested", "ordered", "delayed", "escalated"].includes(item.status)).length;
    const riskScore = Math.min(
      100,
      Math.round(
        costExposure / 1200 +
          timeExposure * 8 +
          stalledApprovals.length * 6 +
          qaFailures.length * 9 +
          Math.max(0, 80 - presenceConfidence) / 2,
      ),
    );
    return {
      siteId: site.id,
      siteName: site.name,
      costExposure,
      timeExposure,
      stalledApprovals: stalledApprovals.length,
      openProblems: problems.length,
      approvalCount,
      openProcurementRisk,
      qaFailures: qaFailures.length,
      presenceConfidence,
      riskScore,
      riskBand: riskScore >= 65 ? "red" : riskScore >= 35 ? "amber" : "green",
      marginPosition: (Number(site.forecastMargin) || 0) - costExposure / 10000,
    };
  });

  const activeSites = state.sites.filter((site) => site.status === "active");
  const approvalTimes = state.approvals
    .filter((approval) => approval.sentAt && approval.timeline?.some((entry) => entry.type === "approved"))
    .map((approval) => {
      const sent = new Date(approval.sentAt.replace(" ", "T"));
      const approved = approval.timeline.find((entry) => entry.type === "approved");
      const approvedAt = new Date(approved.at.replace(" ", "T"));
      return Math.max(1, Math.round((approvedAt - sent) / 36e5));
    });
  const clientVelocity = approvalTimes.length
    ? Math.round(approvalTimes.reduce((sum, value) => sum + value, 0) / approvalTimes.length)
    : 18;

  return {
    siteMetrics,
    portfolio: {
      activeProjects: activeSites.length,
      totalContractValue: activeSites.reduce((sum, site) => sum + (Number(site.contractValue) || 0), 0),
      totalMarginAtRisk: siteMetrics.reduce((sum, metric) => sum + metric.costExposure, 0),
      variationExposure: state.variations
        .filter((variation) => !["signed", "approved"].includes(variation.status))
        .reduce((sum, variation) => sum + (variation.value || 0), 0),
      verifiedLabourPct:
        state.presence.records.length > 0
          ? Math.round(
              (state.presence.records.filter((record) => record.status === "verified-on-site").length / state.presence.records.length) * 100,
            )
          : 100,
      clientVelocityHours: clientVelocity,
    },
  };
}

function normaliseSearchValue(value) {
  if (Array.isArray(value)) {
    return value.map(normaliseSearchValue).join(" ");
  }
  if (value && typeof value === "object") {
    return Object.values(value).map(normaliseSearchValue).join(" ");
  }
  return String(value ?? "");
}

function fuzzyScore(query, haystack) {
  const needle = query.trim().toLowerCase();
  const target = normaliseSearchValue(haystack).toLowerCase();
  if (!needle || !target) return -1;
  if (target.includes(needle)) {
    return 1200 - target.indexOf(needle);
  }

  let score = 0;
  let qIndex = 0;
  for (let index = 0; index < target.length && qIndex < needle.length; index += 1) {
    if (target[index] === needle[qIndex]) {
      score += 12;
      if (index > 0 && target[index - 1] === " ") {
        score += 4;
      }
      qIndex += 1;
    }
  }

  if (qIndex !== needle.length) {
    return -1;
  }

  return score - Math.max(0, target.length - needle.length);
}

function buildSearchResults(state, query) {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }

  const collections = [
    {
      type: "Tasks",
      items: state.tasks,
      label: (item) => item.title,
      haystack: (item) => [item.title, item.description, item.trade, item.status],
      route: (item) => ({ kind: "internal", siteId: item.siteId, page: "tasks", entityId: item.id }),
    },
    {
      type: "Problems",
      items: state.problems,
      label: (item) => item.title,
      haystack: (item) => [item.title, item.category, item.priority, item.status, item.thread?.map((entry) => entry.body)],
      route: (item) => ({ kind: "internal", siteId: item.siteId, page: "probs", entityId: item.id }),
    },
    {
      type: "RFIs",
      items: state.rfis,
      label: (item) => `${item.number} ${item.title}`,
      haystack: (item) => [item.number, item.title, item.description, item.trade, item.to, item.status],
      route: (item) => ({ kind: "internal", siteId: item.siteId, page: "rfis", entityId: item.id }),
    },
    {
      type: "Variations",
      items: state.variations,
      label: (item) => `${item.number} ${item.title}`,
      haystack: (item) => [item.number, item.title, item.trade, item.status, item.value],
      route: (item) => ({ kind: "internal", siteId: item.siteId, page: "vos", entityId: item.id }),
    },
    {
      type: "Approvals",
      items: state.approvals,
      label: (item) => item.title,
      haystack: (item) => [item.title, item.type, item.summary, item.reason, item.status],
      route: (item) => ({ kind: "internal", siteId: item.siteId, page: "clientflow", entityId: item.id }),
    },
    {
      type: "Documents",
      items: state.documents,
      label: (item) => item.title,
      haystack: (item) => [item.title, item.category, item.rev, item.tags, item.impactAnalysis?.summary],
      route: (item) => ({ kind: "internal", siteId: item.siteId, page: "docs", entityId: item.id }),
    },
    {
      type: "Contracts",
      items: state.contractPacks,
      label: (item) => item.docId,
      haystack: (item) => [item.docId, item.template, item.status, item.content?.sections],
      route: (item) => ({ kind: "internal", siteId: item.siteId, page: "contracts", entityId: item.docId }),
    },
    {
      type: "Passports",
      items: state.passports.records,
      label: (item) => item.person,
      haystack: (item) => [item.person, item.company, item.trade, item.role, item.docs],
      route: (item) => ({ kind: "internal", siteId: item.siteId, page: "passport", entityId: item.id }),
    },
    {
      type: "Presence",
      items: state.presence.records,
      label: (item) => item.person,
      haystack: (item) => [item.person, item.status, item.anomalyFlags, item.supervisorNotes],
      route: (item) => ({ kind: "internal", siteId: item.siteId, page: "presence", entityId: item.id }),
    },
    {
      type: "Invoices",
      items: state.invoices,
      label: (item) => item.number,
      haystack: (item) => [item.number, item.siteId, item.status, item.value, item.period, item.lineItems],
      route: (item) => ({ kind: "subcontractor", userId: state.session.userId, page: "invoices", entityId: item.id }),
    },
    {
      type: "Messages",
      items: state.messages,
      label: (item) => item.threadId,
      haystack: (item) => [item.threadType, item.threadId, item.messages],
      route: (item) => ({ kind: "internal", siteId: state.session.siteId, page: "clientflow", entityId: item.threadId }),
    },
    {
      type: "Diary",
      items: state.diary,
      label: (item) => `${item.date} ${item.summary.slice(0, 40)}`,
      haystack: (item) => [item.date, item.summary, item.weather, item.delays, item.safety],
      route: (item) => ({ kind: "internal", siteId: item.siteId, page: "diary", entityId: item.id }),
    },
    {
      type: "Safety",
      items: state.safety,
      label: (item) => item.topic,
      haystack: (item) => [item.topic, item.type, item.by],
      route: (item) => ({ kind: "internal", siteId: item.siteId, page: "safety", entityId: item.id }),
    },
    {
      type: "Procurement",
      items: state.procurement,
      label: (item) => item.item,
      haystack: (item) => [item.item, item.supplier, item.status, item.poNumber, item.quantity],
      route: (item) => ({ kind: "internal", siteId: item.siteId, page: "mats", entityId: item.id }),
    },
    {
      type: "Audit",
      items: state.auditTrail,
      label: (item) => item.action,
      haystack: (item) => [item.action, item.actor, item.entityType, item.entityId, item.siteId],
      route: (item) => ({ kind: "internal", siteId: item.siteId || state.session.siteId, page: "audit", entityId: item.id }),
    },
    {
      type: "Board Reports",
      items: state.boardReports,
      label: (item) => item.title,
      haystack: (item) => [item.title, item.period, item.summary],
      route: () => ({ kind: "director", page: "boardroom", siteId: null, entityId: null }),
    },
    {
      type: "Templates",
      items: state.contractTemplates,
      label: (item) => item.name,
      haystack: (item) => [item.name, item.type, item.branding, item.clauses],
      route: () => ({ kind: "internal", siteId: state.session.siteId, page: "contracts", entityId: null }),
    },
    {
      type: "Clauses",
      items: state.clauseLibrary,
      label: (item) => item.title,
      haystack: (item) => [item.title, item.text, item.tags],
      route: () => ({ kind: "internal", siteId: state.session.siteId, page: "contracts", entityId: null }),
    },
    {
      type: "People",
      items: state.users,
      label: (item) => item.name,
      haystack: (item) => [item.name, item.role, item.trade, item.company],
      route: (item) =>
        routeKindForRole(item.role) === "client"
          ? { kind: "client", clientId: item.clientId, page: "home", entityId: null }
          : { kind: "internal", siteId: item.siteIds?.[0] || "s1", page: "team", entityId: item.id },
    },
    {
      type: "Sites",
      items: state.sites,
      label: (item) => `${item.code} ${item.name}`,
      haystack: (item) => [item.code, item.name, item.address, item.region, item.currentPhase],
      route: (item) => ({ kind: "internal", siteId: item.id, page: "dash", entityId: null }),
    },
  ];

  return collections
    .map((collection) => ({
      type: collection.type,
      results: collection.items
        .map((item) => ({
          item,
          score: fuzzyScore(q, collection.haystack ? collection.haystack(item) : collection.label(item)),
        }))
        .filter((entry) => entry.score >= 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 6)
        .map(({ item }) => ({
          id: item.id || item.docId || item.number || item.threadId,
          title: collection.label(item),
          route: collection.route(item),
          subtitle:
            item.status ||
            item.role ||
            item.category ||
            item.type ||
            item.region ||
            item.period ||
            item.threadType ||
            "",
        })),
    }))
    .filter((group) => group.results.length);
}

function getRecipientsForRoles(state, roles) {
  return roles
    .map((targetRole) => state.users.filter((user) => targetRole === user.role))
    .flat()
    .map((user) => ({ user }));
}

function getRecipientsForClient(state, clientId) {
  const client = state.clients.find((item) => item.id === clientId);
  return client ? [{ client }] : [];
}

function appendProjectLog(state, siteId, title, body) {
  state.projectLogs.unshift({
    id: randomId("log"),
    siteId,
    at: nowStamp(),
    title,
    body,
  });
  state.projectLogs = state.projectLogs.slice(0, 240);
}

function queueBuildxactSync(state, type, reference, siteId, payloadCurrent, payloadPrevious = null) {
  const readOnly = Boolean(state.buildxact?.readOnlyMode);
  const demoOnly = state.org?.mode === "demo";
  const queueItem = {
    id: randomId("bxq"),
    resource: type,
    action: "upsert",
    type,
    reference,
    siteId,
    payloadSize: `${Math.max(2, Math.round(JSON.stringify(payloadCurrent).length / 1000))} KB`,
    status: demoOnly ? "skipped-demo" : readOnly ? "read-only" : "pending",
    attempts: 0,
    createdAt: nowStamp(),
    lastError: demoOnly ? "Demo mode: payload retained locally and never sent externally." : readOnly ? "Read-only mode enabled. Payload retained for preview only." : null,
    demoOnly,
  };
  state.buildxact.queue.unshift(queueItem);
  state.buildxact.queue = state.buildxact.queue.slice(0, 120);
  state.buildxact.pendingPushes = Array.isArray(state.buildxact.pendingPushes) ? state.buildxact.pendingPushes : [];
	  state.buildxact.pendingPushes.unshift({
	    id: queueItem.id,
	    createdAt: queueItem.createdAt,
	    status: demoOnly ? "skipped-demo" : "queued",
	    type,
	    payload: payloadCurrent,
	    relatedEntity: { type, id: reference },
	    attemptCount: 0,
	    lastError: queueItem.lastError,
	    buildxactRemoteId: null,
	    demoOnly,
	  });
  state.buildxact.pendingPushes = state.buildxact.pendingPushes.slice(0, 120);
  state.buildxact.payloadPreviews.unshift({
    id: randomId("bxp"),
    type,
    reference,
    current: payloadCurrent,
    previous: payloadPrevious,
  });
  state.buildxact.payloadPreviews = state.buildxact.payloadPreviews.slice(0, 120);
  if (readOnly || demoOnly) {
	    state.buildxact.syncHistory.unshift(
	      createBuildxactSyncHistory({
	        type,
	        reference,
	        siteId,
	        status: "skipped",
	        payloadSize: queueItem.payloadSize,
	        error: demoOnly ? "Demo mode never sends to Buildxact." : "Read-only mode enabled.",
	      }),
	    );
    state.buildxact.syncHistory = state.buildxact.syncHistory.slice(0, 180);
  }
  return queueItem;
}

function queueSignedApprovalBuildxactPush(state, approval, contractPack) {
  if (!approval || !contractPack) return null;
  const site = state.sites.find((item) => item.id === approval.siteId);
  const client = state.clients.find((item) => item.id === approval.clientId);
  const costCode = (state.buildxact?.costCodes || []).find((item) => item.siteforgeTag === "variation") || null;
  const variationPayload = createSignedApprovalPushPayload({ approval, site, client, contractPack, costCode });
  const attachmentPayload = createAttachmentPayload({ approval, site, contractPack });
  const variationQueue = queueBuildxactSync(state, "variation", approval.number || approval.id, approval.siteId, variationPayload, null);
  queueBuildxactSync(state, "contractPack", contractPack.docId, approval.siteId, attachmentPayload, null);
  return variationQueue;
}

function getBrowserEvidence() {
  return {
    ip: "browser-direct",
    ua: typeof navigator !== "undefined" ? navigator.userAgent : "SiteForge Browser",
  };
}

function buildApprovalEmailPayload(state, approval) {
  const client = state.clients.find((item) => item.id === approval.clientId);
  const site = state.sites.find((item) => item.id === approval.siteId);
  const builder = state.settings?.company || state.company || APP_CONFIG.builder;
  return {
    id: randomId("email"),
    createdAt: nowStamp(),
    status: "queued",
    type: "approval-sent",
    to: { name: client?.primaryContact || client?.name || "Client", email: client?.email || "" },
    cc: [],
    subject: `${builder.name || "SiteForge"} approval request: ${approval.number || approval.title}`,
    bodyText: [
      `Hello ${client?.primaryContact || "there"},`,
      "",
      `${builder.name || "Your builder"} has issued ${approval.title} for ${site?.name || "your project"}.`,
      `Cost impact: ${formatCurrency(approval.costImpact || 0)}`,
      `Time impact: ${approval.timeImpact || 0} day(s)`,
      "",
      `Review and sign here: ${approval.portalUrl}`,
      "",
      "This message is queued locally until an email provider is connected. You can copy and send it manually.",
    ].join("\n"),
    bodyHtml: `<p>Hello ${client?.primaryContact || "there"},</p><p>${builder.name || "Your builder"} has issued <strong>${approval.title}</strong> for ${site?.name || "your project"}.</p><p><strong>Cost impact:</strong> ${formatCurrency(approval.costImpact || 0)}<br/><strong>Time impact:</strong> ${approval.timeImpact || 0} day(s)</p><p><a href="${approval.portalUrl}">Review and sign approval</a></p><p>This message is queued locally until an email provider is connected.</p>`,
    attachments: [],
    relatedEntity: { type: "approval", id: approval.id },
    attemptCount: 0,
    lastAttempt: null,
    lastError: null,
    externalProvider: null,
    externalMessageId: null,
  };
}

function queueExternalDeliveryForApproval(state, approval) {
  if (!approval) return;
  state.emailQueue = Array.isArray(state.emailQueue) ? state.emailQueue : [];
  state.smsQueue = Array.isArray(state.smsQueue) ? state.smsQueue : [];
  state.teamsQueue = Array.isArray(state.teamsQueue) ? state.teamsQueue : [];
  if (approval.deliveryChannels?.email) {
    const exists = state.emailQueue.some((item) => item.relatedEntity?.type === "approval" && item.relatedEntity?.id === approval.id && item.type === "approval-sent");
    if (!exists) state.emailQueue.unshift(buildApprovalEmailPayload(state, approval));
  }
  if (approval.deliveryChannels?.sms) {
    const client = state.clients.find((item) => item.id === approval.clientId);
    state.smsQueue.unshift({
      id: randomId("sms"),
      createdAt: nowStamp(),
      status: "queued",
      type: "approval-sent",
      to: { name: client?.primaryContact || client?.name || "Client", phone: client?.phone || "" },
      body: `${approval.title}: review and sign ${approval.portalUrl}`,
      relatedEntity: { type: "approval", id: approval.id },
      attemptCount: 0,
      lastAttempt: null,
      lastError: null,
      externalProvider: null,
      externalMessageId: null,
    });
  }
  if (approval.deliveryChannels?.teams) {
    const client = state.clients.find((item) => item.id === approval.clientId);
    state.teamsQueue.unshift({
      id: randomId("teamsq"),
      createdAt: nowStamp(),
      status: "queued",
      type: "approval-sent",
      channel: "client-approval",
      payload: {
        title: approval.title,
        number: approval.number,
        client: client?.primaryContact || client?.name || "Client",
        costImpact: approval.costImpact || 0,
        timeImpact: approval.timeImpact || 0,
        portalUrl: approval.portalUrl,
      },
      relatedEntity: { type: "approval", id: approval.id },
      attemptCount: 0,
      lastAttempt: null,
      lastError: null,
    });
  }
  state.emailQueue = state.emailQueue.slice(0, 160);
  state.smsQueue = state.smsQueue.slice(0, 160);
  state.teamsQueue = state.teamsQueue.slice(0, 160);
}

function getDeliveryChannels(state, approval) {
  return {
    ...DEFAULT_CLIENTFLOW_CHANNELS,
    ...(state.settings?.clientflow?.channelsByType?.[approval?.type] || {}),
    ...(approval?.deliveryChannels || {}),
  };
}

function buildDeliveryQueue(channels, issuedAt = nowStamp()) {
  return Object.entries(channels)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([channel]) => ({
      id: randomId("delivery"),
      channel,
      status: channel === "inPortal" ? "available" : "queued",
      queuedAt: issuedAt,
      attempts: 0,
      lastError: null,
    }));
}

function appendApprovalComplianceEvent(approval, { event, actor = "System", role = "System", payload = {}, evidence = null }) {
  if (!approval) return null;
  const trail = approval.complianceTrail || [];
  const previousHash = trail[trail.length - 1]?.hash || "GENESIS";
  const timestamp = nowStamp();
  const eventPayload = {
    id: randomId("apce"),
    approvalId: approval.id,
    event,
    actor,
    role,
    timestamp,
    payload,
    ...(evidence || getBrowserEvidence()),
    previousHash,
  };
  eventPayload.hash = hashString(`${previousHash}:${event}:${actor}:${timestamp}:${JSON.stringify(payload)}`);
  approval.complianceTrail = [...trail, eventPayload].slice(-160);
  return eventPayload;
}

function verifyApprovalComplianceEvents(approval) {
  const trail = approval?.complianceTrail || [];
  let previousHash = "GENESIS";
  for (const event of trail) {
    const expected = hashString(`${previousHash}:${event.event}:${event.actor}:${event.timestamp}:${JSON.stringify(event.payload || {})}`);
    if (event.previousHash !== previousHash || event.hash !== expected) {
      return { status: "failed", count: trail.length, summary: `Compliance trail breaks at ${event.event}.` };
    }
    previousHash = event.hash;
  }
  return {
    status: "verified",
    count: trail.length,
    summary: trail.length ? "Approval compliance trail is intact." : "No compliance events have been recorded yet.",
  };
}

function prepareApprovalForClientIssue(state, approval, actor, { bulkId = null } = {}) {
  const issuedAt = nowStamp();
  const before = { status: approval.status, sentAt: approval.sentAt };
  approval.status = "awaiting-client";
  approval.sentAt = approval.sentAt || issuedAt;
  approval.portalToken = approval.portalToken || uuid();
  approval.portalUrl = buildPortalUrl(approval.portalToken);
  approval.portalExpiresAt = approval.portalExpiresAt || addDays(formatDate(), 30);
  approval.magicLink = {
    token: approval.portalToken,
    url: approval.portalUrl,
    issuedAt,
    expiresAt: approval.portalExpiresAt,
    singleUse: true,
    resendCount: Number(approval.magicLink?.resendCount || 0),
  };
  approval.portalAuth = {
    emailVerificationRequired: true,
    oneTimeCodeStatus: "queued",
    sessionTimeoutMinutes: 30,
    rememberDeviceAvailable: true,
  };
  approval.deliveryChannels = getDeliveryChannels(state, approval);
  approval.deliveryQueue = buildDeliveryQueue(approval.deliveryChannels, issuedAt);
  approval.bulkIssueId = bulkId || approval.bulkIssueId || null;
  appendApprovalComplianceEvent(approval, {
    event: "approval.sent",
    actor: actorName(actor),
    role: actor.role,
    payload: {
      status: approval.status,
      portalExpiresAt: approval.portalExpiresAt,
      channels: Object.keys(approval.deliveryChannels).filter((channel) => approval.deliveryChannels[channel]),
      bulkId,
    },
  });
  return before;
}

function issueApprovalToClient(next, helpers, approval, { bulkId = null, timelineText = null } = {}) {
  if (!approval) return null;
  const before = prepareApprovalForClientIssue(next, approval, helpers.actor, { bulkId });
  queueExternalDeliveryForApproval(next, approval);
  if (approval.recoveryChain) {
    approval.recoveryChain.sentAt = approval.sentAt || nowStamp();
  }
  helpers.appendTimeline(approval, {
    type: "sent",
    actor: actorName(helpers.actor),
    role: helpers.actor.role,
    text:
      timelineText ||
      `Approval issued via ${Object.keys(approval.deliveryChannels || {})
        .filter((channel) => approval.deliveryChannels[channel])
        .join(", ")}.`,
  });
  helpers.addMessage(
    "approval",
    approval.id,
    [approval.ownerId, next.users.find((user) => user.clientId === approval.clientId)?.id].filter(Boolean),
    `We've sent ${approval.title.toLowerCase()} for review with the current recommendation and supporting records.`,
  );
  helpers.addAudit({
    action: "approval.send",
    entityType: "approval",
    entityId: approval.id,
    before,
    after: { status: approval.status, sentAt: approval.sentAt },
    siteId: approval.siteId,
  });
  helpers.emit({
    eventType: "approval.created",
    title: `Approval sent - ${approval.title}`,
    body: `${approval.summary} Magic-link access expires ${approval.portalExpiresAt}.`,
    siteId: approval.siteId,
    entityType: "approval",
    entityId: approval.id,
    recipients: [
      ...getRecipientsForRoles(next, ["Project Manager"]),
      ...getRecipientsForClient(next, approval.clientId),
    ],
    route: { kind: "internal", siteId: approval.siteId, page: "clientflow", entityId: approval.id },
  });
  if (approval.deliveryChannels?.teams) {
    const client = next.clients.find((item) => item.id === approval.clientId);
    const channel = next.teams.channelMap?.["approval.sent"] || "Client Approvals";
    const event = buildTeamsApprovalDispatch({
      approval,
      client,
      builder: next.org?.settings?.company || APP_CONFIG.builder,
      channel,
    });
    const record = { id: randomId("teams"), ...event, status: next.teams.connected ? "sent" : "queued" };
    next.teams.outbound.unshift(record);
    next.notifications.eventLog.unshift({ id: randomId("tel"), ...record });
    next.teams.outbound = next.teams.outbound.slice(0, 120);
    next.notifications.eventLog = next.notifications.eventLog.slice(0, 240);
  }
  return before;
}

function nextScopedNumber(state, collectionName, siteId, prefix, field = "number") {
  const collection = Array.isArray(state[collectionName]) ? state[collectionName] : [];
  const matches = collection.filter((entry) => entry.siteId === siteId && String(entry[field] || "").startsWith(`${prefix}-`));
  const highest = matches.reduce((max, entry) => {
    const value = Number(String(entry[field] || "").replace(`${prefix}-`, ""));
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);
  return `${prefix}-${String(highest + 1).padStart(3, "0")}`;
}

function inferTemplateType(name = "") {
  if (/rain|eot|extension/i.test(name)) return "Rain Day";
  if (/delay/i.test(name)) return "Delay Notice";
  if (/selection|upgrade/i.test(name)) return "Selection Upgrade";
  if (/variation|vo[\s-]/i.test(name)) return "Variation";
  return "Variation";
}

function firstMeaningfulLine(text = "", fallback = "Uploaded template") {
  return (text.split(/\n+/).map((line) => line.trim()).find(Boolean) || fallback).slice(0, 100);
}

function clausesFromText(text = "") {
  const clauses = text
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return clauses.length ? clauses : [text.trim()].filter(Boolean);
}

function inferTokenAlias(token = "") {
  const normalised = token.toLowerCase().replace(/[_\s-]+/g, ".");
  const aliases = {
    client: "client.name",
    "client.name": "client.name",
    cost: "approval.cost",
    "estimated.cost": "approval.cost",
    "estimated_cost": "approval.cost",
    date: "date.today",
    "date.issued": "date.today",
    "project.name": "site.name",
    "project.address": "site.address",
    "site.address": "site.address",
    "builder.name": "builder.name",
    "builder.abn": "builder.abn",
    "variation.number": "approval.number",
    "variation.description": "approval.summary",
    "time.impact.days": "approval.days",
  };
  return aliases[normalised] || "";
}

function ensureVariationForApproval(state, approval) {
  const existingVariation = state.variations.find((variation) => variation.clientApprovalId === approval.id);
  if (existingVariation || !COMMERCIAL_APPROVALS.has(approval.type)) {
    return existingVariation || null;
  }

  const variation = {
    id: randomId("var"),
    siteId: approval.siteId,
    number: nextScopedNumber(state, "variations", approval.siteId, "VO"),
    title: approval.title.replace(/^Approve\s+/i, "").replace(/^Approve\s+/i, ""),
    sourceType: approval.sourceType,
    sourceId: approval.sourceId,
    status: "submitted",
    priority: approval.priority,
    value: approval.costImpact || 0,
    days: approval.timeImpact || 0,
    trade: findInCollection(state, approval.sourceType, approval.sourceId)?.trade || "General",
    createdBy: approval.createdBy,
    clientApprovalId: approval.id,
    contractPackId: null,
    linkedRecords: [...(approval.linkedRecords || []), buildLink("approval", approval, approval.siteId)],
  };
  state.variations.unshift(variation);
  approval.linkedRecords = approval.linkedRecords || [];
  upsertLinkedRecord(approval, buildLink("variation", variation, approval.siteId));
  return variation;
}

function hasApprovalLink(source) {
  return Boolean(
    source?.linkedApprovals?.length ||
      source?.linkedApprovalId ||
      source?.clientApprovalId ||
      source?.linkedRecords?.some((record) => record.type === "approval"),
  );
}

function sourceEventDate(source) {
  return source?.createdAt || source?.reportedAt || source?.raisedAt || source?.date || source?.updatedAt || nowStamp();
}

function createRecoveryApprovalRecord(next, helpers, { sourceType, source, approvalType, title, summary, reason, costImpact, timeImpact, templateId, opportunityId }) {
  const siteId = source?.siteId || next.session.siteId;
  const site = next.sites.find((item) => item.id === siteId) || next.sites[0];
  const client = next.clients.find((item) => item.id === site?.clientId) || next.clients[0];
  if (!source || !site || !client) return null;
  const aiDraft = draftApproval(source, approvalType);
  const portalToken = uuid();
  const numericCost = Number(costImpact ?? aiDraft.costImpact ?? source.costImpact ?? source.value ?? 0);
  const numericTime = Number(timeImpact ?? aiDraft.timeImpact ?? source.timeImpact ?? source.days ?? 0);
  const createdAt = nowStamp();
  const approval = {
    id: randomId("ap"),
    number: nextScopedNumber(next, "approvals", siteId, "CF"),
    siteId,
    clientId: client.id,
    type: approvalType,
    title: title || buildApprovalTitle(source, approvalType),
    summary: summary || aiDraft.summary || source.description || source.summary || source.title || "",
    reason: reason || aiDraft.reason || "Commercial recovery generated from linked site evidence.",
    recommendation: aiDraft.recommendation || "Recommended for issue to client for review and signature.",
    status: "draft",
    priority: source.priority || "medium",
    sourceType,
    sourceId: source.id || source.docId,
    createdBy: helpers.actor.id,
    ownerId: site.pmId || "u_pm_1",
    sentAt: null,
    dueAt: addDays(formatDate(), 3),
    viewedAt: null,
    costImpact: numericCost,
    timeImpact: numericTime,
    templateId: templateId || null,
    linkedRecords: [...(source.linkedRecords || []), buildLink(sourceType, source, siteId)],
    attachments: buildSourceAttachments(source),
    aiDraft: {
      ...aiDraft,
      summary: summary || aiDraft.summary,
      reason: reason || aiDraft.reason,
      costImpact: numericCost,
      timeImpact: numericTime,
    },
    timeline: [],
    messageThread: [],
    contractPackId: null,
    portalToken,
    portalUrl: buildPortalUrl(portalToken),
    recoveryChain: {
      chainType: `${sourceType}->${approvalType}`,
      sourceType,
      sourceId: source.id || source.docId,
      sourceEventAt: sourceEventDate(source),
      approvalCreatedAt: createdAt,
      sentAt: null,
      signedAt: null,
      opportunityId: opportunityId || null,
    },
  };
  helpers.appendTimeline(approval, {
    type: "created",
    actor: actorName(helpers.actor),
    role: helpers.actor.role,
    text: `${helpers.actor.role} raised ${approvalType} from ${sourceType} recovery evidence.`,
  });
  next.approvals.unshift(approval);
  source.linkedApprovals = source.linkedApprovals || [];
  if (!source.linkedApprovals.includes(approval.id)) source.linkedApprovals.push(approval.id);
  if (sourceType === "procurement") source.linkedApprovalId = approval.id;
  upsertLinkedRecord(source, buildLink("approval", approval, siteId));
  const variation = helpers.ensureVariation(approval);
  if (variation) upsertLinkedRecord(source, buildLink("variation", variation, siteId));
  if (opportunityId) {
    next.recoveryOpportunities = next.recoveryOpportunities.map((opportunity) =>
      opportunity.id === opportunityId ? { ...opportunity, status: "converted", convertedAt: createdAt, approvalId: approval.id } : opportunity,
    );
  }
  helpers.addAudit({
    action: "recovery.approval-created",
    entityType: "approval",
    entityId: approval.id,
    before: null,
    after: { type: approval.type, sourceType, sourceId: approval.sourceId, costImpact: numericCost, timeImpact: numericTime },
    siteId,
  });
  helpers.emit({
    eventType: "approval.created",
    title: `Recovery approval drafted - ${approval.number}`,
    body: `${approval.title} was generated from ${sourceType} evidence.`,
    siteId,
    entityType: "approval",
    entityId: approval.id,
    recipients: getRecipientsForRoles(next, ["Project Manager", "Contract Admin"]),
    route: { kind: "internal", siteId, page: "clientflow", entityId: approval.id },
  });
  return approval;
}

function buildRecoveryCandidates(state, siteId) {
  const candidates = [];
  const push = (sourceType, source, approvalType, chainType, reason, defaults = {}) => {
    if (!source || source.siteId !== siteId || hasApprovalLink(source)) return;
    const key = `${sourceType}:${source.id || source.docId}:${approvalType}`;
    candidates.push({
      id: `recovery-${hashString(key)}`,
      key,
      siteId,
      sourceType,
      sourceId: source.id || source.docId,
      approvalType,
      chainType,
      title: defaults.title || buildApprovalTitle(source, approvalType),
      summary: defaults.summary || source.description || source.summary || source.title || source.item || source.topic || reason,
      reason,
      costImpact: Number(defaults.costImpact ?? source.costImpact ?? source.value ?? 0),
      timeImpact: Number(defaults.timeImpact ?? source.timeImpact ?? source.days ?? 0),
      status: "open",
      detectedAt: nowStamp(),
      sourceEventAt: sourceEventDate(source),
    });
  };
  state.diary.forEach((entry) => {
    if (entry.rainEvent || entry.isRainDay || /rain|wet weather|inclement/i.test(`${entry.weather || ""} ${entry.summary || ""}`)) {
      push("diary", entry, "Rain Day", "Diary -> Rain Day", "Rain event has no linked EOT / rain-day approval.");
    }
    if (Number(entry.costImpact || entry.value || 0) > 0) {
      push("diary", entry, "Variation", "Diary -> Variation", "Diary entry records cost impact with no linked variation approval.");
    }
  });
  state.problems.forEach((problem) => {
    if (["open", "under-review", "in-progress"].includes(problem.status) && Number(problem.costImpact || 0) > 0) {
      push("problem", problem, "Variation", "Problem -> Variation", "Problem has recoverable cost impact with no approval.");
    }
    if (["open", "under-review", "in-progress"].includes(problem.status) && Number(problem.timeImpact || 0) > 0) {
      push("problem", problem, "Delay Notice", "Problem -> Delay Notice", "Problem has programme impact with no delay notice.");
    }
  });
  state.rfis.forEach((rfi) => {
    const impactText = `${rfi.response || ""} ${rfi.summary || ""} ${rfi.topic || ""}`;
    if (["responded", "closed", "answered"].includes(rfi.status) && /change|variation|scope|extra/i.test(impactText)) {
      push("rfi", rfi, "Variation", "RFI -> Variation", "RFI response appears to alter scope.");
    }
    if (["responded", "closed", "answered"].includes(rfi.status) && (/delay|extension|programme|critical path/i.test(impactText) || Number(rfi.timeImpact || 0) > 0)) {
      push("rfi", rfi, "Extension of Time", "RFI -> EOT", "RFI response appears to affect programme.");
    }
  });
  state.procurement.forEach((item) => {
    if (["delayed", "escalated", "in-transit"].includes(item.status)) {
      push("procurement", item, "Extension of Time", "Procurement Delay -> EOT", "Procurement delay may support an extension of time.", {
        timeImpact: item.timeImpact || item.delayDays || 2,
      });
    }
  });
  state.safety.forEach((entry) => {
    if (["critical", "incident"].includes(entry.type) || /stop work|shutdown|incident/i.test(`${entry.summary || ""} ${entry.title || ""}`)) {
      push("safety", entry, "Delay Notice", "Safety Incident -> Delay Notice", "Safety event may justify a delay notice.");
    }
  });
  state.documents.forEach((document) => {
    if (document.impactAnalysis?.summary || document.acknowledgements?.some((ack) => ack.status !== "acknowledged")) {
      push("document", document, "Variation", "Drawing Revision -> Variation", "Drawing revision may have scope or acknowledgement impact.");
    }
  });
  (state.weatherForecasts?.[siteId] || []).forEach((forecast) => {
    if (Number(forecast.rainfallMm || 0) >= 10 || Number(forecast.rainChance || 0) >= 75) {
      push("weather", { ...forecast, id: `weather-${siteId}-${forecast.date}`, siteId, title: `${forecast.label} forecast ${forecast.date}` }, "Rain Day", "Weather Forecast -> Rain Day", "Forecast rain may justify a proactive rain-day notice.", {
        timeImpact: 1,
      });
    }
  });
  return candidates;
}

function buildOperationsReport(state, reportType = "weekly-site-operations", siteId = null) {
  const targetSiteId = siteId || state.session.siteId;
  const site = state.sites.find((entry) => entry.id === targetSiteId) || state.sites[0] || {};
  const scoped = (items) => items.filter((item) => item.siteId === targetSiteId);
  const approvals = scoped(state.approvals || []);
  const problems = scoped(state.problems || []);
  const rfis = scoped(state.rfis || []);
  const diary = scoped(state.diary || []);
  const safety = scoped(state.safety || []);
  const passports = (state.passports?.records || []).filter((item) => item.siteId === targetSiteId);
  const transmittals = scoped(state.transmittals || []);
  const signed = approvals.filter((approval) => approval.status === "signed");
  const reportNames = {
    "weekly-site-operations": "Weekly Site Operations Report",
    "daily-site-report": "Daily Site Report",
    "weekly-clientflow": "Weekly ClientFlow Recovery Report",
    "monthly-compliance": "Monthly Compliance Report",
    "monthly-safety": "Monthly Safety Report",
    "handover-pack": "Project Handover Pack",
    "audit-trail": "Audit Trail Report",
  };
  const baseSections = {
    "weekly-site-operations": [
      {
        heading: "Diary and field activity",
        lines: [
          `${diary.length} diary entries captured.`,
          `${problems.filter((item) => item.status !== "closed").length} open problems requiring action.`,
          `${rfis.filter((item) => item.status !== "closed").length} RFIs open or under review.`,
        ],
        rows: diary.slice(0, 6).map((entry) => ({ date: entry.date, weather: entry.weather, summary: entry.summary || entry.title })),
      },
      {
        heading: "Photos and evidence",
        lines: [`${state.files?.records?.filter((file) => file.siteId === targetSiteId && file.classification === "Photo / Site Image").length || 0} indexed site photos.`],
      },
    ],
    "daily-site-report": [
      {
        heading: "Today on site",
        lines: [
          `${diary.filter((entry) => entry.date === formatDate()).length || diary.length} diary entries available for today's report context.`,
          `${problems.filter((item) => item.status !== "closed").length} open problems.`,
          `${state.tasks.filter((task) => task.siteId === targetSiteId && task.status === "done").length} completed tasks recorded.`,
          `${state.files?.records?.filter((file) => file.siteId === targetSiteId && file.classification === "Photo / Site Image").length || 0} site photos indexed.`,
        ],
      },
    ],
    "weekly-clientflow": [
      {
        heading: "ClientFlow recovery",
        lines: [
          `${approvals.length} approvals in the register.`,
          `${signed.length} signed approvals this period.`,
          `${formatCurrency(signed.reduce((sum, approval) => sum + Number(approval.costImpact || 0), 0))} recovered through signed approvals.`,
          `${approvals.filter((approval) => ["awaiting-client", "question", "changes-requested"].includes(approval.status)).length} approvals awaiting client response.`,
        ],
        rows: approvals.slice(0, 8).map((approval) => ({ number: approval.number, title: approval.title, status: approval.status, value: formatCurrency(approval.costImpact) })),
      },
    ],
    "monthly-compliance": [
      {
        heading: "Passport, tickets, SWMS",
        lines: [
          `${passports.length} worker passports registered on this site.`,
          `${passports.filter((passport) => passport.blockedReasons?.length).length} blocked or restricted passports.`,
          `${state.swms?.filter((item) => item.siteId === targetSiteId).length || 0} SWMS records held.`,
          `${transmittals.length} transmittals issued with acknowledgement tracking.`,
        ],
      },
    ],
    "monthly-safety": [
      {
        heading: "Safety operations",
        lines: [
          `${safety.length} safety records captured.`,
          `${safety.filter((item) => ["critical", "incident"].includes(item.type)).length} critical / incident records.`,
          `${state.toolboxTalks?.filter((talk) => talk.siteId === targetSiteId).length || 0} toolbox talks issued.`,
        ],
        rows: safety.slice(0, 8).map((entry) => ({ type: entry.type, topic: entry.topic || entry.title, status: entry.status || "recorded" })),
      },
    ],
    "handover-pack": [
      {
        heading: "Handover artifacts",
        lines: [
          `${state.documents.filter((document) => document.siteId === targetSiteId).length} documents in Document Control.`,
          `${signed.length} signed approval packs ready for handover evidence.`,
          `${transmittals.length} transmittal records available.`,
        ],
      },
    ],
    "audit-trail": [
      {
        heading: "Audit trail summary",
        lines: [
          `${state.auditTrail.filter((entry) => !entry.siteId || entry.siteId === targetSiteId).length} audit entries available for this site scope.`,
          "Full hash-chain verification is available from Audit Trail.",
        ],
        rows: state.auditTrail.filter((entry) => !entry.siteId || entry.siteId === targetSiteId).slice(0, 10).map((entry) => ({ action: entry.action, actor: entry.actor, at: entry.timestamp })),
      },
    ],
  };
  return {
    id: randomId("opr"),
    number: nextScopedNumber(state, "boardReports", targetSiteId, "OPR"),
    siteId: targetSiteId,
    siteName: site.name,
    reportType,
    title: reportNames[reportType] || "Operations Report",
    period: state.session.period || "Current period",
    createdAt: nowStamp(),
    summary: `${reportNames[reportType] || "Operations report"} for ${site.name || targetSiteId}, covering operational evidence, compliance, recovery and site execution.`,
    sections: baseSections[reportType] || baseSections["weekly-site-operations"],
  };
}

function applyBudgetImpact(state, approval, contractPack) {
  const site = state.sites.find((item) => item.id === approval.siteId);
  const budget = state.siteBudgets.find((item) => item.siteId === approval.siteId);
  const variation = state.variations.find((item) => item.clientApprovalId === approval.id);
  const value = Number(approval.costImpact || variation?.value || 0);

  if (site) {
    site.committed = Number(site.committed || 0) + value;
    site.marginAtRisk = Math.max(0, site.marginAtRisk - Math.round(value * 0.35));
  }
  if (budget) {
    budget.summary = budget.summary || { contractValue: site?.contractValue || 0, spent: 0, committed: 0, contingencyUsed: 0, forecastMargin: site?.forecastMargin || 0 };
    budget.summary.committed += value;
    const candidate = budget.items.find((item) => item.category.toLowerCase().includes((variation?.trade || "").toLowerCase())) || budget.items[budget.items.length - 1];
    if (candidate) {
      candidate.committed = Number(candidate.committed || 0) + value;
      candidate.forecast = Number(candidate.forecast || candidate.budget || 0) + value;
    }
  }

  if (variation) {
    variation.status = "signed";
    variation.contractPackId = contractPack.docId;
  }

  const existingRegister = state.variationRegister.find((entry) => entry.variationId === variation?.id);
  if (variation && !existingRegister) {
    state.variationRegister.unshift({
      id: randomId("vr"),
      siteId: approval.siteId,
      variationId: variation.id,
      status: "signed",
      value,
      approvedAt: nowStamp(),
    });
  } else if (existingRegister) {
    existingRegister.status = "signed";
    existingRegister.value = value;
    existingRegister.approvedAt = nowStamp();
  }

  queueBuildxactSync(
    state,
    "budgetImpact",
    variation?.number || approval.id,
    approval.siteId,
    {
      approvalId: approval.id,
      contractPack: contractPack.docId,
      committed: value,
      siteCode: site?.code,
    },
    null,
  );
}

function applyScheduleImpact(state, approval) {
  if (!approval.timeImpact) {
    return;
  }
  const schedule = state.schedules.find((entry) => entry.siteId === approval.siteId);
  const site = state.sites.find((entry) => entry.id === approval.siteId);
  if (!schedule) {
    return;
  }

  schedule.impacts.unshift({
    id: randomId("impact"),
    sourceType: "approval",
    sourceId: approval.id,
    days: approval.timeImpact,
    reason: approval.title,
  });
  schedule.currentCompletion = addDays(schedule.currentCompletion, approval.timeImpact);
  if (site?.estimatedCompletion) {
    site.estimatedCompletion = addDays(site.estimatedCompletion, approval.timeImpact);
  }
}

function parseDateTime(value) {
  if (!value) return null;
  const parsed = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hoursSince(value, runtime = getRuntimeNow()) {
  const parsed = parseDateTime(value);
  if (!parsed) return 0;
  return Math.max(0, (runtime.getTime() - parsed.getTime()) / 36e5);
}

function computeHours(startIso, finishIso) {
  const start = parseDateTime(startIso);
  const finish = parseDateTime(finishIso);
  if (!start || !finish) return 0;
  return Math.round(Math.max(0, finish.getTime() - start.getTime()) / 36e3) / 100;
}

function daysUntil(value, runtime = getRuntimeNow()) {
  const parsed = parseDateTime(value?.length > 10 ? value : `${value} 00:00`);
  if (!parsed) return Infinity;
  return Math.ceil((parsed.getTime() - runtime.getTime()) / 86400000);
}

function setByPath(root, path, value) {
  const parts = path.split(".");
  const finalKey = parts.pop();
  const target = parts.reduce((accumulator, key) => {
    if (!accumulator[key]) accumulator[key] = {};
    return accumulator[key];
  }, root);
  target[finalKey] = value;
}

function getCollectionRef(state, type) {
  const path = COLLECTION_MAP[type] || type;
  return { path, collection: readCollection(state, path) };
}

function updateSentiment(state, clientId, delta) {
  if (!clientId) return;
  const current = state.clientSentiment[clientId] || { score: 60, trend: [60], label: "neutral" };
  const score = Math.max(0, Math.min(100, current.score + delta));
  state.clientSentiment[clientId] = {
    score,
    trend: [...(current.trend || []), score].slice(-10),
    label: score >= 70 ? "positive" : score < 50 ? "concerned" : "neutral",
  };
}

function pushToast(state, toast) {
  state.demo = state.demo || { recentToasts: [] };
  state.demo.recentToasts = Array.isArray(state.demo.recentToasts) ? state.demo.recentToasts : [];
  const now = Date.now();
  const duplicate = (state.demo.recentToasts || []).some((entry) => {
    const entryTime = Date.parse(String(entry.at || "").replace(" ", "T"));
    const closeEnough = Number.isFinite(entryTime) ? now - entryTime < 2000 : false;
    const sameEvent = toast.eventType && entry.eventType === toast.eventType && entry.entityId === toast.entityId;
    const sameCopy = entry.title === toast.title && entry.body === toast.body;
    return closeEnough && (sameEvent || sameCopy);
  });
  if (duplicate) return;
  state.demo.recentToasts.unshift({
    id: randomId("toast"),
    at: nowStamp(),
    ...toast,
  });
  state.demo.recentToasts = state.demo.recentToasts.slice(0, 8);
}

function getApprovalMergeData(state, approval) {
  const site = state.sites.find((entry) => entry.id === approval.siteId) || state.sites[0];
  const client = state.clients.find((entry) => entry.id === approval.clientId) || state.clients[0];
  const builder = state.company || state.settings?.company || APP_CONFIG.builder;
  const cost = Number(approval.costImpact || 0);
  const costWords = new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(cost);

  return {
    "client.name": client?.primaryContact || client?.name || "",
    "client.company": client?.name || "",
    "client.abn": client?.abn || "",
    "client.address": client?.address || "",
    "builder.name": builder?.name || "",
    "builder.abn": builder?.abn || "",
    "builder.address": builder?.address || "",
    "site.name": site?.name || "",
    "site.address": site?.address || "",
    "site.lot": site?.lot || site?.code || "",
    "approval.number": approval.id,
    "approval.type": approval.type,
    "approval.title": approval.title,
    "approval.cost": formatCurrency(cost),
    "approval.cost_words": costWords,
    "approval.days": approval.timeImpact || 0,
    "approval.reason": approval.reason,
    "approval.summary": approval.summary,
    "approval.recommendation": approval.recommendation,
    "date.today": formatDate(),
    "date.signed": "",
    "signature.builder": approval.contractPackId ? "Builder signature pending" : "",
    "signature.client": "",
  };
}

function materialiseContractTemplate(contractPack, approval, state) {
  const template = state.contractTemplates.find((entry) => entry.id === approval.templateId || entry.id === contractPack.templateId || entry.type === approval.type) || state.contractTemplates[0];
  if (!template?.sourceContent) {
    return;
  }

  const mergeData = getApprovalMergeData(state, approval);
  const preview = buildTemplatePreviewContent(template.sourceContent, mergeData, template.tokenAliases || {});
  contractPack.content = {
    sections: preview.sections,
    mergeData,
    unresolvedTokens: preview.unresolvedTokens,
    templateBody: preview.populatedContent,
  };
  contractPack.template = template.name;
  contractPack.templateId = template.id;
}

function createContractPackForApproval(next, approval, helpers, { autoRelease = false } = {}) {
  if (!approval || approval.contractPackId) {
    return next.contractPacks.find((pack) => pack.docId === approval?.contractPackId) || null;
  }
  const site = next.sites.find((siteItem) => siteItem.id === approval.siteId);
  const client = next.clients.find((clientItem) => clientItem.id === approval.clientId);
  const contractPack = generateDraft({
    approval,
    client,
    site,
    builder: next.company || next.settings?.company || APP_CONFIG.builder,
    templates: next.contractTemplates,
  });
  materialiseContractTemplate(contractPack, approval, next);
  next.contractPacks.unshift(contractPack);
  approval.contractPackId = contractPack.docId;

  if (autoRelease) {
    contractPack.status = "contract-awaiting-client";
    contractPack.signatures.builder = {
      name: next.company?.name || APP_CONFIG.builder.name,
      role: "Builder",
      signedAt: nowStamp(),
      ip: "browser",
    };
    contractPack.auditLog.unshift({
      id: randomId("cpa"),
      action: "builder signature fast-tracked",
      by: "System",
      at: nowStamp(),
      details: "Variation approval was released for client e-signature after approval.",
    });
    approval.status = "contract-awaiting-client";
    helpers.appendTimeline(approval, {
      type: "contract-awaiting-client",
      actor: "System",
      role: "System",
      text: "Contract pack auto-generated, builder signature recorded, and released for client e-signature.",
    });
    appendApprovalComplianceEvent(approval, {
      event: "contract.released-for-client",
      actor: "System",
      role: "System",
      payload: { contractPackId: contractPack.docId },
    });
  } else {
    contractPack.status = "contract-drafted";
    approval.status = "contract-drafted";
    helpers.appendTimeline(approval, {
      type: "contract-drafted",
      actor: "System",
      role: "System",
      text: "Contract pack generated and sent to Contract Studio review.",
    });
    appendApprovalComplianceEvent(approval, {
      event: "contract.drafted",
      actor: "System",
      role: "System",
      payload: { contractPackId: contractPack.docId },
    });
  }

  helpers.projectLog(
    approval.siteId,
    `Contract pack drafted - ${approval.title}`,
    `Contract draft ${contractPack.docId} generated automatically from client approval.`,
  );
  return contractPack;
}

function finaliseClientSignedContract(next, helpers, contractPack, approval, signerName) {
  if (!contractPack || contractPack.status === "signed") return contractPack;
  const client = next.clients.find((item) => item.id === approval?.clientId);
  const signedPack = signContract(contractPack, "client", {
    name: signerName || client?.primaryContact || "Client",
    role: "Client",
    ...getBrowserEvidence(),
  });
  Object.assign(contractPack, signedPack);
  if (approval) {
    approval.status = "signed";
    if (approval.recoveryChain) {
      approval.recoveryChain.signedAt = contractPack.signatures?.client?.signedAt || nowStamp();
    }
    helpers.appendTimeline(approval, {
      type: "signed",
      actor: signerName || client?.primaryContact || "Client",
      role: "Client",
      text: "Contract fully executed.",
    });
    appendApprovalComplianceEvent(approval, {
      event: "contract.client-signed",
      actor: signerName || client?.primaryContact || "Client",
      role: "Client",
      payload: {
        contractPackId: contractPack.docId,
        signedAt: contractPack.signatures?.client?.signedAt,
        documentHash: contractPack.signatures?.client?.hash,
      },
    });
  }
  updateSentiment(next, approval?.clientId, 10);
  helpers.addAudit({
    action: "contract.client-sign",
    entityType: "contractPack",
    entityId: contractPack.docId,
    before: null,
    after: buildContractSummary(contractPack),
    siteId: contractPack.siteId,
  });
  if (approval) {
    helpers.applyBudgetImpact(approval, contractPack);
    helpers.applyScheduleImpact(approval);
	    if (!next.documents.some((document) => document.contractPackId === contractPack.docId)) {
	      next.documents.unshift({
	        id: randomId("doc"),
	        siteId: approval.siteId,
	        category: "Contract",
	        title: `Signed ${approval.type} - ${approval.title}`,
	        drawingNumber: approval.number,
	        rev: contractPack.revision || "1",
	        date: formatDate(),
	        clientVisible: true,
	        tags: ["contract", "executed", approval.type],
	        linkedTaskIds: [],
	        revisionHistory: [{ rev: "Executed", date: formatDate(), by: signerName || client?.primaryContact || "Client" }],
	        archived: false,
	        fileId: contractPack.fileId || null,
	        contractPackId: contractPack.docId,
	        linkedApprovalId: approval.id,
	        signedAt: contractPack.signatures?.client?.signedAt,
	        uploadedBy: helpers.actor.id,
	        uploadedAt: nowStamp(),
	        impactAnalysis: {
	          summary: `Fully executed ${approval.type.toLowerCase()} contract archived from ClientFlow.`,
          affectedTasks: [],
          affectedRfis: [],
          affectedTrades: [],
          affectedZones: [],
          notes: [`Signed by ${signerName || client?.primaryContact || "Client"} at ${contractPack.signatures.client?.signedAt}.`],
          acknowledgementsRequired: [],
          acknowledgedBy: [],
        },
      });
    }
    helpers.projectLog(
      approval.siteId,
      `Contract executed - ${approval.title}`,
      `Contract pack ${contractPack.docId} fully executed and archived for ${client?.name || "client"}.`,
    );
    queueSignedApprovalBuildxactPush(next, approval, contractPack);
  }
  helpers.emit({
    eventType: "contract.client-signed",
    title: `Contract fully executed - ${approval?.title || contractPack.docId}`,
    body: `${contractPack.docId} is now signed and archived.`,
    siteId: approval?.siteId,
    entityType: "contractPack",
    entityId: contractPack.docId,
    recipients: [
      ...getRecipientsForRoles(next, ["Supervisor", "Project Manager", "Contract Admin", "Director"]),
      ...getRecipientsForClient(next, approval?.clientId),
    ],
    route: { kind: "internal", siteId: approval?.siteId || next.session.siteId, page: "contracts", entityId: contractPack.docId },
  });
  if (approval) {
    helpers.emit({
      eventType: "approval.signed",
      title: `Approval signed - ${approval.title}`,
      body: `${approval.number || approval.id} is fully signed and its contract pack is archived.`,
      siteId: approval.siteId,
      entityType: "approval",
      entityId: approval.id,
      recipients: [
        ...getRecipientsForRoles(next, ["Supervisor", "Project Manager", "Contract Admin", "Director"]),
        ...getRecipientsForClient(next, approval.clientId),
      ],
      route: { kind: "internal", siteId: approval.siteId, page: "clientflow", entityId: approval.id },
    });
    if (next.teams) {
      const event = createTeamsEvent({
        eventType: "approval.signed",
        title: `Client signed ${approval.number || approval.id}`,
        body: approval.title,
        channel: next.teams.channelMap?.["approval.signed"] || "Builder PM Channel",
        status: next.teams.connected ? "sent" : "queued",
      });
      next.teams.outbound.unshift({ id: randomId("teams"), ...event });
      next.teams.outbound = next.teams.outbound.slice(0, 120);
    }
  }
  return contractPack;
}

function runTimedAutomationSweep(next, helpers) {
  const runtime = getRuntimeNow();
  const runtimeStamp = nowStamp();

  next.rfis.forEach((rfi) => {
    if (["closed", "responded"].includes(rfi.status)) return;
    if (daysUntil(rfi.dueDate, runtime) < 0) {
      if (rfi.status !== "overdue") {
        rfi.status = "overdue";
      }
      if (!rfi.overdueNotifiedAt) {
        rfi.overdueNotifiedAt = runtimeStamp;
        helpers.emit({
          eventType: "rfi.overdue",
          title: `RFI overdue - ${rfi.number}`,
          body: `${rfi.title} is now overdue and requires response.`,
          siteId: rfi.siteId,
          entityType: "rfi",
          entityId: rfi.id,
          recipients: getRecipientsForRoles(next, ["Project Manager", "Contract Admin"]),
          route: { kind: "internal", siteId: rfi.siteId, page: "rfis", entityId: rfi.id },
        });
      }
    }
  });

  next.tasks.forEach((task) => {
    if (task.status === "done" || !task.dueDate) return;
    if (daysUntil(task.dueDate, runtime) < 0 && !task.overdueNotifiedAt) {
      task.overdueNotifiedAt = runtimeStamp;
      helpers.emit({
        eventType: "task.overdue",
        title: `Task overdue - ${task.title}`,
        body: `${task.title} has passed its due date and still needs action.`,
        siteId: task.siteId,
        entityType: "task",
        entityId: task.id,
        recipients: [
          { user: next.users.find((entry) => entry.id === task.assigneeId) },
          ...getRecipientsForRoles(next, ["Supervisor"]),
        ].filter((entry) => entry.user),
        route: { kind: "internal", siteId: task.siteId, page: "tasks", entityId: task.id },
      });
    }
  });

  next.approvals.forEach((approval) => {
    if (!["awaiting-client", "question", "changes-requested", "contract-awaiting-client"].includes(approval.status)) return;
    const stalledHours = hoursSince(approval.sentAt, runtime);
    const thresholdHours = Number(next.settings?.clientflow?.stallThresholdBusinessDays || 5) * 24;
    const escalationLevel = stalledHours >= thresholdHours * 3 ? 3 : stalledHours >= thresholdHours * 2 ? 2 : stalledHours >= thresholdHours ? 1 : stalledHours >= 48 ? 0 : null;
    if (escalationLevel !== null && Number(approval.stalledEscalationLevel ?? -1) < escalationLevel) {
      approval.stalledEscalationLevel = escalationLevel;
      approval.stalledEscalatedAt = runtimeStamp;
      appendApprovalComplianceEvent(approval, {
        event: "approval.stalled-escalation",
        actor: "Automation",
        role: "System",
        payload: { escalationLevel, stalledHours: Math.round(stalledHours), thresholdHours },
      });
    }
    if (stalledHours >= 48 && !approval.stalledNotifiedAt) {
      approval.stalledNotifiedAt = runtimeStamp;
      helpers.emit({
        eventType: "approval.stalled",
        title: escalationLevel && escalationLevel >= 2 ? `Approval escalation - ${approval.title}` : `Approval stalled - ${approval.title}`,
        body: escalationLevel && escalationLevel >= 2 ? "ClientFlow escalation threshold reached. PM and Director review recommended." : "No client response has been recorded in the last 48 hours.",
        siteId: approval.siteId,
        entityType: "approval",
        entityId: approval.id,
        recipients: [
          ...getRecipientsForRoles(next, escalationLevel && escalationLevel >= 2 ? ["Project Manager", "Director"] : ["Project Manager"]),
          ...getRecipientsForClient(next, approval.clientId),
        ],
        route: { kind: "internal", siteId: approval.siteId, page: "clientflow", entityId: approval.id },
      });
    }
  });

  next.contractPacks.forEach((pack) => {
    if (!pack.signatures?.builder || pack.signatures?.client || pack.pendingSignatureNotifiedAt) return;
    if (hoursSince(pack.signatures.builder.signedAt, runtime) >= 24) {
      pack.pendingSignatureNotifiedAt = runtimeStamp;
      const approval = next.approvals.find((entry) => entry.id === pack.approvalId);
      helpers.emit({
        eventType: "contract.pending-signature",
        title: `Contract pending client signature - ${pack.docId}`,
        body: `${approval?.title || "Contract"} is still awaiting client execution.`,
        siteId: pack.siteId,
        entityType: "contractPack",
        entityId: pack.docId,
        recipients: [
          ...getRecipientsForClient(next, approval?.clientId),
          ...getRecipientsForRoles(next, ["Project Manager", "Contract Admin"]),
        ],
        route: { kind: "client", clientId: approval?.clientId, page: "documents", entityId: pack.docId },
      });
    }
  });

  next.passports.expiringTickets = (next.passports.expiringTickets || []).filter(Boolean);
  next.passports.expiringTickets.forEach((ticket) => {
    const days = daysUntil(ticket.expiresOn, runtime);
    ticket.daysRemaining = days;
    ticket.notifications = ticket.notifications || [];
    [30, 14, 7, 1].forEach((threshold) => {
      if (days <= threshold && days >= 0 && !ticket.notifications.includes(threshold)) {
        ticket.notifications.push(threshold);
        helpers.emit({
          eventType: "passport.ticket-expiring",
          title: `${ticket.label} expires in ${days} day${days === 1 ? "" : "s"}`,
          body: `${ticket.label} for ${next.users.find((entry) => entry.id === ticket.userId)?.name || "worker"} needs renewal before site access is blocked.`,
          siteId: next.passports.records.find((entry) => entry.id === ticket.passportId)?.siteId,
          entityType: "passport",
          entityId: ticket.passportId,
          recipients: [
            { user: next.users.find((entry) => entry.id === ticket.userId) },
            ...getRecipientsForRoles(next, ["Supervisor"]),
          ].filter((entry) => entry.user),
          route: { kind: "internal", siteId: next.passports.records.find((entry) => entry.id === ticket.passportId)?.siteId || next.session.siteId, page: "passport", entityId: ticket.passportId },
        });
      }
    });

    if (days < 0) {
      const passport = next.passports.records.find((entry) => entry.id === ticket.passportId);
      if (passport) {
        passport.blockedReasons = [...new Set([...(passport.blockedReasons || []), `${ticket.label} expired`])];
        const expiringDoc = passport.docs.find((doc) => doc.label.toLowerCase().includes(ticket.label.toLowerCase()));
        if (expiringDoc) expiringDoc.status = "expired";
      }
    }
  });

  const today = runtimeStamp.slice(0, 10);
  if (next.recoveryLastSweepDate !== today) {
    const existingKeys = new Set((next.recoveryOpportunities || []).filter((item) => item.status !== "dismissed").map((item) => item.key));
    const newItems = next.sites.flatMap((site) => buildRecoveryCandidates(next, site.id)).filter((candidate) => !existingKeys.has(candidate.key));
    if (newItems.length) {
      next.recoveryOpportunities = [...newItems, ...(next.recoveryOpportunities || [])].slice(0, 180);
      helpers.emit({
        eventType: "recovery.opportunity",
        title: `${newItems.length} recovery opportunities detected`,
        body: "SiteForge found field events that have not reached ClientFlow.",
        siteId: next.session.siteId,
        entityType: "recoveryOpportunity",
        entityId: newItems[0].id,
        recipients: getRecipientsForRoles(next, ["Project Manager", "Director"]),
        route: { kind: "internal", siteId: newItems[0].siteId, page: "clientflow" },
      });
    }
    next.recoveryLastSweepDate = today;
  }
}

function createHelpers(prev, next) {
  const actor = prev.users.find((user) => user.id === prev.session.userId) || prev.users[0] || {
    id: "system",
    name: "SiteForge",
    role: "System",
  };

  const helpers = {
    actor,
    addAudit({ action, entityType, entityId, before = null, after = null, siteId = null }) {
      const entry = createAuditEntry({
        actor: actor.name,
        actorRole: actor.role,
        action,
        entityType,
        entityId,
        before,
        after,
        siteId,
      });
      entry.orgId = next.org?.id || DEFAULT_ORG.id;
      next.auditTrail = [entry, ...(next.auditTrail || [])].slice(0, 600);
      Audit.create(entry).catch((error) => {
        console.warn("Failed to persist audit entry", error);
      });
    },
    emit({ eventType, title, body, siteId = null, entityType = null, entityId = null, recipients = [], route = null }) {
      const result = dispatchNotificationEvent({
        state: next,
        eventType,
        title,
        body,
        siteId,
        entityType,
        entityId,
        actor,
        route,
        recipients,
      });
      next.notifications.items.unshift(...result.items);
      next.notifications.eventLog.unshift(...result.eventLog);
      next.notifications.items = next.notifications.items.slice(0, 180);
      next.notifications.eventLog = next.notifications.eventLog.slice(0, 240);
      const urgent = result.items.find((item) => ["high", "critical"].includes(item.severity));
      if (urgent) {
        pushToast(next, {
          tone: urgent.severity === "critical" ? "critical" : "high",
          title: urgent.title,
          body: urgent.body,
        });
      }
    },
    addMessage(threadType, threadId, participants, body, byUserId = actor.id) {
      let thread = next.messages.find((item) => item.threadType === threadType && item.threadId === threadId);
      if (!thread) {
        thread = { id: randomId("msg-thread"), threadType, threadId, participants: [...participants], messages: [] };
        next.messages.unshift(thread);
      }
      thread.messages.push({
        id: randomId("msg"),
        by: byUserId,
        at: nowStamp(),
        body,
      });
    },
    appendTimeline(approval, entry) {
      approval.timeline = approval.timeline || [];
      approval.timeline.push({
        id: randomId("apt"),
        at: nowStamp(),
        ...entry,
      });
    },
    queueSync: (type, reference, siteId, current, previous = null) => queueBuildxactSync(next, type, reference, siteId, current, previous),
    projectLog: (siteId, title, body) => appendProjectLog(next, siteId, title, body),
    ensureVariation: (approval) => ensureVariationForApproval(next, approval),
    applyBudgetImpact: (approval, contractPack) => applyBudgetImpact(next, approval, contractPack),
    applyScheduleImpact: (approval) => applyScheduleImpact(next, approval),
  };

  return helpers;
}

export function SiteForgeProvider({ children }) {
  const [state, setState, persistence] = usePersistentState(getInitialStateStorageKey(), createInitialStore);
  const dataLayerBootstrapped = useRef(false);
  const hydrationNormalised = useRef(false);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!persistence?.hydrated || hydrationNormalised.current) return;
    hydrationNormalised.current = true;
    setState((previous) => normaliseState(cloneState(previous)));
  }, [persistence?.hydrated, setState]);

  useEffect(() => {
    if (dataLayerBootstrapped.current) return;
    dataLayerBootstrapped.current = true;
    bootstrapLocalDataLayer(state).catch((error) => {
      console.warn("Failed to bootstrap SiteForge data layer", error);
    });
  }, [state]);

  useEffect(() => {
    const onHashChange = () => {
      const parsed = parseHash(window.location.hash);
      if (!parsed) {
        return;
      }
      setState((previous) => {
        const next = cloneState(previous);
        let resolvedSiteId = next.session.siteId;
        if (parsed.siteId) {
          const exists = next.sites.some((site) => site.id === parsed.siteId);
          if (exists) {
            resolvedSiteId = parsed.siteId;
          } else if (next.sites[0]?.id) {
            resolvedSiteId = next.sites[0].id;
          }
        } else if (!resolvedSiteId && next.sites[0]?.id) {
          resolvedSiteId = next.sites[0].id;
        }

        next.session.route = { ...parsed, siteId: resolvedSiteId };
        next.session.siteId = resolvedSiteId;

        if (parsed.userId) {
          const userExists = next.users.some((user) => user.id === parsed.userId);
          if (userExists) {
            next.session.userId = parsed.userId;
          }
        }
        if (parsed.clientId) {
          const clientUser = next.users.find((user) => user.clientId === parsed.clientId);
          if (clientUser) {
            next.session.userId = clientUser.id;
            next.session.role = "Client";
          }
        }
        if (parsed.kind === "client-token") {
          const approval = next.approvals.find((item) => item.portalToken === parsed.approvalToken);
          if (approval) {
            const clientUser = next.users.find((user) => user.clientId === approval.clientId);
            next.session.role = "Client";
            next.session.userId = clientUser?.id || DEFAULT_ROLE_USERS.Client;
            next.session.route = { kind: "client", clientId: approval.clientId, page: "approvals", entityId: approval.id };
            next.session.siteId = approval.siteId;
          }
        }
        if (parsed.kind === "worker") {
          next.session.role = "Worker";
        }
        if (parsed.kind === "subcontractor") {
          next.session.role = "Subcontractor";
        }
        if (parsed.kind === "director") {
          next.session.role = "Director";
        }
        return normaliseState(next);
      });
    };

    window.addEventListener("hashchange", onHashChange);
    if (!window.location.hash && window.location.pathname.startsWith("/approve/")) {
      onHashChange();
    } else if (!window.location.hash) {
      const onboardingComplete = state.onboarding?.complete;
      const hasSites = state.sites.length > 0;
      if (onboardingComplete && hasSites) {
        const bootRole = ["Worker", "Client", "Subcontractor"].includes(state.session.role) ? "Supervisor" : state.session.role;
        window.location.hash = buildHash(getDefaultRouteForRole(bootRole, state));
      }
    } else {
      onHashChange();
    }

    return () => window.removeEventListener("hashchange", onHashChange);
  }, [setState, state.session.route]);

  const mutate = useCallback(
    (mutator) => {
      setState((previous) => {
        const next = cloneState(previous);
        mutator(next, createHelpers(previous, next));
        return normaliseState(next);
      });
    },
    [setState],
  );

  const navigate = useCallback(
    (route) => {
      const target = route.kind ? route : { ...state.session.route, ...route };
      setState((previous) => {
        const next = cloneState(previous);
        next.session.route = { ...target };
        if (target.siteId) {
          next.session.siteId = target.siteId;
        }
        if (target.userId) {
          next.session.userId = target.userId;
        }
        return normaliseState(next);
      });
      const hash = buildHash(target);
      if (window.location.hash !== hash) {
        window.location.hash = hash;
      }
    },
    [setState, state.session.route],
  );

  const persistExecutedPdf = useCallback(
    async (payload) => {
      if (!payload?.contractPack?.docId) return;
      try {
        const blob = await generateSignedContractPdfBlob(payload);
        const blobId = `executed-pdf-${payload.contractPack.docId}`;
        await putBlob(blobId, blob);
        mutate((next, helpers) => {
          const pack = next.contractPacks.find((entry) => entry.docId === payload.contractPack.docId);
          const document = next.documents.find((entry) => entry.contractPackId === payload.contractPack.docId);
          const approval = next.approvals.find((entry) => entry.contractPackId === payload.contractPack.docId);
          if (pack) {
            pack.executedPdfBlobId = blobId;
            pack.pdfArchiveLabel = `${pack.docId}.pdf`;
          }
          if (document) {
            document.fileId = blobId;
            document.fileName = `${payload.contractPack.docId}.pdf`;
            document.mimeType = "application/pdf";
            document.immutable = true;
          }
          if (pack && approval && !next.buildxact?.readOnlyMode) {
            queueBuildxactSync(
              next,
              "contractPackAttachment",
              pack.docId,
              approval.siteId,
              createAttachmentPayload({
                approval,
                site: next.sites.find((item) => item.id === approval.siteId),
                contractPack: pack,
              }),
              null,
            );
          }
          helpers.addAudit({
            action: "contract.executed-pdf-stored",
            entityType: "contractPack",
            entityId: payload.contractPack.docId,
            before: null,
            after: { executedPdfBlobId: blobId },
            siteId: payload.contractPack.siteId,
          });
        });
      } catch (error) {
        mutate((next, helpers) => {
          helpers.addAudit({
            action: "contract.executed-pdf-failed",
            entityType: "contractPack",
            entityId: payload.contractPack.docId,
            before: null,
            after: { error: error?.message || "PDF generation failed" },
            siteId: payload.contractPack.siteId,
          });
        });
      }
    },
    [mutate],
  );

  const improveApprovalDraft = useCallback(
    async ({ approvalId, sourceEntity, approvalType, siteId }) => {
      const snapshot = stateRef.current;
      const approval = snapshot.approvals.find((entry) => entry.id === approvalId);
      if (!approval) return;
      const resolvedSiteId = siteId || approval.siteId || snapshot.session.siteId;
      const projectContext = {
        orgMode: snapshot.org?.mode,
        site: snapshot.sites.find((entry) => entry.id === resolvedSiteId),
        company: snapshot.company,
        client: snapshot.clients.find((entry) => entry.id === approval.clientId),
        sourceEntity,
        relatedApprovals: snapshot.approvals.filter((entry) => entry.siteId === resolvedSiteId).slice(0, 8),
      };
      const smartDraft = await draftApprovalSmart(
        sourceEntity,
        approvalType || approval.type,
        projectContext,
        snapshot.device?.settings?.integrations || snapshot.settings?.integrations || {},
      );
      mutate((next, helpers) => {
        const target = next.approvals.find((entry) => entry.id === approvalId);
        if (!target) return;
        const before = { summary: target.summary, reason: target.reason, recommendation: target.recommendation, source: target.aiDraft?.source };
        const isAi = smartDraft.source === "claude" || smartDraft.source === "openai";
        target.aiDraft = {
          ...(target.aiDraft || {}),
          ...smartDraft,
          costImpact: target.costImpact,
          timeImpact: target.timeImpact,
          source: smartDraft.source,
        };
        if (isAi) {
          target.summary = smartDraft.summary || target.summary;
          target.reason = smartDraft.reason || target.reason;
          target.recommendation = smartDraft.recommendation || target.recommendation;
          helpers.appendTimeline(target, {
            type: "ai-draft-updated",
            actor: "SiteForge AI",
            role: "System",
            text: `Draft copy improved by ${smartDraft.source === "openai" ? "ChatGPT" : "Claude"}.`,
          });
        }
        helpers.addAudit({
          action: "approval.ai-draft.update",
          entityType: "approval",
          entityId: target.id,
          before,
          after: { summary: target.summary, reason: target.reason, recommendation: target.recommendation, source: smartDraft.source },
          siteId: target.siteId,
        });
      });
    },
    [mutate],
  );

  const refreshAiInsightCache = useCallback(
    async ({ siteId = null } = {}) => {
      const snapshot = stateRef.current;
      if (!snapshot?.onboarding?.complete || snapshot.org?.mode === "demo") return;
      const integrationSettings = snapshot.device?.settings?.integrations || snapshot.settings?.integrations || {};
      const aiConfig = getStoredAiConfig(integrationSettings);
      if (!aiConfig.apiKey) return;
      const resolvedSiteId = siteId || snapshot.session.siteId || snapshot.sites[0]?.id || null;
      const now = Date.now();
      const cacheFresh = (entry, ttlMs) => {
        const generated = Date.parse(entry?.generatedAt || "");
        return Number.isFinite(generated) && now - generated < ttlMs;
      };

      if (resolvedSiteId) {
        const diary = snapshot.diary.filter((entry) => entry.siteId === resolvedSiteId).slice(0, 12);
        const diaryHash = hashString(diary.map((entry) => `${entry.id}:${entry.updatedAt || entry.createdAt || entry.date}:${entry.summary}`).join("|"));
        const currentWeekly = snapshot.aiCache?.weeklyClientSummary?.[resolvedSiteId];
        if (diary.length && (!currentWeekly || currentWeekly.basedOnDiaryHash !== diaryHash || !cacheFresh(currentWeekly, 86400000))) {
          const result = await askSiteForgeAi({
            userMessage: `Summarise these SiteForge diary entries into a concise client-facing weekly operations summary for an Australian residential build. Mention rain, blockers, evidence, and next actions only where present.\n\n${JSON.stringify(diary)}`,
            projectContext: { orgMode: snapshot.org?.mode, site: snapshot.sites.find((entry) => entry.id === resolvedSiteId), diary },
            provider: aiConfig.provider,
            apiKey: aiConfig.apiKey,
            model: aiConfig.model,
            openaiProxyUrl: aiConfig.openaiProxyUrl,
          });
          if (result.source === "claude" || result.source === "openai") {
            mutate((next) => {
              next.aiCache = next.aiCache || { weeklyClientSummary: {}, boardInsights: {} };
              next.aiCache.weeklyClientSummary = next.aiCache.weeklyClientSummary || {};
              next.aiCache.weeklyClientSummary[resolvedSiteId] = {
                summary: result.text,
                generatedAt: new Date().toISOString(),
                basedOnDiaryHash: diaryHash,
                source: result.source,
              };
            });
          }
        }
      }

      const openApprovals = snapshot.approvals.filter((approval) => !["signed", "declined", "archived"].includes(approval.status));
      const openProblems = snapshot.problems.filter((problem) => !["closed", "resolved"].includes(problem.status));
      const delayedProcurement = snapshot.procurement.filter((item) => ["delayed", "escalated"].includes(item.status));
      const boardHash = hashString([...openApprovals, ...openProblems, ...delayedProcurement].map((entry) => `${entry.id}:${entry.status}:${entry.updatedAt || entry.createdAt || entry.sentAt || ""}`).join("|"));
      const currentBoard = snapshot.aiCache?.boardInsights?.portfolio;
      if ((openApprovals.length || openProblems.length || delayedProcurement.length) && (!currentBoard || currentBoard.basedOnPortfolioHash !== boardHash || !cacheFresh(currentBoard, 21600000))) {
        const result = await askSiteForgeAi({
          userMessage: `Create a Director Boardroom operations insight for SiteForge. Use only operations/compliance/commercial-recovery language, not P&L. Return one sharp paragraph plus 3 recommended actions.\n\n${JSON.stringify({ sites: snapshot.sites, openApprovals, openProblems, delayedProcurement })}`,
          projectContext: { orgMode: snapshot.org?.mode, sites: snapshot.sites, openApprovals, openProblems, delayedProcurement },
          provider: aiConfig.provider,
          apiKey: aiConfig.apiKey,
          model: aiConfig.model,
          openaiProxyUrl: aiConfig.openaiProxyUrl,
        });
        if (result.source === "claude" || result.source === "openai") {
          mutate((next) => {
            next.aiCache = next.aiCache || { weeklyClientSummary: {}, boardInsights: {} };
            next.aiCache.boardInsights = next.aiCache.boardInsights || {};
            next.aiCache.boardInsights.portfolio = {
              summary: result.text,
              generatedAt: new Date().toISOString(),
              basedOnPortfolioHash: boardHash,
              source: result.source,
            };
          });
        }
      }
    },
    [mutate],
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.__siteforgeNow = DEMO_TIME_TRAVEL && state.org?.mode === "demo" && state.demo?.simulatedNow ? state.demo.simulatedNow : nowStamp();
    }
  }, [state.demo?.simulatedNow, state.org?.mode]);

  useEffect(() => {
    if (!DEMO_TIME_TRAVEL || state.org?.mode !== "demo") return;
    mutate((next, helpers) => {
      runTimedAutomationSweep(next, helpers);
    });
  }, [mutate, state.demo?.simulatedNow, state.org?.mode]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      mutate((next, helpers) => {
        const queuedAt = nowStamp();
        const due = (next.reportSchedules || []).filter((schedule) => schedule.enabled && schedule.lastQueuedAt !== queuedAt.slice(0, 10));
        due.forEach((schedule) => {
          next.reportQueue.unshift({
            id: randomId("rq"),
            reportType: schedule.reportType,
            status: "queued",
            queuedAt,
            scheduleId: schedule.id,
            siteId: next.session.siteId,
            recipients: schedule.recipients,
          });
          schedule.lastQueuedAt = queuedAt.slice(0, 10);
        });
        next.reportQueue = (next.reportQueue || []).slice(0, 80);
	        if (due.length) {
	          helpers.addAudit({
	            action: "report.scheduler-queue",
	            entityType: "reportQueue",
	            entityId: next.reportQueue[0]?.id || "reportQueue",
	            before: null,
	            after: { queued: due.length },
	            siteId: next.session.siteId,
	          });
	        }
		        (next.presence.records || []).forEach((record) => {
		          if (record.finish || hoursSince(record.start) < 16 || record.autoCloseNotifiedAt) return;
		          record.autoCloseNotifiedAt = nowStamp();
		          helpers.emit({
	            eventType: "presence.anomaly",
	            title: `Presence record still open - ${record.person || record.worker || record.userId}`,
	            body: "This attendance record has been open for more than 16 hours. Supervisor review is required.",
	            siteId: record.siteId,
	            entityType: "presence",
	            entityId: record.id,
	            recipients: getRecipientsForRoles(next, ["Supervisor", "Project Manager"]),
		            route: { kind: "internal", siteId: record.siteId, page: "presence", entityId: record.id },
		          });
		        });
	        const stalledThresholdMs = 7 * 24 * 60 * 60 * 1000;
	        const directorThresholdMs = 14 * 24 * 60 * 60 * 1000;
	        const nowMs = Date.now();
	        (next.approvals || []).forEach((approval) => {
	          if (approval.status !== "awaiting-client" || !approval.sentAt) return;
	          const sentMs = new Date(approval.sentAt).getTime();
	          if (!Number.isFinite(sentMs)) return;
	          const ageMs = nowMs - sentMs;
	          if (ageMs > directorThresholdMs && !approval._escalatedToDirector) {
	            approval._escalatedToDirector = nowStamp();
	            helpers.emit({
	              eventType: "approval.stalled-director",
	              title: `Director escalation - ${approval.title}`,
	              body: "Client approval has been awaiting response for more than 14 days.",
	              siteId: approval.siteId,
	              entityType: "approval",
	              entityId: approval.id,
	              recipients: getRecipientsForRoles(next, ["Director", "Project Manager"]),
	              route: { kind: "internal", siteId: approval.siteId, page: "clientflow", entityId: approval.id },
	            });
	          } else if (ageMs > stalledThresholdMs && !approval._escalatedToPm) {
	            approval._escalatedToPm = nowStamp();
	            helpers.emit({
	              eventType: "approval.stalled-pm",
	              title: `PM follow-up required - ${approval.title}`,
	              body: "Client approval has been awaiting response for more than 7 days.",
	              siteId: approval.siteId,
	              entityType: "approval",
	              entityId: approval.id,
	              recipients: getRecipientsForRoles(next, ["Project Manager"]),
	              route: { kind: "internal", siteId: approval.siteId, page: "clientflow", entityId: approval.id },
	            });
	          }
	        });
		      });
		    }, 60000);
    return () => window.clearInterval(timer);
  }, [mutate]);

	  useEffect(() => {
		    if (!INCLUDE_DEMO_DATA || !DEMO_TIME_TRAVEL || state.org?.mode !== "demo" || !state.demo?.mode) return undefined;
	    let timer = null;
	    const fireDemoEvent = () => {
	      mutate((next, helpers) => {
	        if (next.org?.mode !== "demo" || !next.demo?.mode) return;
	        if (!next.demo.queuedEvents.length) return;
        const event = next.demo.queuedEvents.shift();
        next.demo.queuedEvents.push(event);
        pushToast(next, {
          tone: event.tone || "medium",
          title: event.title,
          body: event.body,
        });
        helpers.emit({
          eventType: event.type === "approval" ? "approval.question" : event.type === "presence" ? "presence.anomaly" : event.type === "procurement" ? "procurement.delayed" : "problem.created",
          title: event.title,
          body: event.body,
          siteId: next.session.siteId,
          entityType: event.type,
          entityId: randomId("demo"),
          recipients: [{ user: next.users.find((entry) => entry.id === next.session.userId) || next.users[0] }],
          route: next.session.route,
        });
      });
      const nextDelay = 26000 + Math.floor(Math.random() * 28000);
      timer = window.setTimeout(fireDemoEvent, nextDelay);
    };
    timer = window.setTimeout(fireDemoEvent, 26000 + Math.floor(Math.random() * 28000));

    return () => window.clearTimeout(timer);
	  }, [mutate, state.demo?.mode, state.org?.mode]);

	  const actions = useMemo(
		    () => ({
		      navigate,
		      improveApprovalDraft,
		      async switchToMode(targetMode) {
	        if (targetMode !== "demo" && targetMode !== "real") return;
	        if (targetMode === "demo" && !INCLUDE_DEMO_DATA) return;
	        const currentState = stateRef.current;
	        const currentMode = currentState?.org?.mode || getActiveMode();
	        if (currentMode === targetMode) return;
	        await persistence?.flushPendingWrites?.();
	        setActiveMode(targetMode);
	        const stored = readStateSlot(targetMode) || await loadPersistedAppState(getStateStorageKey(targetMode)).catch(() => null);
	        let destinationState = stored
	          ? hydrateModeState(stored, targetMode)
	          : targetMode === "demo"
	            ? createDemoStore()
	            : createRealOnboardingStore();
	        if (targetMode === "demo") {
	          tagAllRecordsAsDemo(destinationState);
	          destinationState.org = { ...(destinationState.org || DEFAULT_ORG), mode: "demo", id: DEFAULT_ORG.id };
	        } else {
	          destinationState.org = {
	            ...(destinationState.org || {}),
	            mode: "real",
	            id: destinationState.org?.id && destinationState.org.id !== DEFAULT_ORG.id ? destinationState.org.id : uuid(),
	          };
	        }
	        const actor = currentState?.users?.find((user) => user.id === currentState?.session?.userId) || currentState?.users?.[0];
	        const auditEntry = createAuditEntry({
	          actor: actor?.name || "User",
	          actorRole: currentState?.session?.role || actor?.role || "Director",
	          action: "mode.switch",
	          entityType: "mode",
	          entityId: targetMode,
	          before: { mode: currentMode || null },
	          after: { mode: targetMode },
	          siteId: destinationState.session?.siteId || null,
	        });
	        auditEntry.orgId = destinationState.org?.id || (targetMode === "demo" ? DEFAULT_ORG.id : uuid());
	        destinationState.auditTrail = [auditEntry, ...(destinationState.auditTrail || [])].slice(0, 600);
	        destinationState = normaliseState(destinationState);
	        writeStateSlot(targetMode, destinationState);
	        setState(destinationState);
	        setTimeout(() => {
	          if (!destinationState.onboarding?.complete) {
	            window.location.hash = "";
	            return;
	          }
	          const role = destinationState.session?.role || "Director";
	          const route = destinationState.session?.route || getDefaultRouteForRole(role, destinationState);
	          const hash = buildHash(route);
	          if (window.location.hash !== hash) window.location.hash = hash;
	        }, 0);
	      },
	      resetCurrentMode() {
	        const mode = stateRef.current?.org?.mode;
	        if (mode !== "demo" && mode !== "real") return;
	        const fresh = mode === "demo" ? createDemoStore() : createRealOnboardingStore();
	        setActiveMode(mode);
	        writeStateSlot(mode, fresh);
	        setState(fresh);
	        window.location.hash = mode === "demo" ? buildHash(fresh.session.route || DEFAULT_ROLE_PAGES.Supervisor) : "";
	      },
	      beginRealOnboarding() {
	        setActiveMode("real");
	        setState((previous) => {
	          const next = cloneState(previous);
	          next.org = { ...(next.org || {}), mode: "real" };
          next.onboarding = { ...(next.onboarding || {}), complete: false, mode: "real", step: "company" };
          next.demo = { ...(next.demo || {}), mode: false, queuedEvents: [], recentToasts: [] };
          return normaliseState(next);
        });
      },
      saveOnboardingCompany(payload = {}) {
        setState((previous) => {
          const next = cloneState(previous);
          const company = {
            name: payload.companyName || payload.name || "",
            abn: payload.abn || "",
            address: payload.addressText || [payload.street, payload.suburb, payload.state, payload.postcode].filter(Boolean).join(", "),
            phone: payload.phone || "",
            email: payload.email || "",
            website: payload.website || "",
            logoDataUrl: payload.logoDataUrl || "",
            defaultContractType: payload.defaultContractType || "HIA",
          };
          next.company = { ...(next.company || {}), ...company };
          next.settings = next.settings || {};
          next.settings.company = { ...(next.settings.company || {}), ...company };
          next.settings.contractDefaults = {
            ...(next.settings.contractDefaults || {}),
            defaultContractType: payload.defaultContractType || "HIA",
            standardVariationTemplate: next.settings.contractDefaults?.standardVariationTemplate || "tpl-hia-var",
          };
          next.org = { ...(next.org || {}), name: company.name, mode: "real", settings: { ...(next.org?.settings || {}), company } };
          next.onboarding = { ...(next.onboarding || {}), mode: "real", step: "profile" };
          return normaliseState(next);
        });
      },
      saveOnboardingTeam({ owner = {}, teammates = [] } = {}) {
        setState((previous) => {
          const next = cloneState(previous);
          const ownerId = owner.id || randomId("u");
          const ownerRecord = {
            id: ownerId,
            name: owner.name || "Owner",
            email: owner.email || "",
            phone: owner.phone || "",
            role: owner.role || "Director",
            trade: owner.trade || "",
            avatar: (owner.name || "Owner").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
            siteIds: [],
            orgId: next.org?.id || DEFAULT_ORG.id,
          };
          const teammateRecords = teammates
            .filter((person) => person.name || person.email)
            .map((person) => ({
              id: person.id || randomId("u"),
              name: person.name || person.email,
              email: person.email || "",
              phone: person.phone || "",
              role: person.role || "Supervisor",
              trade: person.trade || "",
              avatar: (person.name || person.email || "TM").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
              siteIds: [],
              orgId: next.org?.id || DEFAULT_ORG.id,
            }));
          next.users = [ownerRecord, ...teammateRecords];
          next.settings.user = {
            ...(next.settings.user || {}),
            name: ownerRecord.name,
            email: ownerRecord.email,
            phone: ownerRecord.phone,
            defaultRole: ownerRecord.role,
          };
          next.settings.profile = { ...(next.settings.profile || {}), ...next.settings.user };
          next.session.userId = ownerRecord.id;
          next.session.role = ownerRecord.role;
          const routeKind = routeKindForRole(ownerRecord.role);
          if (next.session.route?.kind && next.session.route.kind !== routeKind) {
            next.session.route = { ...next.session.route, kind: routeKind };
          }
          next.onboarding = { ...(next.onboarding || {}), step: "first-project" };
          return normaliseState(next);
        });
      },
      saveOnboardingIntegrations(payload = {}) {
        setState((previous) => {
          const next = cloneState(previous);
          next.settings.integrations = {
            ...(next.settings.integrations || {}),
            aiProvider: payload.aiProvider || next.settings.integrations?.aiProvider || "anthropic",
            aiModel: payload.aiModel || next.settings.integrations?.aiModel || "claude-sonnet-4-20250514",
            anthropicModel: payload.anthropicModel || next.settings.integrations?.anthropicModel || "claude-sonnet-4-20250514",
            openaiModel: payload.openaiModel || next.settings.integrations?.openaiModel || "gpt-4.1",
            anthropicConfigured: Boolean(payload.anthropicConfigured),
            openaiConfigured: Boolean(payload.openaiConfigured),
            openaiProxyConfigured: Boolean(payload.openaiProxyConfigured),
            aiLastTestedAt: payload.aiLastTestedAt || next.settings.integrations?.aiLastTestedAt || null,
            aiLastTestStatus: payload.aiLastTestStatus || next.settings.integrations?.aiLastTestStatus || "untested",
            aiLastTestProvider: payload.aiLastTestProvider || next.settings.integrations?.aiLastTestProvider || null,
            aiLastTestMessage: payload.aiLastTestMessage || next.settings.integrations?.aiLastTestMessage || "",
            buildxactConnected: false,
            buildxactApiKey: payload.buildxactApiKey || "",
            buildxactWorkspaceId: payload.buildxactWorkspaceId || "",
            buildxactSyncMode: "disconnected",
            buildxactLastError: payload.buildxactConnected ? "Credentials saved locally. Real Buildxact API connection requires backend configuration." : null,
            teamsConnected: false,
          };
          next.buildxact.connection = {
            ...(next.buildxact.connection || {}),
            status: payload.buildxactConnected ? "configured" : "disconnected",
            workspaceId: payload.buildxactWorkspaceId || "",
            apiKeyMasked: payload.buildxactApiKey ? `••••${payload.buildxactApiKey.slice(-4)}` : "",
          };
          next.onboarding = { ...(next.onboarding || {}), step: "done" };
          return normaliseState(next);
        });
      },
      finishRealOnboarding() {
        let resolvedRoute = null;
        setState((previous) => {
          const next = cloneState(previous);

          next.org = { ...(next.org || {}), mode: "real", plan: next.org?.plan || "starter" };
          next.onboarding = {
            ...(next.onboarding || {}),
            complete: true,
            mode: "real",
            step: "done",
            completedAt: nowStamp(),
          };
          next.settings.developer = { ...(next.settings.developer || {}), demoDataBanner: false };
          next.demo = { ...(next.demo || {}), mode: false, queuedEvents: [], recentToasts: [] };

          const firstSite = next.sites[0];
          const targetSiteId =
            next.session.siteId && next.sites.some((site) => site.id === next.session.siteId)
              ? next.session.siteId
              : firstSite?.id || null;

          const ownerUser =
            next.users.find((user) => user.id === next.session.userId) ||
            next.users.find((user) => user.role === (next.settings?.user?.defaultRole || "Director")) ||
            next.users[0];

          const role = ownerUser?.role || next.settings?.user?.defaultRole || "Director";

          next.session.userId = ownerUser?.id || null;
          next.session.role = role;
          next.session.siteId = targetSiteId;

          const routeKind = routeKindForRole(role);
          if (routeKind === "director") {
            next.session.route = { kind: "director", page: "boardroom", siteId: targetSiteId, entityId: null };
          } else if (routeKind === "internal") {
            const defaultPage = role === "Contract Admin" ? "contracts" : "dash";
            next.session.route = { kind: "internal", siteId: targetSiteId, page: defaultPage, entityId: null };
          } else {
            next.session.route = getDefaultRouteForRole(role, next);
          }
          resolvedRoute = next.session.route;

          const auditEntry = createAuditEntry({
            actor: ownerUser?.name || "SiteForge User",
            actorRole: role,
            action: "onboarding.complete",
            entityType: "onboarding",
            entityId: "real",
            before: null,
            after: { mode: "real", siteId: targetSiteId, role, userId: ownerUser?.id || null },
            siteId: targetSiteId,
          });
          auditEntry.orgId = next.org?.id || DEFAULT_ORG.id;
          next.auditTrail = [auditEntry, ...(next.auditTrail || [])].slice(0, 600);

          return normaliseState(next);
        });

        setTimeout(() => {
          try {
            const targetState = stateRef.current;
            const committedRoute = targetState?.onboarding?.complete ? targetState?.session?.route : null;
            const hash = buildHash(committedRoute || resolvedRoute || DEFAULT_ROLE_PAGES.Director);
            if (window.location.hash !== hash) {
              window.location.hash = hash;
            }
          } catch (error) {
            console.warn("Failed to navigate after onboarding", error);
          }
        }, 0);
      },
      restartOnboarding() {
        setState((previous) => {
          const next = cloneState(previous);
          next.onboarding = {
            complete: false,
            mode: null,
            step: "welcome",
            completedAt: null,
            completedTours: [],
          };
          return normaliseState(next);
        });
      },
	      importState(importedState) {
	        const mode = importedState?.org?.mode === "demo" ? "demo" : "real";
	        const imported = hydrateModeState(cloneState(importedState), mode);
	        setActiveMode(mode);
	        writeStateSlot(mode, imported);
	        setState(imported);
	        window.location.hash = imported.onboarding?.complete ? buildHash(imported.session?.route || getDefaultRouteForRole(imported.session?.role, imported)) : "";
	      },
      completeOnboarding(mode = "demo") {
        if (mode === "demo") {
          if (!INCLUDE_DEMO_DATA) return;
          const demoState = createDemoStore();
          setState(demoState);
          window.location.hash = buildHash(demoState.session.route || DEFAULT_ROLE_PAGES.Supervisor);
          return;
        }
        mutate((next, helpers) => {
          next.onboarding = {
            ...(next.onboarding || {}),
            complete: true,
            mode,
            completedAt: nowStamp(),
          };
          helpers.addAudit({
            action: "onboarding.complete",
            entityType: "onboarding",
            entityId: mode,
            before: null,
            after: next.onboarding,
            siteId: next.session.siteId,
          });
        });
      },
      markTourComplete(tour) {
        mutate((next) => {
          next.onboarding.completedTours = [...new Set([...(next.onboarding.completedTours || []), tour])];
        });
      },
      submitSupportRequest(payload = {}) {
        mutate((next, helpers) => {
          const request = {
            id: randomId("support"),
            subject: payload.subject || "Support request",
            body: payload.body || "",
            status: "queued",
            createdAt: nowStamp(),
            userId: next.session.userId,
          };
          next.help.supportQueue.unshift(request);
          helpers.addAudit({
            action: "support.request",
            entityType: "support",
            entityId: request.id,
            before: null,
            after: request,
            siteId: next.session.siteId,
          });
          pushToast(next, { tone: "medium", title: "Support request queued", body: "This will send once backend email is connected." });
        });
      },
      setRole(role) {
        setState((previous) => {
          const next = cloneState(previous);
          const defaultRoute = getDefaultRouteForRole(role, next);
          const roleUser = getUserForRole(next, role);
          next.session.role = role;
          next.session.userId = roleUser?.id || null;
          next.session.route = defaultRoute;
          next.session.siteId = defaultRoute.siteId || roleUser?.siteIds?.[0] || next.sites[0]?.id || null;
          return normaliseState(next);
        });
        window.location.hash = buildHash(getDefaultRouteForRole(role, state));
      },
      setSite(siteId) {
        mutate((next) => {
          next.settings = next.settings || {};
          next.settings.activeProjectId = siteId;
        });
        navigate({ kind: "internal", siteId, page: state.session.route.page || "dash", entityId: null });
      },
      createProject(payload) {
        const siteId = randomId("s");
        const clientId = randomId("c");
        const clientName = `${payload.clientFirstName || ""} ${payload.clientLastName || ""}`.trim();
        const companyName = payload.clientCompany || clientName || "New Client";
        const contractValue = Number(payload.contractValue || 0);
        const addressText = payload.siteAddressText || payload.siteAddress || [payload.siteStreet, payload.siteSuburb, payload.siteState, payload.sitePostcode].filter(Boolean).join(", ");

        mutate((next, helpers) => {
          const currentUser = next.users.find((user) => user.id === next.session.userId) || next.users[0] || null;
          const supervisorId = payload.supervisorId || next.users.find((user) => user.role === "Supervisor")?.id || currentUser?.id || null;
          const pmId = payload.pmId || next.users.find((user) => user.role === "Project Manager")?.id || currentUser?.id || null;
          const caId = payload.caId || next.users.find((user) => user.role === "Contract Admin")?.id || null;
          const client = {
            id: clientId,
            name: companyName,
            primaryContact: clientName,
            email: payload.clientEmail,
            phone: payload.clientPhone || "",
            siteId,
            brand: payload.projectName,
            preferredChannel: "Email + Portal",
            notificationPreferences: { email: true, sms: false, teams: false, portal: true },
          };
          const site = {
            id: siteId,
            code: payload.projectName
              .split(/\s+/)
              .map((part) => part[0])
              .join("")
              .slice(0, 3)
              .toUpperCase()
              .padEnd(3, "X"),
            name: payload.projectName,
            clientId,
            superintendentId: supervisorId,
            pmId,
            caId,
            region: payload.region || "Brisbane",
            type: payload.contractType || "HIA",
            address: addressText,
            addressStructured: {
              street: payload.siteStreet || "",
              suburb: payload.siteSuburb || "",
              state: payload.siteState || "",
              postcode: payload.sitePostcode || "",
            },
            status: (payload.status || "Active").toLowerCase().replace(/\s+/g, "-"),
            progress: 0,
            contractValue,
            spent: 0,
            committed: 0,
            forecastMargin: 18,
            marginAtRisk: 0,
            crewToday: 0,
            weather: "Forecast pending",
            nextMilestone: "Project setup",
            estimatedCompletion: payload.expectedCompletionDate || "",
            currentPhase: "Pre-construction",
            risk: "green",
            heroPhotoLabel: `${payload.projectName} site photo`,
            contractType: payload.contractType || "HIA",
            startDate: payload.startDate || formatDate(),
            supervisorName: next.users.find((user) => user.id === supervisorId)?.name || "Unassigned",
            notes: payload.notes || "",
            lotNumber: payload.lotNumber || "",
            planNumber: payload.planNumber || "",
          };

          next.clients.unshift(client);
          next.sites.unshift(site);
          next.users = next.users.map((user) =>
            [supervisorId, pmId, caId].includes(user.id)
              ? { ...user, siteIds: [...new Set([...(user.siteIds || []), siteId])] }
              : user,
          );
          next.siteBudgets.unshift({
            siteId,
            summary: { contractValue, spent: 0, committed: 0, contingencyUsed: 0, forecastMargin: 18 },
            items: [
              { id: randomId("bud"), category: "Preliminaries", budget: Math.round(contractValue * 0.08), spent: 0, committed: 0, forecast: Math.round(contractValue * 0.08) },
              { id: randomId("bud"), category: "Structure", budget: Math.round(contractValue * 0.34), spent: 0, committed: 0, forecast: Math.round(contractValue * 0.34) },
              { id: randomId("bud"), category: "Services", budget: Math.round(contractValue * 0.18), spent: 0, committed: 0, forecast: Math.round(contractValue * 0.18) },
              { id: randomId("bud"), category: "Finishes", budget: Math.round(contractValue * 0.25), spent: 0, committed: 0, forecast: Math.round(contractValue * 0.25) },
              { id: randomId("bud"), category: "Contingency", budget: Math.round(contractValue * 0.05), spent: 0, committed: 0, forecast: Math.round(contractValue * 0.05) },
            ],
          });
          next.schedules.unshift({
            siteId,
            baselineCompletion: payload.expectedCompletionDate || "",
            currentCompletion: payload.expectedCompletionDate || "",
            nextMilestone: "Project setup",
            phases: [
              { id: randomId("sch"), label: "Pre-construction", startDay: 0, duration: 12, progress: 0, color: "#06B6D4" },
              { id: randomId("sch"), label: "Construction", startDay: 12, duration: 58, progress: 0, color: "#F59E0B" },
              { id: randomId("sch"), label: "Handover", startDay: 70, duration: 10, progress: 0, color: "#10B981" },
            ],
            impacts: [],
          });
          next.projectLogs.unshift({
            id: randomId("log"),
            siteId,
            at: nowStamp(),
            title: "Project created",
            body: `${payload.projectName} was created with ${payload.contractType || "HIA"} contract defaults.`,
          });
          next.settings = next.settings || {};
          next.settings.activeProjectId = siteId;
          next.session.siteId = siteId;
          next.session.route = { kind: "internal", siteId, page: "dash", entityId: null };
          if (!next.onboarding?.complete) {
            next.onboarding = { ...(next.onboarding || {}), step: "integrations" };
          }
          helpers.addAudit({
            action: "project.create",
            entityType: "site",
            entityId: siteId,
            before: null,
            after: { name: site.name, clientId, contractValue },
            siteId,
          });
          helpers.emit({
            eventType: "project.created",
            title: `Project created - ${site.name}`,
            body: `${client.primaryContact} now has a SiteForge project workspace.`,
            siteId,
            entityType: "site",
            entityId: siteId,
            recipients: getRecipientsForRoles(next, ["Supervisor", "Project Manager", "Contract Admin"]),
            route: { kind: "internal", siteId, page: "dash", entityId: null },
          });
        });

        window.location.hash = buildHash({ kind: "internal", siteId, page: "dash", entityId: null });
        return siteId;
      },
      updateSettings(section, patch) {
        mutate((next, helpers) => {
          const before = { ...(next.settings?.[section] || {}) };
          next.settings = next.settings || {};
          next.settings[section] = { ...(next.settings[section] || {}), ...patch };
          if (section === "company") {
            next.company = { ...(next.company || APP_CONFIG.builder), ...patch };
            next.org.settings.company = { ...(next.org.settings.company || {}), ...patch };
          }
          if (section === "contractDefaults") {
            next.org.settings.contractDefaults = { ...(next.org.settings.contractDefaults || {}), ...patch };
          }
          if (section === "appearance" || section === "integrations") {
            next.device.settings[section] = { ...(next.device.settings[section] || {}), ...patch };
          }
          if (section === "profile" || section === "notifications") {
            next.user.settings[section] = { ...(next.user.settings[section] || {}), ...patch };
          }
          helpers.addAudit({
            action: `settings.${section}.update`,
            entityType: "settings",
            entityId: section,
            before,
            after: next.settings[section],
            siteId: next.session.siteId,
          });
        });
      },
      setPeriod(period) {
        mutate((next) => {
          next.session.period = period;
        });
      },
      toggleNotifications() {
        mutate((next) => {
          next.ui.notificationsOpen = !next.ui.notificationsOpen;
        });
      },
      openSearch() {
        mutate((next) => {
          next.ui.searchOpen = true;
        });
      },
      openCommandPalette() {
        mutate((next) => {
          next.ui.commandPaletteOpen = true;
          next.ui.searchOpen = true;
        });
      },
      closeSearch() {
        mutate((next) => {
          next.ui.searchOpen = false;
          next.ui.commandPaletteOpen = false;
        });
      },
      toggleAIAssistant() {
        mutate((next) => {
          next.ui.aiAssistantOpen = !next.ui.aiAssistantOpen;
        });
      },
      toggleDemoScriptMode() {
        mutate((next) => {
          next.demo.demoScriptMode = !next.demo.demoScriptMode;
          next.demo.demoScriptStep = 0;
        });
      },
      advanceDemoScript() {
        mutate((next) => {
          next.demo.demoScriptStep += 1;
        });
      },
      dismissBootRoleSelector() {
        mutate((next) => {
          next.ui.bootRoleSelectorOpen = false;
        });
      },
      toggleShortcuts() {
        mutate((next) => {
          next.ui.shortcutsOpen = !next.ui.shortcutsOpen;
        });
      },
      rememberSearch(query) {
        mutate((next) => {
          const deduped = [query, ...next.session.recentSearches.filter((item) => item !== query)].slice(0, 8);
          next.session.recentSearches = deduped;
        });
      },
      markNotificationRead(id) {
        mutate((next) => {
          const notification = next.notifications.items.find((item) => item.id === id);
          if (notification) {
            notification.readAt = notification.readAt || nowStamp();
          }
        });
      },
      markAllNotificationsRead() {
        mutate((next) => {
          next.notifications.items.forEach((item) => {
            item.readAt = item.readAt || nowStamp();
          });
        });
      },
      clearOldNotifications() {
        mutate((next) => {
          next.notifications.items = next.notifications.items.slice(0, 180);
          next.notifications.eventLog = next.notifications.eventLog.slice(0, 240);
        });
      },
      pushNotification({ eventType = "system.notice", title, body, priority = "medium", route = null }) {
        mutate((next) => {
          const now = nowStamp();
          const recipientId = next.session.userId || next.users[0]?.id || null;
          const item = {
            id: randomId("ntf"),
            eventType,
            channel: "in-app",
            recipientId,
            recipientRole: next.session.role || next.users[0]?.role || "Director",
            siteId: next.session.siteId || null,
            entityType: "system",
            entityId: eventType,
            title,
            body,
            severity: priority,
            readAt: null,
            createdAt: now,
            group: "System",
            route: route || { kind: routeKindForRole(next.session.role || "Director"), siteId: next.session.siteId, page: "admin", entityId: null },
          };
          const duplicate = next.notifications.items.some((entry) => entry.eventType === item.eventType && !entry.readAt && entry.title === item.title);
          if (duplicate) return;
          next.notifications.items.unshift(item);
          next.notifications.items = next.notifications.items.slice(0, 180);
          if (["high", "critical"].includes(priority)) {
            pushToast(next, { eventType, tone: priority === "critical" ? "critical" : "high", title, body });
          }
        });
      },
      saveTableViewState(tableKey, payload) {
        mutate((next) => {
          next.tableViews.state[tableKey] = {
            ...(next.tableViews.state[tableKey] || {}),
            ...payload,
            updatedAt: nowStamp(),
          };
        });
      },
      createNamedTableView(tableKey, name, payload) {
        mutate((next) => {
          next.tableViews.saved[tableKey] = next.tableViews.saved[tableKey] || [];
          next.tableViews.saved[tableKey].unshift({
            id: randomId("tv"),
            name,
            ...payload,
            updatedAt: nowStamp(),
          });
        });
      },
      deleteNamedTableView(tableKey, viewId) {
        mutate((next) => {
          next.tableViews.saved[tableKey] = (next.tableViews.saved[tableKey] || []).filter((view) => view.id !== viewId);
        });
      },
	      setDemoMode(enabled) {
	        mutate((next) => {
	          if (!INCLUDE_DEMO_DATA || next.org?.mode !== "demo") return;
	          next.demo.mode = enabled;
          next.demo.userControlled = true;
          if (enabled && (!Array.isArray(next.demo.queuedEvents) || !next.demo.queuedEvents.length)) {
            next.demo.queuedEvents = createInitialData().demo.queuedEvents;
          }
          if (!enabled) {
            next.demo.recentToasts = [];
          }
        });
      },
	      advanceSimulatedTime(days = 1) {
	        mutate((next, helpers) => {
	          if (!INCLUDE_DEMO_DATA || !DEMO_TIME_TRAVEL || next.org?.mode !== "demo") return;
	          next.demo.simulatedNow = `${addDays(next.demo.simulatedNow.slice(0, 10), days)} ${next.demo.simulatedNow.slice(11) || "09:15"}`;
          helpers.projectLog(next.session.siteId, "Simulated time advanced", `Demo clock moved forward by ${days} day${days === 1 ? "" : "s"}.`);
        });
      },
      addTask(payload) {
        mutate((next, helpers) => {
          const task = {
            id: randomId("tsk"),
            siteId: payload.siteId || next.session.siteId,
            title: payload.title,
            description: payload.description || payload.title,
            trade: payload.trade || "General",
            companyId: payload.companyId || getCurrentUser(next).companyId,
            assigneeId: payload.assigneeId || next.session.userId,
            priority: payload.priority || "medium",
            status: "todo",
            dueDate: payload.dueDate || formatDate(),
            progress: 0,
            crewRequired: payload.crewRequired || 1,
            mobileMaterials: payload.mobileMaterials || [],
            linkedRecords: payload.linkedRecords || [],
            clientVisible: Boolean(payload.clientVisible),
          };
          next.tasks.unshift(task);
          helpers.addAudit({
            action: "task.create",
            entityType: "task",
            entityId: task.id,
            before: null,
            after: { status: task.status, title: task.title },
            siteId: task.siteId,
          });
        });
      },
      updateTaskStatus(taskId, status) {
        mutate((next, helpers) => {
          const task = next.tasks.find((item) => item.id === taskId);
          if (!task) return;
          const before = { status: task.status, progress: task.progress };
          task.status = status;
          task.progress = status === "done" ? 100 : status === "in-progress" ? Math.max(25, task.progress || 0) : 0;
          helpers.addAudit({
            action: "task.status",
            entityType: "task",
            entityId: task.id,
            before,
            after: { status: task.status, progress: task.progress },
            siteId: task.siteId,
          });
	          if (status === "done") {
	            helpers.projectLog(task.siteId, `Task completed - ${task.title}`, `${actorName(helpers.actor)} marked the task complete.`);
	            const linkedQa = (task.linkedRecords || [])
	              .filter((record) => record.type === "qa")
	              .map((record) => next.qa.find((entry) => entry.id === record.id))
	              .filter(Boolean);
	            linkedQa.forEach((entry) => {
	              entry.reinspectionRequired = true;
	              entry.reinspectionPromptedAt = nowStamp();
	              entry.history = [
	                ...(entry.history || []),
	                { at: nowStamp(), action: "rework-complete", taskId: task.id, by: actorName(helpers.actor) },
	              ];
	              helpers.emit({
	                eventType: "qa.reinspection-required",
	                title: `Re-inspection required - ${entry.title}`,
	                body: `Rework task "${task.title}" is complete. Re-inspect the defect before closing QA.`,
	                siteId: entry.siteId,
	                entityType: "qa",
	                entityId: entry.id,
	                recipients: getRecipientsForRoles(next, ["Supervisor", "Project Manager"]),
	                route: { kind: "internal", siteId: entry.siteId, page: "qa", entityId: entry.id },
	              });
	            });
	          }
	        });
	      },
      addProblem(payload) {
        mutate((next, helpers) => {
          const problem = {
            id: randomId("prob"),
            siteId: payload.siteId || next.session.siteId,
            title: payload.title,
            category: payload.category || "Field issue",
            reportedBy: payload.reportedBy || next.session.userId,
            priority: payload.priority || "medium",
            status: "open",
            costImpact: Number(payload.costImpact || 0),
            timeImpact: Number(payload.timeImpact || 0),
            linkedApprovals: [],
            linkedRecords: payload.linkedRecords || [],
            photos: payload.photos || [],
            thread: [
              {
                id: randomId("pr-msg"),
                by: actorName(helpers.actor),
                role: helpers.actor.role,
                at: nowStamp(),
                body: payload.description || payload.title,
              },
            ],
          };
          next.problems.unshift(problem);
          helpers.addAudit({
            action: "problem.create",
            entityType: "problem",
            entityId: problem.id,
            before: null,
            after: { status: problem.status, priority: problem.priority },
            siteId: problem.siteId,
          });
          helpers.emit({
            eventType: problem.priority === "critical" ? "problem.critical" : "problem.created",
            title: problem.priority === "critical" ? `Critical site problem - ${problem.title}` : `Problem reported - ${problem.title}`,
            body: payload.description || problem.title,
            siteId: problem.siteId,
            entityType: "problem",
            entityId: problem.id,
            recipients:
              problem.priority === "critical"
                ? [...getRecipientsForRoles(next, ["Project Manager", "Director"]), ...getRecipientsForRoles(next, ["Supervisor"])]
                : [...getRecipientsForRoles(next, ["Supervisor"]), ...getRecipientsForRoles(next, ["Project Manager"])],
            route: { kind: "internal", siteId: problem.siteId, page: "probs", entityId: problem.id },
          });
        });
      },
      replyProblem(problemId, message) {
        mutate((next, helpers) => {
          const problem = next.problems.find((item) => item.id === problemId);
          if (!problem || !message.trim()) return;
          problem.thread.push({
            id: randomId("pr-msg"),
            by: actorName(helpers.actor),
            role: helpers.actor.role,
            at: nowStamp(),
            body: message,
          });
          helpers.addAudit({
            action: "problem.comment",
            entityType: "problem",
            entityId: problem.id,
            before: null,
            after: { comment: message },
            siteId: problem.siteId,
          });
        });
      },
	      createApprovalFromSource({ sourceType, sourceId, approvalType, handUp = false, manualOverride = null }) {
	        let aiUpgrade = null;
	        mutate((next, helpers) => {
	          const manualSource =
	            sourceType === "manual"
	              ? {
	                  id: sourceId || randomId("manual"),
	                  siteId: manualOverride?.siteId || next.session.siteId,
	                  clientId: manualOverride?.clientId,
	                  title: manualOverride?.title || "Manual variation",
	                  description: manualOverride?.description || manualOverride?.title || "",
	                  reason: manualOverride?.reason || manualOverride?.description || "Manual variation raised from the register.",
	                  priority: manualOverride?.priority || "medium",
	                  trade: manualOverride?.trade || helpers.actor.trade || "General",
	                  costImpact: Number(manualOverride?.costImpact ?? manualOverride?.value ?? 0),
	                  timeImpact: Number(manualOverride?.timeImpact ?? manualOverride?.days ?? 0),
	                  value: Number(manualOverride?.value ?? manualOverride?.costImpact ?? 0),
	                  days: Number(manualOverride?.days ?? manualOverride?.timeImpact ?? 0),
	                  templateId: manualOverride?.templateId || next.settings?.contractDefaults?.standardVariationTemplate || null,
	                  photos: manualOverride?.photos || [],
	                  linkedRecords: [],
	                }
	              : null;
	          const source = manualSource || findInCollection(next, sourceType, sourceId);
	          if (!source) return;
	          const siteId = source.siteId || next.session.siteId;
	          const site = next.sites.find((item) => item.id === siteId);
	          if (!site) return;
	          const client = next.clients.find((item) => item.id === (source.clientId || site.clientId));
	          if (!client) return;
	          const aiDraft = draftApproval(source, approvalType);
	          const portalToken = uuid();
	          const approval = {
            id: randomId("ap"),
            number: nextScopedNumber(next, "approvals", siteId, "CF"),
            siteId,
            clientId: client.id,
            type: approvalType,
	            title: manualOverride?.title || buildApprovalTitle(source, approvalType),
	            summary: aiDraft.summary,
	            reason: aiDraft.reason,
	            recommendation: aiDraft.recommendation,
	            status: handUp || manualOverride?.submitForReview ? "awaiting-pm" : "draft",
	            priority: source.priority || "medium",
	            sourceType,
	            sourceId: sourceType === "manual" ? null : sourceId,
	            createdBy: helpers.actor.id,
	            ownerId: site.pmId || "u_pm_1",
            sentAt: null,
            dueAt: addDays(formatDate(), 3),
            viewedAt: null,
            costImpact: aiDraft.costImpact,
            timeImpact: aiDraft.timeImpact,
            linkedRecords: [...(source.linkedRecords || []), buildLink(sourceType, source, siteId)],
	            attachments: buildSourceAttachments(source),
	            aiDraft,
	            timeline: [],
	            messageThread: [],
	            contractPackId: null,
	            portalToken,
	            portalUrl: buildPortalUrl(portalToken),
	            templateId: source.templateId || null,
	          };
	          helpers.appendTimeline(approval, {
	            type: approval.status === "awaiting-pm" ? "awaiting-pm" : "created",
	            actor: actorName(helpers.actor),
	            role: helpers.actor.role,
	            text:
	              approval.status === "awaiting-pm"
	                ? `${helpers.actor.role} submitted approval from ${sourceType} for PM review.`
	                : `${helpers.actor.role} created approval from ${sourceType}.`,
	          });
	          if (approval.status === "awaiting-pm") {
	            approval.internalReview = {
	              submittedAt: nowStamp(),
	              submittedBy: helpers.actor.id,
	              pm: null,
	              ca: null,
	            };
	          }
	          next.approvals.unshift(approval);
	          if (sourceType !== "manual" && source.linkedApprovals) {
	            source.linkedApprovals.push(approval.id);
	          }
	          if (sourceType === "procurement") {
	            source.linkedApprovalId = approval.id;
	          }
	          if (sourceType !== "manual") {
	            upsertLinkedRecord(source, buildLink("approval", approval, siteId));
	          }
	          const variation = helpers.ensureVariation(approval);
	          if (variation) {
	            variation.trade = source.trade || variation.trade;
	            variation.templateId = source.templateId || variation.templateId;
	            variation.photos = source.photos || variation.photos || [];
	            if (sourceType !== "manual") {
	              upsertLinkedRecord(source, buildLink("variation", variation, siteId));
	            }
	          }
	          helpers.addAudit({
            action: "approval.create",
            entityType: "approval",
            entityId: approval.id,
            before: null,
	            after: { status: approval.status, type: approval.type },
	            siteId,
	          });
	          if (approval.status === "awaiting-pm") {
	            helpers.emit({
	              eventType: "approval.internal-review",
	              title: `PM review required - ${approval.number || approval.id}`,
	              body: approval.title,
	              siteId,
	              entityType: "approval",
	              entityId: approval.id,
	              recipients: getRecipientsForRoles(next, ["Project Manager", "Director"]),
	              route: { kind: "internal", siteId, page: "clientflow", entityId: approval.id },
	            });
	          }
	          aiUpgrade = { approvalId: approval.id, sourceEntity: { ...source }, approvalType, siteId };
	        });
	        if (aiUpgrade) improveApprovalDraft(aiUpgrade);
      },
      createApprovalFromBlank({ approvalType = "Variation", clientId, title, description, reason, costImpact = 0, timeImpactDays = 0, templateId = null }) {
        let targetRoute = null;
        let aiUpgrade = null;
        mutate((next, helpers) => {
          const siteId = next.session.siteId;
          const site = next.sites.find((item) => item.id === siteId) || next.sites[0];
          const client = next.clients.find((item) => item.id === clientId) || next.clients.find((item) => item.id === site?.clientId) || next.clients[0];
          if (!site || !client) return;
          const numericCost = Number(costImpact || 0);
          const numericDays = Number(timeImpactDays || 0);
          const portalToken = uuid();
          const approval = {
            id: randomId("ap"),
            number: nextScopedNumber(next, "approvals", site.id, "CF"),
            siteId: site.id,
            clientId: client.id,
            type: approvalType,
            title: title || `${approvalType} approval`,
            summary: description || "",
            reason: reason || "",
            recommendation: "Recommended for issue to client for review and signature.",
            status: "draft",
            priority: "medium",
            sourceType: "manual",
            sourceId: null,
            createdBy: helpers.actor.id,
            ownerId: site.pmId || helpers.actor.id,
            sentAt: null,
            dueAt: addDays(formatDate(), 3),
            viewedAt: null,
            costImpact: numericCost,
            timeImpact: numericDays,
            templateId,
            linkedRecords: [],
            attachments: [],
            aiDraft: {
              summary: description || "",
              reason: reason || "",
              recommendation: "Recommended for issue to client for review and signature.",
              costImpact: numericCost,
              timeImpact: numericDays,
              source: "local-template",
              upgradeStartedAt: nowStamp(),
            },
            timeline: [],
            messageThread: [],
            contractPackId: null,
            portalToken,
            portalUrl: buildPortalUrl(portalToken),
          };
          helpers.appendTimeline(approval, {
            type: "created",
            actor: actorName(helpers.actor),
            role: helpers.actor.role,
            text: `${helpers.actor.role} created a fresh approval draft.`,
          });
          next.approvals.unshift(approval);
          const variation = helpers.ensureVariation(approval);
          if (variation) {
            upsertLinkedRecord(variation, buildLink("approval", approval, site.id));
            upsertLinkedRecord(approval, buildLink("variation", variation, site.id));
          }
          helpers.addAudit({
            action: "approval.create.blank",
            entityType: "approval",
            entityId: approval.id,
            before: null,
            after: { status: approval.status, type: approval.type, costImpact: approval.costImpact },
            siteId: site.id,
          });
          helpers.emit({
            eventType: "approval.created",
            title: `Approval draft created - ${approval.number}`,
            body: approval.title,
            siteId: site.id,
            entityType: "approval",
            entityId: approval.id,
            recipients: getRecipientsForRoles(next, ["Project Manager", "Contract Admin"]),
            route: { kind: "internal", siteId: site.id, page: "clientflow", entityId: approval.id },
          });
          targetRoute = { kind: "internal", siteId: site.id, page: "clientflow", entityId: approval.id };
          aiUpgrade = {
            approvalId: approval.id,
            sourceEntity: { title, description, reason, costImpact: numericCost, timeImpact: numericDays, siteId: site.id },
            approvalType,
            siteId: site.id,
          };
        });
        if (aiUpgrade) improveApprovalDraft(aiUpgrade);
        setTimeout(() => {
          if (targetRoute) navigate(targetRoute);
        }, 0);
      },
      detectRecoveryOpportunities(siteId = null) {
        mutate((next, helpers) => {
          const targetSiteId = siteId || next.session.siteId;
          const candidates = buildRecoveryCandidates(next, targetSiteId);
          const existingKeys = new Set(next.recoveryOpportunities.filter((item) => item.status !== "dismissed").map((item) => item.key));
          const newItems = candidates.filter((candidate) => !existingKeys.has(candidate.key));
          next.recoveryOpportunities = [...newItems, ...next.recoveryOpportunities].slice(0, 180);
          helpers.addAudit({
            action: "recovery.detect",
            entityType: "recoveryOpportunity",
            entityId: targetSiteId,
            before: null,
            after: { detected: candidates.length, added: newItems.length },
            siteId: targetSiteId,
          });
          pushToast(next, {
            tone: newItems.length ? "warning" : "passed",
            title: newItems.length ? "Recovery opportunities found" : "Recovery sweep clear",
            body: newItems.length ? `${newItems.length} field events can be converted to commercial recovery.` : "No unlinked recoverable events were found for this site.",
          });
        });
      },
      raiseRecoveryApproval({ opportunityId = null, sourceType, sourceId, approvalType, title, summary, reason, costImpact, timeImpact, templateId } = {}) {
        let targetRoute = null;
        let aiUpgrade = null;
        mutate((next, helpers) => {
          const opportunity = opportunityId ? next.recoveryOpportunities.find((item) => item.id === opportunityId) : null;
          const resolvedSourceType = sourceType || opportunity?.sourceType;
          const resolvedApprovalType = approvalType || opportunity?.approvalType || "Variation";
          const resolvedSourceId = sourceId || opportunity?.sourceId;
          let source = findInCollection(next, resolvedSourceType, resolvedSourceId);
          if (!source && resolvedSourceType === "weather") {
            source = (next.weatherForecasts?.[opportunity?.siteId || next.session.siteId] || [])
              .map((forecast) => ({ ...forecast, id: `weather-${opportunity?.siteId || next.session.siteId}-${forecast.date}`, siteId: opportunity?.siteId || next.session.siteId, title: `${forecast.label} forecast ${forecast.date}` }))
              .find((forecast) => forecast.id === resolvedSourceId);
          }
          if (!source) return;
          const approval = createRecoveryApprovalRecord(next, helpers, {
            sourceType: resolvedSourceType,
            source,
            approvalType: resolvedApprovalType,
            title: title || opportunity?.title,
            summary: summary || opportunity?.summary,
            reason: reason || opportunity?.reason,
            costImpact: costImpact ?? opportunity?.costImpact,
            timeImpact: timeImpact ?? opportunity?.timeImpact,
            templateId: templateId || opportunity?.templateId || null,
            opportunityId: opportunity?.id || opportunityId,
          });
          if (!approval) return;
          aiUpgrade = { approvalId: approval.id, sourceEntity: { ...source }, approvalType: approval.type, siteId: approval.siteId };
          targetRoute = { kind: "internal", siteId: approval.siteId, page: "clientflow", entityId: approval.id };
        });
        if (aiUpgrade) improveApprovalDraft(aiUpgrade);
        setTimeout(() => {
          if (targetRoute) navigate(targetRoute);
        }, 0);
      },
      dismissRecoveryOpportunity(opportunityId, reason = "Dismissed after commercial review.") {
        mutate((next, helpers) => {
          const opportunity = next.recoveryOpportunities.find((item) => item.id === opportunityId);
          if (!opportunity) return;
          const before = { status: opportunity.status };
          opportunity.status = "dismissed";
          opportunity.dismissedAt = nowStamp();
          opportunity.dismissedBy = next.session.userId;
          opportunity.dismissalReason = reason;
          helpers.addAudit({
            action: "recovery.dismiss",
            entityType: "recoveryOpportunity",
            entityId: opportunity.id,
            before,
            after: { status: opportunity.status, reason },
            siteId: opportunity.siteId,
          });
        });
      },
      updateApprovalDraft(approvalId, patch) {
        mutate((next, helpers) => {
          const approval = next.approvals.find((item) => item.id === approvalId);
          if (!approval) return;
          const before = { title: approval.title, status: approval.status, costImpact: approval.costImpact, timeImpact: approval.timeImpact };
          Object.assign(approval, patch);
          helpers.addAudit({
            action: "approval.update",
            entityType: "approval",
            entityId: approval.id,
            before,
            after: { title: approval.title, status: approval.status, costImpact: approval.costImpact, timeImpact: approval.timeImpact },
            siteId: approval.siteId,
          });
        });
      },
      submitApprovalForInternalReview(approvalId) {
        mutate((next, helpers) => {
          const approval = next.approvals.find((item) => item.id === approvalId);
          if (!approval || approval.status !== "draft") return;
          const before = { status: approval.status };
          approval.status = "awaiting-pm";
          approval.internalReview = {
            ...(approval.internalReview || {}),
            submittedAt: nowStamp(),
            submittedBy: helpers.actor.id,
            pm: approval.internalReview?.pm || null,
            ca: approval.internalReview?.ca || null,
          };
          helpers.appendTimeline(approval, {
            type: "awaiting-pm",
            actor: actorName(helpers.actor),
            role: helpers.actor.role,
            text: "Submitted for internal PM review before client issue.",
          });
          appendApprovalComplianceEvent(approval, {
            event: "approval.internal-review-submitted",
            actor: actorName(helpers.actor),
            role: helpers.actor.role,
            payload: { status: approval.status },
          });
          helpers.addAudit({
            action: "approval.submit-internal-review",
            entityType: "approval",
            entityId: approval.id,
            before,
            after: { status: approval.status },
            siteId: approval.siteId,
          });
          helpers.emit({
            eventType: "approval.internal-review",
            title: `PM review required - ${approval.number || approval.id}`,
            body: approval.title,
            siteId: approval.siteId,
            entityType: "approval",
            entityId: approval.id,
            recipients: getRecipientsForRoles(next, ["Project Manager", "Director"]),
            route: { kind: "internal", siteId: approval.siteId, page: "clientflow", entityId: approval.id },
          });
        });
      },
      pmReviewApproval(approvalId, decision, note = "") {
        mutate((next, helpers) => {
          const approval = next.approvals.find((item) => item.id === approvalId);
          if (!approval || approval.status !== "awaiting-pm") return;
          if (!requireRole(helpers.actor.role, "clientflow.review_pm")) return;
          const before = { status: approval.status };
          approval.internalReview = {
            ...(approval.internalReview || {}),
            pm: { decision, note, reviewerId: helpers.actor.id, reviewerName: actorName(helpers.actor), reviewedAt: nowStamp() },
          };
          if (decision === "approve") {
            approval.status = "awaiting-ca";
            helpers.appendTimeline(approval, {
              type: "awaiting-ca",
              actor: actorName(helpers.actor),
              role: helpers.actor.role,
              text: note || "PM approved for Contract Admin review.",
            });
            helpers.emit({
              eventType: "approval.internal-review",
              title: `CA review required - ${approval.number || approval.id}`,
              body: approval.title,
              siteId: approval.siteId,
              entityType: "approval",
              entityId: approval.id,
              recipients: getRecipientsForRoles(next, ["Contract Admin", "Director"]),
              route: { kind: "internal", siteId: approval.siteId, page: "clientflow", entityId: approval.id },
            });
          } else {
            approval.status = "internal-rejected";
            helpers.appendTimeline(approval, {
              type: "internal-rejected",
              actor: actorName(helpers.actor),
              role: helpers.actor.role,
              text: note || "PM rejected the approval for revision.",
            });
          }
          appendApprovalComplianceEvent(approval, {
            event: `approval.pm-${decision === "approve" ? "approved" : "rejected"}`,
            actor: actorName(helpers.actor),
            role: helpers.actor.role,
            payload: { note, status: approval.status },
          });
          helpers.addAudit({
            action: `approval.pm-${decision === "approve" ? "approve" : "reject"}`,
            entityType: "approval",
            entityId: approval.id,
            before,
            after: { status: approval.status, note },
            siteId: approval.siteId,
          });
        });
      },
      caReviewApproval(approvalId, decision, note = "") {
        mutate((next, helpers) => {
          const approval = next.approvals.find((item) => item.id === approvalId);
          if (!approval || approval.status !== "awaiting-ca") return;
          if (!requireRole(helpers.actor.role, "clientflow.review_ca")) return;
          const before = { status: approval.status };
          approval.internalReview = {
            ...(approval.internalReview || {}),
            ca: { decision, note, reviewerId: helpers.actor.id, reviewerName: actorName(helpers.actor), reviewedAt: nowStamp() },
          };
          if (decision === "approve") {
            helpers.appendTimeline(approval, {
              type: "ca-approved",
              actor: actorName(helpers.actor),
              role: helpers.actor.role,
              text: note || "Contract Admin approved. Approval released to client.",
            });
            appendApprovalComplianceEvent(approval, {
              event: "approval.ca-approved",
              actor: actorName(helpers.actor),
              role: helpers.actor.role,
              payload: { note },
            });
            issueApprovalToClient(next, helpers, approval, { timelineText: "Contract Admin approved and issued this approval to the client portal." });
          } else {
            approval.status = "internal-rejected";
            helpers.appendTimeline(approval, {
              type: "internal-rejected",
              actor: actorName(helpers.actor),
              role: helpers.actor.role,
              text: note || "Contract Admin rejected the approval for revision.",
            });
            appendApprovalComplianceEvent(approval, {
              event: "approval.ca-rejected",
              actor: actorName(helpers.actor),
              role: helpers.actor.role,
              payload: { note, status: approval.status },
            });
          }
          helpers.addAudit({
            action: `approval.ca-${decision === "approve" ? "approve" : "reject"}`,
            entityType: "approval",
            entityId: approval.id,
            before,
            after: { status: approval.status, note },
            siteId: approval.siteId,
          });
        });
      },
      directorOverrideApprovalReview(approvalId, note = "Solo Director override: PM and Contract Admin gates recorded and skipped under Director authority.") {
        mutate((next, helpers) => {
          const approval = next.approvals.find((item) => item.id === approvalId);
          if (!approval || !["draft", "awaiting-pm", "awaiting-ca", "internal-rejected"].includes(approval.status)) return;
          if (!requireRole(helpers.actor.role, "clientflow.review_pm") || !requireRole(helpers.actor.role, "clientflow.review_ca")) return;
          const before = { status: approval.status };
          approval.internalReview = {
            ...(approval.internalReview || {}),
            directorOverride: { note, reviewerId: helpers.actor.id, reviewerName: actorName(helpers.actor), reviewedAt: nowStamp() },
            pm: approval.internalReview?.pm || { decision: "override", note, reviewerId: helpers.actor.id, reviewerName: actorName(helpers.actor), reviewedAt: nowStamp() },
            ca: approval.internalReview?.ca || { decision: "override", note, reviewerId: helpers.actor.id, reviewerName: actorName(helpers.actor), reviewedAt: nowStamp() },
          };
          helpers.appendTimeline(approval, {
            type: "director-override",
            actor: actorName(helpers.actor),
            role: helpers.actor.role,
            text: note,
          });
          appendApprovalComplianceEvent(approval, {
            event: "approval.director-override",
            actor: actorName(helpers.actor),
            role: helpers.actor.role,
            payload: { note, skippedGates: ["pm", "ca"] },
          });
          issueApprovalToClient(next, helpers, approval, { timelineText: "Director override recorded and approval issued to the client portal." });
          helpers.addAudit({
            action: "approval.director-override",
            entityType: "approval",
            entityId: approval.id,
            before,
            after: { status: approval.status, note },
            siteId: approval.siteId,
          });
        });
      },
      sendApproval(approvalId) {
        mutate((next, helpers) => {
          const approval = next.approvals.find((item) => item.id === approvalId);
          if (!approval) return;
          issueApprovalToClient(next, helpers, approval);
        });
      },
      bulkIssueApprovals(approvalIds = []) {
        mutate((next, helpers) => {
          const ids = new Set(approvalIds);
          const candidates = next.approvals.filter((approval) => ids.has(approval.id) && ["draft", "changes-requested", "question"].includes(approval.status));
          if (!candidates.length) return;
          const bulkId = randomId("bulk");
          candidates.forEach((approval) => {
            const before = prepareApprovalForClientIssue(next, approval, helpers.actor, { bulkId });
            queueExternalDeliveryForApproval(next, approval);
            if (approval.recoveryChain) {
              approval.recoveryChain.sentAt = approval.sentAt || nowStamp();
            }
            helpers.appendTimeline(approval, {
              type: "bulk-sent",
              actor: actorName(helpers.actor),
              role: helpers.actor.role,
              text: `Issued as part of bulk run ${bulkId}.`,
            });
            helpers.addAudit({
              action: "approval.bulk-send",
              entityType: "approval",
              entityId: approval.id,
              before,
              after: { status: approval.status, bulkId },
              siteId: approval.siteId,
            });
          });
          helpers.emit({
            eventType: "approval.created",
            title: `${candidates.length} approvals bulk issued`,
            body: `Bulk issue ${bulkId} queued delivery across ClientFlow channels.`,
            siteId: next.session.siteId,
            entityType: "bulkIssue",
            entityId: bulkId,
            recipients: getRecipientsForRoles(next, ["Project Manager", "Contract Admin"]),
            route: { kind: "internal", siteId: next.session.siteId, page: "clientflow", entityId: candidates[0].id },
          });
        });
      },
      createApprovalBundle(approvalIds = []) {
        mutate((next, helpers) => {
          const approvals = next.approvals.filter((approval) => approvalIds.includes(approval.id));
          if (approvals.length < 2) return;
          const siteId = approvals[0].siteId;
          const clientId = approvals[0].clientId;
          const bundle = {
            id: randomId("bundle"),
            number: nextScopedNumber(next, "approvalBundles", siteId, "BND"),
            siteId,
            clientId,
            title: `${approvals.length} linked ClientFlow approvals`,
            approvalIds: approvals.map((approval) => approval.id),
            status: "draft",
            portalToken: uuid(),
            portalUrl: buildPortalUrl(approvals[0].portalToken || approvals[0].id),
            createdAt: nowStamp(),
            createdBy: helpers.actor.id,
          };
          next.approvalBundles.unshift(bundle);
          approvals.forEach((approval) => {
            approval.bundleId = bundle.id;
            appendApprovalComplianceEvent(approval, {
              event: "approval.bundled",
              actor: actorName(helpers.actor),
              role: helpers.actor.role,
              payload: { bundleId: bundle.id, bundleNumber: bundle.number },
            });
          });
          helpers.addAudit({
            action: "approval.bundle-create",
            entityType: "approvalBundle",
            entityId: bundle.id,
            before: null,
            after: { approvalIds: bundle.approvalIds },
            siteId,
          });
        });
      },
      verifyApprovalComplianceTrail(approvalId) {
        mutate((next) => {
          const approval = next.approvals.find((item) => item.id === approvalId);
          if (!approval) return;
          approval.complianceVerification = {
            ...verifyApprovalComplianceEvents(approval),
            verifiedAt: nowStamp(),
          };
          pushToast(next, {
            tone: approval.complianceVerification.status === "verified" ? "success" : "critical",
            title: approval.complianceVerification.status === "verified" ? "Compliance trail verified" : "Compliance trail warning",
            body: approval.complianceVerification.summary,
          });
        });
      },
      viewApproval(approvalId) {
        mutate((next, helpers) => {
          const approval = next.approvals.find((item) => item.id === approvalId);
          if (!approval) return;
          const evidence = getBrowserEvidence();
          approval.portalAccessLog = approval.portalAccessLog || [];
          approval.portalAccessLog.push({
            id: randomId("access"),
            at: nowStamp(),
            actor: "Client portal",
            ...evidence,
          });
          approval.portalAccessLog = approval.portalAccessLog.slice(-40);
          appendApprovalComplianceEvent(approval, {
            event: "approval.viewed",
            actor: "Client portal",
            role: "Client",
            evidence,
            payload: { viewCount: approval.portalAccessLog.length },
          });
          if (!approval.viewedAt) {
            approval.viewedAt = nowStamp();
            helpers.emit({
              eventType: "approval.viewed",
              title: `Approval viewed - ${approval.title}`,
              body: "The client opened the approval detail page.",
              siteId: approval.siteId,
              entityType: "approval",
              entityId: approval.id,
              recipients: getRecipientsForRoles(next, ["Project Manager"]),
              route: { kind: "internal", siteId: approval.siteId, page: "clientflow", entityId: approval.id },
            });
          }
        });
      },
      respondToApproval(approvalId, actionType, note, userName) {
        mutate((next, helpers) => {
          const approval = next.approvals.find((item) => item.id === approvalId);
          if (!approval) return;
          const clientUser = next.users.find((user) => user.clientId === approval.clientId) || helpers.actor;
          const actor = userName ? { ...clientUser, name: userName, role: clientUser.role || "Client" } : clientUser;
          const before = { status: approval.status };

          if (actionType === "approve") {
            approval.status = "approved";
            approval.messageThread.push({
              id: randomId("apm"),
              by: actor.name,
              role: "Client",
              at: nowStamp(),
              body: note || "Approved. Please proceed.",
            });
            helpers.appendTimeline(approval, {
              type: "approved",
              actor: actor.name,
              role: "Client",
              text: note || "Client approved the request.",
            });
            helpers.addAudit({
              action: "approval.approved",
              entityType: "approval",
              entityId: approval.id,
              before,
              after: { status: approval.status },
              siteId: approval.siteId,
            });
            helpers.emit({
              eventType: "approval.approved",
              title: `Client approved - ${approval.title}`,
              body: note || "Client approved in portal.",
              siteId: approval.siteId,
              entityType: "approval",
              entityId: approval.id,
              recipients: getRecipientsForRoles(next, ["Supervisor", "Project Manager", "Contract Admin"]),
              route: { kind: "internal", siteId: approval.siteId, page: "clientflow", entityId: approval.id },
            });
            updateSentiment(next, approval.clientId, 8);
            if (!approval.contractPackId) {
              const contractPack = createContractPackForApproval(next, approval, helpers, { autoRelease: approval.autoReleaseToClient });
              helpers.emit({
                eventType: approval.autoReleaseToClient ? "contract.builder-signed" : "contract.drafted",
                title: approval.autoReleaseToClient ? `Contract ready for client signature - ${approval.title}` : `Contract drafted - ${approval.title}`,
                body: approval.autoReleaseToClient ? `Draft ${contractPack.docId} is ready for client e-signature.` : `Draft ${contractPack.docId} is ready for Contract Admin review.`,
                siteId: approval.siteId,
                entityType: "contractPack",
                entityId: contractPack.docId,
                recipients: approval.autoReleaseToClient ? getRecipientsForClient(next, approval.clientId) : getRecipientsForRoles(next, ["Contract Admin", "Project Manager"]),
                route: approval.autoReleaseToClient
                  ? { kind: "client", clientId: approval.clientId, page: "documents", entityId: contractPack.docId }
                  : { kind: "internal", siteId: approval.siteId, page: "contracts", entityId: contractPack.docId },
              });
            }
          } else if (actionType === "decline") {
            approval.status = "declined";
            approval.messageThread.push({
              id: randomId("apm"),
              by: actor.name,
              role: "Client",
              at: nowStamp(),
              body: note || "Declined. Please revise and resend.",
            });
            helpers.appendTimeline(approval, {
              type: "declined",
              actor: actor.name,
              role: "Client",
              text: note || "Client declined the request.",
            });
            helpers.addAudit({
              action: "approval.declined",
              entityType: "approval",
              entityId: approval.id,
              before,
              after: { status: approval.status },
              siteId: approval.siteId,
            });
            helpers.emit({
              eventType: "approval.declined",
              title: `Client declined - ${approval.title}`,
              body: note || "Client requested alternative commercial options.",
              siteId: approval.siteId,
              entityType: "approval",
              entityId: approval.id,
              recipients: getRecipientsForRoles(next, ["Project Manager", "Contract Admin"]),
              route: { kind: "internal", siteId: approval.siteId, page: "clientflow", entityId: approval.id },
            });
            updateSentiment(next, approval.clientId, -12);
          } else if (actionType === "question" || actionType === "change") {
            approval.status = actionType === "change" ? "changes-requested" : "question";
            approval.messageThread.push({
              id: randomId("apm"),
              by: actor.name,
              role: "Client",
              at: nowStamp(),
              body: note || (actionType === "change" ? "Please revise and resend." : "Please clarify this item."),
            });
            helpers.appendTimeline(approval, {
              type: actionType === "change" ? "changes-requested" : "question",
              actor: actor.name,
              role: "Client",
              text: note || (actionType === "change" ? "Client requested a change." : "Client asked a question."),
            });
            helpers.emit({
              eventType: "approval.question",
              title: `Client ${actionType === "change" ? "change request" : "question"} - ${approval.title}`,
              body: note || "Client wants clarification before approving.",
              siteId: approval.siteId,
              entityType: "approval",
              entityId: approval.id,
              recipients: getRecipientsForRoles(next, ["Project Manager"]),
              route: { kind: "internal", siteId: approval.siteId, page: "clientflow", entityId: approval.id },
            });
            updateSentiment(next, approval.clientId, actionType === "change" ? -8 : -4);
          } else if (actionType === "call") {
            approval.messageThread.push({
              id: randomId("apm"),
              by: actor.name,
              role: "Client",
              at: nowStamp(),
              body: note || "Please arrange a callback to run through this approval.",
            });
            helpers.appendTimeline(approval, {
              type: "call-requested",
              actor: actor.name,
              role: "Client",
              text: note || "Client requested a callback.",
            });
            helpers.emit({
              eventType: "approval.question",
              title: `Callback requested - ${approval.title}`,
              body: note || "Client requested a call.",
              siteId: approval.siteId,
              entityType: "approval",
              entityId: approval.id,
              recipients: getRecipientsForRoles(next, ["Project Manager"]),
              route: { kind: "internal", siteId: approval.siteId, page: "clientflow", entityId: approval.id },
            });
            updateSentiment(next, approval.clientId, -2);
          }
          if (["approve", "decline", "question", "change", "call"].includes(actionType)) {
            appendApprovalComplianceEvent(approval, {
              event: `client.${actionType}`,
              actor: actor.name,
              role: "Client",
              payload: { note: note || "", status: approval.status },
            });
          }
        });
      },
      markApprovalInternal(approvalId, status, note = "") {
        mutate((next, helpers) => {
          const approval = next.approvals.find((item) => item.id === approvalId);
          if (!approval || !["approved", "declined"].includes(status)) return;
          const before = { status: approval.status };
          approval.status = status;
          approval.messageThread = approval.messageThread || [];
          approval.messageThread.push({
            id: randomId("apm"),
            by: actorName(helpers.actor),
            role: helpers.actor.role,
            at: nowStamp(),
            body: note || `Approval marked ${status} internally.`,
          });
          helpers.appendTimeline(approval, {
            type: status,
            actor: actorName(helpers.actor),
            role: helpers.actor.role,
            text: note || `Approval marked ${status} internally.`,
          });
          appendApprovalComplianceEvent(approval, {
            event: `internal.${status}`,
            actor: actorName(helpers.actor),
            role: helpers.actor.role,
            payload: { note, status },
          });
          helpers.addAudit({
            action: `approval.${status}.internal`,
            entityType: "approval",
            entityId: approval.id,
            before,
            after: { status: approval.status },
            siteId: approval.siteId,
          });
          helpers.emit({
            eventType: status === "approved" ? "approval.approved" : "approval.declined",
            title: `Approval ${status} - ${approval.title}`,
            body: note || `Approval marked ${status} internally.`,
            siteId: approval.siteId,
            entityType: "approval",
            entityId: approval.id,
            recipients: getRecipientsForRoles(next, ["Supervisor", "Project Manager", "Contract Admin"]),
            route: { kind: "internal", siteId: approval.siteId, page: "clientflow", entityId: approval.id },
          });
          if (status === "approved" && !approval.contractPackId) {
            const pack = createContractPackForApproval(next, approval, helpers, { autoRelease: false });
            helpers.emit({
              eventType: "contract.drafted",
              title: `Contract drafted - ${approval.title}`,
              body: `Draft ${pack.docId} is ready for Contract Studio review.`,
              siteId: approval.siteId,
              entityType: "contractPack",
              entityId: pack.docId,
              recipients: getRecipientsForRoles(next, ["Contract Admin", "Project Manager"]),
              route: { kind: "internal", siteId: approval.siteId, page: "contracts", entityId: pack.docId },
            });
          }
        });
      },
      generateContractFromApproval(approvalId) {
        mutate((next, helpers) => {
          const approval = next.approvals.find((item) => item.id === approvalId);
          if (!approval) return;
          const before = { status: approval.status, contractPackId: approval.contractPackId };
          const pack = createContractPackForApproval(next, approval, helpers, { autoRelease: false });
          helpers.addAudit({
            action: "contract.generate_from_approval",
            entityType: "approval",
            entityId: approval.id,
            before,
            after: { status: approval.status, contractPackId: pack?.docId },
            siteId: approval.siteId,
          });
          helpers.emit({
            eventType: "contract.drafted",
            title: `Contract generated - ${approval.title}`,
            body: `Draft ${pack?.docId || approval.contractPackId} is ready for Contract Studio review.`,
            siteId: approval.siteId,
            entityType: "contractPack",
            entityId: pack?.docId || approval.contractPackId,
            recipients: getRecipientsForRoles(next, ["Contract Admin", "Project Manager"]),
            route: { kind: "internal", siteId: approval.siteId, page: "contracts", entityId: pack?.docId || approval.contractPackId },
          });
        });
      },
      addApprovalMessage(approvalId, message, external = false) {
        mutate((next, helpers) => {
          const approval = next.approvals.find((item) => item.id === approvalId);
          if (!approval || !message.trim()) return;
          approval.messageThread.push({
            id: randomId("apm"),
            by: actorName(helpers.actor),
            role: external ? "Client" : helpers.actor.role,
            at: nowStamp(),
            body: message,
          });
          helpers.addMessage(
            "approval",
            approval.id,
            [approval.ownerId, next.users.find((user) => user.clientId === approval.clientId)?.id].filter(Boolean),
            message,
            helpers.actor.id,
          );
        });
      },
      requestContractChanges(contractId, note) {
        mutate((next, helpers) => {
          const contractPack = next.contractPacks.find((item) => item.docId === contractId);
          if (!contractPack) return;
          const approval = next.approvals.find((item) => item.id === contractPack.approvalId);
          contractPack.status = "contract-review-requested";
          contractPack.auditLog.unshift({
            id: randomId("cpa"),
            action: "review changes requested",
            by: actorName(helpers.actor),
            at: nowStamp(),
            details: note,
          });
          if (approval) {
            approval.status = "contract-in-review";
            helpers.appendTimeline(approval, {
              type: "contract-review-requested",
              actor: actorName(helpers.actor),
              role: helpers.actor.role,
              text: note,
            });
          }
          helpers.emit({
            eventType: "contract.review-requested",
            title: `Contract review requested - ${approval?.title || contractId}`,
            body: note,
            siteId: approval?.siteId,
            entityType: "contractPack",
            entityId: contractPack.docId,
            recipients: getRecipientsForRoles(next, ["Project Manager"]),
            route: { kind: "internal", siteId: approval?.siteId || next.session.siteId, page: "contracts", entityId: contractPack.docId },
          });
        });
      },
      editContractClause(contractId, sectionIndex, clauseIndex, value) {
        mutate((next, helpers) => {
          const contractPack = next.contractPacks.find((item) => item.docId === contractId);
          if (!contractPack) return;
          const before = contractPack.content.sections[sectionIndex]?.clauses?.[clauseIndex];
          if (!contractPack.content.sections[sectionIndex]) return;
          contractPack.content.sections[sectionIndex].clauses[clauseIndex] = value;
          contractPack.updatedAt = nowStamp();
          contractPack.auditLog.unshift({
            id: randomId("cpa"),
            action: "clause edited",
            by: actorName(helpers.actor),
            at: nowStamp(),
            details: `Updated clause ${clauseIndex + 1} in section ${sectionIndex + 1}.`,
          });
          helpers.addAudit({
            action: "contract.edit",
            entityType: "contractPack",
            entityId: contractPack.docId,
            before: { clause: before },
            after: { clause: value },
            siteId: contractPack.siteId,
          });
        });
      },
      assignTemplateToContract(contractId, templateId) {
        mutate((next, helpers) => {
          const contractPack = next.contractPacks.find((item) => item.docId === contractId);
          if (!contractPack) return;
          const approval = next.approvals.find((item) => item.id === contractPack.approvalId);
          const before = { templateId: contractPack.templateId, template: contractPack.template };
          contractPack.templateId = templateId;
          if (approval) {
            materialiseContractTemplate(contractPack, approval, next);
          }
          helpers.addAudit({
            action: "contract.template-assign",
            entityType: "contractPack",
            entityId: contractPack.docId,
            before,
            after: { templateId: contractPack.templateId, template: contractPack.template },
            siteId: contractPack.siteId,
          });
        });
      },
      addContractAttachment(contractId, fileName) {
        mutate((next, helpers) => {
          const contractPack = next.contractPacks.find((item) => item.docId === contractId);
          if (!contractPack || !fileName.trim()) return;
          contractPack.attachments.push({
            id: randomId("att"),
            name: fileName.trim(),
            kind: fileName.toLowerCase().endsWith(".png") ? "image" : "pdf",
          });
          contractPack.auditLog.unshift({
            id: randomId("cpa"),
            action: "attachment added",
            by: actorName(helpers.actor),
            at: nowStamp(),
            details: `${fileName.trim()} added to contract pack.`,
          });
        });
      },
      approveContractDraft(contractId) {
        mutate((next, helpers) => {
          const contractPack = next.contractPacks.find((item) => item.docId === contractId);
          if (!contractPack) return;
          const approval = next.approvals.find((item) => item.id === contractPack.approvalId);
          contractPack.status = "builder-signature-pending";
          contractPack.auditLog.unshift({
            id: randomId("cpa"),
            action: "draft approved for builder signature",
            by: actorName(helpers.actor),
            at: nowStamp(),
            details: "Contract Admin approved the draft for builder-side execution.",
          });
          if (approval) {
            approval.status = "contract-awaiting-builder";
            helpers.appendTimeline(approval, {
              type: "contract-awaiting-builder",
              actor: actorName(helpers.actor),
              role: helpers.actor.role,
              text: "Contract Admin approved the draft for builder signature.",
            });
          }
          helpers.emit({
            eventType: "contract.review-requested",
            title: `Contract ready for builder signature - ${approval?.title || contractId}`,
            body: "Draft has passed internal review and is ready for PM or Supervisor sign-off.",
            siteId: approval?.siteId,
            entityType: "contractPack",
            entityId: contractPack.docId,
            recipients: getRecipientsForRoles(next, ["Project Manager", "Supervisor"]),
            route: { kind: "internal", siteId: approval?.siteId || next.session.siteId, page: "contracts", entityId: contractPack.docId },
          });
        });
      },
      signBuilderContract(contractId, name) {
        mutate((next, helpers) => {
          const contractPack = next.contractPacks.find((item) => item.docId === contractId);
          if (!contractPack) return;
          const signedPack = signContract(contractPack, "builder", {
            name: name || actorName(helpers.actor),
            role: helpers.actor.role,
            ip: "198.51.100.88",
          });
          Object.assign(contractPack, signedPack);
          const approval = next.approvals.find((item) => item.id === contractPack.approvalId);
          if (approval) {
            approval.status = "contract-awaiting-client";
            helpers.appendTimeline(approval, {
              type: "builder-signed",
              actor: name || actorName(helpers.actor),
              role: helpers.actor.role,
              text: "Builder-side signature recorded.",
            });
          }
          helpers.addAudit({
            action: "contract.builder-sign",
            entityType: "contractPack",
            entityId: contractPack.docId,
            before: null,
            after: buildContractSummary(contractPack),
            siteId: contractPack.siteId,
          });
          helpers.emit({
            eventType: "contract.builder-signed",
            title: `Contract ready for client signature - ${approval?.title || contractId}`,
            body: "Builder-side signature is complete and the contract pack is now ready for client execution.",
            siteId: approval?.siteId,
            entityType: "contractPack",
            entityId: contractPack.docId,
            recipients: getRecipientsForClient(next, approval?.clientId),
            route: { kind: "client", clientId: approval?.clientId, page: "documents", entityId: contractPack.docId },
          });
        });
      },
      async signClientContract(contractId, name) {
        let pdfPayload = null;
        mutate((next, helpers) => {
          const contractPack = next.contractPacks.find((item) => item.docId === contractId);
          if (!contractPack) return;
          const approval = next.approvals.find((item) => item.id === contractPack.approvalId);
          const client = next.clients.find((item) => item.id === approval?.clientId);
          finaliseClientSignedContract(next, helpers, contractPack, approval, name);
          pdfPayload = {
            contractPack: cloneState(contractPack),
            approval: cloneState(approval),
            builder: cloneState(next.company || next.settings?.company || APP_CONFIG.builder),
            client: cloneState(client || {}),
          };
        });
        await persistExecutedPdf(pdfPayload);
      },
      async approveAndSignApproval(approvalId, signerName, note = "") {
        let pdfPayload = null;
        mutate((next, helpers) => {
          const approval = next.approvals.find((item) => item.id === approvalId);
          if (!approval) return;
          const client = next.clients.find((item) => item.id === approval.clientId);
          const before = { status: approval.status, contractPackId: approval.contractPackId };
          if (!["approved", "contract-drafted", "contract-awaiting-client", "signed"].includes(approval.status)) {
            approval.status = "approved";
            approval.messageThread = approval.messageThread || [];
            approval.messageThread.push({
              id: randomId("apm"),
              by: signerName || client?.primaryContact || "Client",
              role: "Client",
              at: nowStamp(),
              body: note || "Approved and signed electronically.",
            });
            helpers.appendTimeline(approval, {
              type: "approved",
              actor: signerName || client?.primaryContact || "Client",
              role: "Client",
              text: note || "Client approved the request.",
            });
            helpers.addAudit({
              action: "approval.approved",
              entityType: "approval",
              entityId: approval.id,
              before,
              after: { status: approval.status },
              siteId: approval.siteId,
            });
            helpers.emit({
              eventType: "approval.approved",
              title: `Client approved - ${approval.title}`,
              body: note || "Client approved in portal.",
              siteId: approval.siteId,
              entityType: "approval",
              entityId: approval.id,
              recipients: getRecipientsForRoles(next, ["Supervisor", "Project Manager", "Contract Admin"]),
              route: { kind: "internal", siteId: approval.siteId, page: "clientflow", entityId: approval.id },
            });
            updateSentiment(next, approval.clientId, 8);
          }
          const contractPack =
            next.contractPacks.find((pack) => pack.docId === approval.contractPackId) ||
            createContractPackForApproval(next, approval, helpers, { autoRelease: true });
          if (contractPack && contractPack.status !== "contract-awaiting-client" && contractPack.status !== "signed") {
            contractPack.status = "contract-awaiting-client";
            contractPack.signatures.builder = contractPack.signatures.builder || {
              name: next.company?.name || APP_CONFIG.builder.name,
              role: "Builder",
              signedAt: nowStamp(),
              ip: "browser",
            };
            approval.status = "contract-awaiting-client";
            helpers.appendTimeline(approval, {
              type: "contract-awaiting-client",
              actor: "System",
              role: "System",
              text: "Contract pack released for client e-signature.",
            });
          }
          finaliseClientSignedContract(next, helpers, contractPack, approval, signerName || client?.primaryContact || "Client");
          pdfPayload = {
            contractPack: cloneState(contractPack),
            approval: cloneState(approval),
            builder: cloneState(next.company || next.settings?.company || APP_CONFIG.builder),
            client: cloneState(client || {}),
          };
        });
        await persistExecutedPdf(pdfPayload);
      },
      archiveContract(contractId) {
        mutate((next, helpers) => {
          const contractPack = next.contractPacks.find((item) => item.docId === contractId);
          if (!contractPack) return;
          contractPack.archivedAt = nowStamp();
          contractPack.status = contractPack.status === "signed" ? "signed" : "archived";
          contractPack.auditLog.unshift({
            id: randomId("cpa"),
            action: "archived",
            by: actorName(helpers.actor),
            at: nowStamp(),
            details: "Contract pack archived by Contract Admin.",
          });
        });
      },
      createVariationFromRfi(rfiId) {
        let targetRoute = null;
        mutate((next, helpers) => {
          const rfi = next.rfis.find((item) => item.id === rfiId);
          if (!rfi) return;
          const variation = {
            id: randomId("var"),
            siteId: rfi.siteId,
            number: nextScopedNumber(next, "variations", rfi.siteId, "VO"),
            title: `Variation arising from ${rfi.number}`,
            sourceType: "rfi",
            sourceId: rfi.id,
            status: "submitted",
            priority: rfi.priority,
            value: Number(rfi.costImpact || 0),
            days: Number(rfi.timeImpact || 0),
            trade: rfi.trade,
            createdBy: helpers.actor.id,
            clientApprovalId: null,
            contractPackId: null,
            linkedRecords: [],
          };
          linkRecords(rfi, variation, "rfi", "variation", rfi.siteId);
          next.variations.unshift(variation);
          helpers.addAudit({
            action: "variation.create",
            entityType: "variation",
            entityId: variation.id,
            before: null,
            after: { status: variation.status, value: variation.value },
            siteId: variation.siteId,
          });
          targetRoute = { kind: "internal", siteId: variation.siteId, page: "vos", entityId: variation.id };
        });
        setTimeout(() => {
          if (targetRoute) navigate(targetRoute);
        }, 0);
      },
      createVariationDraft(payload) {
        mutate((next, helpers) => {
          const variation = {
            id: randomId("var"),
            siteId: payload.siteId || next.session.siteId,
            number: nextScopedNumber(next, "variations", payload.siteId || next.session.siteId, "VO"),
            title: payload.title,
            sourceType: payload.sourceType || "variation",
            sourceId: payload.sourceId || randomId("src"),
            status: "submitted",
            priority: payload.priority || "medium",
            value: Number(payload.value || 0),
            days: Number(payload.days || 0),
            description: payload.description || payload.title,
            reason: payload.reason || "Field event changed the original scope or commercial basis.",
            templateId: payload.templateId || next.settings?.contractDefaults?.standardVariationTemplate || null,
            trade: payload.trade || helpers.actor.trade || "General",
            createdBy: helpers.actor.id,
            clientApprovalId: null,
            contractPackId: null,
            linkedRecords: payload.linkedRecords || [],
            photos: payload.photos || [],
          };
          next.variations.unshift(variation);
          helpers.addAudit({
            action: "variation.create",
            entityType: "variation",
            entityId: variation.id,
            before: null,
            after: { status: variation.status, value: variation.value },
            siteId: variation.siteId,
          });
        });
	      },
	      sendVariationToClient(variationId, templateId = null) {
	        let targetRoute = null;
	        let aiUpgrade = null;
	        mutate((next, helpers) => {
          const variation = next.variations.find((item) => item.id === variationId);
          if (!variation) return;
          const selectedTemplateId = templateId || variation.templateId || next.settings?.contractDefaults?.standardVariationTemplate || null;
          const sourceType = variation.sourceType === "rfi" ? "rfi" : "variation";
          const portalToken = uuid();
          const approval = {
            id: randomId("ap"),
            number: nextScopedNumber(next, "approvals", variation.siteId, "CF"),
            siteId: variation.siteId,
            clientId: next.sites.find((site) => site.id === variation.siteId)?.clientId,
            type: "Variation",
            title: `Approve ${variation.title.toLowerCase()}`,
            summary: variation.description || `${variation.title} requires commercial approval before the builder can proceed cleanly.`,
            reason: variation.reason || "The linked field or consultant event has now changed the commercial basis of the work.",
            recommendation: "Approve now so the variation can be formalised without additional delay.",
            status: "awaiting-pm",
            priority: variation.priority,
            templateId: selectedTemplateId,
            autoReleaseToClient: false,
            portalToken,
            portalUrl: buildPortalUrl(portalToken),
            sourceType,
            sourceId: variation.sourceId || variation.id,
            createdBy: helpers.actor.id,
	            ownerId: next.sites.find((site) => site.id === variation.siteId)?.pmId || helpers.actor.id,
            sentAt: null,
            dueAt: addDays(formatDate(), 3),
            viewedAt: null,
            costImpact: variation.value,
            timeImpact: variation.days,
            linkedRecords: [buildLink("variation", variation, variation.siteId)],
            attachments: [],
            aiDraft: draftApproval(variation, "Variation"),
            timeline: [],
            messageThread: [],
            contractPackId: null,
          };
          helpers.appendTimeline(approval, {
            type: "awaiting-pm",
            actor: actorName(helpers.actor),
            role: helpers.actor.role,
            text: "Variation submitted for PM review before client issue.",
          });
          variation.clientApprovalId = approval.id;
          variation.status = "review";
          variation.templateId = selectedTemplateId;
          next.approvals.unshift(approval);
          helpers.addAudit({
            action: "variation.submit_internal_review",
            entityType: "variation",
            entityId: variation.id,
            before: { status: "submitted" },
            after: { status: variation.status, approvalId: approval.id, templateId: selectedTemplateId },
            siteId: variation.siteId,
          });
          helpers.emit({
            eventType: "approval.internal-review",
            title: `Variation ready for PM review - ${variation.title}`,
            body: `${approval.number} is waiting for PM review before client issue.`,
            siteId: approval.siteId,
            entityType: "approval",
            entityId: approval.id,
            recipients: [...getRecipientsForRoles(next, ["Project Manager"]), ...getRecipientsForClient(next, approval.clientId)],
            route: { kind: "internal", siteId: approval.siteId, page: "clientflow", entityId: approval.id },
          });
          targetRoute = { kind: "internal", siteId: approval.siteId, page: "clientflow", entityId: approval.id };
          aiUpgrade = { approvalId: approval.id, sourceEntity: { ...variation }, approvalType: "Variation", siteId: approval.siteId };
        });
        if (aiUpgrade) improveApprovalDraft(aiUpgrade);
        setTimeout(() => {
          if (targetRoute) navigate(targetRoute);
        }, 0);
      },
      addProcurementRequest(payload) {
        mutate((next, helpers) => {
          const item = {
            id: randomId("proc"),
            siteId: payload.siteId || next.session.siteId,
            item: payload.item,
            quantity: payload.quantity,
            requestedBy: payload.requestedBy || next.session.userId,
            status: "pending",
            date: formatDate(),
            eta: payload.eta || "",
            supplier: payload.supplier || "",
            poNumber: payload.poNumber || "",
            cost: Number(payload.cost || 0),
            linkedTaskIds: payload.linkedTaskIds || [],
            schedulePhaseId: payload.schedulePhaseId || null,
            linkedApprovalId: null,
            linkedRecords: payload.linkedRecords || [],
          };
          next.procurement.unshift(item);
          helpers.addAudit({
            action: "procurement.create",
            entityType: "procurement",
            entityId: item.id,
            before: null,
            after: { status: item.status, item: item.item },
            siteId: item.siteId,
          });
        });
      },
      updateProcurementStatus(itemId, status) {
        mutate((next, helpers) => {
          const item = next.procurement.find((entry) => entry.id === itemId);
          if (!item) return;
          const before = { status: item.status };
          item.status = status;
          helpers.addAudit({
            action: "procurement.status",
            entityType: "procurement",
            entityId: item.id,
            before,
            after: { status },
            siteId: item.siteId,
          });
          if (status === "delayed") {
            helpers.emit({
              eventType: "procurement.delayed",
              title: `Procurement delayed - ${item.item}`,
              body: "Delay detected. SiteForge can draft an EOT request from this event.",
              siteId: item.siteId,
              entityType: "procurement",
              entityId: item.id,
              recipients: getRecipientsForRoles(next, ["Project Manager"]),
              route: { kind: "internal", siteId: item.siteId, page: "mats", entityId: item.id },
            });
          }
        });
      },
      createEotFromProcurement(itemId) {
        let targetRoute = null;
        let aiUpgrade = null;
        mutate((next, helpers) => {
          const item = next.procurement.find((entry) => entry.id === itemId);
          if (!item) return;
          const ai = draftApproval(item, "Extension of Time");
          const site = next.sites.find((entry) => entry.id === item.siteId);
          if (!site) return;
          const linkedTasks = (item.linkedTaskIds || [])
            .map((taskId) => next.tasks.find((task) => task.id === taskId))
            .filter(Boolean);
          const schedule = next.schedules.find((entry) => entry.siteId === item.siteId);
          const linkedPhase = schedule?.phases?.find((phase) => phase.id === item.schedulePhaseId);
          const scheduleLinks = linkedPhase
            ? [{ type: "schedule", id: linkedPhase.id, label: linkedPhase.label, siteId: item.siteId }]
            : [];
          const affectedLinks = [
            ...linkedTasks.map((task) => buildLink("task", task, item.siteId)),
            ...scheduleLinks,
          ];
          const approval = {
            id: randomId("ap"),
            number: nextScopedNumber(next, "approvals", item.siteId, "CF"),
            siteId: item.siteId,
            clientId: site.clientId,
            type: "Extension of Time",
            title: `EOT request for ${item.item.toLowerCase()} delay`,
            summary: ai.summary,
            reason: ai.reason,
            recommendation: ai.recommendation,
            status: "draft",
            priority: "high",
            sourceType: "procurement",
            sourceId: item.id,
            createdBy: helpers.actor.id,
            ownerId: site.pmId,
            sentAt: null,
            dueAt: addDays(formatDate(), 3),
            viewedAt: null,
            costImpact: Number(item.cost || 0),
            timeImpact: 2,
            linkedRecords: [buildLink("procurement", item, item.siteId), ...affectedLinks],
            attachments: [],
            aiDraft: {
              ...ai,
              summary: `${ai.summary}${affectedLinks.length ? ` Affected programme items: ${affectedLinks.map((link) => link.label).join(", ")}.` : ""}`,
            },
            timeline: [],
            messageThread: [],
            contractPackId: null,
          };
          helpers.appendTimeline(approval, {
            type: "created",
            actor: actorName(helpers.actor),
            role: helpers.actor.role,
            text: "Drafted from delayed procurement item.",
          });
          next.approvals.unshift(approval);
          item.linkedApprovalId = approval.id;
          linkRecords(item, approval, "procurement", "approval", item.siteId);
          linkedTasks.forEach((task) => linkRecords(task, approval, "task", "approval", item.siteId));
          helpers.addAudit({
            action: "procurement.eot-created",
            entityType: "approval",
            entityId: approval.id,
            before: null,
            after: { procurementId: item.id, affectedLinks: affectedLinks.map((link) => link.id) },
            siteId: item.siteId,
          });
          targetRoute = { kind: "internal", siteId: item.siteId, page: "clientflow", entityId: approval.id };
          aiUpgrade = { approvalId: approval.id, sourceEntity: { ...item }, approvalType: "Extension of Time", siteId: item.siteId };
        });
        if (aiUpgrade) improveApprovalDraft(aiUpgrade);
        setTimeout(() => {
          if (targetRoute) navigate(targetRoute);
        }, 0);
      },
      addQaRecord(payload) {
        mutate((next, helpers) => {
          const entry = {
            id: randomId("qa"),
            siteId: payload.siteId || next.session.siteId,
            title: payload.title,
            type: payload.type || "Hold Point",
            trade: payload.trade || "General",
            inspector: payload.inspector || actorName(helpers.actor),
            status: "scheduled",
            date: payload.date || formatDate(),
            passCount: 0,
            totalCount: Number(payload.totalCount || 0),
            notes: payload.notes || "",
            linkedRecords: payload.linkedRecords || [],
            photos: payload.photos || [],
          };
          next.qa.unshift(entry);
          helpers.addAudit({
            action: "qa.create",
            entityType: "qa",
            entityId: entry.id,
            before: null,
            after: { status: entry.status, title: entry.title },
            siteId: entry.siteId,
          });
        });
      },
      updateQaStatus(qaId, status) {
        mutate((next, helpers) => {
          const entry = next.qa.find((item) => item.id === qaId);
          if (!entry) return;
          const before = { status: entry.status, passCount: entry.passCount };
	          entry.status = status;
	          if (status === "passed") {
	            entry.passCount = entry.totalCount;
	            entry.reinspectionRequired = false;
	            entry.defectClosedAt = nowStamp();
	            entry.history = [
	              ...(entry.history || []),
	              { at: nowStamp(), action: before.status === "failed" ? "reinspection-passed" : "inspection-passed", by: actorName(helpers.actor) },
	            ];
	          }
          helpers.addAudit({
            action: "qa.status",
            entityType: "qa",
            entityId: entry.id,
            before,
            after: { status: entry.status, passCount: entry.passCount },
            siteId: entry.siteId,
          });
	          if (status === "failed") {
	            const existingTask =
	              (entry.reworkTaskId && next.tasks.find((task) => task.id === entry.reworkTaskId)) ||
	              next.tasks.find((task) => (task.linkedRecords || []).some((record) => record.type === "qa" && record.id === entry.id) && task.type === "rework");
	            if (!existingTask) {
	              const site = next.sites.find((item) => item.id === entry.siteId);
	              const task = {
	                id: randomId("tsk"),
	                siteId: entry.siteId,
	                title: `Rework - ${entry.title}`,
	                description: entry.notes || `Rectify failed ${entry.type || "QA"} inspection before re-inspection.`,
	                type: "rework",
	                trade: entry.trade || "General",
	                companyId: helpers.actor.companyId,
	                assigneeId: site?.superintendentId || helpers.actor.id,
	                priority: "high",
	                status: "todo",
	                dueDate: addDays(entry.date || formatDate(), 2),
	                progress: 0,
	                crewRequired: 1,
	                mobileMaterials: [],
	                linkedRecords: [buildLink("qa", entry, entry.siteId)],
	                clientVisible: false,
	                requiresReinspection: true,
	              };
	              next.tasks.unshift(task);
	              entry.reworkTaskId = task.id;
	              upsertLinkedRecord(entry, buildLink("task", task, entry.siteId));
	              helpers.addAudit({
	                action: "task.create.rework",
	                entityType: "task",
	                entityId: task.id,
	                before: null,
	                after: { title: task.title, status: task.status, qaId: entry.id },
	                siteId: task.siteId,
	              });
	              helpers.emit({
	                eventType: "task.rework-created",
	                title: `Rework task created - ${entry.title}`,
	                body: task.description,
	                siteId: entry.siteId,
	                entityType: "task",
	                entityId: task.id,
	                recipients: getRecipientsForRoles(next, ["Supervisor", "Project Manager"]),
	                route: { kind: "internal", siteId: entry.siteId, page: "tasks", entityId: task.id },
	              });
	            }
	            helpers.emit({
	              eventType: "qa.failed",
              title: `QA failed - ${entry.title}`,
              body: entry.notes || "Inspection failed and needs rework review.",
              siteId: entry.siteId,
              entityType: "qa",
              entityId: entry.id,
              recipients: getRecipientsForRoles(next, ["Project Manager", "Contract Admin"]),
              route: { kind: "internal", siteId: entry.siteId, page: "qa", entityId: entry.id },
            });
          }
        });
      },
      addDiaryEntry(payload) {
        mutate((next, helpers) => {
          const structured = payload.rawText ? structureFieldNote(payload.rawText) : null;
          const voiceTranscript = (payload.voiceNotes || []).map((note) => note.transcript).filter(Boolean).join(" ");
          const entry = {
            id: randomId("dia"),
            siteId: payload.siteId || next.session.siteId,
            date: payload.date || formatDate(),
            weather: payload.weather || "Fine",
            crew: Number(payload.crew || 0),
            summary: payload.summary || structured?.summary || voiceTranscript || "",
            safety: payload.safety || structured?.safety || "",
            delays: payload.delays || structured?.delays || "Nil",
            photos: payload.photos || [],
            voiceNotes: payload.voiceNotes || [],
            rainEvent: Boolean(payload.rainEvent),
            linkedRecords: payload.linkedRecords || [],
            createdAt: nowStamp(),
            updatedAt: nowStamp(),
          };
          next.diary.unshift(entry);
          helpers.addAudit({
            action: "diary.create",
            entityType: "diary",
            entityId: entry.id,
            before: null,
            after: { date: entry.date, rainEvent: entry.rainEvent },
            siteId: entry.siteId,
          });
        });
      },
      createRainDayClaim(diaryId) {
        let targetRoute = null;
        let aiUpgrade = null;
        mutate((next, helpers) => {
          const diary = next.diary.find((entry) => entry.id === diaryId);
          if (!diary) return;
          const site = next.sites.find((entry) => entry.id === diary.siteId);
          if (!site) return;
          const ai = draftApproval(diary, "Rain Day");
          const approval = {
            id: randomId("ap"),
            number: nextScopedNumber(next, "approvals", diary.siteId, "CF"),
            siteId: diary.siteId,
            clientId: site.clientId,
            type: "Rain Day",
            title: `Rain day claim for ${diary.date}`,
            summary: ai.summary,
            reason: ai.reason,
            recommendation: ai.recommendation,
            status: "draft",
            priority: "medium",
            sourceType: "diary",
            sourceId: diary.id,
            createdBy: helpers.actor.id,
            ownerId: site.pmId,
            sentAt: null,
            dueAt: addDays(diary.date, 3),
            viewedAt: null,
            costImpact: 0,
            timeImpact: 1,
            linkedRecords: [buildLink("diary", diary, diary.siteId)],
            attachments: [{ id: randomId("att"), name: `Weather evidence ${diary.date}.pdf`, kind: "pdf" }],
            aiDraft: ai,
            timeline: [],
            messageThread: [],
            contractPackId: null,
          };
          helpers.appendTimeline(approval, {
            type: "created",
            actor: actorName(helpers.actor),
            role: helpers.actor.role,
            text: "Rain day claim drafted from site diary.",
          });
          next.approvals.unshift(approval);
          linkRecords(diary, approval, "diary", "approval", diary.siteId);
          helpers.addAudit({
            action: "diary.rain-day-claim",
            entityType: "approval",
            entityId: approval.id,
            before: null,
            after: { diaryId: diary.id, status: approval.status, timeImpact: approval.timeImpact },
            siteId: diary.siteId,
          });
          helpers.emit({
            eventType: "approval.created",
            title: `Rain day claim drafted - ${approval.number}`,
            body: approval.summary,
            siteId: diary.siteId,
            entityType: "approval",
            entityId: approval.id,
            recipients: getRecipientsForRoles(next, ["Project Manager", "Contract Admin"]),
            route: { kind: "internal", siteId: diary.siteId, page: "clientflow", entityId: approval.id },
          });
          targetRoute = { kind: "internal", siteId: diary.siteId, page: "clientflow", entityId: approval.id };
          aiUpgrade = { approvalId: approval.id, sourceEntity: { ...diary }, approvalType: "Rain Day", siteId: diary.siteId };
        });
        if (aiUpgrade) improveApprovalDraft(aiUpgrade);
        setTimeout(() => {
          if (targetRoute) navigate(targetRoute);
        }, 0);
      },
      createVariationFromDiary(diaryId, payload) {
        let targetRoute = null;
        let aiUpgrade = null;
        mutate((next, helpers) => {
          const diary = next.diary.find((entry) => entry.id === diaryId);
          if (!diary) return;
          const site = next.sites.find((entry) => entry.id === diary.siteId) || next.sites[0];
          const client = next.clients.find((entry) => entry.id === site?.clientId) || next.clients[0];
          const numericValue = Number(payload.value || 0);
          const numericDays = Number(payload.days || 0);
          const variation = {
            id: randomId("var"),
            siteId: diary.siteId,
            number: nextScopedNumber(next, "variations", diary.siteId, "VO"),
            title: payload.title || `Variation from diary - ${diary.date}`,
            sourceType: "diary",
            sourceId: diary.id,
            status: "submitted",
            priority: payload.priority || "medium",
            value: numericValue,
            days: numericDays,
            description: payload.description || diary.summary,
            reason: payload.reason || diary.delays || "Diary event changed the recoverable scope or programme basis.",
            templateId: payload.templateId || next.settings?.contractDefaults?.standardVariationTemplate || null,
            trade: payload.trade || "General",
            createdBy: helpers.actor.id,
            clientApprovalId: null,
            contractPackId: null,
            linkedRecords: [buildLink("diary", diary, diary.siteId)],
            photos: payload.photos || diary.photos || [],
          };
          next.variations.unshift(variation);
          upsertLinkedRecord(diary, buildLink("variation", variation, diary.siteId));
          if (payload.releaseToClient !== false && site && client) {
            const portalToken = uuid();
            const approvalStatus = payload.sendImmediately === false ? "draft" : "awaiting-pm";
            const approval = {
              id: randomId("ap"),
              number: nextScopedNumber(next, "approvals", diary.siteId, "CF"),
              siteId: diary.siteId,
              clientId: client.id,
              type: "Variation",
              title: variation.title,
              summary: variation.description,
              reason: variation.reason,
              recommendation: "Recommended for issue to client for review and signature.",
              status: approvalStatus,
              priority: variation.priority,
              sourceType: "variation",
              sourceId: variation.id,
              createdBy: helpers.actor.id,
              ownerId: site.pmId || helpers.actor.id,
              sentAt: null,
              dueAt: addDays(formatDate(), 3),
              viewedAt: null,
              costImpact: numericValue,
              timeImpact: numericDays,
              templateId: variation.templateId,
              linkedRecords: [buildLink("diary", diary, diary.siteId), buildLink("variation", variation, diary.siteId)],
              attachments: buildSourceAttachments(variation),
              aiDraft: {
                summary: variation.description,
                reason: variation.reason,
                recommendation: "Recommended for issue to client for review and signature.",
                costImpact: numericValue,
                timeImpact: numericDays,
                source: "local-template",
                upgradeStartedAt: nowStamp(),
              },
              timeline: [],
              messageThread: [],
              contractPackId: null,
              portalToken,
              portalUrl: buildPortalUrl(portalToken),
            };
            helpers.appendTimeline(approval, {
              type: approvalStatus === "awaiting-pm" ? "awaiting-pm" : "created",
              actor: actorName(helpers.actor),
              role: helpers.actor.role,
              text: approvalStatus === "awaiting-pm" ? "Diary variation submitted for PM review." : "Diary variation prepared as a ClientFlow draft.",
            });
            next.approvals.unshift(approval);
            variation.clientApprovalId = approval.id;
            upsertLinkedRecord(variation, buildLink("approval", approval, diary.siteId));
            upsertLinkedRecord(diary, buildLink("approval", approval, diary.siteId));
            helpers.addAudit({
              action: approvalStatus === "awaiting-pm" ? "approval.submit-internal-review.from_diary" : "approval.create.from_diary",
              entityType: "approval",
              entityId: approval.id,
              before: null,
              after: { status: approval.status, variationId: variation.id, costImpact: approval.costImpact },
              siteId: diary.siteId,
            });
            helpers.emit({
              eventType: "approval.created",
              title: `${approval.number} created from diary variation`,
              body: approvalStatus === "awaiting-pm" ? `${approval.title} is ready for PM review.` : `${approval.title} was saved as a ClientFlow draft.`,
              siteId: diary.siteId,
              entityType: "approval",
              entityId: approval.id,
              recipients: getRecipientsForRoles(next, ["Project Manager", "Contract Admin"]),
              route: { kind: "internal", siteId: diary.siteId, page: "clientflow", entityId: approval.id },
            });
            targetRoute = { kind: "internal", siteId: diary.siteId, page: "clientflow", entityId: approval.id };
            aiUpgrade = { approvalId: approval.id, sourceEntity: { ...variation }, approvalType: "Variation", siteId: diary.siteId };
          }
          helpers.addAudit({
            action: "diary.convert_to_variation",
            entityType: "variation",
            entityId: variation.id,
            before: null,
            after: { diaryId: diary.id, value: variation.value, days: variation.days, templateId: variation.templateId },
            siteId: diary.siteId,
          });
          helpers.emit({
            eventType: "variation.created",
            title: `Variation draft created - ${variation.number}`,
            body: `${variation.title} is ready for PM review and client issue.`,
            siteId: diary.siteId,
            entityType: "variation",
            entityId: variation.id,
            recipients: getRecipientsForRoles(next, ["Project Manager"]),
            route: { kind: "internal", siteId: diary.siteId, page: "vos", entityId: variation.id },
          });
        });
        if (aiUpgrade) improveApprovalDraft(aiUpgrade);
        setTimeout(() => {
          if (targetRoute) navigate(targetRoute);
        }, 0);
      },
      addSafetyRecord(payload) {
        mutate((next, helpers) => {
          const record = {
            id: randomId("safe"),
            siteId: payload.siteId || next.session.siteId,
            type: payload.type || "toolbox",
            topic: payload.topic,
            by: actorName(helpers.actor),
            date: payload.date || formatDate(),
            participants: payload.participants || [helpers.actor.id],
            acknowledgementRequired: Boolean(payload.acknowledgementRequired),
            linkedRecords: payload.linkedRecords || [],
            photos: payload.photos || [],
          };
          next.safety.unshift(record);
          helpers.addAudit({
            action: "safety.create",
            entityType: "safety",
            entityId: record.id,
            before: null,
            after: { type: record.type, topic: record.topic },
            siteId: record.siteId,
          });
          if (record.type === "critical" || record.type === "incident") {
            helpers.emit({
              eventType: "safety.incident",
              title: `Safety incident - ${record.topic}`,
              body: "Immediate review and project response required.",
              siteId: record.siteId,
              entityType: "safety",
              entityId: record.id,
              recipients: [...getRecipientsForRoles(next, ["Supervisor", "Project Manager", "Director"]), ...next.users.map((user) => ({ user }))],
              route: { kind: "internal", siteId: record.siteId, page: "safety", entityId: record.id },
            });
          }
        });
      },
      createDelayNoticeFromSafety(safetyId) {
        let aiUpgrade = null;
        mutate((next, helpers) => {
          const record = next.safety.find((item) => item.id === safetyId);
          if (!record) return;
          const site = next.sites.find((item) => item.id === record.siteId);
          const ai = draftApproval(record, "Delay Notice");
          const approval = {
            id: randomId("ap"),
            number: nextScopedNumber(next, "approvals", record.siteId, "CF"),
            siteId: record.siteId,
            clientId: site.clientId,
            type: "Delay Notice",
            title: `Delay notice - ${record.topic.toLowerCase()}`,
            summary: ai.summary,
            reason: ai.reason,
            recommendation: ai.recommendation,
            status: "draft",
            priority: "high",
            sourceType: "safety",
            sourceId: record.id,
            createdBy: helpers.actor.id,
            ownerId: site.pmId,
            sentAt: null,
            dueAt: addDays(formatDate(), 2),
            viewedAt: null,
            costImpact: 0,
            timeImpact: 1,
            linkedRecords: [buildLink("safety", record, record.siteId)],
            attachments: [],
            aiDraft: ai,
            timeline: [],
            messageThread: [],
            contractPackId: null,
          };
          next.approvals.unshift(approval);
          upsertLinkedRecord(record, buildLink("approval", approval, record.siteId));
          aiUpgrade = { approvalId: approval.id, sourceEntity: { ...record }, approvalType: "Delay Notice", siteId: record.siteId };
        });
        if (aiUpgrade) improveApprovalDraft(aiUpgrade);
      },
      createReworkTaskFromQa(qaId) {
        mutate((next, helpers) => {
          const qa = next.qa.find((item) => item.id === qaId);
          if (!qa) return;
	          const task = {
	            id: randomId("tsk"),
	            siteId: qa.siteId,
	            title: `Rework - ${qa.title}`,
	            description: qa.notes,
	            type: "rework",
	            trade: qa.trade,
	            companyId: helpers.actor.companyId,
            assigneeId: next.sites.find((site) => site.id === qa.siteId)?.superintendentId || helpers.actor.id,
            priority: "high",
            status: "todo",
            dueDate: addDays(qa.date, 2),
            progress: 0,
            crewRequired: 1,
            mobileMaterials: [],
	            linkedRecords: [buildLink("qa", qa, qa.siteId)],
	            clientVisible: false,
	            requiresReinspection: true,
	          };
	          next.tasks.unshift(task);
	          qa.reworkTaskId = task.id;
	          upsertLinkedRecord(qa, buildLink("task", task, qa.siteId));
          helpers.addAudit({
            action: "task.create",
            entityType: "task",
            entityId: task.id,
            before: null,
            after: { title: task.title, status: task.status },
            siteId: task.siteId,
          });
        });
      },
      createRfi(payload) {
        mutate((next, helpers) => {
          const rfi = {
            id: randomId("rfi"),
            siteId: payload.siteId || next.session.siteId,
            number: nextScopedNumber(next, "rfis", payload.siteId || next.session.siteId, "RFI"),
            title: payload.title,
            trade: payload.trade || "General",
            fromUserId: helpers.actor.id,
            to: payload.to || "Consultant",
            status: "open",
            priority: payload.priority || "medium",
            dueDate: payload.dueDate || addDays(formatDate(), 4),
            costImpact: Number(payload.costImpact || 0),
            timeImpact: Number(payload.timeImpact || 0),
            scopeCompanyId: helpers.actor.companyId,
            description: payload.description || payload.title,
            linkedRecords: payload.linkedRecords || [],
            responses: [],
          };
          next.rfis.unshift(rfi);
          helpers.addAudit({
            action: "rfi.create",
            entityType: "rfi",
            entityId: rfi.id,
            before: null,
            after: { status: rfi.status, title: rfi.title },
            siteId: rfi.siteId,
          });
        });
      },
      createRfiFromProblem(problemId, payload = {}) {
        let targetRoute = null;
        let createdRfiId = null;
        mutate((next, helpers) => {
          const problem = next.problems.find((item) => item.id === problemId);
          if (!problem) return;
          const rfi = {
            id: randomId("rfi"),
            siteId: problem.siteId,
            number: nextScopedNumber(next, "rfis", problem.siteId, "RFI"),
            title: payload.title || `Clarification required - ${problem.title}`,
            trade: payload.trade || problem.trade || "General",
            fromUserId: helpers.actor.id,
            to: payload.to || "Consultant",
            status: "open",
            priority: payload.priority || problem.priority || "medium",
            dueDate: payload.dueDate || addDays(formatDate(), 4),
            costImpact: Number(payload.costImpact ?? problem.costImpact ?? 0),
            timeImpact: Number(payload.timeImpact ?? problem.timeImpact ?? 0),
            scopeCompanyId: helpers.actor.companyId,
            description: payload.description || problem.description || problem.title,
            sourceType: "problem",
            sourceId: problem.id,
            linkedRecords: [],
            responses: [],
          };
          linkRecords(problem, rfi, "problem", "rfi", problem.siteId);
          next.rfis.unshift(rfi);
          helpers.addAudit({
            action: "problem.convert-to-rfi",
            entityType: "rfi",
            entityId: rfi.id,
            before: null,
            after: { problemId: problem.id, number: rfi.number, title: rfi.title },
            siteId: problem.siteId,
          });
          helpers.emit({
            eventType: "rfi.created",
            title: `RFI raised from problem - ${rfi.number}`,
            body: rfi.title,
            siteId: problem.siteId,
            entityType: "rfi",
            entityId: rfi.id,
            recipients: getRecipientsForRoles(next, ["Project Manager", "Contract Admin"]),
            route: { kind: "internal", siteId: problem.siteId, page: "rfis", entityId: rfi.id },
          });
          targetRoute = { kind: "internal", siteId: problem.siteId, page: "rfis", entityId: rfi.id };
          createdRfiId = rfi.id;
        });
        setTimeout(() => {
          if (targetRoute) navigate(targetRoute);
        }, 0);
        return createdRfiId;
      },
      updateRfi(rfiId, patch = {}) {
        mutate((next, helpers) => {
          const rfi = next.rfis.find((item) => item.id === rfiId);
          if (!rfi) return;
          const before = { title: rfi.title, description: rfi.description, to: rfi.to, aiSource: rfi.aiSource };
          ["title", "description", "to", "trade", "priority", "dueDate", "aiSource"].forEach((key) => {
            if (patch[key] !== undefined) rfi[key] = patch[key];
          });
          rfi.updatedAt = nowStamp();
          helpers.addAudit({
            action: "rfi.update",
            entityType: "rfi",
            entityId: rfi.id,
            before,
            after: { title: rfi.title, description: rfi.description, to: rfi.to, aiSource: rfi.aiSource },
            siteId: rfi.siteId,
          });
        });
      },
	      respondRfi(rfiId, message) {
	        mutate((next, helpers) => {
	          const rfi = next.rfis.find((item) => item.id === rfiId);
	          if (!rfi || !message.trim()) return;
          rfi.responses.push({
            id: randomId("rfi-r"),
            by: actorName(helpers.actor),
            at: nowStamp(),
            body: message,
          });
	          rfi.status = "responded";
	        });
	      },
	      async respondRfiSmart(rfiId, draftMessage = "") {
	        const snapshot = stateRef.current;
	        const rfi = snapshot.rfis.find((item) => item.id === rfiId);
	        if (!rfi) return { ok: false, error: "RFI not found." };
	        const integrationSettings = snapshot.device?.settings?.integrations || snapshot.settings?.integrations || {};
	        const aiConfig = getStoredAiConfig(integrationSettings);
	        if (!aiConfig.apiKey) return { ok: false, error: "No AI API key configured." };
	        if (snapshot.org?.mode === "demo") return { ok: false, error: "AI RFI polishing is disabled in demo mode for project data." };
	        const site = snapshot.sites.find((item) => item.id === rfi.siteId);
	        const projectContext = {
	          orgMode: snapshot.org?.mode,
	          site,
	          rfi: { title: rfi.title, description: rfi.description, trade: rfi.trade, to: rfi.to, dueDate: rfi.dueDate },
	          draftMessage,
	        };
	        const result = await askSiteForgeAi({
	          userMessage: `Polish this RFI response for an Australian residential building project.

RFI: ${JSON.stringify(projectContext.rfi)}
Draft response: ${draftMessage || "No draft yet. Prepare a concise response that answers the RFI clearly and preserves contract position."}

Return only the polished response text. Keep it practical, formal, and specific. Do not invent facts that are not in the RFI or draft.`,
	          projectContext,
	          provider: aiConfig.provider,
	          apiKey: aiConfig.apiKey,
	          model: aiConfig.model,
	          openaiProxyUrl: aiConfig.openaiProxyUrl,
	          allowInDemo: false,
	        });
	        if (result.source === "claude" || result.source === "openai") {
	          return { ok: true, body: String(result.text || "").trim(), source: result.source };
	        }
	        return { ok: false, error: result.text || "AI did not return an RFI response.", source: result.source };
	      },
	      closeRfi(rfiId) {
        mutate((next) => {
          const rfi = next.rfis.find((item) => item.id === rfiId);
          if (rfi) {
            rfi.status = "closed";
          }
        });
      },
      updatePassportAcknowledgement(passportId, acknowledgementId, typedName) {
        mutate((next, helpers) => {
          const passport = next.passports.records.find((item) => item.id === passportId);
          if (!passport) return;
          const acknowledgement = passport.acknowledgements.find((item) => item.id === acknowledgementId);
          if (acknowledgement) {
            acknowledgement.done = true;
          }
          passport.docs.forEach((doc) => {
            if (acknowledgement?.label?.toLowerCase().includes("revision") && doc.label.toLowerCase().includes("revision")) {
              doc.status = "complete";
            }
            if (acknowledgement?.label?.toLowerCase().includes("retaining") && doc.label.toLowerCase().includes("retaining")) {
              doc.status = "complete";
            }
          });
          passport.blockedReasons = passport.docs
            .filter((doc) => doc.status !== "complete")
            .map((doc) =>
              doc.status === "expired"
                ? `${doc.label} expired`
                : doc.status === "missing"
                  ? `${doc.label} missing`
                  : `${doc.label} not acknowledged`,
            );
          if (typedName) {
            helpers.addAudit({
              action: "passport.acknowledge",
              entityType: "passport",
              entityId: passport.id,
              before: null,
              after: { acknowledgement: acknowledgement?.label, by: typedName },
              siteId: passport.siteId,
            });
          }
          next.documents.forEach((document) => {
            if (document.impactAnalysis?.acknowledgementsRequired?.includes(passport.userId)) {
              document.impactAnalysis.acknowledgedBy = document.impactAnalysis.acknowledgedBy || [];
              if (!document.impactAnalysis.acknowledgedBy.includes(passport.userId)) {
                document.impactAnalysis.acknowledgedBy.push(passport.userId);
              }
            }
          });
        });
      },
      completePassportInduction(passportId, { typedName = "", quizScore = 100, videoWatched = true } = {}) {
        mutate((next, helpers) => {
          const passport = next.passports.records.find((item) => item.id === passportId);
          if (!passport) return;
          const before = { inductionStatus: passport.inductionStatus, blockedReasons: passport.blockedReasons };
          passport.inductionStatus = quizScore >= 80 && videoWatched ? "complete" : "pending";
          passport.inductionCompletedAt = passport.inductionStatus === "complete" ? nowStamp() : null;
          passport.inductionSignature = passport.inductionStatus === "complete"
            ? { signerName: typedName || passport.person, signedAt: nowStamp(), quizScore, videoWatched }
            : null;
          passport.docs = passport.docs || [];
          const inductionDoc = passport.docs.find((doc) => doc.label.toLowerCase().includes("induction"));
          if (inductionDoc) {
            inductionDoc.status = passport.inductionStatus === "complete" ? "complete" : "pending";
          } else if (passport.inductionStatus === "complete") {
            passport.docs.unshift({ id: randomId("pd"), label: "Site induction", status: "complete" });
          }
          passport.blockedReasons = (passport.blockedReasons || []).filter((reason) => !reason.toLowerCase().includes("induction"));
          if (passport.inductionStatus !== "complete") {
            passport.blockedReasons.unshift("Induction incomplete");
          }
          helpers.addAudit({
            action: "passport.induction-complete",
            entityType: "passport",
            entityId: passport.id,
            before,
            after: { inductionStatus: passport.inductionStatus, quizScore, by: typedName || passport.person },
            siteId: passport.siteId,
          });
        });
      },
      acknowledgeDailyBrief(passportId, typedName = "") {
        mutate((next, helpers) => {
          const passport = next.passports.records.find((item) => item.id === passportId);
          if (!passport) return;
          passport.dailyBriefAcknowledgements = passport.dailyBriefAcknowledgements || [];
          passport.dailyBriefAcknowledgements.unshift({
            id: randomId("brief"),
            siteId: passport.siteId,
            by: typedName || passport.person,
            at: nowStamp(),
            brief: next.passports.siteAccess.find((entry) => entry.siteId === passport.siteId)?.dailyBrief || "",
          });
          passport.dailyBriefAcknowledgements = passport.dailyBriefAcknowledgements.slice(0, 30);
          helpers.addAudit({
            action: "passport.daily-brief-ack",
            entityType: "passport",
            entityId: passport.id,
            before: null,
            after: { by: typedName || passport.person },
            siteId: passport.siteId,
          });
        });
      },
      acknowledgeSwms(passportId, swmsId, typedName = "") {
        mutate((next, helpers) => {
          const passport = next.passports.records.find((item) => item.id === passportId);
          const swms = next.swms.find((item) => item.id === swmsId);
          if (!passport || !swms) return;
          swms.acknowledgedBy = swms.acknowledgedBy || [];
          if (!swms.acknowledgedBy.includes(passport.userId)) {
            swms.acknowledgedBy.push(passport.userId);
          }
          passport.acknowledgements = passport.acknowledgements || [];
          passport.acknowledgements.unshift({
            id: randomId("ack"),
            label: `${swms.title} acknowledged`,
            done: true,
            by: typedName || passport.person,
            at: nowStamp(),
          });
          const swmsDoc = passport.docs.find((doc) => doc.label.toLowerCase().includes("swms"));
          if (swmsDoc) swmsDoc.status = "complete";
          passport.blockedReasons = (passport.blockedReasons || []).filter((reason) => !reason.toLowerCase().includes("swms"));
          helpers.addAudit({
            action: "passport.swms-ack",
            entityType: "passport",
            entityId: passport.id,
            before: null,
            after: { swmsId, by: typedName || passport.person },
            siteId: passport.siteId,
          });
        });
      },
      addPassportTicket(passportId, { label, expiresOn, number = "", attachmentFileId = null } = {}) {
        mutate((next, helpers) => {
          const passport = next.passports.records.find((item) => item.id === passportId);
          if (!passport || !label || !expiresOn) return;
          passport.tickets = passport.tickets || [];
          const ticket = {
            id: randomId("ticket"),
            name: label,
            number,
            issuedDate: formatDate(),
            expiryDate: expiresOn,
            attachmentFileId,
          };
          passport.tickets.unshift(ticket);
          passport.licences = [...new Set([...(passport.licences || []), label])];
          next.passports.expiringTickets.unshift({
            id: randomId("tick"),
            userId: passport.userId,
            passportId: passport.id,
            label,
            expiresOn,
            fileId: attachmentFileId,
            notifications: [],
          });
          passport.blockedReasons = (passport.blockedReasons || []).filter((reason) => !reason.toLowerCase().includes(label.toLowerCase()));
          helpers.addAudit({
            action: "passport.ticket-add",
            entityType: "passport",
            entityId: passport.id,
            before: null,
            after: ticket,
            siteId: passport.siteId,
          });
        });
      },
      setPassportBlock(passportId, { reason, severity = "suspended", duration = "24h" } = {}) {
        mutate((next, helpers) => {
          const passport = next.passports.records.find((item) => item.id === passportId);
          if (!passport || !reason?.trim()) return;
          const before = { blockedReasons: passport.blockedReasons };
          const label = `Manual block: ${reason.trim()}`;
          passport.blockedReasons = [...new Set([...(passport.blockedReasons || []), label])];
          passport.blockHistory = passport.blockHistory || [];
          passport.blockHistory.unshift({
            id: randomId("block"),
            reason: reason.trim(),
            severity,
            duration,
            by: actorName(helpers.actor),
            at: nowStamp(),
            active: true,
          });
          helpers.addAudit({
            action: "passport.block",
            entityType: "passport",
            entityId: passport.id,
            before,
            after: { blockedReasons: passport.blockedReasons, severity, duration },
            siteId: passport.siteId,
          });
          helpers.emit({
            eventType: "passport.access-denied",
            title: `Passport blocked - ${passport.person}`,
            body: reason.trim(),
            siteId: passport.siteId,
            entityType: "passport",
            entityId: passport.id,
            recipients: getRecipientsForRoles(next, ["Supervisor", "Project Manager"]),
            route: { kind: "internal", siteId: passport.siteId, page: "passport", entityId: passport.id },
          });
        });
      },
      clearPassportBlock(passportId, reason = "") {
        mutate((next, helpers) => {
          const passport = next.passports.records.find((item) => item.id === passportId);
          if (!passport) return;
          const before = { blockedReasons: passport.blockedReasons };
          passport.blockedReasons = (passport.blockedReasons || []).filter((entry) => !entry.toLowerCase().startsWith("manual block:"));
          passport.blockHistory = (passport.blockHistory || []).map((entry) => entry.active ? { ...entry, active: false, clearedAt: nowStamp(), clearedBy: actorName(helpers.actor), clearReason: reason } : entry);
          helpers.addAudit({
            action: "passport.unblock",
            entityType: "passport",
            entityId: passport.id,
            before,
            after: { blockedReasons: passport.blockedReasons, reason },
            siteId: passport.siteId,
          });
        });
      },
      issueVisitorPassport({ siteId, name, company, phone, escort = "" } = {}) {
        mutate((next, helpers) => {
          if (!name?.trim()) return;
          const visitorId = randomId("visitor");
          const passport = {
            id: randomId("pass"),
            siteId: siteId || next.session.siteId,
            userId: visitorId,
            person: name.trim(),
            companyId: `visitor-${visitorId}`,
            company: company || "Visitor",
            phone,
            role: "Visitor",
            trade: "Visitor",
            permissions: ["Emergency", "Daily Brief"],
            inductionStatus: "complete",
            inductionCompletedAt: nowStamp(),
            visitorPass: { issuedAt: nowStamp(), validForDate: formatDate(), escort, qrCode: `VIS-${uuid().slice(0, 8).toUpperCase()}` },
            licences: [],
            insuranceStatus: "n/a",
            docs: [{ id: randomId("pd"), label: "Visitor induction", status: "complete" }],
            blockedReasons: escort ? [] : ["Escort not assigned"],
            acknowledgements: [{ id: randomId("ack"), label: "Escorted access only", done: Boolean(escort), by: escort || "" }],
          };
          next.passports.records.unshift(passport);
          helpers.addAudit({
            action: "passport.visitor-issue",
            entityType: "passport",
            entityId: passport.id,
            before: null,
            after: { person: passport.person, escort },
            siteId: passport.siteId,
          });
        });
      },
      scanPassport(siteId, passportId, options = {}) {
        mutate((next, helpers) => {
          const passport = next.passports.records.find((item) => item.id === passportId);
          if (!passport) return;
          const expiredTicket = (next.passports.expiringTickets || []).find((ticket) => ticket.passportId === passport.id && daysUntil(ticket.expiresOn) < 0);
          const reasons = [
            ...(passport.blockedReasons || []),
            passport.inductionStatus !== "complete" ? "Induction incomplete" : null,
            expiredTicket ? `${expiredTicket.label} expired` : null,
          ].filter(Boolean);
          const result = reasons.length ? "blocked" : "granted";
          const reason = reasons[0] || "All documents current";
          next.passports.scanLog.unshift({
            id: randomId("scan"),
            siteId,
            passportId,
            at: nowStamp(),
            result,
            reason,
            method: options.method || "manual",
            gpsVerified: Boolean(options.gpsVerified),
            distanceMeters: options.distanceMeters ?? null,
            qrValue: options.qrValue || null,
          });
          next.passports.scanLog = next.passports.scanLog.slice(0, 220);
          next.presence.events.unshift({
            id: randomId("pe"),
            siteId,
            userId: passport.userId,
            at: nowStamp(),
            signal: "sign-in",
            state: result === "granted" ? "captured" : "blocked",
            note: `${reason}${options.gpsVerified ? " · GPS verified" : options.distanceMeters ? ` · ${options.distanceMeters}m from site` : ""}`,
          });
          next.presence.events = next.presence.events.slice(0, 260);
          if (result === "granted") {
            next.presence.records.unshift({
              id: randomId("presence"),
              siteId,
              userId: passport.userId,
              worker: passport.person,
              company: passport.company,
              status: "verified-on-site",
              confidence: options.gpsVerified ? 98 : 82,
              start: nowStamp(),
              finish: null,
              signals: [options.method || "manual", options.gpsVerified ? "gps" : "manual-location"],
              anomalyFlags: options.gpsVerified ? [] : ["GPS not verified"],
              supervisorNotes: reason,
            });
            next.presence.records = next.presence.records.slice(0, 200);
          }
          if (result === "blocked") {
            helpers.emit({
              eventType: "passport.access-denied",
              title: `Access denied - ${passport.person}`,
              body: reason,
              siteId,
              entityType: "passport",
              entityId: passport.id,
              recipients: getRecipientsForRoles(next, ["Supervisor"]),
              route: { kind: "internal", siteId, page: "passport", entityId: passport.id },
            });
          }
	        });
	      },
	      signOutPresence({ siteId, userId, recordId = null, manualClose = false }) {
	        mutate((next, helpers) => {
	          const target = recordId
	            ? next.presence.records.find((record) => record.id === recordId)
	            : next.presence.records.find((record) => record.siteId === siteId && record.userId === userId && !record.finish);
	          if (!target) return;
	          const before = { finish: target.finish || null, status: target.status, payrollState: target.payrollState };
	          target.finish = nowStamp();
	          target.status = "verified-complete";
	          target.hours = computeHours(target.start, target.finish);
	          target.payrollState = manualClose ? "review" : "ready";
	          target.autoCloseNotifiedAt = null;
	          next.presence.events.unshift({
	            id: randomId("pe"),
	            siteId: target.siteId,
	            userId: target.userId,
	            at: target.finish,
	            signal: "sign-out",
	            state: "captured",
	            note: manualClose ? "Closed manually by supervisor" : "Worker signed out",
	          });
	          next.presence.events = next.presence.events.slice(0, 260);
	          helpers.addAudit({
	            action: "presence.signed-out",
	            entityType: "presence",
	            entityId: target.id,
	            before,
	            after: { finish: target.finish, hours: target.hours, payrollState: target.payrollState },
	            siteId: target.siteId,
	          });
	        });
	      },
	      acknowledgeToolboxTalk(talkId, userId, name) {
        mutate((next) => {
          const talk = next.toolboxTalks.find((item) => item.id === talkId);
          if (!talk) return;
          const already = talk.acknowledgements.some((entry) => entry.userId === userId);
          if (!already) {
            talk.acknowledgements.push({
              userId,
              name,
              at: nowStamp(),
            });
          }
        });
      },
      configurePresenceNotice(siteId, payload = {}) {
        mutate((next, helpers) => {
          const site = next.sites.find((item) => item.id === siteId);
          if (!site) return;
          const noticeIssuedAt = formatDate(payload.noticeIssuedAt);
          const activationDate = addDays(noticeIssuedAt, 14);
          const today = formatDate();
          let record = next.presence.siteCompliance.find((item) => item.siteId === siteId);
          if (!record) {
            record = { id: randomId("presence-compliance"), siteId };
            next.presence.siteCompliance.unshift(record);
          }
          const before = { ...record };
          Object.assign(record, {
            status: today >= activationDate ? "ready-to-activate" : "pending-14-day-notice",
            enabled: false,
            noticeIssuedAt,
            activationDate,
            noticeDocumentName: payload.noticeDocumentName || "Presence disclosure notice",
            confirmedNoticeIssued: Boolean(payload.confirmedNoticeIssued ?? true),
            disclosureCopy: payload.disclosureCopy || "Workers may view, export, and challenge disclosed attendance signals.",
            lastReviewedAt: nowStamp(),
          });
          helpers.addAudit({
            action: "presence.notice-configured",
            entityType: "presenceCompliance",
            entityId: record.id,
            before,
            after: { ...record },
            siteId,
          });
          pushToast(next, {
            tone: today >= activationDate ? "medium" : "warning",
            title: "Presence notice recorded",
            body: today >= activationDate ? "Notice window is complete. Presence can now be activated." : `Activation locked until ${activationDate}.`,
          });
        });
      },
      activatePresenceForSite(siteId) {
        mutate((next, helpers) => {
          const record = next.presence.siteCompliance.find((item) => item.siteId === siteId);
          if (!record?.confirmedNoticeIssued || !record.activationDate) {
            pushToast(next, { tone: "critical", title: "Presence cannot activate", body: "Issue and upload the 14-day disclosure notice first." });
            return;
          }
          const today = formatDate();
          if (today < record.activationDate) {
            pushToast(next, { tone: "warning", title: "14-day notice still running", body: `Activation is locked until ${record.activationDate}.` });
            return;
          }
          const before = { ...record };
          Object.assign(record, {
            enabled: true,
            status: "active",
            activatedAt: nowStamp(),
            activatedBy: next.session.userId,
            lastReviewedAt: nowStamp(),
          });
          helpers.addAudit({
            action: "presence.activated",
            entityType: "presenceCompliance",
            entityId: record.id,
            before,
            after: { ...record },
            siteId,
          });
          pushToast(next, { tone: "passed", title: "Presence active", body: "Disclosed attendance verification is now enabled for this site." });
        });
      },
      runPresenceAnomalyScan(siteId = null) {
        mutate((next, helpers) => {
          const targetSiteId = siteId || next.session.siteId;
          const scannedAt = nowStamp();
          const existingOpen = new Set(next.presence.reviewQueue.filter((item) => item.status === "open").map((item) => item.recordId));
          next.presence.records
            .filter((record) => record.siteId === targetSiteId)
            .forEach((record) => {
              const flags = new Set(record.anomalyFlags || []);
              if (!record.signals?.some((signal) => ["geofence", "gps", "beacon"].includes(signal))) flags.add("No verified location signal");
              if (record.gpsVerified === false) flags.add("GPS outside declared site boundary");
              if (!record.finish && hoursSince(record.start || scannedAt) >= 10) flags.add("Missing scan-out after expected shift");
              if (record.status === "overlapping-presence") flags.add("Overlapping presence on another site");
              if (!flags.size) return;
              record.anomalyFlags = [...flags];
              record.payrollState = record.payrollState === "ready" ? "review" : record.payrollState || "review";
              record.confidence = Math.min(record.confidence || 75, flags.size >= 2 ? 52 : 70);
              if (!existingOpen.has(record.id)) {
                next.presence.reviewQueue.unshift({
                  id: randomId("presence-review"),
                  siteId: record.siteId,
                  recordId: record.id,
                  worker: record.person || record.worker,
                  flags: record.anomalyFlags,
                  confidence: record.confidence,
                  status: "open",
                  createdAt: scannedAt,
                });
              }
            });
          next.presence.reviewQueue = next.presence.reviewQueue.slice(0, 160);
          helpers.addAudit({
            action: "presence.anomaly-scan",
            entityType: "presence",
            entityId: targetSiteId,
            before: null,
            after: { scannedAt, openReviews: next.presence.reviewQueue.filter((item) => item.siteId === targetSiteId && item.status === "open").length },
            siteId: targetSiteId,
          });
          pushToast(next, { tone: "medium", title: "Presence scan complete", body: "Anomaly queue updated for disclosed attendance records." });
        });
      },
      generatePresencePayrollExport({ siteId = null, userId = null, period = null } = {}) {
        mutate((next, helpers) => {
          const targetSiteId = siteId || next.session.siteId;
          const targetRecords = next.presence.records.filter((record) => record.siteId === targetSiteId && (!userId || record.userId === userId));
          const verified = targetRecords.filter((record) => record.payrollState === "ready" || record.status === "verified-on-site");
          const flagged = targetRecords.filter((record) => record.anomalyFlags?.length || ["hold", "review"].includes(record.payrollState));
          const averageConfidence = targetRecords.length
            ? Math.round(targetRecords.reduce((sum, record) => sum + (record.confidence || 0), 0) / targetRecords.length)
            : 100;
          const exportRecord = {
            id: randomId("pay"),
            siteId: targetSiteId,
            userId,
            period: period || `${formatDate().slice(0, 7)} payroll evidence`,
            state: flagged.length ? "review" : "ready",
            verifiedHours: Number((verified.length * 7.6).toFixed(1)),
            flaggedHours: Number((flagged.length * 7.6).toFixed(1)),
            confidence: averageConfidence,
            generatedAt: nowStamp(),
            rows: targetRecords.map((record) => ({
              userId: record.userId,
              person: record.person || record.worker,
              status: record.status,
              confidence: record.confidence,
              flags: record.anomalyFlags || [],
              start: record.start || null,
              finish: record.finish || null,
            })),
          };
          next.presence.exports.unshift(exportRecord);
          next.presence.exports = next.presence.exports.slice(0, 160);
          helpers.addAudit({
            action: "presence.payroll-export",
            entityType: "presenceExport",
            entityId: exportRecord.id,
            before: null,
            after: { period: exportRecord.period, confidence: exportRecord.confidence },
            siteId: targetSiteId,
          });
          pushToast(next, { tone: "passed", title: "Payroll evidence generated", body: `${exportRecord.verifiedHours} verified hours exported.` });
        });
      },
      requestPresenceDataExport(userId = null, siteId = null) {
        mutate((next, helpers) => {
          const requesterId = userId || next.session.userId;
          const targetSiteId = siteId || next.session.siteId;
          const request = {
            id: randomId("presence-data-export"),
            siteId: targetSiteId,
            userId: requesterId,
            status: "compliance-review",
            requestedAt: nowStamp(),
            recordCount: next.presence.records.filter((record) => record.siteId === targetSiteId && record.userId === requesterId).length,
          };
          next.presence.dataExports.unshift(request);
          helpers.addAudit({
            action: "presence.worker-data-export-requested",
            entityType: "presenceDataExport",
            entityId: request.id,
            before: null,
            after: request,
            siteId: targetSiteId,
          });
          pushToast(next, { tone: "medium", title: "Data export requested", body: "Compliance review queue has been updated." });
        });
      },
      requestPresenceOptOut({ userId = null, siteId = null, reason = "" } = {}) {
        mutate((next, helpers) => {
          const request = {
            id: randomId("presence-optout"),
            siteId: siteId || next.session.siteId,
            userId: userId || next.session.userId,
            reason: reason || "Worker requested presence verification opt-out review.",
            status: "review",
            requestedAt: nowStamp(),
          };
          next.presence.optOutRequests.unshift(request);
          helpers.addAudit({
            action: "presence.opt-out-requested",
            entityType: "presenceOptOut",
            entityId: request.id,
            before: null,
            after: request,
            siteId: request.siteId,
          });
          pushToast(next, { tone: "warning", title: "Opt-out review opened", body: "Presence opt-out request is waiting for compliance review." });
        });
      },
      challengePresenceRecord(presenceId, reason = "Worker challenged this attendance signal.") {
        mutate((next, helpers) => {
          const record = next.presence.records.find((item) => item.id === presenceId);
          if (!record) return;
          const challenge = {
            id: randomId("presence-challenge"),
            siteId: record.siteId,
            recordId: record.id,
            userId: record.userId,
            reason,
            status: "open",
            requestedAt: nowStamp(),
          };
          record.challenges = [...(record.challenges || []), challenge.id];
          record.payrollState = "review";
          if (!record.anomalyFlags.includes("Worker challenge open")) record.anomalyFlags.push("Worker challenge open");
          next.presence.challenges.unshift(challenge);
          helpers.addAudit({
            action: "presence.challenge-opened",
            entityType: "presence",
            entityId: record.id,
            before: null,
            after: challenge,
            siteId: record.siteId,
          });
          pushToast(next, { tone: "warning", title: "Presence challenge opened", body: "Supervisor review is required before payroll export." });
        });
      },
      resolvePresence(presenceId, outcome, note, override = {}) {
        mutate((next, helpers) => {
          const record = next.presence.records.find((item) => item.id === presenceId);
          if (!record) return;
          const before = { status: record.status, confidence: record.confidence, payrollState: record.payrollState };
          if (outcome === "verify") {
            record.status = "verified-on-site";
            record.confidence = Math.max(record.confidence, 85);
            record.payrollState = "ready";
            record.anomalyFlags = [];
          } else if (outcome === "hold") {
            record.payrollState = "hold";
            record.confidence = Math.min(record.confidence, 45);
          }
          record.supervisorNotes = note || record.supervisorNotes;
          record.resolvedAt = nowStamp();
          record.resolvedBy = next.session.userId;
          if (override.reason || note) {
            record.manualOverrides = [
              ...(record.manualOverrides || []),
              {
                id: randomId("presence-override"),
                outcome,
                reason: override.reason || note,
                signedBy: override.signedBy || next.users.find((user) => user.id === next.session.userId)?.name || "Supervisor",
                at: record.resolvedAt,
              },
            ].slice(-20);
          }
          next.presence.reviewQueue = next.presence.reviewQueue.map((item) =>
            item.recordId === record.id && item.status === "open" ? { ...item, status: outcome === "verify" ? "resolved" : "held", resolvedAt: nowStamp() } : item,
          );
          next.presence.challenges = next.presence.challenges.map((item) =>
            item.recordId === record.id && item.status === "open" ? { ...item, status: outcome === "verify" ? "resolved" : "held", resolvedAt: nowStamp() } : item,
          );
          helpers.addAudit({
            action: "presence.resolve",
            entityType: "presence",
            entityId: record.id,
            before,
            after: { status: record.status, confidence: record.confidence, payrollState: record.payrollState },
            siteId: record.siteId,
          });
        });
      },
      triggerPresenceDigest() {
        mutate((next, helpers) => {
          const flagged = next.presence.records.filter((record) => record.anomalyFlags?.length);
          if (!flagged.length) return;
          helpers.emit({
            eventType: "presence.anomaly",
            title: "Daily presence anomaly digest ready",
            body: `${flagged.length} attendance anomalies need supervisor review.`,
            siteId: next.session.siteId,
            entityType: "presence",
            entityId: flagged[0].id,
            recipients: getRecipientsForRoles(next, ["Supervisor"]),
            route: { kind: "internal", siteId: next.session.siteId, page: "presence", entityId: flagged[0].id },
          });
        });
      },
      connectTeamsMock() {
        mutate((next, helpers) => {
          const before = { connected: next.teams.connected, oauthStatus: next.teams.oauthStatus };
          next.teams.connected = false;
          next.teams.oauthStatus = "backend-required";
          next.teams.lastConnectionAttemptAt = nowStamp();
          helpers.addAudit({
            action: "teams.connect-blocked",
            entityType: "integration",
            entityId: "teams",
            before,
            after: { connected: false, oauthStatus: next.teams.oauthStatus },
            siteId: next.session.siteId,
          });
          pushToast(next, { tone: "medium", title: "Teams requires backend setup", body: "Adaptive card payloads will stay queued locally until a real Teams bot or webhook is configured." });
        });
      },
      updateTeamsChannelMap(eventType, channel) {
        mutate((next, helpers) => {
          const before = { ...(next.teams.channelMap || {}) };
          next.teams.channelMap = { ...(next.teams.channelMap || DEFAULT_TEAMS_CHANNEL_MAP), [eventType]: channel };
          helpers.addAudit({
            action: "teams.channel-map",
            entityType: "integration",
            entityId: "teams",
            before,
            after: next.teams.channelMap,
            siteId: next.session.siteId,
          });
        });
      },
      sendTeamsTestMessage() {
        mutate((next) => {
          const event = createTeamsEvent({
            eventType: "teams.test",
            title: "SiteForge Teams test",
            body: "If this were connected to the real bot, this message would appear in Microsoft Teams.",
            channel: "PM Escalations",
            status: next.teams.connected ? "sent" : "queued",
          });
          next.teams.outbound.unshift({ id: randomId("teams"), ...event });
          next.notifications.eventLog.unshift({ id: randomId("tel"), ...event });
          next.notifications.eventLog = next.notifications.eventLog.slice(0, 240);
          pushToast(next, { tone: "medium", title: "Teams test queued", body: "Outbound log updated with a Teams test message." });
        });
      },
      queueTeamsApprovalCard(approvalId) {
        mutate((next, helpers) => {
          const approval = next.approvals.find((item) => item.id === approvalId);
          if (!approval) return;
          const client = next.clients.find((item) => item.id === approval.clientId);
          const channel = next.teams.channelMap?.["approval.sent"] || "Client Approvals";
          const event = buildTeamsApprovalDispatch({
            approval,
            client,
            builder: next.org?.settings?.company || APP_CONFIG.builder,
            channel,
          });
          const record = { id: randomId("teams"), ...event, status: next.teams.connected ? "sent" : "queued" };
          next.teams.outbound.unshift(record);
          next.notifications.eventLog.unshift({ id: randomId("tel"), ...record });
          next.teams.outbound = next.teams.outbound.slice(0, 120);
          next.notifications.eventLog = next.notifications.eventLog.slice(0, 240);
          helpers.addAudit({
            action: "teams.approval-card",
            entityType: "approval",
            entityId: approval.id,
            before: null,
            after: { channel, status: record.status },
            siteId: approval.siteId,
          });
        });
      },
      handleTeamsApprovalAction({ approvalId, action = "question", note = "", signerName = "Teams user" } = {}) {
        mutate((next, helpers) => {
          const approval = next.approvals.find((item) => item.id === approvalId);
          if (!approval) return;
          const before = { status: approval.status };
          if (action === "approve") {
            approval.status = "approved";
            helpers.appendTimeline(approval, { type: "approved", actor: signerName, role: "Teams", text: "Approved from Microsoft Teams adaptive card." });
          } else if (action === "decline") {
            approval.status = "declined";
            helpers.appendTimeline(approval, { type: "declined", actor: signerName, role: "Teams", text: note || "Declined from Microsoft Teams adaptive card." });
          } else {
            approval.status = "question";
            approval.messageThread = approval.messageThread || [];
            approval.messageThread.push({ id: randomId("msg"), by: signerName, role: "Teams", at: nowStamp(), body: note || "Question raised from Microsoft Teams." });
            helpers.appendTimeline(approval, { type: "question", actor: signerName, role: "Teams", text: note || "Question raised from Microsoft Teams." });
          }
          helpers.addAudit({
            action: `teams.approval-${action}`,
            entityType: "approval",
            entityId: approval.id,
            before,
            after: { status: approval.status },
            siteId: approval.siteId,
          });
        });
      },
      runTeamsSlashCommand(command = "") {
        mutate((next) => {
          const response = handleTeamsSlashCommand(command, next);
          const event = createTeamsEvent({
            eventType: "teams.command",
            title: response.title,
            body: response.body,
            channel: "ChatOps",
            status: response.status === "error" ? "error" : "sent",
          });
          next.teams.commandLog.unshift({
            id: randomId("cmd"),
            command,
            response,
            at: nowStamp(),
          });
          next.teams.outbound.unshift({ id: randomId("teams"), ...event });
          next.teams.commandLog = next.teams.commandLog.slice(0, 80);
          next.teams.outbound = next.teams.outbound.slice(0, 120);
          pushToast(next, { tone: response.status === "error" ? "critical" : "medium", title: response.title, body: response.body.slice(0, 120) });
        });
      },
      testBuildxactConnection() {
        mutate((next, helpers) => {
          const hasConfig = Boolean(next.buildxact.connection.workspaceId && next.buildxact.connection.apiKeyMasked);
          next.buildxact.connection.status = hasConfig ? "configured" : "disconnected";
          next.buildxact.connection.lastTestedAt = nowStamp();
          next.settings.integrations = {
            ...(next.settings.integrations || {}),
            buildxactConnected: false,
            buildxactSyncMode: "disconnected",
            buildxactLastError: hasConfig ? "Credentials saved locally. Real Buildxact API connection requires backend configuration." : "Buildxact API key and Workspace ID are required.",
          };
          helpers.addAudit({
            action: "buildxact.connection-test",
            entityType: "integration",
            entityId: "buildxact",
            before: null,
            after: { status: next.buildxact.connection.status, backendRequired: hasConfig },
            siteId: next.session.siteId,
          });
          pushToast(next, {
            tone: hasConfig ? "medium" : "critical",
            title: hasConfig ? "Buildxact credentials saved" : "Buildxact disconnected",
            body: hasConfig ? "No fake sync was run. Backend API connection is still required before data leaves SiteForge." : "Enter an API key and workspace ID before testing.",
          });
        });
      },
      updateBuildxactSettings(patch) {
        mutate((next) => {
          next.buildxact = {
            ...next.buildxact,
            ...patch,
            toggles: { ...next.buildxact.toggles, ...(patch.toggles || {}) },
            entitySync: { ...next.buildxact.entitySync, ...(patch.entitySync || patch.toggles || {}) },
            syncFrequency: { ...next.buildxact.syncFrequency, ...(patch.syncFrequency || {}) },
            connection: { ...next.buildxact.connection, ...(patch.connection || {}) },
          };
        });
      },
      setBuildxactReadOnly(enabled) {
        mutate((next, helpers) => {
          next.buildxact.readOnlyMode = Boolean(enabled);
          helpers.addAudit({
            action: "buildxact.read-only-toggle",
            entityType: "integration",
            entityId: "buildxact",
            before: null,
            after: { readOnlyMode: next.buildxact.readOnlyMode },
            siteId: next.session.siteId,
          });
        });
      },
      markExternalQueueItemSent(queueName, itemId, note = "") {
        mutate((next, helpers) => {
          const queue = next[queueName];
          if (!Array.isArray(queue)) return;
          const item = queue.find((entry) => entry.id === itemId);
          if (!item) return;
          item.status = "sent";
          item.manuallyMarkedSentAt = nowStamp();
          item.manualNote = note || `Manually marked sent by ${actorName(helpers.actor)}`;
          helpers.addAudit({
            action: `${queueName}.manual-sent`,
            entityType: queueName,
            entityId: itemId,
            before: null,
            after: { status: item.status, manualNote: item.manualNote },
            siteId: next.session.siteId,
          });
        });
      },
      deleteExternalQueueItem(queueName, itemId) {
        mutate((next, helpers) => {
          if (!Array.isArray(next[queueName])) return;
          const before = next[queueName].find((entry) => entry.id === itemId) || null;
          next[queueName] = next[queueName].filter((entry) => entry.id !== itemId);
          helpers.addAudit({
            action: `${queueName}.delete`,
            entityType: queueName,
            entityId: itemId,
            before,
            after: null,
            siteId: next.session.siteId,
          });
        });
      },
      reconcileBuildxactNow() {
        mutate((next, helpers) => {
          if (next.buildxact.connection?.status !== "connected") {
            pushToast(next, {
              tone: "critical",
              title: "Buildxact disconnected",
              body: "Connect Buildxact before reconciling. Existing pushes remain queued locally.",
            });
            next.buildxact.connection.lastTestedAt = nowStamp();
            next.settings.integrations = {
              ...(next.settings.integrations || {}),
              buildxactConnected: false,
              buildxactSyncMode: "disconnected",
              buildxactLastError: "Buildxact is disconnected.",
            };
            helpers.addAudit({
              action: "buildxact.reconcile-blocked",
              entityType: "integration",
              entityId: "buildxact",
              before: null,
              after: { status: "disconnected" },
              siteId: next.session.siteId,
            });
            return;
          }
          const orgId = next.org?.id || DEFAULT_ORG.id;
          const snapshot = buildBuildxactPullSnapshot({ orgId });
          const toggles = next.buildxact.entitySync || next.buildxact.toggles || {};
          const before = {
            sites: next.sites.length,
            clients: next.clients.length,
            suppliers: next.buildxact.suppliers?.length || 0,
            costCodes: next.buildxact.costCodes?.length || 0,
          };

          if (toggles.projects) {
            next.sites = upsertByBuildxactId(next.sites, snapshot.sites);
          }
          if (toggles.clients) {
            next.clients = upsertByBuildxactId(next.clients, snapshot.clients);
          }
          if (toggles.suppliers) {
            next.buildxact.suppliers = snapshot.suppliers;
          }
          if (toggles.costCodes) {
            next.buildxact.costCodes = snapshot.costCodes;
          }
          if (toggles.schedule) {
            next.buildxact.scheduleMilestones = snapshot.scheduleMilestones;
          }

          next.buildxact.connection.status = "connected";
          next.buildxact.lastSyncAt = nowStamp();
          next.buildxact.syncHistory.unshift(
            createBuildxactSyncHistory({
              type: "pull",
              reference: "buildxact-fixture-reconcile",
              siteId: next.session.siteId,
              status: "success",
              payloadSize: `${snapshot.sites.length + snapshot.clients.length + snapshot.suppliers.length} records`,
            }),
          );
          next.buildxact.payloadPreviews.unshift({
            id: randomId("bxp"),
            type: "pull",
            reference: "buildxact-fixture-reconcile",
            current: snapshot,
            previous: before,
          });
          next.buildxact.syncHistory = next.buildxact.syncHistory.slice(0, 180);
          next.buildxact.payloadPreviews = next.buildxact.payloadPreviews.slice(0, 120);
          helpers.addAudit({
            action: "buildxact.reconcile",
            entityType: "integration",
            entityId: "buildxact",
            before,
            after: {
              sites: next.sites.length,
              clients: next.clients.length,
              suppliers: next.buildxact.suppliers.length,
              costCodes: next.buildxact.costCodes.length,
            },
            siteId: next.session.siteId,
          });
          pushToast(next, {
            tone: "info",
            title: "Buildxact reconciled",
            body: "Projects, clients, suppliers, cost codes, and schedule context were refreshed from the connector fixtures.",
          });
        });
      },
      retryBuildxactSync(syncId) {
        mutate((next, helpers) => {
          const history = next.buildxact.syncHistory.find((item) => item.id === syncId);
          if (!history) return;
          next.buildxact.syncHistory.unshift({
            ...history,
            id: randomId("bx"),
            status: "success",
            duration: "512ms",
            at: nowStamp(),
            error: undefined,
          });
          helpers.addAudit({
            action: "sync.retry",
            entityType: "sync",
            entityId: syncId,
            before: { status: history.status },
            after: { status: "success" },
            siteId: history.siteId,
          });
        });
      },
      retryAllFailedSyncs() {
        mutate((next) => {
          const failed = next.buildxact.syncHistory.filter((item) => item.status === "error");
          failed.forEach((entry) => {
            next.buildxact.syncHistory.unshift({
              ...entry,
              id: randomId("bx"),
              status: "success",
              duration: "544ms",
              at: nowStamp(),
              error: undefined,
            });
          });
        });
      },
      triggerSyncQueueItem(queueId) {
        mutate((next, helpers) => {
          const item = next.buildxact.queue.find((entry) => entry.id === queueId);
          if (!item) return;
          if (next.buildxact.connection?.status !== "connected") {
            item.status = "pending";
            item.lastError = "Buildxact is disconnected. Payload retained locally until connection is configured.";
            pushToast(next, { tone: "critical", title: "Buildxact disconnected", body: item.lastError });
            return;
          }
          if (item.status === "read-only" || next.buildxact.readOnlyMode) {
            item.status = "read-only";
            item.lastError = "Read-only mode enabled. Nothing was pushed to Buildxact.";
            next.buildxact.syncHistory.unshift(
              createBuildxactSyncHistory({
                type: item.type,
                reference: item.reference,
                siteId: item.siteId,
                status: "skipped",
                payloadSize: item.payloadSize,
                error: item.lastError,
              }),
            );
            next.buildxact.syncHistory = next.buildxact.syncHistory.slice(0, 180);
            return;
          }
          const shouldFail = item.type.toLowerCase().includes("labour") || item.reference.toLowerCase().includes("pay");
          item.status = shouldFail ? "error" : "sent";
          item.attempts = Number(item.attempts || 0) + 1;
          item.lastAttemptAt = nowStamp();
          item.lastError = shouldFail ? "Missing Buildxact cost code mapping for labour export." : null;
          const historyEntry = {
            id: randomId("bx"),
            type: item.type,
            reference: item.reference,
            siteId: item.siteId,
            payloadSize: item.payloadSize,
            status: shouldFail ? "error" : "success",
            duration: shouldFail ? "982ms" : "488ms",
            at: nowStamp(),
            error: shouldFail ? "Missing Buildxact cost code mapping for labour export." : undefined,
          };
          next.buildxact.syncHistory.unshift(historyEntry);
          next.buildxact.syncHistory = next.buildxact.syncHistory.slice(0, 180);
          if (shouldFail) {
            next.buildxact.manualReview.unshift({
              id: randomId("bx-review"),
              queueId: item.id,
              type: item.type,
              reference: item.reference,
              siteId: item.siteId,
              reason: historyEntry.error,
              status: "manual-review",
              createdAt: nowStamp(),
            });
            next.buildxact.manualReview = next.buildxact.manualReview.slice(0, 80);
            helpers.emit({
              eventType: "buildxact.sync-error",
              title: `Buildxact sync error - ${item.reference}`,
              body: historyEntry.error,
              siteId: item.siteId,
              entityType: "sync",
              entityId: historyEntry.id,
              recipients: getRecipientsForRoles(next, ["Contract Admin"]),
              route: { kind: "internal", siteId: item.siteId, page: "integrations", entityId: historyEntry.id },
            });
          }
        });
      },
      async generateOperationsReport(reportType = "weekly-site-operations", siteId = null) {
        const report = buildOperationsReport(state, reportType, siteId || state.session.siteId);
        try {
          const site = state.sites.find((entry) => entry.id === report.siteId) || {};
          const company = state.org?.settings?.company || state.company || APP_CONFIG.builder;
          const blob = await generateOperationsReportPdfBlob({ report, company, site });
          const blobId = `operations-report-${report.id}`;
          await putBlob(blobId, blob);
          mutate((next, helpers) => {
            const document = {
              id: randomId("doc"),
              siteId: report.siteId,
              title: report.title,
              category: "Operations Report",
              type: "report",
              rev: "Issued",
              date: formatDate(),
              clientVisible: false,
              tags: ["operations-report", report.reportType],
              fileId: blobId,
              fileName: `${report.number}.pdf`,
              mimeType: "application/pdf",
              retentionCategory: "operations-report",
              retentionUntil: addDays(formatDate(), 2557),
              reportId: report.id,
              linkedRecords: [],
            };
            next.documents.unshift(document);
            next.boardReports.unshift({ ...report, documentId: document.id, fileId: blobId });
            next.boardReports = next.boardReports.slice(0, 80);
            helpers.addAudit({
              action: "report.generate",
              entityType: "boardReport",
              entityId: report.id,
              before: null,
              after: { reportType, documentId: document.id },
              siteId: report.siteId,
            });
            helpers.emit({
              eventType: "report.generated",
              title: `${report.title} generated`,
              body: `${report.number} is stored in Document Control.`,
              siteId: report.siteId,
              entityType: "document",
              entityId: document.id,
              recipients: getRecipientsForRoles(next, ["Project Manager", "Director"]),
              route: { kind: "internal", siteId: report.siteId, page: "docs", entityId: document.id },
            });
          });
        } catch (error) {
          mutate((next) => {
            pushToast(next, { tone: "critical", title: "Report generation failed", body: error?.message || "PDF tooling unavailable." });
          });
        }
      },
      queueScheduledReports() {
        mutate((next, helpers) => {
          const queuedAt = nowStamp();
          const due = next.reportSchedules.filter((schedule) => schedule.enabled && schedule.lastQueuedAt !== queuedAt.slice(0, 10));
          due.forEach((schedule) => {
            next.reportQueue.unshift({
              id: randomId("rq"),
              reportType: schedule.reportType,
              status: "queued",
              queuedAt,
              scheduleId: schedule.id,
              siteId: next.session.siteId,
              recipients: schedule.recipients,
            });
            schedule.lastQueuedAt = queuedAt.slice(0, 10);
          });
          next.reportQueue = next.reportQueue.slice(0, 80);
          if (due.length) {
            helpers.emit({
              eventType: "report.scheduled",
              title: `${due.length} scheduled operations reports queued`,
              body: "Queued reports can be generated from the Reports page.",
              siteId: next.session.siteId,
              entityType: "reportQueue",
              entityId: next.reportQueue[0]?.id,
              recipients: getRecipientsForRoles(next, ["Project Manager", "Director"]),
              route: { kind: "internal", siteId: next.session.siteId, page: "rpts" },
            });
          }
        });
      },
      async generateWeeklyOperationsSummary() {
        const snapshot = stateRef.current;
        const integrationSettings = snapshot.device?.settings?.integrations || snapshot.settings?.integrations || {};
        const aiConfig = getStoredAiConfig(integrationSettings);
        const signed = snapshot.approvals.filter((approval) => approval.status === "signed");
        const stalled = snapshot.approvals.filter((approval) => ["awaiting-client", "question", "changes-requested"].includes(approval.status));
        const openProblems = snapshot.problems.filter((problem) => problem.status !== "closed");
        const activeSites = snapshot.sites.filter((site) => site.status === "active");
        const localSummary = `Last week across ${activeSites.length} active sites: ${signed.length} approvals signed (${formatCurrency(signed.reduce((sum, approval) => sum + Number(approval.costImpact || 0), 0))} recovered), ${stalled.length} approvals awaiting client response, ${openProblems.length} open problems.`;

        mutate((next, helpers) => {
          next.boardInsightsCache = {
            ...(next.boardInsightsCache || {}),
            generatedAt: nowStamp(),
            aiWeeklySummary: localSummary,
            suggestedActions: ["Review stalled ClientFlow approvals", "Convert open recovery opportunities", "Close compliance acknowledgement gaps"],
            source: "local-template",
            upgradeStartedAt: nowStamp(),
          };
          if (!aiConfig.apiKey || snapshot.org?.mode === "demo") {
            helpers.emit({
              eventType: "ai.weekly-summary",
              title: "Weekly operations summary ready",
              body: localSummary,
              siteId: next.session.siteId,
              entityType: "boardReport",
              entityId: "ai-weekly-summary",
              recipients: getRecipientsForRoles(next, ["Director", "Project Manager"]),
              route: { kind: "director", page: "boardroom" },
            });
          }
        });

        if (!aiConfig.apiKey || snapshot.org?.mode === "demo") return;

        const projectContext = {
          orgMode: snapshot.org?.mode,
          activeSites: activeSites.map((site) => ({ id: site.id, name: site.name, contractValue: site.contractValue, status: site.status })),
          signedThisWeek: signed.slice(0, 8).map((approval) => ({ title: approval.title, costImpact: approval.costImpact, type: approval.type })),
          stalledApprovals: stalled.slice(0, 8).map((approval) => ({ title: approval.title, status: approval.status, dueAt: approval.dueAt, sentAt: approval.sentAt })),
          openProblems: openProblems.slice(0, 8).map((problem) => ({ title: problem.title, severity: problem.severity, status: problem.status })),
          recoveryOpportunities: (snapshot.recoveryOpportunities || []).filter((opportunity) => opportunity.status === "open").slice(0, 6),
        };
        const result = await askSiteForgeAi({
          userMessage: `You are writing a weekly operations briefing for the building company's director. Reply ONLY as JSON:
{
  "summary": "3-4 sentence executive briefing covering financial recovery, stalled commercial items, and operational risk",
  "suggestedActions": ["short action 1", "short action 2", "short action 3"],
  "riskFlags": ["specific risk worth attention 1", "specific risk worth attention 2"]
}

Context:
${JSON.stringify(projectContext)}

Be specific about numbers. Reference Australian construction realities such as HIA contracts, weather, and council inspections. Be commercially direct.`,
          projectContext,
          provider: aiConfig.provider,
          apiKey: aiConfig.apiKey,
          model: aiConfig.model,
          openaiProxyUrl: aiConfig.openaiProxyUrl,
          allowInDemo: false,
        });

        if (result.source !== "claude" && result.source !== "openai") {
          mutate((next) => {
            if (next.boardInsightsCache) {
              next.boardInsightsCache.source = result.source || "ai-failed";
              next.boardInsightsCache.aiError = result.text;
            }
          });
          return;
        }

        try {
          const match = result.text.match(/\{[\s\S]*\}/);
          const parsed = JSON.parse(match ? match[0] : result.text);
          mutate((next, helpers) => {
            const suggestedActions = Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.slice(0, 6) : [];
            const riskFlags = Array.isArray(parsed.riskFlags) ? parsed.riskFlags.slice(0, 6) : [];
            const generatedAt = nowStamp();
            next.boardInsightsCache = {
              ...(next.boardInsightsCache || {}),
              generatedAt,
              aiWeeklySummary: parsed.summary || localSummary,
              suggestedActions,
              riskFlags,
              source: result.source,
              aiError: null,
            };
            next.aiCache = next.aiCache || { weeklyClientSummary: {}, boardInsights: {} };
            next.aiCache.boardInsights = next.aiCache.boardInsights || {};
            next.aiCache.boardInsights.portfolio = {
              summary: parsed.summary || localSummary,
              actions: suggestedActions,
              riskFlags,
              generatedAt,
              source: result.source,
              basedOnPortfolioHash: `manual-${generatedAt}`,
            };
            helpers.emit({
              eventType: "ai.weekly-summary",
              title: `AI weekly briefing ready (${result.source === "openai" ? "ChatGPT" : "Claude"})`,
              body: String(parsed.summary || localSummary).slice(0, 200),
              siteId: snapshot.session.siteId,
              entityType: "boardReport",
              entityId: "ai-weekly-summary",
              recipients: getRecipientsForRoles(next, ["Director", "Project Manager"]),
              route: { kind: "director", page: "boardroom" },
            });
          });
        } catch (error) {
          mutate((next) => {
            if (next.boardInsightsCache) {
              next.boardInsightsCache.source = "ai-parse-error";
              next.boardInsightsCache.aiError = "AI responded but could not be parsed.";
            }
          });
        }
      },
	      async generateBoardReport() {
	        const snapshot = stateRef.current;
	        const reportId = randomId("br");
	        const metrics = buildMetrics(snapshot);
	        const insight = boardInsights({
	          sites: snapshot.sites,
	          approvals: snapshot.approvals.filter((approval) => ["awaiting-client", "question", "contract-awaiting-client"].includes(approval.status)),
	          presence: snapshot.presence.records,
	        });
	        const localSummary = `${insight.summary} Margin at risk currently stands at ${formatCurrency(metrics.portfolio.totalMarginAtRisk)}.`;
	        const createdAt = nowStamp();
	        mutate((next) => {
	          next.boardReports.unshift({
	            id: reportId,
	            period: next.session.period,
	            createdAt,
	            title: `${next.session.period} board report`,
	            summary: localSummary,
	            source: "local-template",
	            upgradeStartedAt: nowStamp(),
	            suggestedActions: insight.suggestedActions || [],
	            riskFlags: insight.topRisks || [],
	          });
	          next.boardReports = next.boardReports.slice(0, 80);
	        });

	        const integrationSettings = snapshot.device?.settings?.integrations || snapshot.settings?.integrations || {};
	        const aiConfig = getStoredAiConfig(integrationSettings);
	        if (!aiConfig.apiKey || snapshot.org?.mode === "demo") return;

	        const projectContext = {
	          orgMode: snapshot.org?.mode,
	          period: snapshot.session.period,
	          metrics: metrics.portfolio,
	          activeSites: snapshot.sites
	            .filter((site) => site.status === "active")
	            .map((site) => ({ id: site.id, name: site.name, contractValue: site.contractValue, progress: site.progress, risk: site.risk })),
	          stalledApprovals: snapshot.approvals
	            .filter((approval) => ["awaiting-client", "question", "contract-awaiting-client"].includes(approval.status))
	            .slice(0, 10)
	            .map((approval) => ({ title: approval.title, status: approval.status, costImpact: approval.costImpact, timeImpact: approval.timeImpact, sentAt: approval.sentAt })),
	          failedQa: snapshot.qa.filter((entry) => entry.status === "failed").slice(0, 8),
	          procurementDelays: snapshot.procurement.filter((entry) => ["delayed", "escalated"].includes(entry.status)).slice(0, 8),
	        };
	        const result = await askSiteForgeAi({
	          userMessage: `You are preparing a board report for an Australian residential building company director.

Reply ONLY as JSON:
{
  "summary": "4-5 sentence board-ready executive summary covering commercial recovery, delivery risk, QA/safety, and cash/margin exposure",
  "suggestedActions": ["specific director action 1", "specific director action 2", "specific director action 3"],
  "riskFlags": ["specific risk 1", "specific risk 2"]
}

Context:
${JSON.stringify(projectContext)}`,
	          projectContext,
	          provider: aiConfig.provider,
	          apiKey: aiConfig.apiKey,
	          model: aiConfig.model,
	          openaiProxyUrl: aiConfig.openaiProxyUrl,
	          allowInDemo: false,
	        });

	        if (result.source !== "claude" && result.source !== "openai") {
	          mutate((next) => {
	            const report = next.boardReports.find((item) => item.id === reportId);
	            if (report) {
	              report.source = result.source || "ai-failed";
	              report.aiError = result.text || "AI board report upgrade failed.";
	            }
	          });
	          return;
	        }

	        try {
	          const match = result.text.match(/\{[\s\S]*\}/);
	          const parsed = JSON.parse(match ? match[0] : result.text);
	          mutate((next, helpers) => {
	            const report = next.boardReports.find((item) => item.id === reportId);
	            if (!report) return;
	            report.summary = parsed.summary || report.summary;
	            report.suggestedActions = Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.slice(0, 6) : report.suggestedActions || [];
	            report.riskFlags = Array.isArray(parsed.riskFlags) ? parsed.riskFlags.slice(0, 6) : report.riskFlags || [];
	            report.source = result.source;
	            report.generatedAt = nowStamp();
	            delete report.upgradeStartedAt;
	            helpers.emit({
	              eventType: "ai.board-report",
	              title: `AI board report ready (${result.source === "openai" ? "ChatGPT" : "Claude"})`,
	              body: report.summary.slice(0, 200),
	              siteId: next.session.siteId,
	              entityType: "boardReport",
	              entityId: report.id,
	              recipients: getRecipientsForRoles(next, ["Director", "Project Manager"]),
	              route: { kind: "director", page: "boardroom", entityId: report.id },
	            });
	          });
	        } catch (error) {
	          mutate((next) => {
	            const report = next.boardReports.find((item) => item.id === reportId);
	            if (report) {
	              report.source = "ai-parse-error";
	              report.aiError = "AI responded but could not be parsed.";
	            }
	          });
	        }
	      },
      sendDirectorEscalation(siteId, title) {
        mutate((next, helpers) => {
          helpers.emit({
            eventType: "approval.stalled",
            title: `Director escalation - ${title}`,
            body: "Item has aged beyond threshold and has been escalated to the PM via Teams.",
            siteId,
            entityType: "approval",
            entityId: randomId("esc"),
            recipients: getRecipientsForRoles(next, ["Project Manager"]),
            route: { kind: "internal", siteId, page: "clientflow", entityId: null },
          });
        });
      },
      addClientMessage(clientId, body, approvalId = null) {
        mutate((next, helpers) => {
          if (!body.trim()) return;
          const clientUser = next.users.find((user) => user.clientId === clientId);
          helpers.addMessage(
            approvalId ? "approval" : "client-general",
            approvalId || clientId,
            [helpers.actor.id, clientUser?.id].filter(Boolean),
            body,
            helpers.actor.id,
          );
        });
      },
      addConversationMessage(threadType, threadId, participants, body) {
        mutate((next, helpers) => {
          if (!body.trim()) return;
          helpers.addMessage(threadType, threadId || randomId("msg"), participants, body, helpers.actor.id);
        });
      },
      updateClientPreferences(clientId, patch) {
        mutate((next) => {
          const client = next.clients.find((entry) => entry.id === clientId);
          if (!client) return;
          Object.assign(client, patch);
        });
      },
      generateWorkerEndOfDay(userId) {
        mutate((next, helpers) => {
          const user = next.users.find((item) => item.id === userId) || helpers.actor;
          const siteId = user.siteIds?.[0] || next.session.siteId;
          const site = next.sites.find((item) => item.id === siteId);
          const summary = generateEndOfDay(
            site,
            next.tasks.filter((task) => task.siteId === siteId && task.assigneeId === user.id),
            next.problems.filter((problem) => problem.siteId === siteId),
            next.procurement.filter((item) => item.siteId === siteId),
            next.diary.filter((entry) => entry.siteId === siteId),
            next.presence.records.filter((entry) => entry.siteId === siteId),
          );
          appendProjectLog(next, siteId, `End of day summary - ${user.name}`, summary);
          helpers.addAudit({
            action: "worker.end-of-day",
            entityType: "site",
            entityId: siteId,
            before: null,
            after: { summary },
            siteId,
          });
        });
      },
      dismissToast(toastId) {
        mutate((next) => {
          next.demo.recentToasts = next.demo.recentToasts.filter((entry) => entry.id !== toastId);
        });
      },
      runSystemSweep() {
        mutate((next, helpers) => {
          runTimedAutomationSweep(next, helpers);
        });
      },
      refreshAiInsightCache,
      async verifyIndexedAuditChain() {
        const result = await Audit.verify();
        mutate((next) => {
          next.ui.auditVerification = result;
        });
        return result;
      },
      updateEntity(type, entityId, patch) {
        mutate((next, helpers) => {
          const { path, collection } = getCollectionRef(next, type);
          if (!Array.isArray(collection)) return;
          const index = collection.findIndex((entry) => entry.id === entityId || entry.docId === entityId);
          if (index === -1) return;
          const before = cloneState(collection[index]);
          collection[index] = { ...collection[index], ...patch, updatedAt: nowStamp() };
          setByPath(next, path, collection);
          helpers.addAudit({
            action: `${type}.update`,
            entityType: type,
            entityId,
            before,
            after: collection[index],
            siteId: collection[index].siteId || next.session.siteId,
          });
        });
      },
      archiveEntity(type, entityId) {
        mutate((next, helpers) => {
          const record = findInCollection(next, type, entityId);
          if (!record) return;
          const before = cloneState(record);
          record.archived = true;
          record.archivedAt = nowStamp();
          if (record.status && record.status !== "signed") {
            record.status = "archived";
          }
          helpers.addAudit({
            action: `${type}.archive`,
            entityType: type,
            entityId,
            before,
            after: record,
            siteId: record.siteId || next.session.siteId,
          });
        });
      },
      restoreEntity(type, entityId) {
        mutate((next, helpers) => {
          const record = findInCollection(next, type, entityId);
          if (!record) return;
          const before = cloneState(record);
          record.archived = false;
          if (record.status === "archived") {
            record.status = type === "task" ? "todo" : "draft";
          }
          helpers.addAudit({
            action: `${type}.restore`,
            entityType: type,
            entityId,
            before,
            after: record,
            siteId: record.siteId || next.session.siteId,
          });
        });
      },
      deleteEntity(type, entityId) {
        mutate((next, helpers) => {
          const { path, collection } = getCollectionRef(next, type);
          if (!Array.isArray(collection)) return;
          const target = collection.find((entry) => entry.id === entityId || entry.docId === entityId);
          if (!target) return;
          const filtered = collection.filter((entry) => entry.id !== entityId && entry.docId !== entityId);
          setByPath(next, path, filtered);
          helpers.addAudit({
            action: `${type}.delete`,
            entityType: type,
            entityId,
            before: target,
            after: null,
            siteId: target.siteId || next.session.siteId,
          });
        });
      },
      duplicateEntity(type, entityId) {
        mutate((next, helpers) => {
          const { path, collection } = getCollectionRef(next, type);
          if (!Array.isArray(collection)) return;
          const target = collection.find((entry) => entry.id === entityId || entry.docId === entityId);
          if (!target) return;
          const duplicate = {
            ...cloneState(target),
            id: randomId(type.slice(0, 3)),
            docId: target.docId ? `${target.docId}-copy` : undefined,
            number: target.number ? `${target.number}-COPY` : undefined,
            title: target.title ? `${target.title} (Copy)` : target.title,
            name: target.name ? `${target.name} (Copy)` : target.name,
            archived: false,
            archivedAt: null,
            status: ["signed", "approved", "paid"].includes(target.status) ? "draft" : target.status,
            createdAt: nowStamp(),
            updatedAt: nowStamp(),
          };
          collection.unshift(duplicate);
          setByPath(next, path, collection);
          helpers.addAudit({
            action: `${type}.duplicate`,
            entityType: type,
            entityId: duplicate.id || duplicate.docId,
            before: null,
            after: duplicate,
            siteId: duplicate.siteId || next.session.siteId,
          });
        });
      },
      reopenTask(taskId) {
        mutate((next, helpers) => {
          const task = next.tasks.find((entry) => entry.id === taskId);
          if (!task) return;
          const before = { status: task.status, progress: task.progress };
          task.status = "todo";
          task.progress = 0;
          helpers.addAudit({
            action: "task.reopen",
            entityType: "task",
            entityId: task.id,
            before,
            after: { status: task.status, progress: task.progress },
            siteId: task.siteId,
          });
        });
      },
      reassignTask(taskId, assigneeId) {
        mutate((next, helpers) => {
          const task = next.tasks.find((entry) => entry.id === taskId);
          if (!task) return;
          const before = { assigneeId: task.assigneeId };
          task.assigneeId = assigneeId;
          helpers.addAudit({
            action: "task.reassign",
            entityType: "task",
            entityId: task.id,
            before,
            after: { assigneeId },
            siteId: task.siteId,
          });
        });
      },
      bulkUpdateTasks(taskIds, status) {
        mutate((next, helpers) => {
          next.tasks.forEach((task) => {
            if (!taskIds.includes(task.id)) return;
            const before = { status: task.status };
            task.status = status;
            task.progress = status === "done" ? 100 : status === "in-progress" ? Math.max(task.progress || 0, 35) : 0;
            helpers.addAudit({
              action: "task.bulk-status",
              entityType: "task",
              entityId: task.id,
              before,
              after: { status: task.status },
              siteId: task.siteId,
            });
          });
        });
      },
      setProblemStatus(problemId, status) {
        mutate((next, helpers) => {
          const problem = next.problems.find((entry) => entry.id === problemId);
          if (!problem) return;
          const before = { status: problem.status };
          problem.status = status;
          helpers.addAudit({
            action: "problem.status",
            entityType: "problem",
            entityId: problem.id,
            before,
            after: { status },
            siteId: problem.siteId,
          });
        });
      },
      reopenRfi(rfiId) {
        mutate((next, helpers) => {
          const rfi = next.rfis.find((entry) => entry.id === rfiId);
          if (!rfi) return;
          const before = { status: rfi.status };
          rfi.status = "open";
          rfi.overdueNotifiedAt = null;
          helpers.addAudit({
            action: "rfi.reopen",
            entityType: "rfi",
            entityId: rfi.id,
            before,
            after: { status: rfi.status },
            siteId: rfi.siteId,
          });
        });
      },
      approveVariation(variationId) {
        mutate((next, helpers) => {
          const variation = next.variations.find((entry) => entry.id === variationId);
          if (!variation) return;
          const before = { status: variation.status };
          variation.status = "approved";
          helpers.addAudit({
            action: "variation.approve",
            entityType: "variation",
            entityId: variation.id,
            before,
            after: { status: variation.status },
            siteId: variation.siteId,
          });
          helpers.emit({
            eventType: "variation.approved",
            title: `Variation approved - ${variation.title}`,
            body: `${variation.number} is approved and ready for contract formalisation.`,
            siteId: variation.siteId,
            entityType: "variation",
            entityId: variation.id,
            recipients: getRecipientsForRoles(next, ["Contract Admin", "Project Manager"]),
            route: { kind: "internal", siteId: variation.siteId, page: "vos", entityId: variation.id },
          });
        });
      },
      splitVariation(variationId, payload) {
        mutate((next, helpers) => {
          const variation = next.variations.find((entry) => entry.id === variationId);
          if (!variation) return;
          const splitValue = Math.max(0, Number(payload?.value || variation.value / 2));
          const duplicate = {
            ...cloneState(variation),
            id: randomId("var"),
            number: `VO-${String(next.variations.length + 1).padStart(3, "0")}`,
            title: payload?.title || `${variation.title} - Split`,
            value: splitValue,
            days: Number(payload?.days || 0),
            status: "draft",
            clientApprovalId: null,
            contractPackId: null,
            createdBy: helpers.actor.id,
          };
          variation.value = Math.max(0, Number(variation.value || 0) - splitValue);
          next.variations.unshift(duplicate);
          helpers.addAudit({
            action: "variation.split",
            entityType: "variation",
            entityId: duplicate.id,
            before: null,
            after: duplicate,
            siteId: duplicate.siteId,
          });
        });
      },
      transitionProcurement(itemId, nextStatus, details = {}) {
        mutate((next, helpers) => {
          const item = next.procurement.find((entry) => entry.id === itemId);
          if (!item) return;
          const before = cloneState(item);
          Object.assign(item, details, { status: nextStatus, updatedAt: nowStamp() });
          if (nextStatus === "supplier-confirmed" && item.eta) {
            item.confirmedAt = nowStamp();
          }
          if (nextStatus === "delivered" && details.signatureName) {
            item.deliverySignature = details.signatureName;
          }
          if (nextStatus === "invoice-received") {
            item.invoiceReceivedAt = nowStamp();
          }
          helpers.addAudit({
            action: "procurement.transition",
            entityType: "procurement",
            entityId: item.id,
            before,
            after: item,
            siteId: item.siteId,
          });
          if (["delayed", "escalated"].includes(nextStatus)) {
            helpers.emit({
              eventType: "procurement.delayed",
              title: `Procurement delayed - ${item.item}`,
              body: "SiteForge suggests an EOT claim or resequencing response.",
              siteId: item.siteId,
              entityType: "procurement",
              entityId: item.id,
              recipients: getRecipientsForRoles(next, ["Project Manager"]),
              route: { kind: "internal", siteId: item.siteId, page: "mats", entityId: item.id },
            });
          }
        });
      },
      updateQaNotes(qaId, notes) {
        mutate((next, helpers) => {
          const qa = next.qa.find((entry) => entry.id === qaId);
          if (!qa) return;
          const before = { notes: qa.notes };
          qa.notes = notes;
          helpers.addAudit({
            action: "qa.notes",
            entityType: "qa",
            entityId: qa.id,
            before,
            after: { notes },
            siteId: qa.siteId,
          });
        });
      },
      reopenQa(qaId) {
        mutate((next, helpers) => {
          const qa = next.qa.find((entry) => entry.id === qaId);
          if (!qa) return;
          const before = { status: qa.status, passCount: qa.passCount };
          qa.status = "scheduled";
          qa.passCount = 0;
          helpers.addAudit({
            action: "qa.reopen",
            entityType: "qa",
            entityId: qa.id,
            before,
            after: { status: qa.status, passCount: qa.passCount },
            siteId: qa.siteId,
          });
        });
      },
      closeSafetyRecord(safetyId, investigation) {
        mutate((next, helpers) => {
          const record = next.safety.find((entry) => entry.id === safetyId);
          if (!record) return;
          const before = { status: record.status, investigation: record.investigation };
          record.closedAt = nowStamp();
          record.investigation = investigation;
          record.status = "closed";
          helpers.addAudit({
            action: "safety.close",
            entityType: "safety",
            entityId: record.id,
            before,
            after: { status: record.status, investigation },
            siteId: record.siteId,
          });
        });
      },
      withdrawApproval(approvalId) {
        mutate((next, helpers) => {
          const approval = next.approvals.find((entry) => entry.id === approvalId);
          if (!approval) return;
          const before = { status: approval.status };
          approval.status = "withdrawn";
          helpers.addAudit({
            action: "approval.withdraw",
            entityType: "approval",
            entityId: approval.id,
            before,
            after: { status: approval.status },
            siteId: approval.siteId,
          });
        });
      },
      resendApproval(approvalId) {
        mutate((next, helpers) => {
          const approval = next.approvals.find((entry) => entry.id === approvalId);
          if (!approval) return;
          const before = { status: approval.status, sentAt: approval.sentAt };
          prepareApprovalForClientIssue(next, approval, helpers.actor);
          approval.magicLink.resendCount = Number(approval.magicLink?.resendCount || 0) + 1;
          approval.sentAt = nowStamp();
          approval.status = "awaiting-client";
          approval.stalledNotifiedAt = null;
          helpers.appendTimeline(approval, {
            type: "resent",
            actor: actorName(helpers.actor),
            role: helpers.actor.role,
            text: `Approval resent to client across ${Object.keys(approval.deliveryChannels || {}).filter((channel) => approval.deliveryChannels[channel]).join(", ")}.`,
          });
          helpers.addAudit({
            action: "approval.resend",
            entityType: "approval",
            entityId: approval.id,
            before,
            after: { status: approval.status, sentAt: approval.sentAt, resendCount: approval.magicLink.resendCount },
            siteId: approval.siteId,
          });
          helpers.emit({
            eventType: "approval.created",
            title: `Approval resent - ${approval.title}`,
            body: approval.summary,
            siteId: approval.siteId,
            entityType: "approval",
            entityId: approval.id,
            recipients: [...getRecipientsForRoles(next, ["Project Manager"]), ...getRecipientsForClient(next, approval.clientId)],
            route: { kind: "internal", siteId: approval.siteId, page: "clientflow", entityId: approval.id },
          });
        });
      },
      archiveApproval(approvalId) {
        mutate((next, helpers) => {
          const approval = next.approvals.find((entry) => entry.id === approvalId);
          if (!approval) return;
          const before = { archived: approval.archived, status: approval.status };
          approval.archived = true;
          approval.archivedAt = nowStamp();
          approval.status = approval.status === "signed" ? "signed" : "archived";
          helpers.addAudit({
            action: "approval.archive",
            entityType: "approval",
            entityId: approval.id,
            before,
            after: { archived: approval.archived, status: approval.status },
            siteId: approval.siteId,
          });
        });
      },
      scheduleCallback(clientId, slotId, approvalId, notes = "") {
        mutate((next, helpers) => {
          const slot = next.pmAvailability.find((entry) => entry.id === slotId && !entry.booked);
          const client = next.clients.find((entry) => entry.id === clientId);
          if (!slot || !client) return;
          slot.booked = true;
          slot.bookedForClientId = clientId;
          slot.bookedForApprovalId = approvalId || null;
          next.callbacks.unshift({
            id: randomId("cb"),
            clientId,
            approvalId: approvalId || null,
            pmUserId: slot.userId,
            slotId: slot.id,
            at: slot.at,
            label: slot.label,
            notes,
            status: "booked",
          });
          helpers.addAudit({
            action: "callback.booked",
            entityType: "client",
            entityId: clientId,
            before: null,
            after: { slotId: slot.id, approvalId },
            siteId: next.sites.find((entry) => entry.clientId === clientId)?.id || next.session.siteId,
          });
          helpers.emit({
            eventType: "approval.question",
            title: `Client callback booked - ${client.name}`,
            body: `Callback booked for ${slot.label}.`,
            siteId: next.sites.find((entry) => entry.clientId === clientId)?.id || next.session.siteId,
            entityType: "approval",
            entityId: approvalId,
            recipients: getRecipientsForRoles(next, ["Project Manager"]),
            route: { kind: "internal", siteId: next.sites.find((entry) => entry.clientId === clientId)?.id || next.session.siteId, page: "clientflow", entityId: approvalId },
          });
        });
      },
      createInvoiceDraft(payload = {}) {
        mutate((next, helpers) => {
          const invoice = {
            id: randomId("inv"),
            companyId: payload.companyId || helpers.actor.companyId,
            siteId: payload.siteId || next.session.siteId,
            number: payload.number || `INV-${String(next.invoices.length + 1).padStart(3, "0")}`,
            value: Number(payload.value || 0),
            status: "draft",
            period: payload.period || formatDate().slice(0, 7),
            expectedPaymentDate: payload.expectedPaymentDate || addDays(formatDate(), 14),
            lineItems: payload.lineItems || [],
            notes: payload.notes || "",
            createdBy: helpers.actor.id,
          };
          next.invoices.unshift(invoice);
          helpers.addAudit({
            action: "invoice.create",
            entityType: "invoice",
            entityId: invoice.id,
            before: null,
            after: invoice,
            siteId: invoice.siteId,
          });
        });
      },
      updateInvoice(invoiceId, patch) {
        mutate((next, helpers) => {
          const invoice = next.invoices.find((entry) => entry.id === invoiceId);
          if (!invoice) return;
          const before = cloneState(invoice);
          Object.assign(invoice, patch, { updatedAt: nowStamp() });
          helpers.addAudit({
            action: "invoice.update",
            entityType: "invoice",
            entityId: invoice.id,
            before,
            after: invoice,
            siteId: invoice.siteId,
          });
        });
      },
      setInvoiceStatus(invoiceId, status) {
        mutate((next, helpers) => {
          const invoice = next.invoices.find((entry) => entry.id === invoiceId);
          if (!invoice) return;
          const before = { status: invoice.status };
          invoice.status = status;
          if (status === "paid" && !invoice.paidAt) {
            invoice.paidAt = nowStamp();
          }
          helpers.addAudit({
            action: "invoice.status",
            entityType: "invoice",
            entityId: invoice.id,
            before,
            after: { status: invoice.status },
            siteId: invoice.siteId,
          });
        });
      },
      saveCalculatorResult(payload) {
        mutate((next) => {
          next.calculatorHistory.unshift({
            id: randomId("calc"),
            at: nowStamp(),
            ...payload,
          });
          next.calculatorHistory = next.calculatorHistory.slice(0, 50);
        });
      },
      saveCalculationToProcurement(payload) {
        mutate((next, helpers) => {
          const item = {
            id: randomId("proc"),
            siteId: next.session.siteId,
            item: payload.item,
            quantity: payload.quantity,
            requestedBy: helpers.actor.id,
            status: "requested",
            date: formatDate(),
            eta: payload.eta || "",
            supplier: payload.supplier || "",
            poNumber: "",
            cost: Number(payload.cost || 0),
            linkedApprovalId: null,
            linkedRecords: [{ type: "calculator", id: payload.historyId || randomId("calc"), label: payload.calculator || "Calculator result", siteId: next.session.siteId }],
          };
          next.procurement.unshift(item);
        });
      },
      async uploadTemplateFiles(fileList) {
        const incoming = Array.from(fileList || []);
        const uploadedTemplateIds = [];
        for (const file of incoming) {
          const metadata = await uploadFile({
            file,
            uploadedBy: state.session.userId,
            siteId: state.session.siteId,
            entityType: "template",
          });
          const extracted = metadata.extractedText || metadata.seedContent || "";
          const templateParse = parseTemplate(extracted);
          const templateId = randomId("tpl");
          const tokenAliases = Object.fromEntries(
            templateParse.tokens
              .map((token) => [token, inferTokenAlias(token)])
              .filter(([, alias]) => alias),
          );
          uploadedTemplateIds.push(templateId);
          setState((previous) => {
            const next = cloneState(previous);
            next.files.records.unshift(metadata);
            next.contractTemplates.unshift({
              id: templateId,
              type: inferTemplateType(metadata.name),
              name: metadata.name.replace(/\.[^.]+$/, ""),
              version: "v1",
              status: "draft",
              branding: firstMeaningfulLine(extracted, "Uploaded template pending review"),
              classification: metadata.classification,
              clauses: clausesFromText(extracted),
              versionHistory: [{ id: randomId("tplh"), version: "v1", at: nowStamp(), by: actorName(getCurrentUser(next)) }],
              mergeTokens: templateParse.tokens,
              tokenAliases,
              sourceFileId: metadata.id,
              sourceContent: extracted,
            });
            next.ui.activeTemplateId = templateId;
            return normaliseState(next);
          });
        }
        return uploadedTemplateIds;
      },
      createTemplate(payload) {
        mutate((next, helpers) => {
          next.contractTemplates.unshift({
            id: randomId("tpl"),
            type: payload.type || "Variation",
            name: payload.name,
            version: "v1",
            status: "active",
            branding: payload.branding || "Custom template",
            clauses: payload.clauses || [],
            versionHistory: [{ id: randomId("tplh"), version: "v1", at: nowStamp(), by: actorName(helpers.actor) }],
            sourceContent: payload.sourceContent || "",
            mergeTokens: parseTemplate(payload.sourceContent || "").tokens,
            tags: payload.tags || [],
          });
        });
      },
	      saveTemplateVersion(templateId, patch) {
	        mutate((next, helpers) => {
	          const template = next.contractTemplates.find((entry) => entry.id === templateId);
	          if (!template) return;
          const nextVersion = `v${(Number(template.version?.replace(/[^\d]/g, "")) || 1) + 1}`;
          Object.assign(template, patch, {
            version: nextVersion,
            mergeTokens: parseTemplate(patch.sourceContent || template.sourceContent || "").tokens,
          });
          template.versionHistory = [
            { id: randomId("tplh"), version: nextVersion, at: nowStamp(), by: actorName(helpers.actor) },
            ...(template.versionHistory || []),
	          ];
	        });
	      },
	      async aiAutofillContractFields({ templateId, approvalId } = {}) {
	        const snapshot = stateRef.current;
	        const template = snapshot.contractTemplates.find((entry) => entry.id === templateId);
	        const approval = approvalId ? snapshot.approvals.find((entry) => entry.id === approvalId) : null;
	        if (!template) return { ok: false, error: "Template not found." };

	        const templateBody = template.sourceContent || (template.clauses || []).join("\n");
	        const tokens = [
	          ...new Set(
	            [...templateBody.matchAll(/\{\{([^}]+)\}\}/g)]
	              .map((match) => match[1].trim())
	              .filter(Boolean),
	          ),
	        ];
	        if (!tokens.length) return { ok: false, error: "No merge tokens found in this template." };

	        const integrationSettings = snapshot.device?.settings?.integrations || snapshot.settings?.integrations || {};
	        const aiConfig = getStoredAiConfig(integrationSettings);
	        if (!aiConfig.apiKey) return { ok: false, error: "No API key configured." };

	        const client = approval ? snapshot.clients.find((entry) => entry.id === approval.clientId) : null;
	        const site = approval ? snapshot.sites.find((entry) => entry.id === approval.siteId) : snapshot.sites[0];
	        const projectContext = {
	          orgMode: snapshot.org?.mode,
	          site,
	          client,
	          approval,
	          company: snapshot.company || snapshot.settings?.company,
	          today: new Date().toLocaleDateString("en-AU"),
	        };
	        const result = await askSiteForgeAi({
	          userMessage: `Fill these contract merge tokens for an Australian building project.
Tokens: ${tokens.join(", ")}
Context: ${JSON.stringify(projectContext)}
Reply ONLY as JSON: { ${tokens.map((token) => `"${token}": "value"`).join(", ")} }
AU date format DD/MM/YYYY. Amounts in AUD. Use formal contract language.`,
	          projectContext,
	          provider: aiConfig.provider,
	          apiKey: aiConfig.apiKey,
	          model: aiConfig.model,
	          openaiProxyUrl: aiConfig.openaiProxyUrl,
	          allowInDemo: false,
	        });

	        if (result.source !== "claude" && result.source !== "openai") {
	          return { ok: false, error: result.text || "AI did not return field values." };
	        }

	        try {
	          const match = result.text.match(/\{[\s\S]*\}/);
	          const filled = JSON.parse(match ? match[0] : result.text);
	          let applied = {};
	          mutate((next, helpers) => {
	            const nextTemplate = next.contractTemplates.find((entry) => entry.id === templateId);
	            if (!nextTemplate) return;
	            const existing = nextTemplate.aiFilledFields || {};
	            applied = Object.fromEntries(
	              Object.entries(filled)
	                .filter(([token, value]) => tokens.includes(token) && value != null && String(value).trim() && !String(existing[token] || "").trim())
	                .map(([token, value]) => [token, String(value)]),
	            );
	            nextTemplate.aiFilledFields = { ...existing, ...applied };
	            nextTemplate.aiFilledAt = nowStamp();
	            nextTemplate.aiFilledSource = result.source;
	            helpers.addAudit({
	              action: "contract-template.ai-autofill",
	              entityType: "template",
	              entityId: templateId,
	              before: { filledFields: existing },
	              after: { filledFields: nextTemplate.aiFilledFields, source: result.source },
	              siteId: site?.id || next.session.siteId,
	            });
	          });
	          return { ok: true, filled: applied, source: result.source };
	        } catch (error) {
	          return { ok: false, error: "AI responded but fields could not be parsed." };
	        }
	      },
	      createClause(payload) {
	        mutate((next) => {
	          next.clauseLibrary.unshift({
            id: randomId("cl"),
            title: payload.title,
            text: payload.text,
            tags: payload.tags || [],
            version: 1,
          });
        });
      },
      updateClause(clauseId, patch) {
        mutate((next) => {
          const clause = next.clauseLibrary.find((entry) => entry.id === clauseId);
          if (!clause) return;
          Object.assign(clause, patch, { version: Number(clause.version || 1) + 1 });
        });
      },
      async uploadDocumentRevision(file, siteId = state.session.siteId) {
        if (!file) return;
        const metadata = await uploadFile({
          file,
          uploadedBy: state.session.userId,
          siteId,
          entityType: "document",
        });
        let aiDiffRequest = null;
        setState((previous) => {
          const next = cloneState(previous);
          const helpers = createHelpers(previous, next);
          next.files.records.unshift(metadata);
          const drawingMatch = metadata.name.match(/([A-Z]-\d{3,})\s*Rev\s*([A-Z0-9]+)/i);
          const drawingNo = drawingMatch?.[1]?.toUpperCase() || metadata.parsedFields?.drawingNumber || metadata.name.replace(/\.[^.]+$/, "");
          const revision = drawingMatch?.[2]?.toUpperCase() || metadata.parsedFields?.revision || "A";
          const existing = next.documents.find((entry) => entry.siteId === siteId && (entry.drawingNumber === drawingNo || entry.title.toUpperCase().includes(drawingNo)));
          const changeSummary = existing ? diffPlans(existing, metadata) : { summary: "Initial issue uploaded to SiteForge.", affectedZones: [], notes: [] };
          const affectedTasks = existing?.linkedTaskIds || [];
          const acknowledgementUsers = [...new Set(next.tasks.filter((task) => affectedTasks.includes(task.id)).map((task) => task.assigneeId).filter(Boolean))];
          const document = {
            id: randomId("doc"),
            siteId,
            title: metadata.name.replace(/\.[^.]+$/, ""),
            drawingNumber: drawingNo,
            rev: `Rev ${revision}`,
            date: formatDate(),
            category: metadata.classification === "Plan / Drawing" ? "Drawing" : metadata.classification,
            clientVisible: false,
            tags: [drawingNo, revision, metadata.classification],
            linkedTaskIds: affectedTasks,
            revisionHistory: [
              ...(existing?.revisionHistory || []).map((entry) => ({ ...entry })),
              ...(existing ? [{ rev: existing.rev, date: existing.date }] : []),
              { rev: `Rev ${revision}`, date: formatDate() },
            ],
            archived: false,
            fileId: metadata.id,
            retentionCategory: metadata.classification === "Contract" ? "signed-contract" : "project-document",
            retentionUntil: addDays(formatDate(), 2557),
            expiryDate: metadata.parsedFields?.expiry || null,
            impactAnalysis: {
              oldDocumentId: existing?.id || null,
              summary: changeSummary.summary,
              affectedTasks,
              affectedRfis: existing?.impactAnalysis?.affectedRfis || [],
              affectedTrades: [...new Set(next.tasks.filter((task) => affectedTasks.includes(task.id)).map((task) => task.trade))],
              affectedZones: changeSummary.affectedZones || [],
              notes: changeSummary.notes || [],
              acknowledgementsRequired: acknowledgementUsers,
              acknowledgedBy: [],
            },
          };

          if (existing) {
            existing.archived = true;
            existing.supersededBy = document.id;
            const oldFile = next.files.records.find((entry) => entry.id === existing.fileId);
            aiDiffRequest = {
              documentId: document.id,
              siteId,
              oldText: oldFile?.extractedText || oldFile?.text || existing.impactAnalysis?.summary || "",
              newText: metadata.extractedText || metadata.text || changeSummary.summary || "",
            };
          }
          next.documents.unshift(document);
          acknowledgementUsers.forEach((userId) => {
            next.tasks.unshift({
              id: randomId("tsk"),
              siteId,
              title: `Acknowledge ${drawingNo} ${document.rev}`,
              description: changeSummary.summary,
              trade: next.users.find((entry) => entry.id === userId)?.trade || "General",
              companyId: next.users.find((entry) => entry.id === userId)?.companyId || "",
              assigneeId: userId,
              priority: "high",
              status: "todo",
              dueDate: formatDate(),
              progress: 0,
              crewRequired: 1,
              mobileMaterials: [],
              linkedRecords: [buildLink("document", document, siteId)],
              clientVisible: false,
            });
            const passport = next.passports.records.find((entry) => entry.userId === userId && entry.siteId === siteId);
            if (passport) {
              passport.blockedReasons = [...new Set([...(passport.blockedReasons || []), `${drawingNo} ${document.rev} not acknowledged`])];
              passport.acknowledgements = passport.acknowledgements || [];
              passport.acknowledgements.unshift({
                id: randomId("ack"),
                label: `${drawingNo} ${document.rev}`,
                done: false,
                documentId: document.id,
              });
            }
          });
          helpers.addAudit({
            action: "document.revision-upload",
            entityType: "document",
            entityId: document.id,
            before: existing,
            after: document,
            siteId,
          });
          return normaliseState(next);
        });
        const snapshot = stateRef.current;
        const integrationSettings = snapshot.device?.settings?.integrations || snapshot.settings?.integrations || {};
        const aiConfig = getStoredAiConfig(integrationSettings);
        if (aiDiffRequest && snapshot.org?.mode !== "demo" && aiConfig.apiKey && (aiDiffRequest.oldText || aiDiffRequest.newText)) {
          const result = await askSiteForgeAi({
            userMessage: `These are two revisions of a construction drawing. Identify meaningful construction changes. Focus on window/door schedule changes, dimensions, electrical fixture additions, finishes, and site execution risk. Reply only as JSON: {"changes":[{"type":"string","location":"string","before":"string","after":"string","severity":"low|medium|high"}],"summary":"one paragraph plain-English summary"}.\n\nOLD REVISION:\n${aiDiffRequest.oldText.slice(0, 12000)}\n\nNEW REVISION:\n${aiDiffRequest.newText.slice(0, 12000)}`,
            projectContext: { orgMode: snapshot.org?.mode, site: snapshot.sites.find((entry) => entry.id === aiDiffRequest.siteId) },
            provider: aiConfig.provider,
            apiKey: aiConfig.apiKey,
            model: aiConfig.model,
            openaiProxyUrl: aiConfig.openaiProxyUrl,
          });
          if (result.source === "claude" || result.source === "openai") {
            setState((previous) => {
              const next = cloneState(previous);
              const document = next.documents.find((entry) => entry.id === aiDiffRequest.documentId);
              if (!document) return previous;
              let parsed = null;
              try {
                const match = result.text.match(/\{[\s\S]*\}/);
                parsed = JSON.parse(match ? match[0] : result.text);
              } catch {
                parsed = null;
              }
              document.impactAnalysis = document.impactAnalysis || {};
              document.impactAnalysis.aiSummary = parsed?.summary || result.text;
              document.impactAnalysis.aiChanges = Array.isArray(parsed?.changes) ? parsed.changes : [];
              document.impactAnalysis.aiSource = result.source;
              document.impactAnalysis.aiGeneratedAt = new Date().toISOString();
              return normaliseState(next);
            });
          }
        }
      },
      addDocumentAnnotation(documentId, payload) {
        mutate((next, helpers) => {
          const document = next.documents.find((entry) => entry.id === documentId);
          if (!document) return;
          const annotation = {
            id: randomId("ann"),
            by: actorName(helpers.actor),
            at: nowStamp(),
            locationRef: payload.locationRef || "General",
            note: payload.note,
          };
          document.annotations = [annotation, ...(document.annotations || [])];
          helpers.addAudit({
            action: "document.annotation.create",
            entityType: "document",
            entityId: document.id,
            before: null,
            after: annotation,
            siteId: document.siteId,
          });
        });
      },
      updateDocumentSearchDescription(documentId, description) {
        mutate((next, helpers) => {
          const document = next.documents.find((entry) => entry.id === documentId);
          if (!document) return;
          const before = { manualSearchDescription: document.manualSearchDescription || "" };
          document.manualSearchDescription = String(description || "").trim();
          document.updatedAt = nowStamp();
          helpers.addAudit({
            action: "document.search-description.update",
            entityType: "document",
            entityId: document.id,
            before,
            after: { manualSearchDescription: document.manualSearchDescription },
            siteId: document.siteId,
          });
        });
      },
      acknowledgeDocumentRevision(documentId, userId = state.session.userId, name = "") {
        mutate((next, helpers) => {
          const document = next.documents.find((entry) => entry.id === documentId);
          if (!document) return;
          document.impactAnalysis = document.impactAnalysis || {};
          document.impactAnalysis.acknowledgedBy = document.impactAnalysis.acknowledgedBy || [];
          if (!document.impactAnalysis.acknowledgedBy.includes(userId)) {
            document.impactAnalysis.acknowledgedBy.push(userId);
          }
          document.acknowledgements = document.acknowledgements || [];
          document.acknowledgements.unshift({
            id: randomId("docack"),
            userId,
            name: name || next.users.find((entry) => entry.id === userId)?.name || userId,
            at: nowStamp(),
          });
          next.passports.records.forEach((passport) => {
            if (passport.userId !== userId || passport.siteId !== document.siteId) return;
            passport.blockedReasons = (passport.blockedReasons || []).filter((reason) => !reason.includes(document.drawingNumber) && !reason.includes(document.rev));
            passport.acknowledgements = (passport.acknowledgements || []).map((ack) =>
              ack.documentId === document.id || ack.label?.includes(document.drawingNumber)
                ? { ...ack, done: true, by: name || passport.person, at: nowStamp() }
                : ack,
            );
          });
          helpers.addAudit({
            action: "document.revision-ack",
            entityType: "document",
            entityId: document.id,
            before: null,
            after: { userId, name },
            siteId: document.siteId,
          });
        });
      },
      async createTransmittal({ documentIds = [], recipients = [], purpose = "For Information" } = {}) {
        let pdfPayload = null;
        let transmittalId = null;
        mutate((next, helpers) => {
          const docs = next.documents.filter((document) => documentIds.includes(document.id));
          if (!docs.length) return;
          const siteId = docs[0].siteId || next.session.siteId;
          const number = nextScopedNumber(next, "transmittals", siteId, "TR");
          const transmittal = {
            id: randomId("tr"),
            number,
            siteId,
            from: actorName(helpers.actor),
            recipients: recipients.length ? recipients : getRecipientsForClient(next, next.sites.find((site) => site.id === siteId)?.clientId).map((entry) => entry.client),
            purpose,
            documentIds: docs.map((doc) => doc.id),
            status: "issued",
            createdAt: nowStamp(),
            acknowledgements: [],
            fileId: null,
          };
          transmittalId = transmittal.id;
          next.transmittals.unshift(transmittal);
          next.documents.unshift({
            id: randomId("doc"),
            siteId,
            title: `${number} document transmittal`,
            drawingNumber: number,
            rev: "Issued",
            date: formatDate(),
            category: "Transmittal",
            clientVisible: true,
            tags: ["transmittal", purpose],
            linkedTaskIds: [],
            revisionHistory: [{ rev: "Issued", date: formatDate(), by: actorName(helpers.actor) }],
            archived: false,
            fileId: null,
            transmittalId: transmittal.id,
            retentionCategory: "transmittal",
            retentionUntil: addDays(formatDate(), 2557),
          });
          pdfPayload = {
            transmittal: cloneState(transmittal),
            documents: cloneState(docs),
            sender: actorName(helpers.actor),
            site: cloneState(next.sites.find((site) => site.id === siteId) || {}),
          };
          helpers.addAudit({
            action: "document.transmittal-issue",
            entityType: "transmittal",
            entityId: transmittal.id,
            before: null,
            after: { documentIds: transmittal.documentIds, purpose },
            siteId,
          });
        });
        if (!pdfPayload || !transmittalId) return;
        try {
          const blob = await generateTransmittalPdfBlob(pdfPayload);
          const blobId = `transmittal-pdf-${transmittalId}`;
          await putBlob(blobId, blob);
          mutate((next) => {
            const transmittal = next.transmittals.find((entry) => entry.id === transmittalId);
            const document = next.documents.find((entry) => entry.transmittalId === transmittalId);
            if (transmittal) transmittal.fileId = blobId;
            if (document) {
              document.fileId = blobId;
              document.fileName = `${transmittal?.number || transmittalId}.pdf`;
              document.mimeType = "application/pdf";
            }
          });
        } catch (error) {
          mutate((next) => {
            const transmittal = next.transmittals.find((entry) => entry.id === transmittalId);
            if (transmittal) transmittal.pdfError = error?.message || "PDF generation failed";
          });
        }
      },
      acknowledgeTransmittal(transmittalId, recipientName = "") {
        mutate((next, helpers) => {
          const transmittal = next.transmittals.find((entry) => entry.id === transmittalId);
          if (!transmittal) return;
          transmittal.acknowledgements = transmittal.acknowledgements || [];
          transmittal.acknowledgements.unshift({
            id: randomId("track"),
            by: recipientName || actorName(helpers.actor),
            at: nowStamp(),
          });
          helpers.addAudit({
            action: "document.transmittal-ack",
            entityType: "transmittal",
            entityId: transmittal.id,
            before: null,
            after: { by: recipientName || actorName(helpers.actor) },
            siteId: transmittal.siteId,
          });
        });
      },
      async verifyDocumentIntegrity(documentId) {
        const documentBefore = state.documents.find((entry) => entry.id === documentId);
        let blobMarker = "no-blob";
        if (documentBefore?.fileId) {
          try {
            const blob = await getBlob(documentBefore.fileId);
            blobMarker = blob ? `${blob.size}:${blob.type}` : "missing-blob";
          } catch {
            blobMarker = "blob-read-error";
          }
        }
        mutate((next) => {
          const document = next.documents.find((entry) => entry.id === documentId);
          if (!document) return;
          const hash = hashString(`${document.id}:${document.title}:${document.rev}:${document.fileId || ""}:${blobMarker}`);
          const previousHash = document.integrity?.hash;
          document.integrity = {
            hash,
            previousHash,
            status: !previousHash || previousHash === hash ? "verified" : "changed",
            verifiedAt: nowStamp(),
            blobMarker,
          };
          pushToast(next, {
            tone: document.integrity.status === "verified" ? "success" : "warning",
            title: document.integrity.status === "verified" ? "Document integrity verified" : "Document changed since last verification",
            body: `${document.title} ${document.rev || ""}`,
          });
        });
      },
      createPermit(payload = {}) {
        mutate((next, helpers) => {
          const permit = {
            id: randomId("permit"),
            siteId: payload.siteId || next.session.siteId,
            title: payload.title || "Required permit",
            authority: payload.authority || "Council / regulator",
            status: payload.status || "required",
            expiryDate: payload.expiryDate || "",
            documentId: payload.documentId || null,
            requiredForPc: payload.requiredForPc !== false,
            createdAt: nowStamp(),
          };
          next.permits.unshift(permit);
          helpers.addAudit({
            action: "document.permit-create",
            entityType: "permit",
            entityId: permit.id,
            before: null,
            after: permit,
            siteId: permit.siteId,
          });
        });
      },
      updatePermitStatus(permitId, status) {
        mutate((next, helpers) => {
          const permit = next.permits.find((entry) => entry.id === permitId);
          if (!permit) return;
          const before = { status: permit.status };
          permit.status = status;
          permit.updatedAt = nowStamp();
          helpers.addAudit({
            action: "document.permit-status",
            entityType: "permit",
            entityId: permit.id,
            before,
            after: { status },
            siteId: permit.siteId,
          });
        });
      },
      runDocumentRetentionSweep() {
        mutate((next, helpers) => {
          next.documents.forEach((document) => {
            if (document.archived || !document.retentionUntil) return;
            if (daysUntil(document.retentionUntil) < 0) {
              document.archived = true;
              document.archivedAt = nowStamp();
              document.retentionArchived = true;
              helpers.addAudit({
                action: "document.retention-archive",
                entityType: "document",
                entityId: document.id,
                before: null,
                after: { retentionUntil: document.retentionUntil },
                siteId: document.siteId,
              });
            }
          });
        });
      },
      async uploadPassportFiles(passportId, fileList) {
        const incoming = Array.from(fileList || []);
        for (const file of incoming) {
          const metadata = await uploadFile({
            file,
            uploadedBy: state.session.userId,
            siteId: state.session.siteId,
            entityType: "passport",
            entityId: passportId,
          });
          setState((previous) => {
            const next = cloneState(previous);
            const passport = next.passports.records.find((entry) => entry.id === passportId);
            if (!passport) return previous;
            next.files.records.unshift(metadata);
            passport.docs.unshift({
              id: randomId("pd"),
              label: metadata.name,
              status: "complete",
              fileId: metadata.id,
            });
            if (["Insurance Certificate", "Licence / Ticket"].includes(metadata.classification)) {
              const expiresOn = metadata.parsedFields?.expiry || addDays(formatDate(), 30);
              next.passports.expiringTickets.unshift({
                id: randomId("tick"),
                fileId: metadata.id,
                userId: passport.userId,
                passportId: passport.id,
                label: metadata.classification === "Insurance Certificate" ? "Insurance certificate" : metadata.parsedFields?.class || metadata.name,
                expiresOn,
                notifications: [],
              });
              passport.blockedReasons = (passport.blockedReasons || []).filter((reason) => !reason.toLowerCase().includes("expired"));
            }
            return normaliseState(next);
          });
        }
      },
      confirmFileField(fileId, key, value) {
        mutate((next) => {
          const file = next.files.records.find((entry) => entry.id === fileId);
          if (!file) return;
          file.parsedFields = { ...(file.parsedFields || {}), [key]: value };
          file.confirmedFields = { ...(file.confirmedFields || {}), [key]: true };
        });
      },
      async deleteFile(fileId) {
        await removeFileEverywhere(fileId);
        setState((previous) => {
          const next = cloneState(previous);
          next.files.records = next.files.records.filter((entry) => entry.id !== fileId);
          next.documents.forEach((document) => {
            if (document.fileId === fileId) document.fileId = null;
          });
          next.contractTemplates.forEach((template) => {
            if (template.sourceFileId === fileId) template.sourceFileId = null;
          });
          next.passports.records.forEach((passport) => {
            passport.docs = passport.docs.filter((doc) => doc.fileId !== fileId);
          });
          next.passports.expiringTickets = next.passports.expiringTickets.filter((ticket) => ticket.fileId !== fileId);
          return normaliseState(next);
        });
      },
      writeOffItem(approvalId, reason) {
        mutate((next, helpers) => {
          const approval = next.approvals.find((entry) => entry.id === approvalId);
          if (!approval) return;
          approval.writtenOff = true;
          approval.writeOffReason = reason;
          const site = next.sites.find((entry) => entry.id === approval.siteId);
          if (site) {
            site.forecastMargin = Math.max(0, site.forecastMargin - Math.round((approval.costImpact || 0) / 10000));
          }
          helpers.addAudit({
            action: "AUTHORITY OVERRIDE · write-off",
            entityType: "approval",
            entityId: approval.id,
            before: null,
            after: { writtenOff: true, reason },
            siteId: approval.siteId,
          });
        });
      },
      terminateSite(siteId, reason) {
        mutate((next, helpers) => {
          const site = next.sites.find((entry) => entry.id === siteId);
          if (!site) return;
          const before = { status: site.status };
          site.status = "terminated";
          site.terminationReason = reason;
          helpers.addAudit({
            action: "AUTHORITY OVERRIDE · terminate-site",
            entityType: "site",
            entityId: site.id,
            before,
            after: { status: site.status, reason },
            siteId: site.id,
          });
        });
      },
      overrideBudget(siteId, budgetItemId, amount, reason) {
        mutate((next, helpers) => {
          const budget = next.siteBudgets.find((entry) => entry.siteId === siteId);
          const item = budget?.items.find((entry) => entry.id === budgetItemId);
          if (!item) return;
          const before = { budget: item.budget };
          item.budget = Number(amount);
          item.overrideReason = reason;
          helpers.addAudit({
            action: "AUTHORITY OVERRIDE · budget-override",
            entityType: "budget",
            entityId: budgetItemId,
            before,
            after: { budget: item.budget, reason },
            siteId,
          });
        });
      },
      exportAuditCsv() {
        return exportAuditCsv(state.auditTrail);
      },
    }),
    [improveApprovalDraft, mutate, navigate, persistExecutedPdf, refreshAiInsightCache, setState, state],
  );

  const derived = useMemo(() => {
    const currentUser = getCurrentUser(state);
    const currentSite = getCurrentSite(state);
    const currentClient = getCurrentClient(state);
    const accessibleSiteIds = getAccessibleSiteIds(state, state.session.role, state.session.userId);
    const accessibleSites = state.sites.filter((site) => accessibleSiteIds.includes(site.id));
    const notificationsForUser = state.notifications.items.filter((item) => {
      if (routeKindForRole(state.session.role) === "client") {
        return item.recipientId === currentClient?.id || item.recipientId === state.session.userId;
      }
      return item.recipientId === state.session.userId || item.recipientRole === state.session.role;
    });
    const unreadNotifications = notificationsForUser.filter((item) => !item.readAt).length;
    const metrics = buildMetrics(state);
    const openApprovals = state.approvals.filter((approval) => !["signed", "declined"].includes(approval.status));
    const currentContract = state.contractPacks.find((pack) => pack.docId === state.ui.activeContractId) || state.contractPacks[0] || null;
    const currentApproval = state.approvals.find((approval) => approval.id === state.ui.activeApprovalId) || state.approvals[0] || null;
    const weeklySummarySiteId = currentClient?.siteId || currentSite?.id || state.session.siteId;
    const weeklySummaryCache = weeklySummarySiteId ? state.aiCache?.weeklyClientSummary?.[weeklySummarySiteId] : null;
    const localBoardInsight = boardInsights({
      sites: state.sites,
      approvals: openApprovals,
      presence: state.presence?.records || [],
    });
    const cachedBoardInsight = state.aiCache?.boardInsights?.portfolio;

    return {
      currentUser,
      currentSite,
      currentClient,
      currentNow: state.demo?.simulatedNow || nowStamp(),
      accessibleSites,
      unreadNotifications,
      notificationsForUser,
      metrics,
      openApprovals,
      currentContract,
      currentApproval,
      auditVerification: state.ui.auditVerification || verifyAuditChain(state.auditTrail),
      search: (query) => buildSearchResults(state, query),
      resolveRecord: (type, id) => findInCollection(state, type, id),
      weeklyClientSummary: weeklySummaryCache?.summary || summariseDiary(state.diary.filter((entry) => entry.siteId === weeklySummarySiteId)),
      weeklyClientSummarySource: weeklySummaryCache?.source || "local-template",
      boardInsight: cachedBoardInsight?.summary
        ? { ...localBoardInsight, summary: cachedBoardInsight.summary, source: cachedBoardInsight.source, generatedAt: cachedBoardInsight.generatedAt }
        : { ...localBoardInsight, source: "local-template" },
      photoTimeline: [
        ...state.files.records
          .filter((file) => file.classification === "Photo / Site Image")
          .map((file) => ({
            id: file.id,
            siteId: file.siteId,
            label: file.name,
            at: new Date(file.lastModified || Date.now()).toISOString(),
            thumbnailDataUrl: file.thumbnailDataUrl,
          })),
        ...state.diary.flatMap((entry) =>
          (entry.photos || []).map((photo, index) => ({
            id: `${entry.id}-photo-${index}`,
            siteId: entry.siteId,
            label: photo,
            at: `${entry.date}T12:00:00`,
            thumbnailDataUrl: null,
          })),
        ),
      ]
        .sort((left, right) => new Date(right.at) - new Date(left.at))
        .slice(0, 24),
      expiringPassportQueue: state.passports.expiringTickets
        .filter((ticket) => Number.isFinite(ticket.daysRemaining ?? daysUntil(ticket.expiresOn)))
        .sort((left, right) => (left.daysRemaining ?? daysUntil(left.expiresOn)) - (right.daysRemaining ?? daysUntil(right.expiresOn))),
      revisionSummary: (docId) => {
        const document = state.documents.find((item) => item.id === docId);
        const old = document?.impactAnalysis?.oldDocumentId ? state.documents.find((item) => item.id === document.impactAnalysis.oldDocumentId) : null;
        return summariseRevision(old, document);
      },
    };
  }, [state]);

  const value = useMemo(() => ({ state, actions, derived, persistence }), [state, actions, derived, persistence]);

  return createElement(SiteForgeContext.Provider, { value }, children);
}

function buildSourceAttachments(source) {
  if (source.attachments?.length) {
    return source.attachments;
  }
  if (source.photos?.length) {
    return source.photos.map((photo) => ({
      id: randomId("att"),
      name: `${photo}.png`,
      kind: "image",
    }));
  }
  return [];
}

function buildApprovalTitle(source, approvalType) {
  const base = source.title || source.item || source.topic || source.number || "site event";
  if (approvalType === "Rain Day") {
    return `Rain day claim for ${source.date || "weather event"}`;
  }
  if (approvalType === "Extension of Time") {
    return `EOT request for ${base.toLowerCase()}`;
  }
  if (approvalType === "Selection Upgrade") {
    return `Approve ${base.toLowerCase()}`;
  }
  if (approvalType === "Delay Notice") {
    return `Delay notice - ${base.toLowerCase()}`;
  }
  return `Approve ${base.toLowerCase()}`;
}

function actorName(actor) {
  return actor?.name || "SiteForge User";
}

export function useSiteForge() {
  const context = useContext(SiteForgeContext);
  if (!context) {
    throw new Error("useSiteForge must be used inside SiteForgeProvider");
  }
  return context;
}
