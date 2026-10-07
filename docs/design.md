# Raide: a railroad tycoon for the phone

Tracks, bridges, engines, carriages, and goods that are produced, refined and
consumed, played with one thumb on a phone. Idea recorded 2026-10-06 in
jeeves, moved here the same day when the repo was made. What is built so far
is in `README.md`; what comes next is in `TODO.md`. This file is what the
game is meant to become.

Working name: **Raide** (Finnish for a railway track; one word, like sora,
höyry and räkkä). The name is open; see Decisions at the end.

## Part 1: what players liked, and what they complained about

Sources are player reviews, forum threads and retrospectives, listed at the
end of this part. "Thumb" says whether the mechanic survives a finger on a
phone screen as it is, needs a change, or has to go.

### Railroad Tycoon 1 to 3 (1990, 1998, 2003)

| Mechanic | Why it was liked | What was complained about | Thumb |
|----------|------------------|---------------------------|-------|
| Start small, make it bigger as it works | Sid Meier: "a game is a series of interesting choices"; players called it a construction set that grows | | Yes. This is the loop, on any screen. |
| Engines with different speed, power and grade ability (RT2) | Choosing the Shay for a mountain line and the Iron Duke for the flat was a real decision | Hill climbers had high upkeep and were slow, so some felt useless | Yes, if the choice is three to four engines with visible stats, chosen from a card. |
| Grades slow trains, track deforms terrain (RT2) | A cheap steep line and a long flat line were different answers to the same problem | RT2 had no tunnels, players missed them | Yes, if the game lays the track and shows the worst grade. No, if the player has to place it tile by tile. |
| Supply chains: raw to refined to town (RT2) | "Market demand changing constantly", turning coal and ore into steel took planning | Distance pay was "too lucrative": hauling coal 500 miles paid more than the mine next door | Yes. Three tiers are readable on a phone. Cap the distance bonus. |
| Goods move on their own along a price map (RT3) | Some loved the colour price map and watching a new consumer change the flows | "Not communicated very well", "look at many different map overlays", chains were hard to set up, profit faded as the market got efficient | No. Hidden flows on a small screen are a mystery. Goods move by rail only. |
| Stock market, margin buying, buying out rivals (RT2) | The most remembered part: "I still remember learning as a child how stock trading on the margin worked" | Luck heavy in hard scenarios; a second game added to the first | Later, maybe. It is buttons, so the thumb is fine, but it is a second game. |
| Hand-made scenarios with a goal and a deadline (RT2 campaign) | "Connect the coasts by 1870" gave each map a reason; the campaign taught one thing per map | Some scenarios locked the start date and the opponents | Yes. Short scenarios fit a phone session. |
| Water, sand and oil upkeep on engines (RT2) | Trains topped up at depots without stopping, so it was free flavour | | Only as yearly upkeep and age. Nothing the player tops up. |
| Drag from A to B, the game lays bridges and tunnels (Railroads!, 2006) | "Automagically lays the track for you"; the 2023 iOS port got "the best train management game" on mobile | "Too easy, too shallow", few decisions once track is free | Yes. This is the right input for a thumb. Keep the decisions in cost, grade and route choice. |

### Transport Tycoon and OpenTTD

| Mechanic | Why it was liked | What was complained about | Thumb |
|----------|------------------|---------------------------|-------|
| Watching trains run on a network you built | The thing players return for; "watching towns grow thanks to supply chains" | "Very sterile" compared with RT2's economy | Yes. Trains must be big enough to see. |
| Pay by type, amount, distance and days in transit | Perishables reward fast lines, bulk rewards long lines | Aircraft overpowered; distance curves are opaque | Yes, as one visible price per site and a modest distance bonus. |
| Station catchment and station rating | Serve a station often and it gets more cargo; stations compete for a tile | Rating formula is invisible and punishes a missed train | Yes, in a simpler form: pickup frequency raises output, shown as a bar on the station. |
| Industries open, grow and close | A map that changes gives new work | Closures feel random | Yes, with a warning on the site first. |
| Manual tile-by-tile track, signals, junction design | The part experienced players want | "Tedious"; on Android "buttons are so small", "the hideous control scheme", the port needed a double-size GUI | No. Tile placement and signals are out. |
| Cargodist (passengers choose destinations) | Hub-and-spoke networks become meaningful | Adds a routing layer most players never understand | No for the first version. |

