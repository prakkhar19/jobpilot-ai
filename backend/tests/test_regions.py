import pytest

from app.data.regions import open_to_india


@pytest.mark.parametrize(
    ("location", "workplace"),
    [
        ("US", "unknown"),
        ("Remote (US)", "remote"),
        ("Remote - CA", "remote"),
        ("Remote - OK; Remote - TX", "remote"),
        ("Palo Alto, CA", "hybrid"),
        ("Dallas, TX", "unknown"),
        ("Honolulu, HI", "hybrid"),
        ("Hybrid in Santa Clara or Mountain View, CA", "hybrid"),
        ("Kuwait City, Kuwait", "unknown"),
        ("Bucharest", "unknown"),
    ],
)
def test_foreign_locations_are_rejected(location, workplace):
    assert open_to_india(location, workplace) is False


@pytest.mark.parametrize(
    ("location", "workplace"),
    [
        ("Gurugram", "unknown"),
        ("Hybrid - Noida, Greater Noida", "hybrid"),
        ("Bengaluru, IN", "onsite"),
        ("Chennai, TN", "onsite"),
        ("Panaji, Goa", "onsite"),
        ("Remote", "remote"),
        ("Remote - APAC", "remote"),
        ("Bangalore, India; Austin, TX", "hybrid"),
    ],
)
def test_india_locations_are_kept(location, workplace):
    assert open_to_india(location, workplace) is True


@pytest.mark.parametrize("location", ["N/A", "In-person", ""])
def test_unknown_locations_stay_unknown(location):
    assert open_to_india(location, "unknown") is None
