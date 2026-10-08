# The economy and the loop

Status: Vesa said yes on 2026-10-08. Steps 1 to 3 are built; steps 4 and 5 are ahead. The numbers are in `src/game/content/economy.ts`: running costs per tile, track upkeep, the loan, stars from net worth, platforms (one at the start, a second and a third bought) with a queue on the line, for towns a store of 4 loads per size, eating 0.25 loads a month per size, and a growth meter that fills in 8 supplied months, and the three buys of step 3: the passing siding, the crane and the year-end contract. Where the build differs from the plan: a train that waits 12 s for a platform takes a siding track; the distance bonus is far steeper so long lines pay per tile like short ones; refineries keep their own input model instead of a store; a passing siding has one fixed length (the longest train the game allows), a line with one yields to a waiting neighbour, and a second train starts at the end with fewer of them; the crane is bought at an industry's station only; the perks are gone and the base was made stronger to carry the game without them (prices about 20 % up, grain and flour 12 % up, running cost per tile and engine upkeep up about a fifth, so the cost share stays at 33 to 46 %). The rules of the towns and of the upgrades are in `docs/design.md`, "Stations and towns" and "Money and goals".

## Why this file

Vesa played build Terävä Ratavalli on 2026-10-08: "It works. But isnt a
game yet. Cash means nothing really. Choices are meaningless due to
prices. Upkeep is not a real cost. The upgrades dont really fit the game.
The harju challenge is suddenly capped at 6 trains?! Cant transport
people, cant mix cars. Trains go on each other at stations."

These are one problem. The game has no scarce thing. The bot's Harju game
(`npm run balance`, the same build) shows it in numbers:

| What | Now | What it does to the game |
|------|-----|--------------------------|
| A train's price against what it earns in a year | 50 against about 70 | Every train pays back inside a year, so buying is always right |
| Engine upkeep against what the train earns | 15 to 22 against about 70 | A fifth: no train is ever worth selling |
| Track | 40 to 60 for a line that earns 70 a year per train | Terrain choices round to nothing |
| Cash at the year end, 1865 to 1868 | 394, 798, 1285, 1730 | Half the scenario has money and nothing to spend it on |
| What stops the spending | A cap of 6 trains | The only limit is a rule, not a cost |
| Station platforms | 3 drawn, a fourth train stands on the third | The "trains on each other" bug is the cap's twin |
| Year-end choice | A free global perk, once each | Not a decision: take all three in any order |

Fixing any one of these alone moves the problem. Raise the train price
and the bot waits a little longer, then the cash piles up again. Remove
the cap and the screen fills with trains on one line. Sora went this way:
each fix was right on its own and the game did not get better.

## The loop: what the player decides every minute

A year is 90 seconds. In each one the player should meet one or two
decisions that cost something they could have spent elsewhere. The
decisions come from a **bottleneck that moves**:

1. **A buyer fills up.** The town that took the boards pays less each
   load. The chip shows the price falling. Do I run boards to the other
   town (a longer line, a better price), switch the train to flour, or
   leave it and take the low price?
2. **A pile fills up.** The forest's logs reach the cap and production
   stops. Do I add a wagon, a second train, or a crane at the forest?
3. **A line fills up.** The second train on a single track waits at the
   station for the first. Its trips stop adding up. Do I build a second
   platform, a passing siding half way, or a second line on another route?
4. **A town grows.** It wants more and it wants passengers. A new line
   opens between two towns.
5. **The year ends.** One contract is offered: take it or not.

Every one of these is a choice between two or three things the player
cannot all afford this year. That is the target, and the bot proves it
(see Checks).

## Money that is tight

The rule: **a good line pays back in about two years, a poor one never,
and running costs are large enough that an idle train is a loss.**
Research already in `docs/design.md`: Railroad Tycoon 2's loans and engine
upkeep made the engine choice a decision; OpenTTD's running costs and
infrastructure maintenance make a long empty line bleed; Mini Metro's
scarcity is the whole game.

