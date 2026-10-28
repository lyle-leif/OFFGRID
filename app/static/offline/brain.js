// The phone's own answer engine, used when the hub can't be reached. Loads the guide index
// and road network from the saved data pack on first use (so app start stays fast on
// low-end phones), then answers with exact data via localAsk.

import { format } from "../i18n.js";
import { url } from "../mode.js";
import { blockedEdges, localAsk, planRoute } from "./answers.js";
import { createNormalizer } from "./normalize.js";
import { createRouter, RoutingError } from "./router.js";
import { createSearch } from "./search.js";

export function createBrain(getLocations, getReports = () => null) {
  let search = null;
  let normalizer = null;
  let routerPromise = null;

  async function getSearch() {
    if (!search) {
      const [guides, lexicon] = await Promise.all([
        fetch(url("pack/guides.json")).then((r) => r.json()),
        fetch(url("pack/lexicon.json")).then((r) => r.json()),
      ]);
      search = createSearch(guides);
      normalizer = createNormalizer(lexicon);
    }
    return search;
  }

  function getRouter() {
    routerPromise ??= (async () => {
      try {
        const [meta, bin] = await Promise.all([
          fetch(url("pack/roads-meta.json")).then((r) => r.json()),
          fetch(url("pack/roads.bin")).then((r) => r.arrayBuffer()),
        ]);
        return createRouter(meta, bin);
      } catch (e) {
        routerPromise = null; // try again next time (e.g. pack not saved yet)
        console.warn("offline router unavailable", e);
        return null;
      }
    })();
    return routerPromise;
  }

  async function ask(body) {
    const locations = getLocations();
    return localAsk(body, {
      search: await getSearch(),
      normalize: normalizer.normalize,
      getRouter,
      locations,
      byId: new Map(locations.map((l) => [l.id, l])),
      reports: getReports() ?? { reports: [], syncedMinAgo: undefined },
    });
  }

  // Same shape as the hub's /api/route response, for the Directions card.
  // avoidReports: steer around roads in this phone's copy of the reports (flooded/blocked).
  // lang: the language of the steps and messages ("en" or "tl").
  async function route(fromLat, fromLng, place, mode, avoidReports = true, lang = "en") {
    const router = await getRouter();
    if (!router) throw new Error(format(lang, "err.no_road_pack"));
    const blocked = blockedEdges(getReports()?.reports);
    const start = [fromLat, fromLng];
    const end = [place.lat, place.lng];
    let r;
    try {
      if (avoidReports) {
        r = planRoute(router, start, end, mode, place.name, blocked, lang);
      } else {
        r = router.route(start, end, mode, place.name, null, lang);
        r = { ...r, avoided_reports: [], through_reports: r.edges.filter((e) => blocked.has(e)).map((e) => blocked.get(e)) };
      }
    } catch (e) {
      if (e instanceof RoutingError) throw new Error(e.text(lang));
      throw e;
    }
    return { ...r, to_id: place.id, to_name: place.name, warning: format(lang, "ans.route_warning"), offline: true };
  }

  // The road under a tapped point, as the hub snaps a road report: { edge_id, road_name,
  // point } or null when no road is within 60 m (the online reports need the phone to do this).
  async function snapRoad(lat, lng) {
    const router = await getRouter();
    if (!router) return null;
    try {
      const s = router.snap(lat, lng, "walk", 60);
      return { edge_id: s.edge, road_name: router.roadLabel(s.edge), point: { lat: s.point[0], lng: s.point[1] } };
    } catch (e) {
      if (e instanceof RoutingError) return null;
      throw e;
    }
  }

  return { ask, route, snapRoad };
}
