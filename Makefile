# Raide: dev, checks, screenshots. The game deploys from GitHub Actions on
# every push to main; infra/ is the analytics pixel host, the one thing
# this Makefile deploys.
#
#   make dev            # vite dev server, reachable on the LAN for a phone
#   make build          # production build -> dist/
#   make preview        # build, then serve it locally
#   make check          # typecheck + build + sim-check, what a commit needs green
#   make balance        # the bot plays the scenario (SCENARIO=harju): its moves, the towns, the money
#   make human          # the measure of done: a human-like player on an iPhone 16, decision log and video in shots/human/
#   make shots-setup    # once: install Playwright
#   make shots          # phone screenshots into shots/
#   make look           # the bot plays on an emulated iPhone 16, screenshots into shots/look/
#   make home           # the start screen, portrait and landscape, fi and en, into shots/home/
#   make advice         # the tip, the marker and the goal strip, into shots/advice/
#   make wants          # what each site wants and whether it is coming, into shots/wants/
#   make result         # the result card, won and lost, into shots/result/
#   make icon           # render public/icon.svg to the PNG icons
#   make buy-check      # buys a train three ways (the map button, the station card, the tip) by touch
#   make touch-check    # lays track and buys a train by touch on an emulated phone
#   make rotate-check   # turning the phone mid-game keeps the state and the layout
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

.PHONY: result dev build preview check balance shots-setup shots look home advice wants buy-check icon touch-check rotate-check human pwa-check mockups topdown plan apply outputs env deploy-pixel

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

home: build
	node scripts/home.mjs

# the tip, the marker and the arc, the goal chip and card, portrait and landscape, into shots/advice/; fails when a tip, the marker or the chip's towns are missing
advice: build
	node scripts/advice.mjs

# what each site wants and whether a train brings it, and the goal strip, Harju at the start and after two years of the bot, and Sawmill, into shots/wants/
wants: build
	node scripts/wants.mjs

# the result card, won and lost, Harju and Sawmill, portrait and landscape, fi and en, into shots/result/; fails when the card scrolls, a button is small or the lost card names nothing
result: build
	node scripts/result.mjs

icon:
	node scripts/icon.mjs

buy-check:
	node scripts/buy-check.mjs

touch-check:
	node scripts/touch-check.mjs

# turning the phone mid-game, with iOS's late layout played in
rotate-check:
	node scripts/rotate-check.mjs

# the measure of done (ADR 0006): a human-like player plays Harju by touch on an iPhone 16 in portrait,
# every decision logged with its game time; a video, frames and the log into shots/human/
human: build
	node scripts/human.mjs $(SCENARIO)

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