### Railway Empire 1 and 2

| Mechanic | Why it was liked | What was complained about | Thumb |
|----------|------------------|---------------------------|-------|
| Automatic signals (RE2) | "A huge time saver", "you do not lose any creative editing" | Purists wanted manual mode, so the developers added it as a separate mode in 1.1 | Yes. Automatic signals are the only option on a phone. |
| Warehouses that merge flows into a city | Cleaner networks | One warehouse size, high cost, not worth it for one or two goods | Later. |
| Manual signals, gridlock, deadlocked trains (RE1) | | "Gordian knot of congested lines", a deadlock means deleting a train | No. The sim must make deadlock impossible. |
| Tasks and rivals with a timer | A reason to act | Rivals felt like scripted interruptions | Scenario goals yes, rivals no. |

### Mini Metro and Mini Motorways

| Mechanic | Why it was liked | What was complained about | Thumb |
|----------|------------------|---------------------------|-------|
| Draw a line with one finger, station to station | "Tailored perfectly for touch screens"; a game lasts 10 to 20 minutes and fits a commute | | Yes. The model for track input. |
| One screen, no menus, the map is the UI | "Just the map, network, and problem to solve" | | Yes. The target for the whole HUD. |
| New stations appear and force a redraw | The real challenge is replanning under change | Late game becomes a panic | Yes, as new industries and growing towns. Slower pace than Mini Metro. |
| Weekly upgrade choice (one more train, a bridge, a tunnel) | A small decision every minute | | Yes. The same rhythm as the year-end report below. |

### Factorio trains

| Mechanic | Why it was liked | What was complained about | Thumb |
|----------|------------------|---------------------------|-------|
| Many trains on shared track with blocks | Deeply satisfying once it runs | Signals are the single most confusing thing in the game; the "chain in, rail out" rule has to be learned from a guide | No as input. Yes as behaviour: the sim runs blocks, the player never sees a signal. |
| A train schedule is a list of stops with a wait condition | Simple and complete | | Yes: a line is a list of stations and a "wait for full load" switch. |
| Supply chain where a missing input stops a whole chain | Debugging a starved chain is the fun | Finding which link starved is the pain | Yes, if every site shows what it has and what it is missing on one tap. |

### Train Valley 1 and 2

| Mechanic | Why it was liked | What was complained about | Thumb |
|----------|------------------|---------------------------|-------|
| Short levels, build track against a clock, one screen | "Initially complex but becomes delightful"; low-poly look praised | On Switch and phone, laying track by stick or on an isometric grid is "fiddly" and "dodgy on diagonals"; taps work for everything except track | Levels yes. Tile track on an angle no. |

### Pocket Trains and Train Station 2

| Mechanic | Why it was liked | What was complained about | Thumb |
|----------|------------------|---------------------------|-------|
| One train per line, a line owns its track (Pocket Trains) | "Think carefully before you expand"; simple to read | | Yes. A line is the unit the player manages. |
| Build an engine from parts, named cargo with charm (Pocket Trains) | Collecting and assembling trains, "giant jars of pickles" | | Yes, as a small engine shed with a few parts per era. |
| Fuel tanks and refuel timers (Pocket Trains) | | "The game grinds to a halt", two wait timers per trip, premium currency to skip | No. No real-time timers of any kind. |
| Real-time timers on every action, gacha trains (Train Station 2) | | "It's just an endless wait", "no automation, everything has to be initiated by the player" | No. Trains run on their own while the game is open. |

