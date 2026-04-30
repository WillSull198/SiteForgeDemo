export function handleBuildxactWebhookEvent(event) {
  return {
    accepted: false,
    reason: "Webhook receiver is scaffolded for the backend integration tier.",
    event,
  };
}
