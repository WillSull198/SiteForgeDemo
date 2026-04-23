export const presenceAdapter = {
  scoreAttendance(record) {
    const hasSignIn = record.signals.includes("sign-in");
    const hasSpatial = record.signals.includes("geofence") || record.signals.includes("beacon");
    const hasOverride = record.signals.includes("manual-override");
    let score = 20;

    if (hasSignIn) score += 30;
    if (hasSpatial) score += 35;
    if (hasOverride) score += 10;
    if (record.anomalies.length === 0) score += 10;
    if (record.status === "verified-on-site") score += 10;
    if (record.status === "signed-in-not-verified") score -= 20;
    if (record.status === "left-before-sign-out") score -= 15;

    return Math.max(0, Math.min(100, score));
  },
};
