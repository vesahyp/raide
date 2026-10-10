# Raide: dev, checks, screenshots. The game deploys from GitHub Actions on
# every push to main; infra/ is the analytics pixel host, the one thing
# this Makefile deploys.
#
#   make dev            # vite dev server, reachable on the LAN for a phone
#   make build          # production build -> dist/
#   make preview        # build, then serve it locally
#   make check          # typecheck + build + sim-check, what a commit needs green
#   make balance        # the bot plays the scenario: when the goal falls, what the money did
#   make shots-setup    # once: install Playwright
#   make shots          # phone screenshots into shots/
#   make look           # the quick look: the bot plays on an emulated iPhone, screenshots into shots/look/
#   make spots          # the bot plays Harju, six views in both orientations into shots/spots/; fails on a train off its rails or a frame over 12 ms
#   make home           # the start screen, portrait and landscape, fi and en, two moments, into shots/home/; fails on a scroll, a small card or a frame over 12 ms
#   make trains         # the station with three trains, the buy card, the train card, loading, the crew, into shots/trains/
#   make advice         # the tip, the marker and the arc, the goal chip and card, into shots/advice/
#   make goods          # piles, chips, badges, the site card and pick mode, portrait and landscape, into shots/goods/
#   make mixed          # the economy step 4 pictures: the extend card, a three-stop line, the buy card with a mixed consist, a mixed train at its middle stop, the train card, into shots/mixed/
#   make result         # the result card, won and lost, portrait and landscape, fi and en, into shots/result/
#   make people         # the line card and the buy sheet
buy-sheet: build
	node scripts/buysheet.mjs

# the economy step 5 pictures: travellers waiting on a platform, a coach train arriving with its pay, the town card, the buy card with a coach and a mail van, the ledger's travellers and mail rows, into shots/people/
#   make buy-sheet      # the line card and buy sheet on iPhone 16, portrait and landscape, Finnish and English, into shots/buysheet/; fails when the footer covers the list, a card wraps or a useless action looks like a button
#   make upgrades       # the economy step 3 pictures: the passing siding, the crane, the contract offer and its chip, into shots/upgrades/
#   make ledger         # the slice 5 pictures: the nine sites, the year-end charts, towns growing, price steps, into shots/ledger/
#   make money-look     # the money card and the line card with its net, portrait and landscape, into shots/money/
#   make drag-look      # the start rings and the drag targets, portrait and landscape, into shots/look/targets-*.png
#   make icon           # render public/icon.svg to the PNG icons
#   make buy-check      # buys a train three ways (the map button, the station card, the tip) by touch; pictures into shots/buy/
#   make touch-check    # lays track and buys a train by touch on an emulated phone
#   make yearend-check  # the year end must wait for a held drag, a pick mode and an open card; a drag from a line's end builds a new line
#   make rotate-check   # the year end against a drag, a pick mode and a card
yearend-check:
	node scripts/yearend-check.mjs

# turning the phone mid-game must keep the state and the layout
#   make playthrough    # the scenario by thumb on an emulated iPhone, portrait and landscape,
#                       #   a video each (ORIENT=portrait for one; SPEED=0.5 on a loaded machine)
#   make pwa-check      # manifest, icons, service worker, offline (URL ?= the live site)
#   make mockups        # render docs/mockups/mockups.html to PNG, iPhone portrait and landscape
#   make topdown        # render the top-down look test in docs/mockups/topdown, four screens
#   make plan           # terraform plan for the pixel infra (no changes)
#   make apply          # terraform apply (creates AWS resources), then make env
#   make outputs        # show terraform outputs (pixel_url etc.)
#   make deploy-pixel   # upload t.gif to the pixel bucket
#
# AWS profile: personal by default; PROFILE=name overrides. Terraform is
# the mise-pinned one (.mise.toml): run `mise install` once.

PROFILE ?= personal
AWS      = AWS_PROFILE=$(PROFILE) aws
TF       = AWS_PROFILE=$(PROFILE) terraform -chdir=infra

.PHONY: result dev build preview check balance shots-setup shots look spots home trains goods advice ledger upgrades mixed orders-check people buy-check buy-sheet drag-look icon money-look touch-check yearend-check rotate-check playthrough pwa-check mockups topdown plan apply outputs env deploy-pixel

dev:
	npm run dev

build:
	npm run build

