from app.services.verify import unsupported_facts

GUIDE = (
    "Batangas City CDRRMO (disaster and rescue): (043) 702-3902. 24/7 Mayor's Action Center hotline: "
    "0999-222-6626. Batangas Medical Center: (043) 723-0911. Call 911 for any emergency."
)
WATER = "Pack drinking water, about 3 to 4 liters per person per day for at least 3 days."


def test_correct_phone_numbers_pass():
    s = "Call the Batangas City CDRRMO at (043) 702-3902, or 911 [hotlines#batangas-city-emergency-hotlines]."
    assert unsupported_facts(s, [GUIDE]) == []


def test_phone_without_area_code_passes():
    assert unsupported_facts("Rescue: 702-3902.", [GUIDE]) == []


def test_invented_phone_number_is_caught():
    assert unsupported_facts("Call the CDRRMO at (043) 702-3909.", [GUIDE]) == ["(043) 702-3909"]


def test_swapped_digits_are_caught():
    assert unsupported_facts("Mayor's Action Center: 0999-222-6662.", [GUIDE]) == ["0999-222-6662"]


def test_numbers_must_come_from_the_source():
    assert unsupported_facts("Pack 3 to 4 liters of water per person per day.", [WATER]) == []
    assert unsupported_facts("Pack 10 liters of water per person.", [WATER]) == ["10"]


def test_list_markers_and_citations_are_not_facts():
    s = "1. Pack drinking water [go-bag#water-and-food]\n2. Bring food for 3 days"
    assert unsupported_facts(s, [WATER]) == []


def test_numbers_from_the_question_are_allowed():
    assert unsupported_facts("Signal no. 5 means extreme threat.", ["extreme threat", "what does signal 5 mean"]) == []


def test_invented_place_name_is_caught():
    s = "Go to the San Isidro Evacuation Center."
    assert unsupported_facts(s, [GUIDE]) == ["San Isidro Evacuation Center"]


def test_known_names_pass_and_sentence_words_are_ignored():
    s = "Call Batangas Medical Center. Pack Water and Food first."
    assert unsupported_facts(s, [GUIDE, "## Water and food\n" + WATER]) == []


def test_possessive_names_match():
    assert unsupported_facts("Batangas Medical Center's number is (043) 723-0911.", [GUIDE]) == []
    assert unsupported_facts("Lipa Medical Center's phone is 723-0911.", [GUIDE]) == ["Lipa Medical Center"]
