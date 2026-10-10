// The phone's own answer engine, used when the hub can't be reached. Loads the guide index
// and road network from the saved data pack on first use (so app start stays fast on
// low-end phones), then answers with exact data via localAsk.

import { blockedEdges, localAsk, planRoute, ROUTE_WARNING } from "./answers.js";
import { createNormalizer } from "./normalize.js";
import { createRouter } from "./router.js";
import { createSearch } from "./search.js";

export function createBrain(getLocations, getReports = () => null) {
  let search = null;
  let normalizer = null;
  let routerPromise = null;

  async function getSearch() {
    if (!search) {
      const [guides, lexicon] = await Promise.all([
        fetch("/pack/guides.json").then((r) => r.json()),
        fetch("/pack/lexicon.json").then((r) => r.json()),
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
          fetch("/pack/roads-meta.json").then((r) => r.json()),
          fetch("/pack/roads.bin").then((r) => r.arrayBuffer()),
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
  async function route(fromLat, fromLng, place, mode, avoidReports = true) {
    const router = await getRouter();
    if (!router) throw new Error("Directions aren't saved on this phone yet. Connect to the hub once to save them.");
    const blocked = blockedEdges(getReports()?.reports);
    const start = [fromLat, fromLng];
    const end = [place.lat, place.lng];
    let r;
    if (avoidReports) {
      r = planRoute(router, start, end, mode, place.name, blocked);
    } else {
      r = router.route(start, end, mode, place.name);
      r = { ...r, avoided_reports: [], through_reports: r.edges.filter((e) => blocked.has(e)).map((e) => blocked.get(e)) };
    }
    return { ...r, to_id: place.id, to_name: place.name, warning: ROUTE_WARNING, offline: true };
  }

  return { ask, route };
}
