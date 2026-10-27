import { getLang, roadName, t } from "./i18n.js";
import { icon, iconLabel } from "./ui-icons.js";

// Chat UI: streams NDJSON events from /api/assistant/ask and renders answer + sources.

// A citation, optionally wrapped like "(ID: [doc#chunk])" as small models sometimes write it.
const CITE = /\s?\(?(?:ID:\s*)?\[([a-z0-9-]+#[a-z0-9-]+)\]\)?/gi;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// Render answer text safely (no innerHTML), styling [doc#chunk] citations.
// With `validIds`, citations the model invented (not a real source) are removed.
function renderAnswer(node, text, validIds = null) {
  node.replaceChildren();
  let last = 0;
  for (const m of text.matchAll(CITE)) {
    node.append(text.slice(last, m.index));
    if (!validIds || validIds.has(m[1])) node.append(" ", el("span", "cite", `[${m[1]}]`));
    last = m.index + m[0].length;
  }
  node.append(text.slice(last));
}

function renderSources(sources) {
  const wrap = el("div", "sources");
  for (const s of sources) {
    const btn = el("button", "source");
    iconLabel(btn, "doc", s.title, 13);
    btn.type = "button";
    btn.title = s.chunk_id;
    btn.setAttribute("aria-expanded", "false");
    let ex = null;
    btn.addEventListener("click", () => {
      if (ex) { ex.remove(); ex = null; btn.setAttribute("aria-expanded", "false"); return; }
      ex = el("div", "excerpt", `${s.doc} › ${s.title}\n${s.excerpt}`);
      btn.after(ex);
      btn.setAttribute("aria-expanded", "true");
    });
    wrap.append(btn);
  }
  return wrap;
}

// Under each guide section: which official source it was checked against (and when), or
// that it is still a draft. Also used by the Hotlines tab.
export function trustNote(p) {
  const div = el("div", p.draft ? "trust draft" : "trust");
  if (p.draft) {
    div.append(icon("warning", 13), ` ${t("trust.draft")}`);
    return div;
  }
  const d = /^(\d{4})-(\d{2})/.exec(p.checked_on || "");
  div.append(icon("check", 13), ` ${t("trust.checked")} `);
  if (p.source_url) {
    const a = el("a", null, p.source);
    a.href = p.source_url;
    a.target = "_blank";
    a.rel = "noopener";
    div.append(a);
  } else {
    div.append(p.source);
  }
  if (d) div.append(` · ${t(`month.${Number(d[2])}`)} ${d[1]}`);
  return div;
}

// The exact guide sections that answer the question, shown before any AI text.
function renderPassages(passages) {
  const wrap = el("div", "passages");
  for (const p of passages) {
    const card = el("div", p.draft ? "passage draft" : "passage");
    const head = el("div", "passage-head");
    iconLabel(head, "doc", `${p.doc_title} › ${p.title}`, 13);
    card.append(head, el("div", "passage-text", p.text), trustNote(p));
    wrap.append(card);
  }
  return wrap;
}

export function createChat({
  messages, form, input, send, count, empty, getLocation, getPosition, getMode, onRoute, onContextChange,
  onShowPlace, onRoutePlace, placeIcon, getUseAi, brain, onHubState, reportIcon, onShowReport,
}) {
  let busy = false;

  // Result cards for "nearest hospital" / "what's near me": pin, name, distance, Show + Route.
  function renderPlaces(places) {
    const wrap = el("div", "place-results");
    for (const p of places) {
      const card = el("div", "place-result");
      const icon = placeIcon?.(p.type);
      const info = el("div", "pr-info");
      info.append(el("div", "pr-name", p.name));
      const d = p.distance_m < 1000 ? `${p.distance_m} m` : `${(p.distance_m / 1000).toFixed(1)} km`;
      info.append(el("div", "pr-meta", p.by_road
        ? t(p.mode === "drive" ? "pr.by_road_drive" : "pr.by_road_walk", { d, min: p.duration_min })
        : t("pr.straight", { d })));
      const show = el("button", "btn secondary pr-btn", t("btn.show"));
      show.type = "button";
      show.addEventListener("click", () => onShowPlace?.(p.id));
      const go = el("button", "btn pr-btn", t("btn.route"));
      go.type = "button";
      go.addEventListener("click", () => onRoutePlace?.(p.id));
      if (icon) card.append(icon);
      card.append(info, show, go);
      wrap.append(card);
    }
    return wrap;
  }
  // Situation reports behind a "is the road flooded?" answer, each with a Show button.
  function renderReports(reports) {
    const wrap = el("div", "place-results");
    for (const r of reports) {
      const card = el("div", "place-result report-result");
      const icon = reportIcon?.(r.kind);
      const info = el("div", "pr-info");
      const kind = t(`kind.${r.kind}`);
      const where = r.road_name ? roadName(getLang(), r.road_name) : r.location_name;
      info.append(el("div", "pr-name", where ? `${kind} · ${where}` : kind));
      info.append(el("div", "pr-meta", t("pr.reports", { trust: t(`trustlabel.${r.trust}`), n: r.reports })));
      const show = el("button", "btn secondary pr-btn", t("btn.show"));
      show.type = "button";
      show.addEventListener("click", () => onShowReport?.(r));
      if (icon) card.append(icon);
      card.append(info, show);
      wrap.append(card);
    }
    return wrap;
  }
  // Last grounded question + answer, sent along so follow-ups ("what about for elderly?") keep their topic.
  let lastTurn = null;

  function setLastTurn(turn) {
    lastTurn = turn;
    onContextChange?.(Boolean(turn));
  }

  function scroll() { messages.scrollTop = messages.scrollHeight; }

  function setBusy(v) {
    busy = v;
    send.disabled = v;
    input.disabled = v;
    send.classList.toggle("busy", v);
    send.setAttribute("aria-label", t(v ? "chat.answering" : "chat.send"));
  }

  async function ask(question) {
    if (busy || !question.trim()) return;
    empty?.remove();
    const loc = getLocation();
    const user = el("div", "msg user", question);
    messages.append(user);

    const bot = el("div", "msg bot");
    const label = el("span", "label", loc ? t("chat.about", { name: loc.name }) : t("chat.label"));
    const body = el("div", "typing");
    bot.append(label, body);
    messages.append(bot);
    scroll();
    setBusy(true);

    let text = "";
    let passageText = "";
    let summaryHead = null;

    // What happened to the AI summary: kept (checked), hidden (unsupported details),
    // skipped (battery saver), unavailable (AI off), or refused (guide may not answer).
    function applySummaryState(ev) {
      if (!summaryHead && ev.summary !== "skipped" && ev.summary !== "dropped") return;
      const note = (iconName, msg, cls) => {
        const n = el("div", `summary-note ${cls ?? ""}`);
        iconLabel(n, iconName, msg, 13);
        return n;
      };
      switch (ev.summary) {
        case "verified":
          iconLabel(summaryHead, "sparkle", t("sum.verified"), 13);
          summaryHead.classList.add("ok");
          break;
        case "dropped":
          summaryHead?.remove();
          body.replaceWith(note("warning",
            t(passageText ? "sum.dropped_passages" : "sum.dropped", { list: (ev.unsupported ?? []).join(", ") }),
            "warn"));
          text = "";
          break;
        case "skipped":
          summaryHead?.remove();
          if (passageText) body.replaceWith(note("battery", t("sum.skipped")));
          break;
        case "unavailable":
          summaryHead?.remove();
          body.replaceWith(note("warning", t("sum.unavailable")));
          break;
        case "refused":
          summaryHead?.remove();
          body.replaceWith(note("warning", t("sum.refused")));
          break;
        case "offline":
          summaryHead?.remove();
          if (passageText) body.replaceWith(note("panel", t("sum.offline")));
          break;
        default:
          break;
      }
    }
    // Handle one event from the hub's stream or from the phone's own engine; true when done.
    let offline = false;
    function handle(ev) {
      if (ev.type === "passages") {
        // Guide text first: exact, instant, and it doesn't depend on the AI.
        label.textContent = loc ? t("label.about_guide", { name: loc.name }) : t("label.guide");
        passageText = ev.passages.map((x) => x.text).join("\n\n");
        bot.insertBefore(renderPassages(ev.passages), body);
        summaryHead = el("div", "summary-head");
        iconLabel(summaryHead, "sparkle", t("sum.checking"), 13);
        bot.insertBefore(summaryHead, body);
        body.classList.add("summary-body");
        scroll();
      } else if (ev.type === "token") {
        text += ev.text;
        renderAnswer(body, text);
        scroll();
      } else if (ev.type === "done") {
        body.classList.remove("typing");
        if (offline) bot.classList.add("offline-answer");
        renderAnswer(body, text, new Set((ev.sources ?? []).map((s) => s.chunk_id)));
        applySummaryState(ev);
        if (ev.status === "route") {
          label.textContent = t("label.road");
          bot.classList.add("route");
          onRoute?.(ev.route);
        } else if (ev.status === "places") {
          label.textContent = t("label.map");
          bot.classList.add("route");
          if (ev.places?.length) bot.append(renderPlaces(ev.places));
        } else if (ev.status === "reports") {
          label.textContent = t(offline ? "label.reports_phone" : "label.reports");
          bot.classList.add("uncertain");
          if (ev.reports?.length) bot.append(renderReports(ev.reports));
        } else if (ev.status === "info") {
          label.textContent = loc ? t("label.about_saved", { name: loc.name }) : t("label.saved");
          if (ev.phone) {
            const line = el("div", "call-911", `${t("label.call")} `);
            ev.phone.split(/;\s*/).forEach((num, i) => {
              if (i) line.append(", ");
              const a = el("a", null, num);
              a.href = `tel:${num.replace(/[^+\d]/g, "")}`;
              line.append(a);
            });
            bot.append(line);
          }
        } else if (ev.status === "needs_input") {
          label.textContent = t("label.need_more");
        }
        if (ev.status === "uncertain") {
          bot.classList.add("uncertain");
          label.textContent = t("label.not_saved");
        }
        if (ev.status === "grounded") {
          const kept = ev.summary === "verified" ? text : passageText || text;
          setLastTurn({ question, answer: kept.slice(0, 4000) });
        }
        if (ev.sources?.some((s) => s.doc === "hotlines.md")) {
          // Small models don't reliably lead with 911, so the app adds it itself.
          const line = el("div", "call-911", `${t("label.911")} `);
          const a = el("a", null, "911");
          a.href = "tel:911";
          line.append(a);
          bot.append(line);
        }
        if (ev.sources?.length) bot.append(renderSources(ev.sources));
        else if (ev.status === "grounded" && ev.location_used) {
          bot.append(el("div", "sources", t("label.record_only")));
        }
        return true;
      } else if (ev.type === "error") {
        throw new Error(ev.message);
      }
      return false;
    }

    const payload = {
      question,
      location_id: loc?.id ?? null,
      previous: lastTurn,
      from_pos: getPosition?.() ?? null,
      travel_mode: getMode?.() ?? "walk",
      use_ai: getUseAi?.() ?? true,
      lang: getLang(),
    };
    try {
      let resp = null;
      try {
        // Give up on the hub quickly if it's gone (left its Wi-Fi, laptop off).
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        resp = await fetch("/api/assistant/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        }).finally(() => clearTimeout(timer));
      } catch (netErr) {
        if (!brain) throw netErr;
        resp = null; // no hub: answer on this phone instead
      }
      let finished = false;
      if (!resp) {
        offline = true;
        onHubState?.(false);
        for (const ev of await brain.ask(payload)) if (handle(ev)) { finished = true; break; }
      } else {
        onHubState?.(true);
        if (!resp.ok) {
          const detail = await resp.json().catch(() => ({}));
          const msg = typeof detail.detail === "string" ? detail.detail : t("err.not_accepted");
          throw new Error(msg);
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (!finished) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            if (handle(JSON.parse(line))) { finished = true; break; }
          }
        }
      }
      if (!finished) throw new Error(t("err.cut_off"));
    } catch (err) {
      body.classList.remove("typing");
      bot.classList.add("error");
      label.textContent = t("err.label");
      const msg = err instanceof TypeError || err.name === "AbortError" ? t("err.no_hub_copy") : err.message;
      body.textContent = text ? `${text}\n\n${msg}` : msg;
      const retry = el("button", "btn secondary retry", t("err.retry"));
      retry.type = "button";
      retry.addEventListener("click", () => { bot.remove(); user.remove(); ask(question); });
      bot.append(retry);
    } finally {
      setBusy(false);
      scroll();
      // Laptops: ready for the next question. Phones: don't pop the keyboard up again.
      if (window.matchMedia("(pointer: fine)").matches) input.focus();
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value;
    input.value = "";
    fit();
    ask(q);
  });
  // The box grows with the text (up to its CSS max-height); the counter shows near the limit.
  function fit() {
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
    count.textContent = `${input.value.length}/500`;
    count.hidden = input.value.length < 400;
  }
  input.addEventListener("input", fit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });

  function reset() {
    setLastTurn(null);
    messages.append(el("div", "topic-break", t("chat.new_topic")));
    scroll();
  }

  return { ask, reset };
}
