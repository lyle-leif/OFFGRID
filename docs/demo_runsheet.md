# OFFGRID 1-minute demo run-sheet

Offline copy of the shared run-sheet, as of 2026-10-10.
A live 60-second demo: the AI answers on the laptop with no internet, an iPhone joins over Wi-Fi,
then the laptop goes away and the phone keeps working.

## The 60 seconds

Type questions exactly as written, typos included.

| Time | Show / do | Say |
|---|---|---|
| 0:00–0:08 | Laptop map of Batangas. Point at the Wi-Fi icon: no internet. | "A typhoon hits Batangas. Power's out, no internet. Most AI apps stop working right here. OFFGRID doesn't." |
| 0:08–0:22 | Laptop, Assistant: type **is it safe to wlak thru flood water?** → guide text in ~2 s, AI summary "checked against the guide" by ~5 s. | "The AI runs on this laptop: a 3-billion-parameter model, no cloud. It answers from saved official guides, it understood my typo, and code checks every fact before you see it." |
| 0:22–0:36 | iPhone: flag → **Road flooded** → tap a street. Flag appears on the laptop map within 3 s. | "Neighbours' phones join the laptop over plain Wi-Fi, no internet. One phone reports a flooded road and everyone sees it. Directions now route around it." |
| 0:36–0:52 | Laptop: close the two "OFFGRID hub" windows. iPhone, Assistant: **saan ang pinakamalapit na ospitl?** → pill "On this phone (no hub)", nearest hospitals instantly → tap **Route**. | "Now the laptop is gone. The phone still answers, in Filipino, typos and all, with turn-by-turn directions." |
| 0:52–1:00 | Logo. | "OFFGRID: AI that works when the cloud doesn't. Ready beyond the grid." |

Measured: laptop answer complete in ~5 s, phone hospital answer < 1 s, report reaches the laptop in 0.5–2.7 s with `?demo`.
Honest split: the language model runs on the laptop; phones run the offline engine (search, routing, typo fixing, reports).

## Night before (real iPhone)

- [ ] `start_hub.bat`; iPhone on the same Wi-Fi; Safari → `http://192.168.1.26:8080/setup` loads (else: Personal Hotspot fallback).
- [ ] Download certificate (code 874D CAAF E982 5344) → Settings → Profile Downloaded → Install → General → About → Certificate Trust Settings → OFFGRID Hub on.
- [ ] Safari → `https://192.168.1.26:8443` (no warning) → Share → Add to Home Screen → open from the icon → wait for "Saved on this phone".
- [ ] Set my location near Batangas City; rehearse all five rows with a timer, including closing the hub.
- [ ] Restart the hub, check the queued report arrived, then `tools/demo_check.py --clear-reports`.

## 10 minutes before

- [ ] Laptop plugged in, Ollama running, `start_hub.bat` running.
- [ ] `.venv\Scripts\python tools\demo_check.py --clear-reports` → every line OK.
- [ ] Router internet cable out (Wi-Fi stays on).
- [ ] iPhone: Airplane mode on, then Wi-Fi on; open OFFGRID from the icon; pill says "Offline-ready".
- [ ] Laptop browser: `http://127.0.0.1:8080/?demo`, battery saver off, map on Batangas City, chats cleared.
- [ ] Phone visible to the audience (document camera, mirroring app, or held up).

## If something goes wrong

| Problem | Do this |
|---|---|
| iPhone can't open the hub | iPhone Personal Hotspot on; laptop joins it; rerun `start_hub.bat`; use the new address (usually 172.20.10.x). |
| AI summary slow or hidden | Keep going: the guide text is the answer. Battery saver gives instant guide-only answers. |
| Report flag doesn't appear | Laptop URL must end in `?demo`; wait 3 s; open the Reports tab. |
| App not on the home screen | Use the same address in Safari. |
| Phone waits after the hub closes | Close the hub windows; don't shut the lid (a sleeping laptop makes the phone wait ~6 s). |
| Nothing on the phone works | Show the phone steps on the laptop with the browser at phone size. |

## Likely questions

| Question | Answer |
|---|---|
| Which AI model? | Qwen 2.5, 3B, in Ollama on the laptop (i5, 8 GB RAM). No cloud, no API key. |
| Does the phone run the AI? | No. Phones run the offline engine: guide search, typo fixing, routing, reports. |
| How do you stop it making things up? | Guide text is shown first, word for word. Code checks every number, phone, name and citation in the AI summary; anything unsupported is hidden. |
| How big on a phone? | About 46 MB, saved once from the hub. |
| What area? | All of Batangas: 1,758 facilities, about 19,000 km of roads (OpenStreetMap). |
| False reports? | Shown as "unverified" until confirmed or verified by a responder PIN; disputed ones hidden; all expire in 2–6 h. |
| Understanding? | 220 test questions with typos, text-speak and Filipino/Taglish: all answered the right way on laptop and phone. |
| Cost? | No licence or cloud fees: open map data and an open model on an ordinary laptop. |
