# Analytics tracking

Raide uses the clavesa tracker: `public/tracker.js` (vendored unmodified
from `clavesa-dev/web-tracker/`) sends events as beacons to a 1x1 GIF, the
data rides in the query string, and CloudFront access logs are the
datastore. No cookies, no backend, no PII. The pattern and its invariants
are in `jeeves/practices/web-tracking.md`; this file covers only what Raide
does.

## Split hosting

The game deploys to GitHub Pages, which exposes no request logs, so the
pixel is served from our own CloudFront (Terraform under `infra/`, copied
from sora). The endpoint is an absolute cross-origin URL that
`TRACKER_CONFIG` in `index.html` takes from `VITE_PIXEL_URL` at build time:
a GitHub repository variable for the Pages deploy, `.env.local` (written by
`make env`) for builds on this machine. A clone or fork has neither, so its
build beacons nowhere. The tracker is also off on localhost and for
`?bot=1` script runs.

## Standing it up

```sh
mise install       # the pinned Terraform
make plan          # terraform plan (infra/tfplan)
make apply         # S3 buckets + CloudFront; writes .env.local
gh variable set VITE_PIXEL_URL --body "$(AWS_PROFILE=personal terraform -chdir=infra output -raw pixel_url)"
make deploy-pixel  # upload public/t.gif with no-store
git push           # the Pages workflow builds with the variable
```

## Game events

`window.__clvtracker.track(event, data)` is the hook; the game calls it
through `track()` in `src/track.ts`. The Play button on the title is a
`data-track="title-play"` CTA.

| Event | When | Data |
|-------|------|------|
| `scenario_start` | the map opens | `scenario` |
| `build` | a drag builds track | `scenario`, `cost`, `bridge` cells |
| `train` | a train is bought | `scenario`, `wagons` |
| `year_end` | the year-end card closes | `scenario`, `year`, `profit`, `choice` |
| `scenario_end` | the result card opens | `scenario`, `won`, `year`, `cash`, `stars` |

No rollup pipeline or board yet: that is in `TODO.md`.
