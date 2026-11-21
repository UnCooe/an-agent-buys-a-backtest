import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const source = process.argv[2] ?? "buyer-agent-clean-evidence.json";
const prior = JSON.parse(await readFile(source, "utf8"));
assert.deepEqual(prior.calls.map((call) => call.name), ["get_order", "read_evidence", "read_evidence"]);
const [order, ...evidence] = prior.calls;
const metrics = evidence.find((call) => call.arguments.evidence === "metrics")?.result;
const decision = evidence.find((call) => call.arguments.evidence === "decision")?.result;
assert.equal(order.result.status, "delivered");
assert.ok(metrics && decision);

const percent = (value) => value + "%";
const check = (label, actual, limit, bound, unit = "") => {
  const passes = bound === "minimum" ? actual >= limit : actual <= limit;
  return label + ": " + actual + unit + " vs " + bound + " " + limit + unit + " (" + (passes ? "PASS" : "FAIL") + ").";
};
const facts = [
  check("Held-out return", metrics.held_out.return_pct, metrics.gates.held_out_min_return_pct, "minimum", "%"),
  check("Development drawdown", metrics.development.max_drawdown_pct, metrics.gates.max_drawdown_pct, "maximum", "%"),
  check("Development trade count", metrics.development.trades, metrics.gates.development_min_trades, "minimum"),
  check("Held-out trade count", metrics.held_out.trades, metrics.gates.held_out_min_trades, "minimum"),
  "Source for those observations and limits: " + metrics.source + ".",
  "Recorded seller decision: " + decision.recorded_decision + ". Source: " + decision.source + ".",
].join("\n");
const response = await fetch((process.env.OLLAMA_API ?? "http://127.0.0.1:11434/api") + "/chat", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model: prior.model, think: true, stream: false,
    options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 1700 },
    messages: [
      { role: "system", content: "You are the buyer's research agent. Reply in at most 90 words and only use the supplied evidence. Make your recommendation in the first sentence. Report the two failed performance checks and the two passed sample checks in plain English. A passed check met its own threshold. Discuss only historical backtest evidence, without any claims about live conditions or general strategy viability. Include the two source filenames. Limit your conclusion to this backtest." },
      { role: "user", content: "Should I advance this strategy based on the backtest I ordered?\n\nEvidence returned by the tools:\n" + facts },
    ],
  }),
  signal: AbortSignal.timeout(110_000),
});
if (!response.ok) throw Error("Local inference failed: HTTP " + response.status);
const result = await response.json();
const answer = result.message.content.trim();
assert.ok(answer, "No answer");
const checked = {
  model: prior.model, modelDigest: prior.modelDigest, user: prior.user,
  retrievalTranscript: source, calls: prior.calls, synthesis: "numeric_comparisons_from_read_only_tools",
  synthesisInput: facts, answer,
};
await writeFile("buyer-agent-comparison-review.json", JSON.stringify(checked, null, 2) + "\n", { flag: "wx" });
console.log(answer);

