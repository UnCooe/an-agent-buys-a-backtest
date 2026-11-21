from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import traceback

PROOF = Path.cwd()
APP = Path(os.environ["QUANT_BUILDER_ROOT"]).resolve(strict=True)
RUNNER = APP / "scripts" / "run-demo-research.py"
SPEC = RUNNER.with_name("demo-research-spec.json")
WORKSPACE = PROOF / "backtest"
DELIVERY = PROOF / "delivery.json"


def read_json(path):
    return json.loads(path.read_bytes())


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def publish(payload):
    temp = DELIVERY.with_suffix(".tmp")
    temp.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temp.replace(DELIVERY)


def fulfill():
    auth = read_json(PROOF / "fulfillment-authorized.json")
    receipt_path = PROOF / "payment-receipt.json"
    receipt = read_json(receipt_path)
    assert auth["orderId"] == receipt["orderId"] == "btc-eth-breakout-x402-001"
    assert auth["transaction"] == receipt["transaction"]
    assert auth["receiptSha256"] == sha256(receipt_path)
    assert auth["fixedSpecSha256"] == sha256(SPEC)
    try:
        reservation = (PROOF / "backtest-started.json").open("x", encoding="utf-8")
    except FileExistsError:
        print("Order already reserved; read the existing delivery or worker status.")
        return
    with reservation:
        json.dump(auth, reservation)

    try:
        spec = importlib.util.spec_from_file_location("existing_demo_runner", RUNNER)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        WORKSPACE.mkdir()
        module.WORKSPACE = WORKSPACE
        module.STATUS = WORKSPACE / "progress.json"
        module.main()
        result = read_json(module.STATUS)
        assert result["state"] == "completed"
        record = result["record"]
        assert record["workflow"]["proofPassed"] is True
        run_dir = WORKSPACE / "runs" / result["runId"]
        for card in record["evidence"]:
            source = run_dir / Path(card["source"]).name
            assert sha256(source) == card["fingerprint"]
        publish({
            "orderId": auth["orderId"], "transaction": auth["transaction"],
            "status": "delivered", "runId": result["runId"], "record": record,
        })
    except Exception as error:
        publish({"orderId": auth["orderId"], "transaction": auth["transaction"],
                 "status": "failed", "error": type(error).__name__})
        raise


with (PROOF / "backtest-worker.log").open("a", encoding="utf-8", buffering=1) as log:
    with redirect_stdout(log), redirect_stderr(log):
        try:
            fulfill()
        except Exception:
            traceback.print_exc()
            sys.exit(1)
