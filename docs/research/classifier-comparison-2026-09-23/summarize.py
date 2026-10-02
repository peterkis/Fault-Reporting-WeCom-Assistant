"""Calculate comparisons without changing samples, thresholds, models or rules."""
import hashlib
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
raw = (ROOT / "synthetic-cases.jsonl").read_bytes()
cases = [json.loads(line) for line in raw.decode("utf8").splitlines()]
by_id = {c["id"]: c for c in cases}
results = {mode: json.loads((ROOT / f"{mode}-results.json").read_text(encoding="utf8"))
           for mode in ["rules", "old_rules", "tfidf", "bge"]}


def metrics(pairs, key="topic"):
    n = len(pairs)
    emitted = [(c, p) for c, p in pairs if p[key] != "UNKNOWN"]
    correct = sum(c["expected_topic"] == p[key] for c, p in pairs)
    emitted_correct = sum(c["expected_topic"] == p[key] for c, p in emitted)
    return {"n": n, "correct_including_abstention_if_gold_unknown": correct,
            "accuracy": correct / n if n else None, "emitted": len(emitted),
            "emission_coverage": len(emitted) / n if n else None,
            "emitted_correct": emitted_correct,
            "emitted_precision": emitted_correct / len(emitted) if emitted else None,
            "wrong_emissions": len(emitted) - emitted_correct}


summary = {"dataset_sha256": hashlib.sha256(raw).hexdigest(), "case_counts": dict(Counter(c["group"] for c in cases)), "models": {}}
for mode, result in results.items():
    assert result["dataset_sha256"] == summary["dataset_sha256"]
    assert {p["id"] for p in result["predictions"]} == set(by_id)
    pairs = [(by_id[p["id"]], p) for p in result["predictions"]]
    common = [(c, p) for c, p in pairs if c["group"] in ["literal", "colloquial", "supplement"]]
    item = {
        "common_unambiguous": metrics(common),
        "groups": {group: metrics([(c, p) for c, p in pairs if c["group"] == group]) for group in summary["case_counts"]},
        "warm_latency": result["warm_latency"], "peak_rss_mib": result["peak_rss_mib"],
    }
    if mode in ["tfidf", "bge"]:
        item["raw_head_common_top1"] = metrics(common, "raw_model_topic")
        item["decision_sources"] = result["decision_sources"]
        item["model_fallback_predictions"] = [{"id": c["id"], "expected": c["expected_topic"], "topic": p["topic"], "confidence": p["confidence"]}
                                               for c, p in pairs if p["decision_source"] == mode]
    if mode == "rules":
        controls = [(c, p) for c, p in pairs if c["acceptable_routes"]]
        item["route_controls"] = {"n": len(controls), "matched": sum(p["route"] in c["acceptable_routes"] for c, p in controls),
                                  "mismatches": [{"id": c["id"], "observed": p["route"], "acceptable": c["acceptable_routes"]}
                                                 for c, p in controls if p["route"] not in c["acceptable_routes"]]}
        item["common_fault_routing"] = dict(Counter(p["route"] for c, p in common))
    item["common_misses"] = [{"id": c["id"], "expected": c["expected_topic"], "predicted": p["topic"]}
                             for c, p in common if c["expected_topic"] != p["topic"]]
    summary["models"][mode] = item

# Only aggregate local historical metadata; no historical message is copied out.
old = Path(r"C:\Users\zqpet\Downloads\outpatient-intake-classifier")
split = [json.loads(line) for line in (old / "models/split.jsonl").read_text(encoding="utf8").splitlines()]
train = [r for r in split if r["split"] == "train"]
test = [r for r in split if r["split"] == "test"]
train_groups = {r["split_group_id"] for r in train}
test_groups = {r["split_group_id"] for r in test}
train_texts = {r["text"].strip() for r in train}
test_texts = {r["text"].strip() for r in test}
audit = {
    "train": len(train), "test": len(test), "train_labels": len({r["label"] for r in train}),
    "test_labels": len({r["label"] for r in test}), "group_overlap_count": len(train_groups & test_groups),
    "test_records_with_group_in_train": sum(r["split_group_id"] in train_groups for r in test),
    "identical_text_overlap_count": len(train_texts & test_texts),
    "test_records_identical_text_in_train": sum(r["text"].strip() in train_texts for r in test),
    "label_support": dict(Counter(r["label"] for r in train)),
    "test_sources": dict(Counter(r["record_type"] for r in test)),
    "empty_train": sum(not r["text"].strip() for r in train),
}
(ROOT / "historical-split-audit.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
jev = json.loads((ROOT / "jev-results.json").read_text(encoding="utf8"))
assert jev["dataset_sha256"] == summary["dataset_sha256"]
assert jev["status"] == "COMPLETED" and not jev["failures"] and len(jev["predictions"]) == len(cases)
j_pairs = [(by_id[p["id"]], p) for p in jev["predictions"]]
j_common = [(c, p) for c, p in j_pairs if c["group"] in ["literal", "colloquial", "supplement"]]
j_times = sorted(p["elapsed_ms"] for _, p in j_pairs)
import math
tokens = sum(p["usage"]["input_tokens"] for _, p in j_pairs)
summary["jev"] = {
    "models": dict(Counter(p["model"] for _, p in j_pairs)),
    "raw_common": metrics(j_common, "raw_topic"), "thresholded_common": metrics(j_common),
    "threshold_policy": "Experimental chosen probability >=0.72 and top-two margin>=0.08; not calibrated. Choice.confidence is not used as a correctness probability.",
    "groups_raw": {g: metrics([(c, p) for c, p in j_pairs if c["group"] == g], "raw_topic") for g in summary["case_counts"]},
    "groups_thresholded": {g: metrics([(c, p) for c, p in j_pairs if c["group"] == g]) for g in summary["case_counts"]},
    "request_nature_counts": dict(Counter(p["request_nature"]["choice"] for _, p in j_pairs)),
    "request_latency": {"n": len(j_times), "p50_ms": j_times[math.ceil(len(j_times)*0.5)-1],
                        "p95_ms": j_times[math.ceil(len(j_times)*0.95)-1], "p99_ms": j_times[math.ceil(len(j_times)*0.99)-1], "max_ms": max(j_times)},
    "total_input_tokens": tokens, "estimated_usd_at_published_direct_rate": tokens*0.042/1e6,
    "http_or_schema_failures": len(jev["failures"]),
    "common_misses": [{"id": c["id"], "expected": c["expected_topic"], "raw": p["raw_topic"], "thresholded": p["topic"], "p": p["chosen_probability"]}
                      for c, p in j_common if p["topic"] != c["expected_topic"] or p["raw_topic"] != c["expected_topic"]],
    "route_controls": [{"id": c["id"], "request_nature": p["request_nature"]["choice"], "needs_review": p["needs_review"]["noul"], "acceptable_routes": c["acceptable_routes"]}
                       for c, p in j_pairs if c["group"] == "route_controls"],
}
(ROOT / "comparison-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
for mode, item in summary["models"].items():
    print(mode, json.dumps({"common": item["common_unambiguous"], "groups": {g: m["correct_including_abstention_if_gold_unknown"] for g, m in item["groups"].items()}, "raw": item.get("raw_head_common_top1"), "fallback": item.get("model_fallback_predictions"), "latency": item["warm_latency"], "peak_rss_mib": item["peak_rss_mib"]}, ensure_ascii=False))
print('jev', json.dumps(summary['jev'], ensure_ascii=False))
