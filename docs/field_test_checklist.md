# OFFGRID field test checklist
*Checklist para sa field test ng OFFGRID*

**Goal:** see how OFFGRID works on real phones, used by real people: installed from the **website link** or from a **barangay hub** (laptop), online and then with no internet or hub. Every problem you find helps make the app better.
*Layunin: makita kung paano gumagana ang OFFGRID sa totoong mga cellphone, gamit ng totoong mga tao: naka-install mula sa **link ng website** o mula sa **hub ng barangay** (laptop), habang online at pagkatapos ay walang internet o hub. Bawat problemang makita ninyo ay makakatulong para gumanda ang app.*

**Time needed:** about 2 hours. **People:** 1 host (organiser; runs the laptop if a hub is used), 1 responder, and 2 to 4 testers (each with a phone).
*Oras na kailangan: mga 2 oras. Mga kasali: 1 host (ang tagapag-ayos; hahawak ng laptop kung may hub), 1 responder, at 2 hanggang 4 na tester (bawat isa may cellphone).*

---

## Safety and privacy rules
*Mga patakaran para sa kaligtasan at privacy*

- **Use fake test data only.** Reports are test reports; don't post real emergencies. Start every test note with **"TEST"**.
  *Gumamit lang ng pekeng test data. Ang mga report ay pang-test lang; huwag mag-post ng totoong emergency. Simulan ang bawat test na tala sa "TEST".*
- **No real names or phone numbers** in anything you type.
  *Walang totoong pangalan o numero ng telepono sa anumang ita-type ninyo.*
- **Don't call 911 or any hotline.** Only check that tapping a number opens the dialer, then cancel.
  *Huwag tumawag sa 911 o anumang hotline. Tingnan lang kung bumubukas ang dialer kapag pinindot ang numero, tapos i-cancel.*
- **Ask before taking photos of people.** Screenshots of the phone screen are fine.
  *Magpaalam muna bago kumuha ng litrato ng tao. Puwede ang screenshot ng screen ng cellphone.*
- **Website reports are seen by everyone using the website.** Remove all test reports at the end (Part D).
  *Nakikita ng lahat ng gumagamit ng website ang mga report doon. Tanggalin ang lahat ng test report sa dulo (Bahagi D).*

---

## Before the test (host)
*Bago ang test (para sa host)*