### Anno production chains

| Mechanic | Why it was liked | What was complained about | Thumb |
|----------|------------------|---------------------------|-------|
| Deep chains with clear logic | "Impossibly deep roots but clear logic"; admiring the network you built | A broken link "the game never bothered to point out"; too many chains to tend at once | Yes at three tiers, with a chain view that shows every link's state. |
| Needs tiers: a bigger town wants new goods | Growth creates demand, demand creates work | | Yes. Towns unlock a new demand at each size. |

### Others worth a line

- **Mashinky**: a token economy where you unlock the next era by hauling
  that era's goods. Players: "like Settlers of Catan", "forces you to use all
  industries". Thumb: yes, and it is the progression model here.
- **Station to Station**: a relaxing connect-the-sites game, 89% positive.
  Players like the short levels and one clear budget per level. The complaint
  is no drama. Thumb: yes; the level shape is borrowed.
- **Railbound**: Apple Design Award 2023 for interaction. "Paint rail tiles
  with one finger", first level impossible to fail, no words in onboarding.
  Thumb: yes; the onboarding model.
- **Transport Fever 2**: praised for its UI and for towns that visibly grow.
  Complaints: town growth is "purely cosmetic", no new industries over 200
  years, no rivals so no tension. Lesson: growth must change demand.
- **Sweet Transit**: 68% positive, "unintuitive gameplay that is badly
  explained". Lesson: every rule the player meets is shown on the map.

### Sources

- Railroad Tycoon II: https://www.filfre.net/2025/01/railroad-tycoon-ii/ ,
  https://news.ycombinator.com/item?id=42657585 ,
  https://forum.quartertothree.com/t/railroad-tycoon-ii-is-still-one-of-the-best-strategy-games/60051 ,
  https://www.gamespot.com/reviews/railroad-tycoon-ii-review/1900-2636834/
- Railroad Tycoon 3: https://forum.quartertothree.com/t/railroad-tycoon-3/6792 ,
  https://www.gamerswithjobs.com/node/1003291
- Railroad Tycoon 1 and Sid Meier:
  https://www.filfre.net/2017/03/railroad-tycoon/ ,
  https://designer-notes.com/?p=1226
- Sid Meier's Railroads! on iOS:
  https://toucharcade.com/2023/04/06/sid-meiers-railroads-review-the-best-train-management-game/ ,
  https://www.gamespot.com/reviews/sid-meiers-railroads-review/1900-6160058/
- OpenTTD: https://wiki.openttd.org/en/Manual/Game%20Mechanics/Cargo%20income ,
  https://steamcommunity.com/app/1536610/discussions/0/3120424524433161112/ ,
  https://play.google.com/store/apps/details?id=org.openttd.sdl ,
  https://wiki.openttd.org/en/Archive/Community/FAQ%20troubleshooting
- Transport Tycoon mobile:
  https://toucharcade.com/2013/10/07/transport-tycoon-review-all-aboard-for-a-great-ride/ ,
  https://www.androidpolice.com/2013/10/15/transport-tycoon-review-an-easy-ride-for-those-who-know-where-theyre-going-but-newcomers-might-not-enjoy-the-trip/
- Railway Empire: https://steamcommunity.com/app/503940/reviews/?browsefilter=toprated ,
  https://steamcommunity.com/app/1644320/discussions/1/3843304884858119542/ ,
  https://goldplatedgames.com/2018/01/26/review-railway-empire/
- Mini Metro: https://www.gamedeveloper.com/design/let-s-talk-about-mini-metro ,
  https://gamingtrend.com/reviews/metro-mania-mini-metro-review/ ,
  https://purenintendo.com/review-mini-metro-nintendo-switch/
- Factorio: https://steamcommunity.com/app/427520/discussions/0/4631482569784838677/ ,
  https://www.switchbladegaming.com/strategy-games/factorio/train-signals-explained/
