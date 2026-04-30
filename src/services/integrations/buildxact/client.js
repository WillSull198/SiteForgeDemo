import projects from "./fixtures/projects.json";
import suppliers from "./fixtures/suppliers.json";
import costCodes from "./fixtures/costCodes.json";
import variations from "./fixtures/variations.json";
import schedule from "./fixtures/schedule.json";

const clone = (value) => JSON.parse(JSON.stringify(value));

export function createBuildxactClient({ mode = "mock" } = {}) {
  if (mode !== "mock") {
    throw new Error("Real Buildxact API client is not configured. Replace createBuildxactClient in client.js with authenticated fetch calls.");
  }

  return {
    async pullProjects() {
      return clone(projects);
    },
    async pullSuppliers() {
      return clone(suppliers);
    },
    async pullCostCodes() {
      return clone(costCodes);
    },
    async pullVariations() {
      return clone(variations);
    },
    async pullSchedule() {
      return clone(schedule);
    },
    async pushVariation(payload) {
      return { status: "accepted", remoteId: `mock-${payload.number}`, payload: clone(payload) };
    },
    async pushDocumentAttachment(payload) {
      return { status: "accepted", remoteId: `mock-doc-${payload.contractPackId || payload.id}`, payload: clone(payload) };
    },
    async pushTimelineComment(payload) {
      return { status: "accepted", remoteId: `mock-note-${payload.reference || payload.id}`, payload: clone(payload) };
    },
  };
}
