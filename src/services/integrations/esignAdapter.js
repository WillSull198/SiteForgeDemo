export const esignAdapter = {
  generateSignaturePack(approval) {
    return {
      status: "generated",
      packId: approval.contractPack.id,
      finalStatus: approval.status === "approved" ? "signature-requested" : "draft",
    };
  },
};
