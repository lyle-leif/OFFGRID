# OFFGRID field test checklist
*Checklist para sa field test ng OFFGRID*

**Goal:** see how OFFGRID works on real phones, used by real people, with the hub on and then off. Every problem you find helps make the app better.
*Layunin: makita kung paano gumagana ang OFFGRID sa totoong mga cellphone, gamit ng totoong mga tao, habang naka-on ang hub at pagkatapos ay naka-off. Bawat problemang makita ninyo ay makakatulong para gumanda ang app.*

**Time needed:** about 1½ to 2 hours. **People:** 1 host (runs the laptop) and 2 to 4 testers (each with a phone).
*Oras na kailangan: mga 1½ hanggang 2 oras. Mga kasali: 1 host (ang humahawak ng laptop) at 2 hanggang 4 na tester (bawat isa may cellphone).*

---

## Safety and privacy rules
*Mga patakaran para sa kaligtasan at privacy*

- **Use fake test data only.** Reports are test reports; don't post real emergencies.
  *Gumamit lang ng pekeng test data. Ang mga report ay pang-test lang; huwag mag-post ng totoong emergency.*
- **No real names** in anything you type.
  *Walang totoong pangalan sa anumang ita-type ninyo.*
- **Don't call 911 or any hotline.** Only check that tapping a number opens the dialer, then cancel.
  *Huwag tumawag sa 911 o anumang hotline. Tingnan lang kung bumubukas ang dialer kapag pinindot ang numero, tapos i-cancel.*
- **Ask before taking photos of people.** Screenshots of the phone screen are fine.
  *Magpaalam muna bago kumuha ng litrato ng tao. Puwede ang screenshot ng screen ng cellphone.*

---

## Before the test (host)
*Bago ang test (para sa host)*

