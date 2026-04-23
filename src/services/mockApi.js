const wait = (ms = 260) => new Promise((resolve) => window.setTimeout(resolve, ms));

export async function mockRequest(result, delay = 260) {
  await wait(delay);
  return result;
}

export async function mockMutation(makeResult, delay = 260) {
  await wait(delay);
  return typeof makeResult === "function" ? makeResult() : makeResult;
}
