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
#   make drag-look      # a drag held under the finger, the lift and the route choice, into shots/look/drag-*.png
#   make icon           # render public/icon.svg to the PNG icons
#   make touch-check    # lays track and buys a train by touch on an emulated phone
#   make rotate-check   # turning the phone mid-game must keep the state and the layout
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

.PHONY: dev build preview check balance shots-setup shots look spots drag-look icon touch-check rotate-check playthrough pwa-check mockups topdown plan apply outputs env deploy-pixel

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

# the route under the finger mid-drag and at the site, then the choice card after the lift
drag-look: build
	node scripts/drag-look.mjs $(SCENARIO)

icon:
	node scripts/icon.mjs

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