| ✓ | Task | *Gawain* |
|---|---|---|
| ☐ | Charge the laptop and all phones. Bring a power bank. | *I-charge ang laptop at lahat ng cellphone. Magdala ng power bank.* |
| ☐ | Double-click `start_hub.bat`. Write down the **setup address** and the **certificate code** it shows. | *I-double-click ang `start_hub.bat`. Isulat ang setup address at ang certificate code na lalabas.* |
| ☐ | Write down the **responder PIN** from the "OFFGRID hub - phones (https 8443)" window. | *Isulat ang responder PIN mula sa window na "OFFGRID hub - phones (https 8443)".* |
| ☐ | If Windows asks to allow Python on the network, choose **Allow**. | *Kapag nagtanong ang Windows kung papayagan ang Python sa network, piliin ang Allow.* |
| ☐ | Make sure the laptop and phones are on the **same Wi-Fi** (or use the laptop's Mobile Hotspot). | *Siguraduhing nasa iisang Wi-Fi ang laptop at mga cellphone (o gamitin ang Mobile Hotspot ng laptop).* |
| ☐ | Print this checklist, one copy per tester if possible. | *I-print ang checklist na ito, isang kopya bawat tester kung kaya.* |

Setup address / *Setup address*: ____________________________ Certificate code / *Certificate code*: ____ ____ ____ ____

---

## Phone information
*Impormasyon ng mga cellphone*

| | Phone 1 | Phone 2 | Phone 3 | iPhone |
|---|---|---|---|---|
| Tester (initials only) / *Tester (initials lang)* | | | | |
| Phone model / *Modelo ng cellphone* | | | | |
| Android or iOS version / *Bersyon ng Android o iOS* | | | | |
| RAM, if known / *RAM, kung alam* | | | | |
| Browser (Chrome / Safari) | | | | |
| Old or cheap phone? / *Luma o murang cellphone?* | | | | |

---

## Part A: Setup from scratch (hub ON)
*Bahagi A: Pag-setup mula sa simula (naka-ON ang hub)*

**The tester does every step alone. The host only watches and writes down where they got stuck. Don't help unless they are completely stuck.**
*Ang tester ang gagawa ng bawat hakbang nang mag-isa. Ang host ay manonood lang at isusulat kung saan sila nahirapan. Huwag tumulong maliban kung talagang hindi na nila alam ang gagawin.*

Mark each box: **✓** worked · **✗** failed · **?** confused but managed.
*Markahan ang bawat kahon: ✓ gumana · ✗ hindi gumana · ? nalito pero nagawa rin.*

| # | Step / *Hakbang* | P1 | P2 | P3 | iPhone |
|---|---|---|---|---|---|
| A1 | Open the setup address in Chrome (iPhone: Safari).<br>*Buksan ang setup address sa Chrome (iPhone: Safari).* | | | | |
| A2 | Tap **Download certificate**. Check that the code matches the laptop screen.<br>*Pindutin ang Download certificate. Tingnan kung pareho ang code sa nasa screen ng laptop.* | | | | |
| A3 | Install the certificate, following the steps on the page.<br>*I-install ang certificate ayon sa mga hakbang sa page.* | | | | |
| A4 | Tap **Open https://…** The app opens with no security warning.<br>*Pindutin ang Open https://… Bubukas ang app nang walang security warning.* | | | | |
| A5 | Android: menu ⋮ → **Install app**. iPhone: Share → **Add to Home Screen**.<br>*Android: menu ⋮ → Install app. iPhone: Share → Add to Home Screen.* | | | | |
| A6 | Open OFFGRID **from the home-screen icon**. Wait for **"Saved on this phone"** at the bottom.<br>*Buksan ang OFFGRID mula sa icon sa home screen. Hintayin ang "Saved on this phone" sa ibaba.* | | | | |
| A7 | Time taken for the whole setup (minutes).<br>*Gaano katagal ang buong setup (minuto).* | | | | |

Where did they get stuck? / *Saan sila nahirapan?* ________________________________________________

---

## Part B: Using the app (hub ON)
*Bahagi B: Paggamit ng app (naka-ON ang hub)*

| # | Task / *Gawain* | P1 | P2 | P3 | iPhone |
|---|---|---|---|---|---|
| B1 | In **Assistant**, ask: "What should I do during an earthquake?"<br>*Sa Assistant, itanong: "What should I do during an earthquake?"* | | | | |
| B2 | Ask in Filipino: "saan ang pinakamalapit na ospital?"<br>*Magtanong sa Filipino: "saan ang pinakamalapit na ospital?"* | | | | |
| B3 | Ask with a typo: "how do i stop bleding"<br>*Magtanong nang may maling spelling: "how do i stop bleding"* | | | | |
| B4 | Under a guide answer, is there a green **"Checked against …"** or orange **"Draft"** label?<br>*Sa ilalim ng sagot mula sa guide, may berdeng "Checked against …" o kulay-orange na "Draft" ba?* | | | | |
| B5 | Turn on **Battery saver**, ask any question, then turn it off.<br>*I-on ang Battery saver, magtanong ng kahit ano, tapos i-off ulit.* | | | | |
| B6 | In **Places**, find the nearest evacuation center and open it.<br>*Sa Places, hanapin ang pinakamalapit na evacuation center at buksan ito.* | | | | |
| B7 | Tap **Directions** (Walk, then Drive). Is the route shown on the map?<br>*Pindutin ang Directions (Walk, tapos Drive). Lumabas ba ang ruta sa mapa?* | | | | |
| B8 | Tap **Track with GPS** and walk a few meters. Does the blue dot follow you?<br>*Pindutin ang Track with GPS at maglakad nang ilang metro. Sumusunod ba ang asul na tuldok?* | | | | |
| B9 | **Turn Wi-Fi OFF**, tap **Use GPS**, and wait up to 90 seconds (near a window or outside). Seconds until the blue dot appears:<br>*I-OFF ang Wi-Fi, pindutin ang Use GPS, at maghintay hanggang 90 segundo (malapit sa bintana o sa labas). Ilang segundo bago lumabas ang asul na tuldok:* | ___ s | ___ s | ___ s | ___ s |
| B10 | Turn Wi-Fi back ON.<br>*I-ON ulit ang Wi-Fi.* | | | | |
| B11 | In **Reports**, tap **Report something**, choose a kind, and tap the map. (Test report only!)<br>*Sa Reports, pindutin ang Report something, pumili ng uri, at pindutin ang mapa. (Pang-test lang!)* | | | | |
| B12 | On **another** phone, does the report appear? Tap **Still true**.<br>*Sa ibang cellphone, lumabas ba ang report? Pindutin ang Still true.* | | | | |
| B13 | Responder only: **I'm a responder** → type the PIN → **Unlock** → **Verify**.<br>*Responder lang: I'm a responder → i-type ang PIN → Unlock → Verify.* | | | | |
| B14 | In **Hotlines**, tap a number. Does the dialer open? **Cancel, don't call.**<br>*Sa Hotlines, pindutin ang isang numero. Bumukas ba ang dialer? I-cancel, huwag tumawag.* | | | | |
| B15 | Drag the bottom panel up and down. Is it easy?<br>*Hilahin pataas at pababa ang panel sa ibaba. Madali ba?* | | | | |
| B16 | Try the light/dark button and the **Legend**. Is the text easy to read?<br>*Subukan ang light/dark na button at ang Legend. Madali bang basahin ang mga sulat?* | | | | |

---

## Part C: Hub OFF (no laptop)
*Bahagi C: Naka-OFF ang hub (walang laptop)*

**Host: close the two "OFFGRID hub" windows on the laptop.**
*Host: isara ang dalawang window na "OFFGRID hub" sa laptop.*

| # | Task / *Gawain* | P1 | P2 | P3 | iPhone |
|---|---|---|---|---|---|
| C1 | Close OFFGRID fully, then open it from the icon. Does it open? Does the top say **"On this phone"**?<br>*Isara nang tuluyan ang OFFGRID, tapos buksan mula sa icon. Bumukas ba? Nakasulat ba sa itaas ang "On this phone"?* | | | | |
| C2 | Ask: "nearest evacuation center". Is there an answer?<br>*Itanong: "nearest evacuation center". May sagot ba?* | | | | |
| C3 | Ask: "ano gagawin kapag may lindol". Is there an answer?<br>*Itanong: "ano gagawin kapag may lindol". May sagot ba?* | | | | |
| C4 | Get **Directions** to a place. Does the route appear?<br>*Kumuha ng Directions papunta sa isang lugar. Lumabas ba ang ruta?* | | | | |
| C5 | Post a test report. Does it say it will be sent later?<br>*Mag-post ng test report. Sinasabi ba na ipapadala ito mamaya?* | | | | |
| C6 | **Host: start `start_hub.bat` again.** Wait about a minute. Was the waiting report sent?<br>*Host: buksan ulit ang `start_hub.bat`. Maghintay nang mga isang minuto. Naipadala ba ang naghihintay na report?* | | | | |

---

## Part D: After the test
*Bahagi D: Pagkatapos ng test*

| ✓ | Task / *Gawain* |
|---|---|
| ☐ | On each phone, drag the panel up, tap the **"Saved on this phone"** line at the bottom, and take a **screenshot** of the details.<br>*Sa bawat cellphone, hilahin pataas ang panel, pindutin ang linyang "Saved on this phone" sa ibaba, at mag-screenshot ng mga detalye.* |
| ☐ | Responder: remove all test reports (**I'm a responder** → PIN → **Remove**).<br>*Responder: tanggalin ang lahat ng test report (I'm a responder → PIN → Remove).* |
| ☐ | Ask each tester the questions below and write down their answers.<br>*Itanong sa bawat tester ang mga tanong sa ibaba at isulat ang kanilang sagot.* |

**Tester feedback** / *Puna ng tester*

1. What was easy? / *Ano ang madali?* ______________________________________________
2. What was confusing? / *Ano ang nakakalito?* ______________________________________________
3. What is missing? / *Ano ang kulang?* ______________________________________________
4. Would you use this during a typhoon or brownout? Why? / *Gagamitin mo ba ito tuwing may bagyo o brownout? Bakit?* ______________________________________________
5. Score from 1 (hard) to 5 (very easy) / *Marka mula 1 (mahirap) hanggang 5 (napakadali)*: ____

---

## Report the results
*Iulat ang resulta*

Send these after the test, as photos of this paper or typed:
*Ipadala ang mga ito pagkatapos ng test, bilang litrato ng papel na ito o naka-type:*

- The **phone information** table.
  *Ang table ng impormasyon ng mga cellphone.*
- Every **✗** and **?**, with what happened.
  *Bawat ✗ at ?, kasama kung ano ang nangyari.*
- **Screenshots** of errors and the "Saved on this phone" details.
  *Mga screenshot ng error at ng detalye ng "Saved on this phone".*
- The **GPS times** from B9 and the **tester feedback**.
  *Ang mga oras ng GPS mula sa B9 at ang puna ng mga tester.*

Then we fix what broke, and use the feedback for the new design (Phase 1).
*Pagkatapos, aayusin natin ang mga nasira, at gagamitin ang mga puna para sa bagong disenyo (Phase 1).*