- Train Valley 2: https://www.thexboxhub.com/train-valley-2-community-edition-review/ ,
  https://ladiesgamers.com/train-valley-2-community-edition-review/
- Pocket Trains: https://www.gamezebo.com/reviews/pocket-trains-review/ ,
  https://www.pocketgamer.com/pocket-trains/hands-on-with-pocket-trains/
- Train Station 2: https://gurugamer.com/reviews/trainstation-2-railway-empire-review-its-just-an-endless-wait-5096 ,
  https://www.pocketgamer.com/trainstation-2-railway-empire/review/
- Anno 1800: https://www.gamespot.com/reviews/anno-1800-review-the-prettiest-spreadsheet/1900-6417131/
- Mashinky: https://steamcommunity.com/app/598960/discussions/0/1489987634008642193/
- Station to Station: https://store.steampowered.com/app/2272400/Station_to_Station/
- Railbound: https://developer.apple.com/news/?id=0x08hncy
- Transport Fever 2: https://stratpack.blog/2021/08/30/transport-fever-2-review ,
  https://www.dedoimedo.com/games/transport-fever-2.html
- Sweet Transit: https://steamcommunity.com/app/1612770/reviews/?browsefilter=toprated

### What the research decides

1. **The player draws track and the game places it.** Drag from station to
   station; the game routes it, bridges water, and offers a tunnel.
   Decisions live in cost, grade and the route choice. (Railroads!, Mini Metro, Railbound.)
2. **No signals, ever.** The sim runs blocks and cannot deadlock. (Railway
   Empire 2, every Factorio complaint.)
3. **Goods move by rail only, and every site shows what it has, what it
   wants, and what it pays, on one tap.** (RT3 and Anno complaints.)
4. **Three tiers, a modest distance bonus, prices that fall as a site fills
   and recover with time.** (RT2 exploit, OpenTTD pay curve.)
5. **Growth changes demand.** A town that grows wants more and wants new
   things. (Transport Fever complaint.)
6. **No real-time timers, no premium currency.** Time runs only while the
   game is open. (Pocket Trains, Train Station 2.)
7. **Short scenarios with one goal, plus a sandbox.** 10 to 25 minutes per
   scenario. (RT2 campaign, Mini Metro, Station to Station.)
8. **Era progression by hauling, Mashinky style.** You unlock diesel by
   moving the goods of the coal age, which makes every industry worth
   serving.
9. **The map is the UI.** Trains are large, text is rare, every control is a
   button at least 44 px, and the first level cannot be failed.

## Part 2: the design

### Setting

Finland from 1862, the year of the Helsinki to Hämeenlinna line, through to
the 1970s and electric traction. Lakes, rivers, ridges and forest make the
terrain puzzle: water forces bridges or detours, ridges force grades or
tunnels. Towns carry real Finnish names on hand-made maps and generated ones
on the sandbox. Goods are the ones the country exported: timber, tar, paper,
iron, butter, grain. Same country and century as Höyry, which is set in
Tampere in 1899.

### The first five minutes

The first map opens on a forest, a sawmill, and a town, with one station
already placed at the forest and enough money for one line. The screen says
nothing. A hand icon shows a drag from the forest station to the sawmill.

1. The player drags. A track appears under the finger, snapped to the two
   sites, with its cost on the line. Lift the finger and it is built.
2. A train card slides up: one engine, two flat wagons, a Buy button. Tap.
   The train leaves at once, loads timber at the forest, and runs to the
   sawmill. The sawmill starts, and boards appear in its yard.
3. The town is across a river. The player drags from the sawmill to the
   town. The route crosses the water and shows a bridge, in a different
   colour, with its cost. Build it, buy a second train with box wagons, and
   the first boards arrive in town. Cash goes up with a sound and a number
   that floats off the station.
4. The year ends. The year-end card shows income, upkeep, profit, and one
   choice: a third train, a longer station, or a new engine. Pick one.