preview: build
	npm run preview

check:
	npm run typecheck
	npm run build
	npm run sim-check

balance:
	npm run balance

shots-setup:
	npm install --no-save playwright && npx playwright install chromium

shots:
	node scripts/shots.mjs

# SCENARIO=harju SECONDS=30 BOT=0 ORIENT=portrait; the pictures are the check for a renderer change
SCENARIO ?= harju
SECONDS ?= 30
look: build
	node scripts/look.mjs $(SCENARIO) $(SECONDS)

spots: build
	node scripts/spots.mjs

home: build
	node scripts/home.mjs

# the slice 4 pictures: a busy station, the cards, loading, the crew
trains: build
	node scripts/trains.mjs

# piles from the stock, chips at every zoom, the site card and pick mode
goods: build
	node scripts/goods.mjs

# the tip, the marker and the arc, the goal chip and card, portrait and landscape, into shots/advice/; fails when a tip, the marker or the chip's towns are missing
advice: build
	node scripts/advice.mjs

# the year-end charts, towns growing house by house, the chip price step
ledger: build
	node scripts/ledger.mjs

# the passing siding in pick mode and bought, two trains passing at it, the crane loading, the site card, the contract offer and its chip
upgrades: build
	node scripts/upgrades.mjs

# the economy step 4 pictures: lengthening a line, a mixed consist, a mixed train unloading and loading
mixed: build
	node scripts/mixed.mjs

# train orders by touch on an iPhone 16: a train passes Koskensaha through, then stops there again; pictures into shots/orders/
orders-check: build
	node scripts/orders-check.mjs

# the result card, won and lost, Harju and Sawmill, portrait and landscape, fi and en, into shots/result/; fails when the card scrolls, a button is small or the lost card names nothing
result: build
	node scripts/result.mjs

# the economy step 5 pictures: travellers on a platform, a coach train arriving, the town card, the buy card, the ledger
people: build
	node scripts/people.mjs

# the money card and the line card with its earnings and net
money-look: build
	node scripts/money-look.mjs

# the route under the finger mid-drag and at the site, then the choice card after the lift
drag-look: build
	node scripts/drag-look.mjs $(SCENARIO)

icon:
	node scripts/icon.mjs

buy-check:
	node scripts/buy-check.mjs

touch-check:
	node scripts/touch-check.mjs

# turning the phone mid-game, with iOS's late layout played in
rotate-check:
	node scripts/rotate-check.mjs

# the scenario on an emulated iPhone, every input a touch, the hand in tools/hand.ts playing:
# a video, a result sheet and frame sheets per orientation into shots/playthrough/
ORIENT ?=
SPEED ?= 1
playthrough:
	ORIENT=$(ORIENT) SPEED=$(SPEED) node scripts/playthrough.mjs

URL ?= https://vesahyp.github.io/raide/
pwa-check:
	node scripts/pwa-check.mjs $(URL)

# the static design mockups (docs/mockups/README.md), one PNG per screen and orientation
mockups:
	node docs/mockups/render.mjs

# the top-down look test (docs/mockups/topdown/README.md): Höyry's style on a big map, four screens
topdown:
	node docs/mockups/topdown/render.mjs

plan:
	$(TF) init -input=false
	$(TF) plan -out=tfplan

apply:
	$(TF) apply tfplan
	$(MAKE) env

outputs:
	@$(TF) output

# The pixel URL for builds on this machine, from the Terraform output.
# Gitignored (*.local): a clone without it builds a game whose tracker is
# off, which is what a fork should get. The Pages deploy reads the same
# value from a GitHub repository variable.
env:
	@printf 'VITE_PIXEL_URL=%s\n' "$$($(TF) output -raw pixel_url)" > .env.local
	@cat .env.local

# The pixel must never cache: every beacon has to reach the origin so the
# request (and its query string) lands in the CloudFront access logs.
deploy-pixel:
	@BUCKET=$$($(TF) output -raw bucket_name); \
	DIST=$$($(TF) output -raw distribution_id); \
	$(AWS) s3 cp public/t.gif "s3://$$BUCKET/t.gif" --cache-control "no-store" --content-type "image/gif"; \
	$(AWS) cloudfront create-invalidation --distribution-id "$$DIST" --paths "/t.gif" >/dev/null; \
	echo "pixel live at $$($(TF) output -raw pixel_url)"
