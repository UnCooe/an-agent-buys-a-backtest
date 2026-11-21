import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const load = async (path) => JSON.parse(await readFile(path, "utf8"));

const transcriptPath = process.argv[2];
assert.ok(transcriptPath, "Expected a named real model transcript");
const transcript = await load(transcriptPath);
const receipt = await load("payment-receipt.json");
const delivery = await load("delivery.json");
assert.equal(receipt.chainStatus, "finalized");
assert.equal(delivery.orderId, receipt.orderId);
assert.equal(delivery.transaction, receipt.transaction);
assert.equal(transcript.calls[0].name, "get_order");
assert.equal(transcript.calls[0].result.run_id, delivery.runId);
assert.equal(transcript.calls[0].result.status, "delivered");
assert.ok(transcript.calls.every((call) => call.arguments.order_id === receipt.orderId));
const metrics = transcript.calls.find((call) => call.name === "read_evidence" && call.arguments.evidence === "metrics")?.result;
const decision = transcript.calls.find((call) => call.name === "read_evidence" && call.arguments.evidence === "decision")?.result;
assert.ok(metrics && decision);
const answer = transcript.answer;
assert.ok(answer.includes(metrics.source));
assert.ok(answer.includes(decision.source));
assert.match(answer, /do not|don't|should not|shouldn't|reject|stop|against advancing/i);
assert.equal(decision.recorded_decision, "reject_candidate");
assert.match(answer, /[-−]6\.97%/);
assert.match(answer, /21\.48%/);
for (const count of [metrics.development.trades, metrics.gates.development_min_trades,
  metrics.held_out.trades, metrics.gates.held_out_min_trades]) {
  assert.match(answer, new RegExp("\\b" + count + "\\b"));
}
assert.match(answer, /(?:met|pass|enough|exceed|above|adequate|sufficient)/i);
assert.doesNotMatch(answer, /(?:all \d+ gates|too few trades|not enough trades|trade counts? (?:failed|fell short))/i);
const evidence = {
  verdict: "checks_passed",
  model: transcript.model,
  order: receipt.orderId,
  run: delivery.runId,
  trace: transcript.calls.map(({name, arguments: args, result}) => ({
    name, handle: args.evidence ?? null, source: result.source ?? null,
  })),
  transaction: receipt.transaction,
  metrics,
  recordedDecision: decision,
  actualAnswer: answer,
};
await writeFile("buyer-evaluation.json", JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(evidence, null, 2));