- **Running costs are per kilometre, not per year.** A train pays for
  every tile it runs (fuel and crew), full or empty, plus a smaller yearly
  upkeep for the engine. A train that runs empty half the way earns half
  and costs the same. This is what makes a return load (boards back past
  the forest) and a mixed train worth planning. Target: running costs are
  35 to 45 % of what a well-run train earns.
- **Track has upkeep.** Each built tile costs a little every year, a
  bridge four times as much. A line laid on a hunch and never used is a
  cost every year. The player can lift track for half its price back.
- **Prices fall faster and recover slower.** A town at size 1 takes about
  6 loads of a good a year at a good price, then the price drops toward
  the floor. One train can flood one town. The second town, the second
  good and a growing town are where the money is. The distance bonus
  stays, so the far town is worth the longer line.
- **Engines and track cost more than they do now**, so the first two
  years are tight: about twice today's prices, scaled so the first line
  and train still pay back within the first two years (the tutorial must
  stay winnable).
- **One loan** (design.md, Money and goals): up to a ceiling that rises
  with net worth, 8 % a year, paid at the year end. It lets the player
  build the second line early and pay for it later. Bankruptcy follows
  design.md: cash below zero at two year ends in a row with the loan full.
- **Stars from net worth, not cash**: track, trains and stations count at
  their resale value, minus the loan. A player who builds well is
  rewarded, not one who hoards.

## What delivered goods do at a town

Built (step 2). Vesa, 2026-10-08: "What happens to goods at stations? They
just seem to disappear with no impact. Then suddenly randomly the city
grows if 3/3 on both?" The town now keeps a store, the price follows the
store, and growth is a meter. The rules are in `docs/design.md`, "Stations
and towns".

## Passengers and mixed trains

- **Passengers and mail** start between towns: each town makes travellers
  by its size, who want to go to the other towns on the map. They pay by
  distance and lose pay for every day past a fair trip time (design.md
  already says so). Coaches carry them. A passenger line is the steady
  income a town line gives; goods are the bigger money with the falling
  price.
- **Lines with more than two stops.** A line is a list of up to four
  stations, run forward and back. This is what makes a mixed train worth
  having: forest, sawmill, town in one line.
- **Mixed trains.** A train is an engine and any wagons, each wagon its
  own type. At each stop every wagon unloads what that stop takes and
  loads what it carries and the next stops want. The train card shows,
  per wagon, what it carries on this line, and a wagon that carries
  nothing on this line is marked so the player can see the waste.

## Checks

The bot proves the loop before Vesa plays it (`npm run balance`):

- The first line and train pay back inside two years; the tutorial is
  winnable by a thumb at a normal pace.
- At no year end before the last two years is the bot's cash more than
  the price of its next useful buy plus 50 %. Money is always spent.
- The bot completes at least one contract in a Harju run, and every offer is
  for a good the map makes and a site that takes it.
- Two trains on a line with a siding and two platforms at each end make 1.6
  to 2.0 times the trips of one, and never meet on the main track.
- A greedy plan (every coin into trains on the first line) earns less by
  1868 than the planned network. Flooding one town does not pay.
- Running costs are 33 to 46 % of gross income over the game, and none of
  the years strays outside 25 to 60 %.
- No train stands on another: a check in `make spots` that no two
  standing trains share a platform track.

## Build order, once Vesa says yes

1. **Money** (built): running costs per tile, track upkeep, higher prices, the
   loan, stars from net worth. The cap goes. Bot re-tuned to the checks
   above. Station queueing with one platform and the waiting train drawn
   on the line.
2. **Towns use what they get** (built): the store, the price from the
   store, the growth meter, the starved good marked.
3. **Where the money goes** (built): platforms, the passing siding, the
   crane, and the year-end contract in place of the perks. The rules are in
   `docs/design.md`, "Stations and towns" and "Money and goals". Double track
   and new engines by era, from the plan's table of upgrades, are not built.
4. **Mixed trains and lines with up to four stops.**
5. **Passengers and mail** between the three towns.

Each step ships on its own and is played before the next starts.

## Defaults taken

Vesa said yes without answering three questions; the plan's defaults
stand until he says otherwise: the loan comes in step 1, the contract
replaces the year-end perks, mixed trains come before passengers.
