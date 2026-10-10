import pytest

from app import config
from app.routes.directions import plan_route
from app.services.routing import Router, RoutingError, meters, turn_word

# A tiny hand-made town (lat, lng). Roughly 110 m per 0.001 degree.
#
#   D(0.002,0) --- footway --- E(0.002,0.002)
#   |                          |
#   A(0,0) -- Main St -- B(0,0.001) -- Main St -- C(0,0.002)
#                        |
#                        F(-0.001,0.001)  (Side St, oneway B->F)
#
NODES = [[0, 0], [0, 0.001], [0, 0.002], [0.002, 0], [0.002, 0.002], [-0.001, 0.001]]
A, B, C, D, E, F = range(6)


def graph(edges):
    names = ["", "Main St", "Side St", "North Rd"]
    classes = ["residential", "footway"]
    return {"nodes": NODES, "names": names, "classes": classes, "edges": edges, "retrieved": "test"}


def edge(u, v, name=1, cls=0, oneway=0):
    return [u, v, meters(tuple(NODES[u]), tuple(NODES[v])), name, cls, oneway, []]


@pytest.fixture
def town():
    return Router(graph([
        edge(A, B), edge(B, C),
        edge(A, D, name=3), edge(C, E, name=3),
        edge(D, E, name=0, cls=1),          # unnamed footway
        edge(B, F, name=2, oneway=1),       # oneway B -> F
    ]))


def test_shortest_path_follows_main_street(town):
    r = town.route((0, 0), (0, 0.002), "walk", "C")
    assert 200 < r["distance_m"] < 240
    assert r["steps"][0]["instruction"] == "Head east on Main St"
    assert r["steps"][-1]["instruction"] == "Arrive at C"


def test_drive_respects_oneway(town):
    # Driving B -> F follows the oneway; driving out of F against it is impossible.
    assert town.route((0, 0.001), (-0.001, 0.001), "drive", "F")["distance_m"] < 130
    with pytest.raises(RoutingError, match="No road connection"):
        town.route((-0.001, 0.001), (0.002, 0.002), "drive", "E")
    # Walking ignores oneway.
    assert town.route((-0.001, 0.001), (0, 0.001), "walk", "B")["distance_m"] < 130


def test_drive_avoids_footway_walk_uses_it(town):
    walk = town.route((0.002, 0), (0.002, 0.002), "walk", "E")
    drive = town.route((0.002, 0), (0.002, 0.002), "drive", "E")
    assert walk["distance_m"] < 250            # straight along the footway
    assert drive["distance_m"] > 600           # around via North Rd and Main St


def test_snapping_adds_approach_step(town):
    r = town.route((0.0005, 0.0005), (0, 0.002), "walk", "C")
    assert r["steps"][0]["instruction"] == "Go to the nearest road"


def test_too_far_from_any_road(town):
    with pytest.raises(RoutingError):
        town.route((0.5, 0.5), (0, 0), "walk", "A")


def test_route_lists_its_edges(town):
    assert town.route((0, 0), (0, 0.002), "walk", "C")["edges"] == [0, 1]


def test_avoid_goes_around_a_reported_road(town):
    # Main St B-C (edge 1) reported flooded: walk A -> C goes round by North Rd and the footway.
    r = town.route((0, 0), (0, 0.002), "walk", "C", avoid=frozenset({1}))
    assert 1 not in r["edges"] and r["edges"] == [2, 3, 4]
    assert r["distance_m"] > 600


def test_plan_route_reports_what_it_avoided(town):
    r = plan_route(town, (0, 0), (0, 0.002), "walk", "C", {1: "rep-1"})
    assert r["avoided_reports"] == ["rep-1"] and r["through_reports"] == []
    # A report on a road the route doesn't use changes nothing.
    r = plan_route(town, (0, 0), (0, 0.002), "walk", "C", {5: "rep-5"})
    assert r["avoided_reports"] == [] and r["through_reports"] == [] and r["edges"] == [0, 1]


def test_plan_route_with_no_way_around_keeps_the_route_and_says_so(town):
    class NoDetour:
        def route(self, start, end, mode, name, avoid=frozenset()):
            if avoid:
                raise RoutingError("No road connection found between these points in the saved road data.")
            return town.route(start, end, mode, name)

    r = plan_route(NoDetour(), (0, 0), (0, 0.002), "walk", "C", {1: "rep-1"})
    assert r["through_reports"] == ["rep-1"] and r["avoided_reports"] == [] and r["edges"] == [0, 1]


def test_turn_words():
    assert turn_word(5) == "Continue"
    assert turn_word(40) == "Bear right"
    assert turn_word(-90) == "Turn left"
    assert turn_word(170) == "Make a U-turn"


@pytest.mark.skipif(not config.ROADS_FILE.exists(), reason="road data not installed")
def test_real_route_batstateu_to_batangas_medical_center():
    r = Router.load(config.ROADS_FILE)
    res = r.route((13.754146, 121.053128), (13.767024, 121.066773), "walk", "Batangas Medical Center")
    assert res["straight_line_m"] < res["distance_m"] < 3 * res["straight_line_m"]
    roads = {s["road"] for s in res["steps"]}
    assert "Rizal Avenue" in roads


def test_mid_edge_start_routes_from_where_you_are(town):
    # Standing in the middle of Main St between A and B, going to C: walk ~165 m along
    # Main St, not back to junction A first (which would be ~275 m).
    r = town.route((0.00005, 0.0005), (0, 0.002), "walk", "C")
    assert 150 < r["distance_m"] < 185
    assert not any(s["instruction"] == "Go to the nearest road" for s in r["steps"])


def test_same_edge_start_and_end(town):
    r = town.route((0, 0.0002), (0, 0.0008), "walk", "X")
    assert 60 < r["distance_m"] < 72
    assert [s["instruction"] for s in r["steps"]][0] == "Head east on Main St"


def test_partial_edge_respects_oneway_when_driving(town):
    # Halfway down the oneway Side St (B -> F): you can drive on to F,
    # but cannot drive back up to B against the oneway.
    mid_side = (-0.0005, 0.001)
    assert town.route(mid_side, (-0.001, 0.001), "drive", "F")["distance_m"] < 70
    with pytest.raises(RoutingError, match="No road connection"):
        town.route(mid_side, (0, 0.002), "drive", "C")
    assert town.route(mid_side, (0, 0.002), "walk", "C")["distance_m"] < 180


def test_bearing_ignores_tiny_kink():
    from app.services.routing import bearing_along
    # A 1 m jog north, then 100 m east: the road heads east.
    pts = [(0.0, 0.0), (0.00001, 0.0), (0.00001, 0.001)]
    assert 80 < bearing_along(pts) < 100


@pytest.mark.skipif(not config.ROADS_FILE.exists(), reason="road data not installed")
def test_real_gps_fix_beside_road_snaps_to_it():
    r = Router.load(config.ROADS_FILE)
    s = r.snap(13.7672, 121.0660, "walk")  # beside Roxas Road, Batangas City
    assert s.off < 30 and r.edges[s.edge].name == "Roxas Road"
    res = r.route((13.7672, 121.0660), (13.767024, 121.066773), "walk", "Batangas Medical Center")
    assert res["steps"][0]["instruction"].startswith("Head")  # no detour to a junction first