That is the whole game in miniature: haul, refine, deliver, grow. Target time
to the first paid delivery: under 90 seconds. The first map cannot be lost.

### The first hour

The first hour is four scenarios of ten to fifteen minutes, each adding one
thing, then the sandbox opens.

| Scenario | Adds | Goal |
|----------|------|------|
| 1. Sawmill | Drag track, bridge, two trains, one chain | Deliver 20 boards to the town |
| 2. Ridge | Grades and the tunnel choice, engine power, passengers between two towns | Connect both towns and reach a cash target by 1870 |
| 3. Two chains | Ore, ironworks, a second chain sharing one line, the "wait for full load" switch, a town growing to size 2 | Grow the town to size 3 |
| 4. Harbour | The export sink, loans and interest, an industry that closes when unserved, the coal era unlock | Unlock the coal era by hauling 60 loads of its goods |

By the end of the hour the player has met every rule in the game. The
sandbox is a generated map, endless, with the full era ladder.

### Track laying with a thumb

- **Input**: drag from any station or track end to any site, station or
  track point. The game routes track between them. The route follows a grid
  the player never sees (eight directions, a cell about 8 mm on a phone), so
  snapping is to cells, sites, stations and existing track.
- **Live cost on the line**: cost, worst grade, and length update while the
  finger moves. Grade is coloured along the line: flat, 2 %, 4 %. Lifting the
  finger builds; a Cancel button is under the thumb for the first second.
- **Three route buttons** appear after lift when the route crosses a ridge or
  a lake: Around, Over, Through. Each shows its cost and its worst grade.
  Over is a bridge (lakes, rivers); Through is a tunnel (ridges). This is the
  whole terrain decision, in three taps or none.
- **Bending a route**: drag the middle of a ghost route to move it through a
  different point, the way a map app moves a driving route. One waypoint per
  drag.
- **Branches**: drag from any point on existing track and a junction is
  placed there. Junctions are automatic; the sim resolves them.
- **Costs** (starting values, tuned by the sim): plain track 1 per cell;
  each percent of grade adds 25 %; bridge 4 per cell; tunnel 8 per cell;
  station 20, upgrade 40 and 80. Demolish refunds half.
- **Grades** cost time: an engine's power and the
  train's loaded weight set its speed on a grade, so a cheap steep line with
  a weak engine crawls, and the player sees it crawl.
- **Single and double track**: single track by default; a second drag over an
  existing line doubles it for 80 % of the cost. On single track, trains wait
  at stations for each other and the sim never deadlocks. On double track
  they pass. No signals exist in the UI.
- **Pinch to zoom, two fingers to pan** while a drag is in progress, so a
  long route is possible on a small screen; one finger pans when no drag is
  active.

### Engines and carriages

A **train** is one engine and one to six wagons, and it belongs to one
**line**. A line is an ordered list of stations and the train runs it
forward and back. Each stop has one switch: wait for a full load, or leave
on time. That is the whole schedule.

**Wagons** are typed, one type per good family, and a train's wagons decide
what it carries: flat wagon (timber, boards), hopper (ore, coal), box wagon
(flour, paper, goods), tank wagon (tar, oil), coach (passengers), mail van.
Wagons cost little; the engine is the investment.

**Engines** have four stats: speed, power, upkeep per year, and life in
years. Power sets how many loaded wagons the engine can pull on a grade at
what speed. Upkeep rises after the engine passes its life, and an old engine
breaks down for a few days now and then, which the player sees as a stopped
train with smoke. A Replace button on the train card buys the current
equivalent and sells the old one.

**Eras**, each unlocked by hauling the goods of the era before it (the
Mashinky rule), each with two or three engines:

| Era | From | Engines | Unlocked by hauling |
|-----|------|---------|---------------------|
| Wood | 1862 | a light wood burner, a slow strong one for grades | the start |
| Coal | 1890 | a fast express, a heavy freight engine | timber, boards, grain, flour |
| Diesel | 1955 | one mixed engine, cheaper upkeep | ore, iron, tar, paper |
| Electric | 1970 | fast, strong, needs electrified track | coal, goods, passengers at volume |

