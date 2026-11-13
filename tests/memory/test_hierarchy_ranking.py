"""Hierarchy is a bounded ranking nudge: importance and layer separate near-ties, nothing more."""

from norn_m.memory.hierarchy import hierarchy_quality
from norn_m.utils.scoring import HIERARCHY_BOOST_WEIGHT, score_and_rank


def _candidate(memory_id, semantic, layer=None, importance=None):
    payload = {"data": memory_id}
    if layer is not None:
        payload["layer"] = layer
    if importance is not None:
        payload["importance"] = importance
    return {"id": memory_id, "score": semantic, "payload": payload}


def _rank(candidates, threshold=0.1):
    boosts = {}
    for candidate in candidates:
        quality = hierarchy_quality(candidate["payload"])
        if quality is not None:
            boosts[candidate["id"]] = HIERARCHY_BOOST_WEIGHT * quality
    return [row["id"] for row in score_and_rank(candidates, {}, {}, threshold, len(candidates), hierarchy_boosts=boosts)]


def test_quality_prefers_higher_layer_and_importance():
    assert hierarchy_quality({"layer": "L0", "importance": 10}) == 1.0
    assert hierarchy_quality({"layer": "L4", "importance": 1}) < hierarchy_quality({"layer": "L2", "importance": 6})


def test_quality_is_none_for_memories_written_before_hierarchy_fields():
    assert hierarchy_quality({}) is None
    assert hierarchy_quality({"data": "text"}) is None


def test_quality_survives_a_string_importance():
    assert hierarchy_quality({"layer": "L1", "importance": "8"}) == hierarchy_quality({"layer": "L1", "importance": 8})


def test_importance_breaks_a_near_tie():
    candidates = [_candidate("core", 0.80, "L1", 9), _candidate("noise", 0.82, "L4", 2)]

    assert _rank(candidates)[0] == "core"


def test_boost_cannot_outrank_a_much_more_relevant_memory():
    candidates = [_candidate("relevant", 0.90, "L4", 1), _candidate("important", 0.75, "L0", 10)]

    assert _rank(candidates)[0] == "relevant"


def test_boost_does_not_rescue_a_candidate_below_the_semantic_threshold():
    candidates = [_candidate("weak", 0.05, "L0", 10)]

    assert _rank(candidates, threshold=0.1) == []


def test_mixed_stores_keep_legacy_memories_ranked_by_similarity():
    candidates = [_candidate("legacy", 0.70), _candidate("scored", 0.70, "L3", 5)]

    ranked = _rank(candidates)

    assert set(ranked) == {"legacy", "scored"}
