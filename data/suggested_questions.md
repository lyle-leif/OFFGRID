# Brownout Brain — Question bank

Questions people ask during a disaster or while running errands, and what answers each one.

> The tested version of this list is `tests/question_bank.json` (218 questions, including typos,
> text-speak and Filipino/Taglish). Both the hub and the phone are checked against it, and
> `tools/check_questions.py` writes a readable report of how each one is answered.

- **Data**: computed from your location, the selected place, the facility records and the road network. Exact, never guessed by the AI.
- **Guide**: answered by the AI from the saved guides, with source buttons.
- **Gap**: not covered yet; the assistant says so instead of guessing.

> Location questions need **your location** (📍 Set my location, or drag the blue dot) and some need a **selected place** (tap a pin or a Facilities row).

## Finding places (works anytime)

| Question | Filipino / Taglish | Answered by |
|---|---|---|
| Where is the nearest evacuation center? | Saan ang pinakamalapit na evacuation center? | Data |
| Nearest hospital? | Pinakamalapit na ospital? | Data |
| Nearest clinic / health center? | Saan may klinika / health center? | Data |
| Where can I buy medicine? | Saan may botika? / Saan makakabili ng gamot? | Data |
| Nearest police station? | Saan ang presinto / pulis? | Data |
| Nearest fire station? | Saan ang bumbero? | Data |
| Nearest rescue / ambulance? | Saan may ambulansya / rescue? | Data |
| Where is the town hall / barangay hall? | Saan ang munisipyo / barangay hall? | Data |
| Where can I buy rice or groceries? | Saan may palengke / grocery? | Data |
| What's near me? | Anong malapit sa akin? | Data |
| Where's the nearest place to go? | — | Data (nearest evacuation center, hospital, police) |

## About a selected place

| Question | Filipino / Taglish | Answered by |
|---|---|---|
| How far is it from my current location? | Gaano kalayo ito? / Ilang km? | Data (road distance, walk + drive time) |
| How long to walk there? | Gaano katagal maglakad papunta doon? | Data |
| How do I get there? | Paano pumunta dito? / Ano ang daan papunta? | Data (route on map + steps) |
| Contact number? | Paano sila tawagan? | Data (saved phone, or "none saved" + 911) |
| Is it open? / What time does it open? | Bukas ba sila? / Anong oras? | Data (saved hours only; never claims "open now") |
| Is this an evacuation center? | Evacuation center ba ito? | Guide + record |

## During a typhoon (bagyo)

| Question | Answered by |
|---|---|
| What does signal no. 1 / 2 / 3 / 4 / 5 mean? | Guide (PAGASA table) |
| When should we evacuate? | Guide |
| What should we do during the typhoon? / Ano ang gagawin habang may bagyo? | Guide |
| What should we prepare before it arrives? | Guide |
| Is it safe to go home after the typhoon? | Guide |
| What is the current signal in Batangas? | Gap: live info, check PAGASA |

## During a flood (baha)

| Question | Answered by |
|---|---|
| Is it safe to walk through floodwater? / Ligtas bang lumusong sa baha? | Guide |
| What if we're trapped by rising water? | Guide |
| Is the water safe to drink after a flood? | Guide |
| What are the symptoms of leptospirosis? | Guide |
| Should I turn off the electricity? | Guide |
| Is the road to the evacuation center flooded? | Gap: live info |

## Brownout / power outage

| Question | Answered by |
|---|---|
| Who do I call about a brownout in Lipa? | Guide (BATELEC II hotline) |
| Can I run a generator inside the house? | Guide |
| How long is fridge food safe without power? | Guide |
| How do I save phone battery? | Guide |
| Is it safe to use candles? | Guide |
| How do we stay cool without electricity? | Guide |
| When will the power come back? | Gap: live info |

## Go-bag and evacuation supplies

| Question | Answered by |
|---|---|
| What should I put in my go-bag? | Guide |
| How much water should I pack? | Guide |
| What should I bring for my baby? / Anong dapat dalhin para sa sanggol? | Guide |
| …what about for my lola / for a person with disability / for my pet? (follow-up) | Guide |
| What documents should I bring? | Guide |

## First aid

| Question | Answered by |
|---|---|
| How do I stop bleeding? / Paano patigilin ang dugo? | Guide |
| How do I treat a burn? / Napaso ako | Guide |
| What do I do if someone is not breathing? | Guide |
| Signs of heat exhaustion? | Guide |
| Possible broken bone, what do I do? | Guide |

## Earthquake and tsunami (lindol)

| Question | Answered by |
|---|---|
| What should I do during an earthquake? / Ano gagawin kapag may lindol? | Guide (PHIVOLCS) |
| Is it safe to go back inside after an earthquake? | Guide (PHIVOLCS) |
| How do I prepare my home for an earthquake? | Guide (PHIVOLCS) |
| What are the signs of a tsunami? / Ano ang senyales ng tsunami? | Guide (PHIVOLCS) |
| What does intensity 5 mean? | Guide (PHIVOLCS) |

## Taal Volcano and ashfall (bulkan, abo)

| Question | Answered by |
|---|---|
| What does Taal alert level 3 mean? / Ano ang alert level 2 ng Taal? | Guide (PHIVOLCS) |
| When must we evacuate because of Taal? | Guide (PHIVOLCS) |
| What mask should I use for ashfall? / May abo, ano gagawin? | Guide (DOH) |
| Ash on my skin is itchy | Guide (DOH) |

## Hotlines

| Question | Answered by |
|---|---|
| What number do I call for an emergency? | Guide (911) |
| Batangas City rescue hotline? | Guide (CDRRMO) |
| Lipa police / fire number? / Numero ng pulis sa Lipa? | Guide |
| Batangas PDRRMO contact? | Guide |
| Red Cross hotline? | Guide |

## Errands (normal days)

| Question | Answered by |
|---|---|
| Nearest pharmacy? Is it open? What's its number? | Data |
| Where's the nearest palengke / supermarket? How far? | Data |
| Where is the municipal hall (documents, permits)? | Data |
| Nearest clinic for a check-up? | Data |
| How long to drive to Lipa City Hall? (select it first) | Data |

## Known gaps (answered "not in saved information")

- **Live conditions**: flooded roads, open/closed right now, hospital capacity, current typhoon signal, when power returns.
- **Landslides** (beyond checking slopes after an earthquake) and **the current Taal alert level**: not saved. The Taal guide explains what each level means, but only PHIVOLCS can say which level is in force now.
- **ATMs, gas stations, churches**: visible as map landmarks, but not in the searchable facility list.
- **Drinking-water refill points**: none mapped in OpenStreetMap for this area.
