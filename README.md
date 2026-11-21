# An Agent Buys a Backtest

Can an agent buy a piece of research and decide what to do with it? In this case, a buyer paid 1 test CCD via x402 on Concordium for a historical BTC/ETH backtest. The seller verified the finalized payment before running the backtest. A local buyer agent opened the order, read the delivered evidence, and advised against advancing the strategy.

[Testnet transaction](https://ccdexplorer.io/testnet/transaction/c0b68a6c934ae5747b920d794cb07a0799779295e11593d3684d94feca1563f4) · [Recorded buyer answer](baseline/buyer-evaluation.json) · [Fixed research spec](demo-research-spec.json)

The payment was initiated by a script. The buyer model chose the read-only evidence tools, then produced its explanation using numerical comparisons computed from their output. The transaction proves settlement; the run ID, delivery record, and model trace document what was delivered and read. The backtest used historical spot market data; no trades were placed.

## November 21 build-window run

[Finalized testnet transfer](https://ccdexplorer.io/testnet/transaction/0490d4596fd5ced1be358a0dae5021ece5c4c01be31a3cb936a7d4aba731499e) · [Buyer evaluation](build-window/buyer-evaluation.json) · [Delivery](build-window/delivery.json)

Run `loop-20261121-024000-0e57ebd4` used the same fixed specification and historical inputs as the November 8 baseline. The order returned HTTP 402 before payment, then HTTP 202 while the authorized backtest was pending. The seller delivered the real backtest after settlement. The buyer read both evidence files.

## Inspect the recorded case

Requires Node.js 24. From the repository root, create a working copy of the build-window run and check the recorded answer. This does not call a model, broadcast a payment, or rerun the backtest.

```text
node -e "require('node:fs').cpSync('build-window', 'replay', { recursive: true, errorOnExist: true, force: false })"
cd replay
node -e "require('node:fs').renameSync('buyer-evaluation.json', 'recorded-buyer-evaluation.json')"
node ../verify-buyer-answer.mjs buyer-agent-comparison-review.json
```

The included JSON files are field-limited copies of the original backtest evidence. The delivery hashes match these copies. [Source fingerprints](build-window/source-fingerprints.json) record the original file hashes separately. The private research engine, market data files, and wallet credentials are outside this release. The included strategy and spec describe the exact backtest; the public package replays its evidence rather than recomputing it.

## Try the buyer model on the same evidence

Use a new working copy of `build-window/`. Move the recorded outputs `buyer-agent-comparison-review.json` and `buyer-evaluation.json` out of that copy first; the scripts refuse to overwrite evidence. Start a local Ollama instance with `qwen3:4b` installed. The default API is `http://127.0.0.1:11434/api`; set `OLLAMA_API` for a different local port. Run these from the working copy:

```text
node ../buyer-agent.mjs buyer-tool-trace.json
node ../buyer-agent-explain.mjs buyer-tool-trace.json
node ../verify-buyer-answer.mjs buyer-agent-comparison-review.json
```

Inspect the model's actual tool calls and answer before treating a new run as valid; model outputs can vary.

## Payment code

`pay-for-backtest.mjs` runs the testnet x402 exchange on loopback. It checks the quoted amount and testnet before signing. The same signed request returns the same transaction; a local reservation prevents a second attempt in the same working directory. `verify-paid-order.mjs` checks the finalized transfer on-chain and emits authorization for the seller worker. Neither script is needed to inspect the baseline.

To run the payment stage separately, install the locked packages with `npm ci` and use a fresh working directory outside `baseline/`. The payment script transfers **1 test CCD** and requires your own funded, disposable testnet buyer, seller, and fee-sponsor accounts. Set `CONCORDIUM_TESTNET_WALLET` to a wallet file outside the repository. It expects `seed` (a hex HD seed) and `accounts.buyer.address`, `accounts.seller.address`, and `accounts.sponsor.address` matching identity index 0, credential counter 0, key indices 0, 1, and 2. Run the payment and verification scripts from the same working directory. Never use mainnet credentials. If settlement is uncertain, inspect the receipt and chain before attempting another payment.

`fulfill-backtest.py` is the original seller worker with portable paths. It checks that the receipt and fixed spec match the authorization, invokes the existing runner, and publishes the evidence after completion. Running it requires the separate research engine, its original historical inputs, and the Builder prototype path in `QUANT_BUILDER_ROOT`. The public baseline supplies its recorded output for reviewers.
