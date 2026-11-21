import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { AccountAddress, buildBasicAccountSigner, ConcordiumHdWallet, TransactionHash } from "@concordium/web-sdk";
import { CONCORDIUM_TESTNET_CAIP2, getConcordiumGrpcUrl, getExplorerTxUrl,
  parseGrpcUrl, toConcordiumFacilitatorSigner } from "@x402/concordium";
import { ExactConcordiumScheme as BuyerScheme } from "@x402/concordium/exact/client";
import { ExactConcordiumScheme as SettlementScheme } from "@x402/concordium/exact/facilitator";
import { x402Client } from "@x402/core/client";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, decodePaymentSignatureHeader,
  encodePaymentRequiredHeader, encodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { checkNetwork, checkedFetch, grpc, walletPath } from "./testnet-identity.mjs";

const network = CONCORDIUM_TESTNET_CAIP2;
const orderId = "btc-eth-breakout-x402-001";
const amount = "1000000";
const asset = "CCD";
const receiptFile = "payment-receipt.json";

assert.ok(walletPath, "Set CONCORDIUM_TESTNET_WALLET to an external disposable testnet wallet file.");
await checkNetwork();
const { seed, accounts } = JSON.parse(await readFile(walletPath));
const { buyer, seller, sponsor } = accounts;
const wallet = ConcordiumHdWallet.fromHex(seed, "Testnet");
const signingKey = (index) => wallet.getAccountSigningKey(0, 0, index).toString("hex");
const [host, port] = parseGrpcUrl(getConcordiumGrpcUrl(network));
const signer = toConcordiumFacilitatorSigner(sponsor.address, signingKey(2), {
  host, port, useTls: true, network,
});
const facilitator = new SettlementScheme({ signer, requireFinalization: true });
const client = x402Client.fromConfig({
  schemes: [{ network, client: new BuyerScheme({
  accountAddress: AccountAddress.fromBase58(buyer.address),
  signer: buildBasicAccountSigner(signingKey(0)),
  }) }],
  spendControls: { allowedAssets: [{ network, asset, maxAmountPerPayment: amount }] },
});
const account = (address) => grpc.getAccountInfo(AccountAddress.fromBase58(address));
const [buyerBefore, sellerBefore] = await Promise.all([account(buyer.address), account(seller.address)]);
assert.equal(sellerBefore.accountAddress.address, seller.address);
const terms = {
  scheme: "exact", network, asset, amount, payTo: seller.address,
  maxTimeoutSeconds: 120, extra: { feePayer: sponsor.address },
};

function checkQuote(quote, budget) {
  assert.equal(quote.x402Version, 2);
  assert.equal(quote.accepts.length, 1);
  const offer = quote.accepts[0];
  assert.equal(offer.network, network);
  assert.equal(offer.asset, asset);
  assert.equal(offer.payTo, seller.address);
  assert.equal(offer.extra.feePayer, sponsor.address);
  assert.match(offer.amount, /^[1-9][0-9]*$/);
  if (BigInt(offer.amount) > budget) throw Error("quote exceeds budget");
}

let order;
const server = createServer(async (req, res) => {
  const reply = (status, body, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  try {
    if (req.method !== "POST" || req.url !== "/orders/" + orderId) return reply(404, {});
    const signature = req.headers["payment-signature"];
    if (!signature) return reply(402, { orderId }, {
      "payment-required": encodePaymentRequiredHeader({
        x402Version: 2, resource: { url: endpoint, description: "One fixed historical backtest", mimeType: "application/json" },
        accepts: [terms],
      }),
    });
    const signatureHash = createHash("sha256").update(signature).digest("hex");
    if (order && order.signatureHash !== signatureHash) return reply(409, { error: "order already reserved" });
    order ??= {
      signatureHash,
      settlement: (async () => {
        const payload = decodePaymentSignatureHeader(signature);
        const verified = await facilitator.verify(payload, terms);
        if (!verified.isValid || verified.payer !== buyer.address) {
          throw Error(verified.invalidReason ?? "payer mismatch");
        }
        const settled = await facilitator.settle(payload, terms);
        await writeFile("settlement-attempt.json", JSON.stringify(settled, null, 2) + "\n", { flag: "wx" });
        if (!settled.success || settled.network !== network || !/^[a-f0-9]{64}$/.test(settled.transaction ?? "")) {
          throw Error(settled.errorReason ?? "invalid settlement receipt");
        }
        return settled;
      })(),
    };
    const settlement = await order.settlement;
    return reply(202, { orderId, status: "paid_pending_backtest" }, {
      "payment-response": encodePaymentResponseHeader(settlement),
    });
  } catch (error) {
    reply(502, { error: error.message });
  }
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const endpoint = "http://127.0.0.1:" + server.address().port + "/orders/" + orderId;
try {
  const first = await checkedFetch(endpoint, { method: "POST", redirect: "error" });
  assert.equal(first.status, 402);
  await first.json();
  const quote = decodePaymentRequiredHeader(first.headers.get("payment-required"));
  assert.throws(() => checkQuote(quote, BigInt(amount) - 1n), /quote exceeds budget/);
  checkQuote(quote, BigInt(amount));

  const signature = encodePaymentSignatureHeader(await client.createPaymentPayload(quote));
  // Reserve the only on-chain attempt before any payment can be submitted.
  await writeFile("payment-started.json", JSON.stringify({ orderId, network, amount, asset, buyer: buyer.address, seller: seller.address }), { flag: "wx" });
  const request = () => checkedFetch(endpoint, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(95_000),
    headers: { "payment-signature": signature },
  });
  const paid = await request();
  const body = await paid.json();
  assert.equal(paid.status, 202, JSON.stringify(body));
  assert.equal(body.orderId, orderId);
  const settlement = decodePaymentResponseHeader(paid.headers.get("payment-response"));
  const replay = await request();
  assert.equal(replay.status, 202);
  assert.deepEqual(await replay.json(), body);
  assert.equal(decodePaymentResponseHeader(replay.headers.get("payment-response")).transaction, settlement.transaction);

  const [status, buyerAfter, sellerAfter] = await Promise.all([
    grpc.getBlockItemStatus(TransactionHash.fromHexString(settlement.transaction)),
    account(buyer.address), account(seller.address),
  ]);
  assert.equal(status.status, "finalized");
  assert.notEqual(status.outcome.summary.transactionType, "failed");
  assert.equal(buyerBefore.accountAmount.microCcdAmount - buyerAfter.accountAmount.microCcdAmount, BigInt(amount));
  assert.equal(sellerAfter.accountAmount.microCcdAmount - sellerBefore.accountAmount.microCcdAmount, BigInt(amount));
  const receipt = {
    orderId, network, x402Version: 2, amountMicroCcd: amount,
    buyer: buyer.address, seller: seller.address, sponsor: sponsor.address,
    transaction: settlement.transaction, chainStatus: status.status,
    block: status.outcome.blockHash.toString(), explorer: getExplorerTxUrl(network, settlement.transaction),
    unpaidHttpStatus: first.status, paidHttpStatus: paid.status, replayHttpStatus: replay.status,
    replayReturnedSameTransaction: true, underBudgetLimitRejected: true,
    sellerBalanceIncreaseMicroCcd: amount, buyerBalanceDecreaseMicroCcd: amount,
    fulfillment: body.status,
  };
  await writeFile(receiptFile, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(receipt));
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

