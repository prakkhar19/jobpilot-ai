"""Decide whether a job's location is open to someone in India (onsite/hybrid in India, or remote India-friendly)."""

from __future__ import annotations

import re

INDIA_PLACES = [
    "india", "delhi", "new delhi", "ncr", "noida", "greater noida", "gurugram", "gurgaon", "faridabad", "ghaziabad",
    "bengaluru", "bangalore", "mumbai", "navi mumbai", "thane", "pune", "hyderabad", "secunderabad", "chennai",
    "kolkata", "ahmedabad", "gandhinagar", "jaipur", "chandigarh", "mohali", "panchkula", "indore", "bhopal",
    "lucknow", "kanpur", "nagpur", "coimbatore", "kochi", "cochin", "trivandrum", "thiruvananthapuram", "mysore",
    "mysuru", "mangalore", "visakhapatnam", "vizag", "vijayawada", "bhubaneswar", "surat", "vadodara", "nashik",
    "dehradun", "agra", "patna", "ranchi", "guwahati", "goa", "madurai", "tiruchirappalli", "warangal", "jodhpur",
    "udaipur", "ludhiana", "amritsar", "jalandhar", "phagwara", "raipur", "bhilai", "karnataka", "maharashtra",
    "tamil nadu", "telangana", "kerala", "haryana", "uttar pradesh", "west bengal", "gujarat", "rajasthan", "punjab",
]
# Remote roles that say these are open to India.
OPEN_REGIONS = ["apac", "asia", "asia pacific", "worldwide", "anywhere", "global", "south asia", "ist", "any location",
                "work from home", "wfh"]
FOREIGN_PLACES = [
    "united states", "usa", "u.s.", "us-", "us only", "north america", "americas", "latam", "latin america",
    "canada", "mexico", "brazil", "argentina", "colombia", "chile", "peru", "united kingdom", "uk", "england",
    "london", "scotland", "ireland", "dublin", "europe", "emea", "eu", "germany", "berlin", "munich", "france",
    "paris", "spain", "madrid", "barcelona", "portugal", "lisbon", "netherlands", "amsterdam", "switzerland",
    "zurich", "italy", "poland", "warsaw", "sweden", "stockholm", "denmark", "copenhagen", "norway", "finland",
    "austria", "belgium", "czech", "romania", "ukraine", "estonia", "greece", "turkey", "israel", "tel aviv",
    "uae", "dubai", "saudi", "qatar", "egypt", "nigeria", "kenya", "south africa", "australia", "sydney",
    "melbourne", "new zealand", "japan", "tokyo", "korea", "seoul", "china", "beijing", "shanghai", "hong kong",
    "taiwan", "singapore", "philippines", "manila", "vietnam", "indonesia", "jakarta", "malaysia", "thailand",
    "bangkok", "pakistan", "bangladesh", "sri lanka", "nepal", "san francisco", "new york", "nyc", "seattle",
    "boston", "austin", "chicago", "los angeles", "denver", "atlanta", "toronto", "vancouver", "montreal",
    "washington", "california", "texas", "remote us", "remote - us", "remote, us", "pst", "est", "cet",
]
# Remote job descriptions that restrict where you must live.
_FOREIGN_ONLY = re.compile(
    r"(?i)\b(must (?:be )?(?:located|based|reside|live) in (?:the )?(?:us|u\.s\.|united states|usa|canada|uk|"
    r"united kingdom|europe|eu)|(?:us|u\.s\.|usa|uk|eu|europe|canada)[- ]only|authori[sz]ed to work in the (?:us|"
    r"united states|uk)|within the (?:us|united states|uk|eu)\b|us[- ]based (?:candidates|applicants|remote))")


def _has(text: str, places: list[str]) -> bool:
    return any(re.search(rf"(?<![a-z]){re.escape(p)}(?![a-z])", text) for p in places)


def mentions_india(location: str) -> bool:
    return _has((location or "").lower(), INDIA_PLACES)


def open_to_india(location: str, workplace_type: str = "unknown", description: str = "") -> bool | None:
    """True = open to India, False = clearly elsewhere, None = location unknown."""
    loc = (location or "").lower().strip()
    if not loc:
        return None if not _FOREIGN_ONLY.search(description or "") else False
    if mentions_india(loc):
        return True
    remote = workplace_type == "remote" or "remote" in loc
    if remote:
        if _has(loc, OPEN_REGIONS):
            return True
        if _has(loc, FOREIGN_PLACES):
            return False
        # Plain "Remote": trust it unless the description restricts the country.
        return not _FOREIGN_ONLY.search(description or "")
    if _has(loc, FOREIGN_PLACES):
        return False
    return None
