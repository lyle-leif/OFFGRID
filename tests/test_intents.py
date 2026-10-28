import pytest

from app.services.intents import Intent, detect, report_query

CASES = [
    # distance (needs a selected place)
    ("How far is it from my current location?", True, Intent("distance")),
    ("How far is it?", True, Intent("distance")),
    ("gaano kalayo ito?", True, Intent("distance")),
    ("Ilang km papunta dito?", True, Intent("distance")),
    ("How long does it take to walk there?", True, Intent("distance")),
    ("gaano katagal maglakad papunta doon?", True, Intent("distance")),
    # nearest
    ("Where is the nearest evacuation center?", False, Intent("nearest", "evacuation_center")),
    ("pinakamalapit na evacuation center", False, Intent("nearest", "evacuation_center")),
    ("Nearest hospital?", False, Intent("nearest", "hospital")),
    ("saan ang pinakamalapit na ospital", False, Intent("nearest", "hospital")),
    ("Where can I buy medicine?", False, Intent("nearest", "pharmacy")),
    ("saan may botika", False, Intent("nearest", "pharmacy")),
    ("closest police station", False, Intent("nearest", "police")),
    ("nearest fire station", False, Intent("nearest", "fire_station")),
    ("saan may palengke", False, Intent("nearest", "market")),
    ("where can I buy rice?", False, Intent("nearest", "market")),
    ("nearest clinic for a check-up", False, Intent("nearest", "health_center")),
    ("where is the town hall", False, Intent("nearest", "town_hall")),
    ("nearest barangay hall", False, Intent("nearest", "barangay_hall")),
    ("nearest ambulance", False, Intent("nearest", "rescue")),
    ("How far is the nearest hospital?", False, Intent("nearest", "hospital")),
    ("Where's the nearest place to go?", False, Intent("nearest")),
    # nearby
    ("What's near me?", False, Intent("nearby")),
    ("anong malapit sa akin", False, Intent("nearby")),
    # contact / hours of the selected place
    ("Contact number?", True, Intent("contact")),
    ("What's the phone number of this place?", True, Intent("contact")),
    ("paano sila tawagan", True, Intent("contact")),
    ("Is it open?", True, Intent("hours")),
    ("What time does it open?", True, Intent("hours")),
    ("bukas ba sila ngayon?", True, Intent("hours")),
]

NOT_INTENTS = [
    ("Is the road there flooded?", True),
    ("Is it safe to walk through floodwater?", False),
    ("How do I treat a burn?", False),
    ("What should I pack for a baby?", False),
    ("Lipa fire station number", True),  # a hotline question, answered from the guides
    ("What number do I call for an emergency?", False),
    ("Is the evacuation center full?", True),  # live condition: never from saved data
    ("How do I get there?", True),  # directions, handled separately
    ("Any reports near me?", False),  # situation reports, handled separately
]


@pytest.mark.parametrize("question,has_place,expected", CASES)
def test_detect(question, has_place, expected):
    assert detect(question, has_place) == expected


@pytest.mark.parametrize("question,has_place", NOT_INTENTS)
def test_not_location_intents(question, has_place):
    assert detect(question, has_place) is None


ROADS = ["road_flooded", "road_blocked"]
CENTERS = ["center_full", "center_open"]
ALL = ["road_flooded", "road_blocked", "center_full", "center_open", "water_available", "power_out", "medical_need",
       "other"]

# (question, the selected place is an evacuation center, report kinds or None)
REPORT_CASES = [
    ("Is the road flooded?", False, ROADS),
    ("Is P. Burgos Street flooded?", False, ROADS),
    ("Is P. Burgos flooded?", False, ROADS),
    ("Is the road to Lipa open?", False, ROADS),
    ("baha ba sa Kumintang?", False, ROADS),
    ("may baha ba dito?", False, ROADS),
    ("sarado ba ang tulay?", False, ROADS),
    ("Is the bridge on Rizal Street flooded right now?", False, ROADS),
    ("Is the evacuation center full?", False, CENTERS),
    ("puno na ba ang evacuation center?", False, CENTERS),
    ("Is it full?", True, CENTERS),
    ("may bakante pa ba?", True, CENTERS),
    ("Is the road to Lipa open?", True, ROADS),
    ("Is there power in Lipa?", False, ["power_out"]),
    ("brownout ba sa Batangas City?", False, ["power_out"]),
    ("may kuryente na ba?", False, ["power_out"]),
    ("Where can I get drinking water?", False, ["water_available"]),
    ("saan may tubig?", False, ["water_available"]),
    ("Any reports near me?", False, ALL),
    ("ano ang balita?", False, ALL),
    ("Is the road flooded and is there power?", False, ROADS + ["power_out"]),
    # advice questions stay with the guides
    ("Is it safe to walk through floodwater?", False, None),
    ("What should I do if the road is flooded?", False, None),
    ("ligtas bang lumusong sa baha", False, None),
    ("What should I do during a brownout?", False, None),
    ("How do I purify water?", False, None),
    ("How much water should I pack in my go-bag?", False, None),
    ("Who do I call about a brownout in Lipa?", False, None),
    ("Is it full?", False, None),
    ("What should I pack for a baby?", False, None),
    ("How do I stop bleeding?", False, None),
]


@pytest.mark.parametrize("question,place_is_center,expected", REPORT_CASES)
def test_report_query(question, place_is_center, expected):
    assert report_query(question, place_is_center) == expected
