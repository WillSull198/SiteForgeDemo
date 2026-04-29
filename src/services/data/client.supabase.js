function notConfigured() {
  throw new Error("Supabase data client is not configured. SiteForge is running on the local IndexedDB client.");
}

export const supabaseClient = {
  list: notConfigured,
  get: notConfigured,
  create: notConfigured,
  update: notConfigured,
  remove: notConfigured,
  subscribe: notConfigured,
};
