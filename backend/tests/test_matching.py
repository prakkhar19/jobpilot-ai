from __future__ import annotations

from app.services.jd_analysis import analyze_text
from tests.conftest import import_job, upload_and_approve
from tests.fixtures import JD_ML


def test_jd_analysis_extracts_structure():
    a = analyze_text("Machine Learning Engineer", JD_ML)
    assert {"Python", "PyTorch", "Docker", "Kubernetes", "FastAPI", "Flask"} <= set(a.required_skills)
    assert {"LangChain", "Vector Databases", "AWS"} <= set(a.preferred_skills)
    assert "AWS" not in a.required_skills
    assert a.min_years == 3
    assert a.education_level == 2
    assert a.seniority == ""


def test_jd_analysis_seniority_and_equivalent():
    a = analyze_text("Senior Backend Engineer", "Requirements\n- 5+ years of experience with Go\n"
                     "- BS in CS or equivalent experience")
    assert a.seniority == "senior" and a.min_years == 5
    assert a.education_mandatory is False


def test_match_is_explainable(client):
    upload_and_approve(client)
    job = import_job(client)
    m = job["match"]
    assert m is not None
    assert 40 <= m["overall_score"] <= 100
    comps = {c["key"]: c for c in m["components"] if not c["key"].startswith("_")}
    assert comps["required_skills"]["status"] == "scored"
    assert "Kubernetes" in comps["required_skills"]["missing"]
    assert "Python" in comps["required_skills"]["matched"]
    assert any("not found in your profile" in g for g in m["gaps"])
    assert m["recommendation"] in ("strong_match", "good_match", "consider", "weak_match")
    # Experience: Jan 2021–present plus Jun 2019–Dec 2020 ≈ 5+ years ≥ 3 required
    assert comps["experience"]["score"] == 100.0


def test_missing_profile_data_is_unknown_not_penalised(client):
    prof = upload_and_approve(client)
    prof["educations"] = []
    client.put(f"/api/profiles/{prof['id']}", json=prof)
    job = import_job(client)
    comps = {c["key"]: c for c in job["match"]["components"] if not c["key"].startswith("_")}
    assert comps["education"]["status"] == "unknown"
    assert any("Education" in u for u in job["match"]["unknowns"])


def test_weights_are_configurable(client):
    upload_and_approve(client)
    job = import_job(client)
    before = job["match"]["overall_score"]
    cfg = client.get("/api/agent/config").json()
    cfg["matching_weights"] = {"required_skills": 0, "preferred_skills": 0, "semantic_similarity": 0,
                               "experience": 1, "role_alignment": 0, "education": 0, "location": 0}
    assert client.put("/api/agent/config", json=cfg).status_code == 200
    after = client.post(f"/api/jobs/{job['id']}/match").json()["match"]["overall_score"]
    assert after == 100.0 and after != before
    cfg["matching_weights"] = {"bogus": 1}
    assert client.put("/api/agent/config", json=cfg).status_code == 400


def test_recommended_view_respects_threshold(client):
    upload_and_approve(client)
    import_job(client)
    import_job(client, description="Requirements\n- 8+ years of iOS development with Swift and Objective-C\n"
               "- Xcode, UIKit", title="Senior iOS Developer", company="Other Co")
    rec = client.get("/api/jobs", params={"view": "recommended"}).json()
    titles = [j["title"] for j in rec["items"]]
    assert "Senior iOS Developer" not in titles
    all_jobs = client.get("/api/jobs", params={"sort": "score"}).json()
    assert all_jobs["total"] == 2
    assert all_jobs["items"][0]["match_score"] >= all_jobs["items"][1]["match_score"]
