import { createInitialData } from "./seedData";

let referenceCache = null;

function getReferenceCache() {
  if (!referenceCache) {
    const seed = createInitialData();
    referenceCache = {
      contractTemplates: seed.contractTemplates || [],
      clauseLibrary: seed.clauseLibrary || [],
      templateMarketplace: seed.templateMarketplace || [],
    };
  }
  return referenceCache;
}

const clone = (value) => {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

export function getReferenceContractTemplates() {
  return clone(getReferenceCache().contractTemplates);
}

export function getReferenceClauseLibrary() {
  return clone(getReferenceCache().clauseLibrary);
}

export function getReferenceTemplateMarketplace() {
  return clone(getReferenceCache().templateMarketplace);
}
