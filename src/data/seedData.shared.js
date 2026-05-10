const today = "2026-04-22";
const builderName = "SiteForge Builders";

const priorities = [
  { value: "critical", color: "#EF4444" },
  { value: "high", color: "#F97316" },
  { value: "medium", color: "#3B82F6" },
  { value: "low", color: "#10B981" },
];

const approvalTypes = [
  "Variation",
  "Rain Day",
  "Extension of Time",
  "Provisional Sum Conversion",
  "Selection Upgrade",
  "Delay Notice",
  "Site Instruction",
  "Scope Clarification",
  "Price Escalation",
];

export const APP_CONFIG = {
  // Deprecated: runtime persistence now uses src/services/storageMode.js to
  // select isolated demo/real slots. Kept only for legacy migration tools.
  storageKey: "siteforge-v6-enterprise-demo",
  legacyStorageKeys: ["siteforge-v5-enterprise-demo"],
  storageVersion: 3,
  buildDate: today,
  appTitle: "SiteForge Enterprise",
  metaDescription: "SiteForge is the construction operating layer connecting field events, client approvals, contracts, and commercial recovery.",
  builder: {
    name: builderName,
    legalName: "SiteForge Builders Pty Ltd",
    abn: "61 135 552 912",
    address: "Level 3, 120 Edward Street, Brisbane QLD",
    phone: "07 3000 4400",
    email: "deliver@siteforge.builders",
  },
  roles: ["Supervisor", "Project Manager", "Contract Admin", "Director", "Subcontractor", "Client", "Worker"],
  priorities,
  approvalTypes,
  trades: [
    "Management",
    "Carpentry",
    "Electrical",
    "Plumbing",
    "Concrete",
    "Roofing",
    "Tiling",
    "Painting",
    "Waterproofing",
    "Steel Fixing",
    "General",
    "Joinery",
  ],
  regions: ["Brisbane", "Gold Coast", "Sunshine Coast", "Toowoomba"],
  periods: ["This Week", "This Month", "Quarter", "YTD"],
  roleAccents: {
    Supervisor: "#F59E0B",
    "Project Manager": "#06B6D4",
    "Contract Admin": "#8B5CF6",
    Director: "#1D4ED8",
    Subcontractor: "#F97316",
    Client: "#E8A838",
    Worker: "#10B981",
  },
  clientLanguages: ["English", "Plain English", "Builder Summary"],
  preferredResponseTimes: ["Same day", "24h", "48h", "Custom"],
  costCodes: [
    { local: "Foundations", remote: "BX-1200" },
    { local: "Framing", remote: "BX-2200" },
    { local: "Waterproofing", remote: "BX-3450" },
    { local: "Electrical", remote: "BX-4100" },
    { local: "Finishes", remote: "BX-5600" },
  ],
  supportedFileExtensions: [".pdf", ".png", ".jpg", ".jpeg", ".docx", ".txt", ".md"],
};