Years advance with hauled volume as well as time, so a slow player is never
stuck in 1862 and a fast player cannot skip an era.

### The goods economy

Three tiers at the start, three chains, plus passengers and mail between
towns.

| Raw (from) | Refined (at) | Consumed (by) |
|------------|--------------|---------------|
| Timber (forest) | Boards (sawmill) | Town, harbour |
| Ore (mine) | Iron (ironworks) | Town, harbour |
| Grain (farm) | Flour (mill) | Town, harbour |

Later eras add one chain each: tar from forest to harbour, coal from mine to
ironworks and to town, paper from timber at a paper mill to town and harbour.
Never more than three tiers.

**How a site works.** Every site has a stock of what it makes and a stock of
what it takes. A raw site makes a fixed amount per month, up to a cap, and
its rate rises when it is picked up often. A refinery makes one unit of
output per unit of input delivered. A town consumes a fixed amount per month
per size, and the stock it holds decays. The **harbour** takes anything,
without limit, at a flat 60 % of base price, so every good always has a
buyer.

**Prices.** Each site pays `base × demand`. Demand starts at 1.0, falls
towards 0.4 as the site's stock fills (a lot of recent deliveries), and
recovers towards 1.0 over a few months. Pay is multiplied by a distance
factor from 1.0 at zero to 1.5 at 40 cells, capped there. Passengers and
mail lose 1 % of pay per day in transit past a fixed allowance; goods do
not. These numbers are starting values for the sim to tune.

**What the player sees.** Tap any site: what it has, what it wants, what it
pays now, with a bar for demand. A chain button on a refinery shows the
whole chain on the map: the sites feeding it, the sites buying from it, and
which link is empty. This is the answer to every complaint about RT3 and
Anno.

### Stations and towns

A **station** has a catchment circle and serves every site inside it. Three
sizes: a halt (one train at a time, small circle), a station (two trains,
bigger circle), and a terminus (four trains, biggest circle). Upgrade is one
tap, in place.

