/* SiteForge audit: Template selection now honours the explicit template chosen
   during the approval workflow before falling back to type defaults. */

import { APP_CONFIG } from "../data/seedData";

const randomId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

const nowStamp = () => {
  const now = typeof window !== "undefined" && window.__siteforgeNow ? new Date(window.__siteforgeNow) : new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
};

export const formatCurrency = (value = 0) =>
  new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);

function titleCase(value) {
  return String(value || "").replace(/\b\w/g, (match) => match.toUpperCase());
}

function numberToWordsUnderThousand(value) {
  const ones = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
  ];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

  if (value < 20) {
    return ones[value];
  }
  if (value < 100) {
    return `${tens[Math.floor(value / 10)]}${value % 10 ? `-${ones[value % 10]}` : ""}`;
  }
  return `${ones[Math.floor(value / 100)]} hundred${value % 100 ? ` and ${numberToWordsUnderThousand(value % 100)}` : ""}`;
}

export function numberToWords(value = 0) {
  const amount = Math.round(Number(value) || 0);
  let words = "";
  if (amount < 1000) {
    words = numberToWordsUnderThousand(amount);
  } else if (amount < 1000000) {
    const thousands = Math.floor(amount / 1000);
    const remainder = amount % 1000;
    words = `${numberToWordsUnderThousand(thousands)} thousand${remainder ? ` ${numberToWordsUnderThousand(remainder)}` : ""}`;
  } else {
    const millions = Math.floor(amount / 1000000);
    const remainder = amount % 1000000;
    words = `${numberToWordsUnderThousand(millions)} million${remainder ? ` ${numberToWords(remainder)}` : ""}`;
  }
  return titleCase(words.replace(/-/g, " "));
}

function simpleHash(input) {
  const value = String(input || "");
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `sf-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function pickTemplate(templates = [], approvalType) {
  return templates.find((template) => template.type === approvalType) || templates[0] || null;
}

export function pickTemplateForApproval(templates = [], approval = {}) {
  return templates.find((template) => template.id === approval.templateId) || pickTemplate(templates, approval.type);
}

export function generateDraft({
  approval,
  client,
  site,
  builder = APP_CONFIG.builder,
  templates = [],
}) {
  const template = pickTemplateForApproval(templates, approval);
  const now = nowStamp();
  const costWords = `${numberToWords(approval.costImpact || 0)} Dollars`;
  const mergeData = {
    approvalId: approval.id,
    approvalTitle: approval.title,
    approvalType: approval.type,
    clientName: client?.primaryContact || client?.name || "Client",
    clientCompany: client?.name || "Client",
    siteName: site?.name || "Project Site",
    siteAddress: site?.address || "Address to be confirmed",
    builderName: builder.name,
    builderLegalName: builder.legalName,
    builderAbn: builder.abn,
    builderAddress: builder.address,
    costImpact: approval.costImpact || 0,
    costImpactFormatted: formatCurrency(approval.costImpact || 0),
    costImpactWords: costWords,
    timeImpact: approval.timeImpact || 0,
    reason: approval.reason,
    summary: approval.summary,
    recommendation: approval.recommendation,
    attachments: (approval.attachments || []).map((attachment) => attachment.name).join(", "),
  };

  const templateClauses = template?.clauses || [];

  const sections = [
    {
      heading: template?.name || `${approval.type} Contract`,
      clauses: [
        `This document records ${approval.title.toLowerCase()} for ${mergeData.siteName}.`,
        approval.summary,
        approval.reason,
      ],
    },
    {
      heading: "Commercial Impact",
      clauses: [
        `Adjustment to Contract Sum: ${mergeData.costImpactFormatted} (${mergeData.costImpactWords}).`,
        `Programme impact: ${mergeData.timeImpact ? `${mergeData.timeImpact} day${mergeData.timeImpact === 1 ? "" : "s"}` : "Nil"}.`,
        approval.recommendation,
      ],
    },
    {
      heading: "Contract Basis",
      clauses: templateClauses,
    },
    {
      heading: "Supporting Documents",
      clauses: approval.attachments?.length
        ? approval.attachments.map((attachment) => `${attachment.name} (${attachment.kind.toUpperCase()})`)
        : ["Linked approval records and builder site logs form part of this pack."],
    },
  ];

  return {
    docId: `cp-${approval.id.replace(/^ap-/, "")}`,
    approvalId: approval.id,
    siteId: approval.siteId,
    template: approval.type,
    templateId: template?.id || null,
    status: "contract-drafted",
    content: {
      sections,
      mergeData,
    },
    signatures: {
      builder: null,
      client: null,
    },
    attachments: approval.attachments ? [...approval.attachments] : [],
    auditLog: [
      {
        id: randomId("cpa"),
        action: "contract draft generated",
        by: "System",
        at: now,
        details: `Draft created from approval ${approval.id}.`,
      },
    ],
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    pdfArchiveLabel: null,
  };
}

export function addContractAudit(contractPack, action, by, details) {
  const updated = { ...contractPack };
  updated.auditLog = [
    {
      id: randomId("cpa"),
      action,
      by,
      at: nowStamp(),
      details,
    },
    ...(updated.auditLog || []),
  ];
  updated.updatedAt = nowStamp();
  return updated;
}

export function updateContractContent(contractPack, updater) {
  const draft = { ...contractPack, content: { ...contractPack.content, sections: [...(contractPack.content?.sections || [])] } };
  updater(draft);
  draft.updatedAt = nowStamp();
  return draft;
}

export function signContract(contractPack, side, signer) {
  const signedAt = nowStamp();
  const documentHash =
    signer.documentHash ||
    simpleHash(
      JSON.stringify({
        docId: contractPack.docId,
        approvalId: contractPack.approvalId,
        content: contractPack.content,
        signer: signer.name,
        side,
      }),
    );
  const updated = {
    ...contractPack,
    signatures: {
      ...contractPack.signatures,
      [side]: {
        name: signer.name,
        role: signer.role,
        signedAt,
        ip: signer.ip || "198.51.100.200",
        ua: signer.ua || signer.userAgent || "SiteForge Browser",
        documentHash,
      },
    },
    updatedAt: signedAt,
  };

  if (side === "builder") {
    updated.status = "contract-awaiting-client";
  }

  if (side === "client") {
    updated.status = "signed";
    updated.archivedAt = signedAt;
    updated.pdfArchiveLabel = `${contractPack.approvalId.toUpperCase()} executed pack.pdf`;
  }

  return addContractAudit(
    updated,
    side === "builder" ? "builder signed contract" : "client signed contract",
    signer.name,
    side === "builder"
      ? "Builder-side sign-off recorded and contract released to client for execution."
      : "Client signature recorded and contract pack archived.",
  );
}

export function buildContractSummary(contractPack) {
  return {
    document: contractPack.docId,
    approvalId: contractPack.approvalId,
    status: contractPack.status,
    signed: Boolean(contractPack.signatures?.builder && contractPack.signatures?.client),
    updatedAt: contractPack.updatedAt,
  };
}
