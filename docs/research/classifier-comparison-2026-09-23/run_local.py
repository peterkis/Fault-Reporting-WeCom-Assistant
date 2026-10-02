"""Execute the unchanged downloaded classifier, locally, against frozen synthetic inputs."""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import sys
import time
from collections import Counter

# Limit BLAS contention on the shared machine; ONNX implementation already uses 2/1.
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
sys.dont_write_bytecode = True

OUT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument("--classifier", type=Path, default=Path(r"C:\Users\zqpet\Downloads\outpatient-intake-classifier"))
parser.add_argument("--mode", choices=["old_rules", "tfidf", "bge"], required=True)
args = parser.parse_args()
sys.path.insert(0, str(args.classifier / "src"))
import psutil
from outpatient_classifier.service import ClassificationService

MAP = {
    "software.his_outpatient": "HIS", "software.his_clinical": "HIS", "software.integrated_workstation": "HIS",
    "software.emr_empi": "EMR", "software.pacs_ris": "PACS", "software.lis_transfusion": "LIS",
    "software.medical_insurance": "INSURANCE", "software.queue_calling": "QUEUE", "hardware.call_device": "QUEUE",
    "hardware.printer": "PRINTER", "hardware.pc_display": "PC", "network": "NETWORK",
    "software.consumables": "CONSUMABLES", "software.mobile_nursing": "MOBILE_NURSING",
    "software.nursing": "NURSING", "software.public_platform": "PUBLIC_PLATFORM", "software.self_service": "SELF_SERVICE",
    "hardware.other": "OTHER_HARDWARE", "software.os_office": "OFFICE", "software.other_clinical": "OTHER_CLINICAL",
    "unknown": "UNKNOWN",
}
raw = (OUT / "synthetic-cases.jsonl").read_bytes()
cases = [json.loads(line) for line in raw.decode("utf-8").splitlines()]
assert len(cases) == 132
before = time.perf_counter()
service = ClassificationService(
    model_dir=args.classifier / "models" if args.mode != "old_rules" else OUT / "_absent_model_directory",
    bge_model_dir=args.classifier / "model_assets/bge-small-zh-v1.5" if args.mode == "bge" else None,
    mode="bge" if args.mode == "bge" else "tfidf",
)
load_ms = (time.perf_counter() - before) * 1000


def topic(label):
    return MAP.get(label, f"UNMAPPED:{label}")


def predict(c, messages=None):
    messages = messages if messages is not None else c["messages"]
    result = service.predict_snapshot(
        [{"message_id": f"{c['id']}:m{i+1}", "text": text} for i, text in enumerate(messages)],
        input_revision=len(messages),
    )
    model = result.get("model_prediction")
    return {
        "topic": topic(result["category"]["code"]), "native_label": result["category"]["code"],
        "request_type": result["request_type"], "symptoms": result["symptoms"],
        "decision_source": result["decision_source"], "confidence": result["confidence"],
        "review_required": result["review_required"], "correction_applied": result["correction_applied"],
        "rule_candidates": result["rule_candidates"], "input_revision": result["input_revision"],
        "evidence_message_ids": result["evidence_message_ids"],
        "model_prediction": model,
        "raw_model_topic": topic(model["label"]) if model else None,
    }


for c in cases:
    predict(c)
times, group_times, predictions = [], {}, []
for repeat in range(5):
    for c in cases:
        before = time.perf_counter()
        result = predict(c)
        ms = (time.perf_counter() - before) * 1000
        times.append(ms)
        group_times.setdefault(c["group"], []).append(ms)
        if repeat == 0:
            predictions.append({"id": c["id"], **result,
                                "revisions": [predict(c, c["messages"][:i+1]) for i in range(len(c["messages"]))]
                                if len(c["messages"]) > 1 else None})


def stats(values):
    values = sorted(values)
    import math
    return {"n": len(values), "p50_ms": values[math.ceil(len(values)*0.5)-1],
            "p95_ms": values[math.ceil(len(values)*0.95)-1], "max_ms": max(values)}


# Targeted structural probes are outside scored cases and are explicitly named.
diagnostics = {}
original_predict = service._model_prediction
calls = []


def counted(text):
    calls.append(len(text))
    return original_predict(text)


service._model_prediction = counted
probe = service.predict("打印机卡纸，纸抽不出来")
diagnostics["rule_hit_model_call"] = {"decision_source": probe["decision_source"], "model_prediction_method_calls": len(calls),
                                       "actual_model_available": args.mode != "old_rules"}
service._model_prediction = original_predict
if service.encoder is not None:
    long_text = "门诊系统报错。" + "我在现场尝试重新操作，每次结果相同，详细经过正在补充。" * 26
    late = "前面说错了，应该是PACS影像浏览器打不开"
    snapshot = service.predict_snapshot([{"message_id": "long-1", "text": long_text}, {"message_id": "long-2", "text": late}], 2)
    tokens = service.encoder._tokenizer.encode(snapshot["snapshot_text"])
    prefix = service.encoder._tokenizer.decode(tokens.ids[:service.encoder.max_length])
    diagnostics["late_supplement_truncation"] = {
        "snapshot_chars": len(snapshot["snapshot_text"]), "total_token_count": len(tokens.ids),
        "model_max_tokens": service.encoder.max_length,
        "late_topic_in_snapshot": "PACS" in snapshot["snapshot_text"],
        "late_topic_in_model_prefix": "pacs" in prefix.lower(),
        "final_topic": topic(snapshot["category"]["code"]), "source": snapshot["decision_source"],
        "raw_model_topic": topic(snapshot["model_prediction"]["label"]),
    }

files = list((args.classifier / "src/outpatient_classifier").glob("*.py"))
files += [args.classifier / "models" / name for name in ["training_manifest.json", "tfidf_head.joblib", "bge_head.joblib"]]
files += [args.classifier / "model_assets/bge-small-zh-v1.5/model_int8.onnx"]
memory = psutil.Process().memory_info()
result = {
    "mode": args.mode, "classifier_root": str(args.classifier), "dataset_sha256": hashlib.sha256(raw).hexdigest(),
    "source_hashes": {str(p.relative_to(args.classifier)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
    "environment": {"python": platform.python_version(), "platform": platform.platform(),
                    "packages": {name: importlib.metadata.version(name) for name in ["numpy", "scipy", "scikit-learn", "onnxruntime", "tokenizers", "joblib", "psutil"]},
                    "blas_threads": 1, "onnx_intra_threads": 2, "onnx_inter_threads": 1},
    "load_ms_excluding_module_import": load_ms, "warm_latency": stats(times),
    "group_latency": {key: stats(value) for key, value in group_times.items()},
    "peak_rss_mib": getattr(memory, "peak_wset", memory.rss) / 2 ** 20,
    "current_rss_mib": memory.rss / 2 ** 20,
    "latency_scope": "Unchanged predict_snapshot including normalization/rules/model when configured; 132 cases x5, sequential, one full warm pass; excludes IPC/DB/queue/UI",
    "decision_sources": dict(Counter(p["decision_source"] for p in predictions)),
    "diagnostics": diagnostics, "predictions": predictions,
}
path = OUT / f"{args.mode}-results.json"
path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"file": str(path), "latency": result["warm_latency"], "peak_rss_mib": result["peak_rss_mib"], "decision_sources": result["decision_sources"], "diagnostics": diagnostics}, ensure_ascii=False))