| ✓ | Task | *Gawain* |
|---|---|---|
| ☐ | Charge all phones (and the laptop if using a hub). Bring a power bank. | *I-charge ang lahat ng cellphone (at ang laptop kung may hub). Magdala ng power bank.* |
| ☐ | Decide which phones install from the **website** (Part A-1) and which from the **hub** (Part A-2). Try at least one of each. | *Pagpasyahan kung aling cellphone ang mag-i-install mula sa website (Bahagi A-1) at alin mula sa hub (Bahagi A-2). Subukan ang kahit isa sa bawat isa.* |
| ☐ | **Website responder:** on the laptop, run `node tools/cloud_admin.mjs add "Name"` for the responder and give them the password privately. | *Responder sa website: sa laptop, patakbuhin ang `node tools/cloud_admin.mjs add "Pangalan"` para sa responder at ibigay nang pribado ang password.* |
| ☐ | **Hub (if used):** double-click `start_hub.bat`. Write down the **setup address**, the **certificate code** and the **responder PIN**. If Windows asks to allow Python on the network, choose **Allow**. | *Hub (kung gagamitin): i-double-click ang `start_hub.bat`. Isulat ang setup address, certificate code at responder PIN. Kapag nagtanong ang Windows tungkol sa Python, piliin ang Allow.* |
| ☐ | Hub phones and the laptop on the **same Wi-Fi** (or the laptop's Mobile Hotspot). Website phones need **internet** (Wi-Fi is best: about 46 MB). | *Ang mga cellphone na gagamit ng hub at ang laptop ay nasa iisang Wi-Fi (o Mobile Hotspot ng laptop). Ang mga cellphone na gagamit ng website ay kailangan ng internet (mas mabuti ang Wi-Fi: mga 46 MB).* |
| ☐ | Print this checklist, one copy per tester if possible. | *I-print ang checklist na ito, isang kopya bawat tester kung kaya.* |

Website: **https://lyle-leif.github.io/OFFGRID/**
Hub setup address / *Setup address ng hub*: ____________________________ Certificate code: ____ ____ ____ ____

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
| Installed from: website or hub / *Na-install mula sa: website o hub* | | | | |
| Language chosen: Tagalog or English / *Napiling wika* | | | | |

---

## Part A: Setup from scratch
*Bahagi A: Pag-setup mula sa simula*

**The tester does every step alone. The host only watches and writes down where they got stuck. Don't help unless they are completely stuck.**
*Ang tester ang gagawa ng bawat hakbang nang mag-isa. Ang host ay manonood lang at isusulat kung saan sila nahirapan. Huwag tumulong maliban kung talagang hindi na nila alam ang gagawin.*

Mark each box: **✓** worked · **✗** failed · **?** confused but managed.
*Markahan ang bawat kahon: ✓ gumana · ✗ hindi gumana · ? nalito pero nagawa rin.*

### A-1: From the website link
*A-1: Mula sa link ng website*

| # | Step / *Hakbang* | P1 | P2 | P3 | iPhone |
|---|---|---|---|---|---|
| W1 | Open **lyle-leif.github.io/OFFGRID** in Chrome (iPhone: Safari).<br>*Buksan ang lyle-leif.github.io/OFFGRID sa Chrome (iPhone: Safari).* | | | | |
| W2 | Choose **Tagalog** or **English**.<br>*Piliin ang Tagalog o English.* | | | | |
| W3 | Android: menu ⋮ → **Install app**. iPhone: Share → **Add to Home Screen**, then open it from the new icon (it asks the language again).<br>*Android: menu ⋮ → Install app. iPhone: Share → Add to Home Screen, tapos buksan mula sa bagong icon (magtatanong ulit ng wika).* | | | | |
| W4 | Wait for **"Saved on this phone"** / *"Naka-save sa teleponong ito"* at the bottom. The top says **Online**.<br>*Hintayin ang "Naka-save sa teleponong ito" sa ibaba. Nakasulat sa itaas ang Online.* | | | | |
| W5 | Time taken for the whole setup (minutes).<br>*Gaano katagal ang buong setup (minuto).* | | | | |

### A-2: From the barangay hub (laptop)
*A-2: Mula sa hub ng barangay (laptop)*

| # | Step / *Hakbang* | P1 | P2 | P3 | iPhone |
|---|---|---|---|---|---|
| A1 | Open the setup address in Chrome (iPhone: Safari).<br>*Buksan ang setup address sa Chrome (iPhone: Safari).* | | | | |
| A2 | Tap **Download certificate**. Check that the code matches the laptop screen.<br>*Pindutin ang Download certificate. Tingnan kung pareho ang code sa nasa screen ng laptop.* | | | | |
| A3 | Install the certificate, following the steps on the page.<br>*I-install ang certificate ayon sa mga hakbang sa page.* | | | | |
| A4 | Tap **Open https://…** The app opens with no security warning, and asks **Tagalog or English**.<br>*Pindutin ang Open https://… Bubukas ang app nang walang security warning, at magtatanong ng Tagalog o English.* | | | | |
| A5 | Android: menu ⋮ → **Install app**. iPhone: Share → **Add to Home Screen**.<br>*Android: menu ⋮ → Install app. iPhone: Share → Add to Home Screen.* | | | | |
| A6 | Open OFFGRID **from the home-screen icon**. Wait for **"Saved on this phone"** at the bottom.<br>*Buksan ang OFFGRID mula sa icon sa home screen. Hintayin ang "Naka-save sa teleponong ito" sa ibaba.* | | | | |
| A7 | Time taken for the whole setup (minutes).<br>*Gaano katagal ang buong setup (minuto).* | | | | |

Where did they get stuck? / *Saan sila nahirapan?* ________________________________________________

---

## Part B: Using the app (online, or hub ON)
*Bahagi B: Paggamit ng app (online, o naka-ON ang hub)*

| # | Task / *Gawain* | P1 | P2 | P3 | iPhone |
|---|---|---|---|---|---|
| B1 | In **Assistant**, ask: "What should I do during an earthquake?"<br>*Sa Magtanong, itanong: "What should I do during an earthquake?"* | | | | |
| B2 | Ask in Filipino: "saan ang pinakamalapit na ospital?"<br>*Magtanong sa Filipino: "saan ang pinakamalapit na ospital?"* | | | | |
| B3 | Ask with a typo: "how do i stop bleding"<br>*Magtanong nang may maling spelling: "how do i stop bleding"* | | | | |
| B4 | Under a guide answer, is there a green **"Checked against …"** or orange **"Draft"** label?<br>*Sa ilalim ng sagot mula sa guide, may berdeng "Checked against …" o kulay-orange na "Draft" ba?* | | | | |
| B5 | In **Places**, find the nearest evacuation center and open it. Tap **Directions** (Walk, then Drive). Is the route shown?<br>*Sa Mga lugar, hanapin ang pinakamalapit na evacuation center at buksan ito. Pindutin ang Direksiyon (Lakad, tapos Sasakyan). Lumabas ba ang ruta?* | | | | |
| B6 | Tap **Track with GPS** and walk a few meters. Does the blue dot follow you?<br>*Pindutin ang Sundan gamit ang GPS at maglakad nang ilang metro. Sumusunod ba ang asul na tuldok?* | | | | |
| B7 | **Turn Wi-Fi OFF**, tap **Use GPS**, and wait up to 90 seconds (near a window or outside). Seconds until the blue dot appears:<br>*I-OFF ang Wi-Fi, pindutin ang Gamitin ang GPS, at maghintay hanggang 90 segundo (malapit sa bintana o sa labas). Ilang segundo bago lumabas ang asul na tuldok:* | ___ s | ___ s | ___ s | ___ s |
| B8 | Turn Wi-Fi back ON. Open **Settings** (gear) and switch the language, then switch it back. Did your position stay?<br>*I-ON ulit ang Wi-Fi. Buksan ang Setting (gear) at palitan ang wika, tapos ibalik. Nanatili ba ang lokasyon mo?* | | | | |
| B9 | In **Hotlines**, tap a number. Does the dialer open? **Cancel, don't call.**<br>*Sa Hotline, pindutin ang isang numero. Bumukas ba ang dialer? I-cancel, huwag tumawag.* | | | | |
| B10 | Drag the bottom panel up and down; try the light/dark button and the **Legend**. Is it easy, is the text readable?<br>*Hilahin pataas at pababa ang panel; subukan ang light/dark na button at ang Susi. Madali ba, nababasa ba ang mga sulat?* | | | | |

### Reports (test reports only!)
*Mga ulat (pang-test lang!)*

| # | Task / *Gawain* | P1 | P2 | P3 | iPhone |
|---|---|---|---|---|---|
| R1 | **Reports → Report something → Road flooded.** Tap 1 or 2 details (e.g. **knee-deep**).<br>*Mga ulat → Report something → Baha ang daan. Pumili ng 1 o 2 detalye (hal. hanggang tuhod).* | | | | |
| R2 | In **"What do you see?"**, type: "TEST tubig sa kanto". Did a note appear the first time about who reads notes?<br>*Sa "Ano ang nakikita mo?", i-type: "TEST tubig sa kanto". May lumabas bang paalala sa unang beses kung sino ang nagbabasa ng tala?* | | | | |
| R3 | **Outside:** tap **"I'm here (GPS)"**. Seconds until it was sent, and does it show **"Reporter on site (GPS)"**?<br>*Sa labas: pindutin ang "Nandito ako (GPS)". Ilang segundo bago naipadala, at nakasulat ba ang "Nasa lugar ang nag-ulat (GPS)"?* | ___ s | ___ s | ___ s | ___ s |
| R4 | **Indoors:** try **"I'm here (GPS)"** again. If it says GPS isn't accurate enough, use **"Mark on the map"** and tap the spot.<br>*Sa loob ng bahay: subukan ulit ang "Nandito ako (GPS)". Kapag sinabing hindi sapat ang linaw ng GPS, gamitin ang "Markahan sa mapa" at pindutin ang lugar.* | | | | |
| R5 | Choose **Something else / Iba pa** and try to send it **without** a note. Is it refused? Then add "TEST" and send.<br>*Piliin ang Iba pa at subukang ipadala nang walang tala. Tinanggihan ba? Tapos idagdag ang "TEST" at ipadala.* | | | | |
| R6 | In a note, type **"naiipit"**. Does a red **"Tumawag sa 911 ngayon"** appear? (Don't call; clear the word, then cancel.)<br>*Sa tala, i-type ang "naiipit". Lumabas ba ang pulang "Tumawag sa 911 ngayon"? (Huwag tumawag; burahin ang salita, tapos i-cancel.)* | | | | |
| R7 | On **another** phone, does the report appear (within about 20 seconds on the website)? Is the note **not** shown yet? Tap **Still true**.<br>*Sa ibang cellphone, lumabas ba ang report (sa loob ng mga 20 segundo sa website)? Hindi pa ba nakikita ang tala? Pindutin ang Still true.* | | | | |
| R8 | **Responder:** **I'm a responder** → website: name and password; hub: the PIN. The note shows as waiting. Tap **Approve note**, then **Verify**.<br>*Responder: I'm a responder → website: pangalan at password; hub: ang PIN. Lumalabas ang tala bilang naghihintay. Pindutin ang Aprubahan ang tala, tapos Verify.* | | | | |
| R9 | On the other phone, does the note now show as **"Reporter says: …"**?<br>*Sa ibang cellphone, nakikita na ba ang tala bilang "Sabi ng nag-ulat: …"?* | | | | |

---

## Part C: No internet, no hub
*Bahagi C: Walang internet, walang hub*

**Website phones: turn off Wi-Fi and mobile data. Hub phones: host closes the two "OFFGRID hub" windows.**
*Mga cellphone sa website: i-off ang Wi-Fi at mobile data. Mga cellphone sa hub: isasara ng host ang dalawang window na "OFFGRID hub".*

| # | Task / *Gawain* | P1 | P2 | P3 | iPhone |
|---|---|---|---|---|---|
| C1 | Close OFFGRID fully, then open it from the icon. Does it open? The top says **"Offline"** (website) or **"On this phone"** (hub).<br>*Isara nang tuluyan ang OFFGRID, tapos buksan mula sa icon. Bumukas ba? Nakasulat sa itaas ang "Offline" (website) o "Sa telepono" (hub).* | | | | |
| C2 | Ask: "nearest evacuation center". Is there an answer?<br>*Itanong: "pinakamalapit na evacuation center". May sagot ba?* | | | | |
| C3 | Ask: "ano gagawin kapag may lindol". Is there an answer?<br>*Itanong: "ano gagawin kapag may lindol". May sagot ba?* | | | | |
| C4 | Get **Directions** to a place. Does the route appear?<br>*Kumuha ng Direksiyon papunta sa isang lugar. Lumabas ba ang ruta?* | | | | |
| C5 | Post a test report (with a detail and "TEST" note). Does it say it will be sent later?<br>*Mag-post ng test report (may detalye at tala na "TEST"). Sinasabi ba na ipapadala ito mamaya?* | | | | |
| C6 | Turn internet back on (or host: start `start_hub.bat` again). Wait about a minute. Was the waiting report sent?<br>*I-on ulit ang internet (o host: buksan ulit ang `start_hub.bat`). Maghintay nang mga isang minuto. Naipadala ba ang naghihintay na report?* | | | | |

---

## Part D: After the test
*Bahagi D: Pagkatapos ng test*

| ✓ | Task / *Gawain* |
|---|---|
| ☐ | On each phone, drag the panel up, tap the **"Saved on this phone"** line at the bottom, and take a **screenshot** of the details.<br>*Sa bawat cellphone, hilahin pataas ang panel, pindutin ang linyang "Naka-save sa teleponong ito" sa ibaba, at mag-screenshot ng mga detalye.* |
| ☐ | Responder: **remove all test reports** (website and hub): **I'm a responder** → log in → **Remove**.<br>*Responder: tanggalin ang lahat ng test report (website at hub): I'm a responder → mag-log in → Remove.* |
| ☐ | Host: on the laptop, run `node tools/cloud_admin.mjs log` and check the responder's logins, approvals and removals are listed.<br>*Host: sa laptop, patakbuhin ang `node tools/cloud_admin.mjs log` at tingnan kung nakalista ang mga login, pag-apruba at pagtanggal ng responder.* |
| ☐ | Ask each tester the questions below and write down their answers.<br>*Itanong sa bawat tester ang mga tanong sa ibaba at isulat ang kanilang sagot.* |

**Tester feedback** / *Puna ng tester*

1. What was easy? / *Ano ang madali?* ______________________________________________
2. What was confusing? / *Ano ang nakakalito?* ______________________________________________
3. Were the report details clear (knee-deep, cars can't pass, …)? What is missing? / *Malinaw ba ang mga detalye ng ulat (hanggang tuhod, hindi madaanan ng sasakyan, …)? Ano ang kulang?* ______________________________________________
4. Was "What do you see?" easy to use? Did the 911 warning make sense? / *Madali bang gamitin ang "Ano ang nakikita mo?"? Malinaw ba ang babala tungkol sa 911?* ______________________________________________
5. Is the Tagalog natural? Which words sound wrong? / *Natural ba ang Tagalog? Aling mga salita ang mali ang tunog?* ______________________________________________
6. Would you use this during a typhoon or brownout? Why? / *Gagamitin mo ba ito tuwing may bagyo o brownout? Bakit?* ______________________________________________
7. Score from 1 (hard) to 5 (very easy) / *Marka mula 1 (mahirap) hanggang 5 (napakadali)*: ____

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
  *Mga screenshot ng error at ng detalye ng "Naka-save sa teleponong ito".*
- The **GPS times** from B7 and R3, and the **tester feedback**.
  *Ang mga oras ng GPS mula sa B7 at R3, at ang puna ng mga tester.*

Then we fix what broke, and use the feedback for the next steps (photos on reports, and the new design).
*Pagkatapos, aayusin natin ang mga nasira, at gagamitin ang mga puna para sa mga susunod na hakbang (litrato sa mga ulat, at ang bagong disenyo).*
