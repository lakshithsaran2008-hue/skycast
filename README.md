# Skycast

Windy-style weather map for South and Southeast Asia, with India area picker and 3-month outlook.

- `site/` the website (index.html, style.css, app.js, india.js, weathermap.js, data/ for India areas)
- `pipeline/` downloads NOAA GFS data (wind, gusts, temperature, humidity, clouds, pressure, rain) every 6 hours
- `.github/workflows/deploy.yml` runs the pipeline on a schedule and publishes `site/` to GitHub Pages
- `SETUP.md` step-by-step publishing guide

Local preview of the site only: `cd site && python3 -m http.server 8000` then open http://localhost:8000
