import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { CcdAmount, TransactionHash } from "@concordium/web-sdk";
import { CONCORDIUM_TESTNET_CAIP2 } from "@x402/concordium";
import { checkNetwork, grpc } from "./testnet-identity.mjs";

const rawReceipt = await readFile("payment-receipt.json");
const receipt = JSON.parse(rawReceipt);
const intent = JSON.parse(await readFile("payment-started.json"));
assert.equal(intent.orderId, "btc-eth-breakout-x402-001");
assert.equal(receipt.orderId, intent.orderId);
assert.equal(receipt.network, CONCORDIUM_TESTNET_CAIP2);
assert.equal(intent.network, receipt.network);
assert.equal(receipt.fulfillment, "paid_pending_backtest");
assert.equal(receipt.amountMicroCcd, "1000000");
assert.equal(intent.amount, receipt.amountMicroCcd);
assert.equal(intent.asset, "CCD");
assert.match(receipt.transaction, /^[0-9a-f]{64}$/);

await checkNetwork();
const outcome = await grpc.getBlockItemStatus(TransactionHash.fromHexString(receipt.transaction));
assert.equal(outcome.status, "finalized");
const { summary } = outcome.outcome;
assert.equal(summary.transactionType, "transfer");
assert.equal(summary.sender.address, intent.buyer);
assert.equal(summary.sender.address, receipt.buyer);
assert.equal(summary.transfer.to.address, intent.seller);
assert.equal(summary.transfer.to.address, receipt.seller);
assert.equal(CcdAmount.toMicroCcd(summary.transfer.amount).toString(), receipt.amountMicroCcd);
const spec = await readFile(new URL("./demo-research-spec.json", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const authorization = {
  orderId: receipt.orderId,
  transaction: receipt.transaction,
  receiptSha256: hash(rawReceipt),
  fixedSpecSha256: hash(spec),
};
await writeFile("fulfillment-authorized.json", JSON.stringify(authorization, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ ...authorization, state: "ready_for_backtest" }));

