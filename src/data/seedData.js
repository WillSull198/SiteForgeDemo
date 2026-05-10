import { APP_CONFIG } from "./seedData.shared";

const DEMO = import.meta.env.VITE_INCLUDE_DEMO_DATA !== "false";
const seedModule = DEMO ? await import("./seedData.demo.js") : await import("./seedData.prod.js");

export const { createInitialData, migrateLegacyState } = seedModule;
export { APP_CONFIG };
