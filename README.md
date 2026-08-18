# Delivery Helper PWA

A small offline-first web app prototype for a single delivery driver.

## Included
- Customer database stored locally in the browser
- Customer ID, address/area, Phone 1/2, company notes, personal notes
- GPS latitude/longitude
- One-button capture of current GPS
- Today's delivery list and quantity
- Next-5 stop carousel
- One-tap phone calling
- One-tap Google Maps navigation
- Delivered / undo
- Simple local GPS route reordering (nearest-neighbour heuristic)
- JSON export/import backup
- PWA install support

## Important limitations
- The route optimizer is intentionally simple. It does NOT understand truck restrictions,
  live traffic, one-way restrictions beyond straight-line proximity, road width or legal truck routing.
- Google Maps navigation requires internet access when navigating.
- GPS capture needs HTTPS or localhost in most browsers.
- Data is local to the browser/device unless you export/import it.

## Run on a computer
From this folder:
    python -m http.server 8080

Then open:
    http://localhost:8080

## Phone/tablet
For full PWA + GPS support, host these files on any HTTPS static host
(e.g. GitHub Pages, Cloudflare Pages, Netlify, or your own server).