**Loading takes time** (Vesa, 2026-10-07: "When trains arrive, unloading
and loading cars take time. That also gives way to new perks/purchasables.
And solves the train leaving issue where cars extend to nothing.") A train
runs fully onto its platform track and stops. Then each wagon in turn
unloads and loads, and the player sees the goods move between the wagon
and the yard's pile. The train leaves only when every wagon is done and
the whole train stands on the platform, so no wagon ever stands past the
end of the track. The dwell is a cost the player can see: a long train
earns more a trip but stands longer at both ends.

The dwell is what a station's upgrades buy down. They are bought on the
station's card, per station, because a crane belongs at one sawmill and
not on the whole map:

| Upgrade | Does | Where |
|---------|------|-------|
| Loading crew | Every wagon loads and unloads a third faster | Any station |
| Crane | Timber, boards and grain load and unload twice as fast | Forest, sawmill, farm, mill; needs the crew |
| Longer platform | One more train can stand at the station, and trains up to six wagons fit | Any station |

The crew is the first of them; the crane and the platform follow it. The
numbers are starting values for the bot to tune.

A **town** has a size from 1 to 5. It grows when goods and passengers are
delivered to it over a year and shrinks when they stop. Each size adds
buildings on the map, more passengers, more consumption, and at sizes 3 and
5 a new demand (first iron, then paper). A size 4 town founds a new industry
nearby. Growth is the visible reward for a working network and the thing
that keeps demand moving.

**Industries** change over time. A raw site that goes unserved for three
years shows a warning and closes a year later. A served chain spawns a new
raw site of the same kind every few years, so the map keeps producing
new work for the player.

### Money and goals

- Cash, one loan with 5 % yearly interest, a loan ceiling that rises with
  net worth. The year-end card is the only report: income by good, upkeep,
  interest, profit, net worth, and one upgrade choice.
- Scenarios have one goal and a year limit, shown at the top at all times.
  The sandbox has no goal; it shows net worth and the era.
- Net worth at a scenario's end gives one to three stars. Stars are the
  score and the only thing a records table would hold.

### Failure states

- **Bankruptcy**: cash below zero at two year-ends in a row with the loan at
  its ceiling. The game offers a restart of the scenario at its last
  year-end.
- **Scenario time out**: the year limit passes without the goal. Retry at
  any year-end, which is also the autosave point.
- **Soft failures** that are visible and recoverable: a starved refinery, a
  broken-down engine, a train waiting forever for a full load, a site about
  to close. Each is a marker on the map.

### Session length

The unit is a **year**, which is about 90 seconds at normal speed and 30 at
fast. The year-end card is a natural stop, and the game autosaves there and
at every build. A scenario is 10 to 25 minutes. Pause is one tap and the sim
stops when the app goes to the background, so nothing happens while the
phone is in a pocket.

### Art direction

Decided 2026-10-07 on the top-down mockups in `docs/mockups/topdown/`.
Vesa: "These look great! The zoom levels all seem relevant. Tile step hills
also brilliant! Can see them clearly."

- **Höyry's style, top down, zoomed in like Prison Architect.** Flat Canvas
  2D, one colour for each face, a dark outline on everything, a soft drop
  shadow down and to the right, a 3/4 lean: a building shows its roof and
  its front wall. No image assets: every sprite is drawn with canvas paths.
- **A big map that the player scrolls.** A scenario is a tile map of about
  120 by 100 tiles, about seven portrait screens. At play zoom a tile is
  about 23 px.
- **Hills are one-tile terrace steps.** The land is a whole number of
  terraces of 10 m. Each terrace has its own colour (meadow green, light
  green, dry olive, tan heath with stones on the ridge), a front face of
  earth and a dark rim. The steps are hard, one tile wide, so a hill reads at
  a glance without contour lines. A cutting is a channel through a terrace
  with grey rock walls; an embankment has sand sides; a bridge is a timber
  deck on piers over the water.
- **Four zoom levels, all in use.** Pinch moves between them smoothly.
  1. Close up (a tile about 55 px): the station, its piles and the train
     loading wagon by wagon.
  2. Play zoom (about 23 px): the yards, the lines, the trains with their
     loads. Most of the game happens here.
  3. Route zoom (about 13 to 17 px): wide enough to drag a route over a
     ridge and see the way round.
  4. The whole map: terraces become colour bands, lines are brass, trains
     are dots, sites are badges, and a frame shows where play zoom was.
- **Goods are things on the map.** A yard shows its stock as log piles,
  board stacks and sacks; a wagon shows its load. Chips over each site show
  what it has (cream) and what it pays (dark).
- **The map reads as a Finnish summer**: lake blue, pines and birches,
  towns as clusters of red, ochre and white wooden houses that multiply as
  the town grows, a white church. Trains are an engine with a tender and
  wagons, with white smoke. The HUD is a brass and dark green dashboard with
  large round buttons, and the year-end card looks like a ledger page.
  Winter arrives every year as a palette change: snow on the land, ice on
  the lakes, the same map.

### Left out on purpose

- Signals, junction design, timetables.
- The stock market, rival companies, buyouts. A candidate for a later
  version if the hauling game proves fun on its own.
- Road, ship and air transport. Rail only.
- Goods that travel by themselves (the RT3 price map) and passengers that
  choose destinations (cargodist).
- Per-wagon cargo micromanagement at stations.
- Real-time timers, premium currency, gacha, adverts.
- A 3D view or a camera that turns. The map is top down; pinch zooms and
  one finger scrolls.
- Multiplayer.
- Electrified track as a build step until the electric era exists.

## Shape

The Räkkä architecture, copied from sora: Vite + TypeScript + React for the
menus and the HUD, Canvas 2D with procedural sprites for the map, a headless
fixed-step sim with a bot behind `make check` and `make balance`. GitHub
Pages on push to `main` at `vesahyp.github.io/raide/`. A CloudFront pixel for
tracking from the first deploy, per
jeeves' `practices/web-tracking.md`. Scenario stars
in DynamoDB behind one Lambda, the sibling pattern, only once there is a
records screen to show them on.

Two tools from sora carry over on day one: the bot plays every scenario
headless so a balance change is proved before it ships, and `make playthrough`
records the first hour on an emulated iPhone with the hand-model
driver, because the design depends on how a drag feels.

The sim is the authority on money, prices, trains and blocks; the renderer
only draws. Any rule that cannot be checked by the bot is suspect.

## Name

**Raide.** Finnish, one word, the track itself. Sora, Höyry, Räkkä, Raide. A
Finnish rail magazine of the same name exists (Resiina is the other), which
is a weak collision for a browser game on GitHub Pages. Backup: **Veturi**
(locomotive) or **Ratapiha** (rail yard). No domain is needed; the sibling
games live under `vesahyp.github.io`.

## First playable slice

The smallest version that is fun. Nothing else gets built until this is
judged on a phone.

- One hand-made map: forest, sawmill, town, one river between sawmill and
  town. Fixed camera, portrait and landscape (decided 2026-10-06, below).
- Drag-to-build track with snapping, live cost, and the automatic bridge.
  No grades, no tunnels, no junctions.
- One engine, two wagon types, one line per train, up to three trains.
- One chain: timber to boards to town. Price falls as the town fills and
  recovers. Cash, no loan.
- A year-end card with the numbers and the one choice.
- One goal: deliver 20 boards before 1866.
- The bot plays it headless; `make playthrough` records a hand playing it.

The test: does the first paid delivery arrive inside 90 seconds, and does a
thumb want to lay the next track.

## Decisions

Vesa answered the open questions on 2026-10-06:

- **Portrait and landscape, both.** The layout and the HUD work in either,
  and rotating the phone mid-game keeps the state. The map is drawn turned a
  quarter in landscape so the same map fills the screen either way.
- **Scenarios first.** The sandbox comes later. The first hour above stands.
- **Finland, from 1862.** Real names on the hand-made maps.
- **The stock market: no decision yet.** The rail side comes first. The money
  model stays simple (cash, later one loan) and nothing is built for shares
  until that call is made.
- **The name is open.** Raide is the working name until Vesa decides.
- **Top down, not 3D** (2026-10-07). The three.js map of ADR 0002 stops.
  The look is Höyry's, on a big scrolling map, with one-tile terrace hills
  and four zoom levels. See Art direction.

## Second slice: Harju

Vesa played the sawmill slice on 2026-10-06: "So. The game is 2 drags?" It
had no decision in it, so it could not show whether the game is fun. The
second scenario, Harju, is built around the choices the research found:

- Several industries and two towns, so the first choice is what to connect
  first with cash for two lines and two trains.
- Two chains, each with a refining step: timber, sawmill, boards; grain,
  mill, flour. Towns take both.
- Terrain with a cost trade-off: a drag that meets the lake or the ridge
  ends in two buttons, the cheap way round or the dear bridge or cutting,
  with the cost and the length on each. A ridge cuts a train's speed by the
  engine's climb and the load.
- Two engines: the light fast one that crawls on a ridge, the slow strong
  one that pulls over it.
- Demand that falls as a town fills and recovers with the months, faster in
  a bigger town, so a route that paid well stops paying and the trains go
  elsewhere.
- Trains a tap opens: a wagon more, the engine swap, wait for a full load,
  sell.
- A goal that needs a network: both towns at size 3, and a town grows only
  when a year brings enough of every good on the map.

## Next step

Harju is played on a phone. The rest of this file is built only if its
choices are fun to make with a thumb.
