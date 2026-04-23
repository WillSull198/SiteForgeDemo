export const buildxactAdapter = {
  previewVariation(variation) {
    return {
      type: "approvedVariation",
      payload: {
        variationNumber: variation.num,
        status: variation.st,
        amount: variation.val,
        description: variation.title,
      },
    };
  },
  previewLabourExport(exportState) {
    return {
      type: "labourSummary",
      payload: exportState,
    };
  },
  sync(payload) {
    return {
      state: "success",
      message: `Queued ${payload.type} payload for Buildxact connector`,
    };
  },
};
