# Publish Skycast with hourly weather data (about 15 minutes, free)

You need a free GitHub account. Nothing to install on your computer.

## 1. Create the repository
1. Sign in at github.com, click the **+** at the top right, then **New repository**.
2. Name it `skycast`, choose **Public**, and click **Create repository**.

## 2. Upload the files
1. On the new repository page click **uploading an existing file**.
2. Open the unzipped `skycast` folder on your computer, select everything inside it (the `.github`, `pipeline` and `site` folders, plus `README.md` and `SETUP.md`) and drag it into the browser window.
3. Wait for the upload bar to finish, then click **Commit changes**.

If the `.github` folder did not upload (you can check that `.github/workflows/deploy.yml` is listed in the repository):
1. Click **Add file, then Create new file**.
2. In the name box type `.github/workflows/deploy.yml` (typing the slashes creates the folders).
3. Open `deploy.yml` from the unzipped folder in Notepad, copy everything, paste it into the big box, and click **Commit changes**.

## 3. Turn on publishing
1. Open the repository **Settings**, then **Pages** in the left menu.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.

## 4. Run it the first time
1. Open the **Actions** tab, click **Build and deploy** on the left, then **Run workflow** and the green button.
2. Wait about 10 minutes until the run shows a green tick. If you see a yellow warning on "Fetch weather data", the site still published (see Troubleshooting).
3. Go back to **Settings, then Pages**. Your public address is shown at the top, for example `https://YOUR-NAME.github.io/skycast/`.

## 5. Check it worked
Open the address. At the bottom of the map you should see **GFS 25 km · run 06Z** (the time changes). City names with temperatures appear on the map, and you can drag the time slider about 3.5 days ahead.
If the bar says **Open-Meteo** instead, the hourly data was not found. See below.

From now on the data refreshes by itself 4 times a day. To change the site later, upload the changed file again to the repository (Add file, Upload files) and it redeploys.

## Troubleshooting
- **Bar says "Open-Meteo":** open **Actions**, click the latest run, then **build**, then **Fetch weather data**. Copy the last 20 lines and send them to me.
- **Run turned red at "Install tools":** send me that log too.
- **Page shows an old version:** press Ctrl+Shift+R.
- **Wait for the first successful run:** before it finishes, the address shows a 404 page.

## Using Netlify instead
Upload only the `site` folder to Netlify. Everything works, but without the hourly GFS data it uses Open-Meteo, which has a daily request limit and a coarser map.

## Credits and terms
- Weather model data: NOAA GFS (public domain). 3-month outlook and fallback data: Open-Meteo, free for non-commercial use.
- Base map tiles: Esri (attribution shown on the map). Place data: OpenStreetMap contributors. Area names: Local Government Directory.
- For a commercial or very busy site, check the Esri, Open-Meteo and OpenStreetMap usage terms.

## Optional: your own web address (custom domain)
1. Buy a domain (for example from Namecheap, GoDaddy or Google Domains).
2. **Netlify:** Site configuration → Domain management → Add a domain, then follow the DNS steps Netlify shows. HTTPS is added automatically.
3. **GitHub Pages:** repository Settings → Pages → Custom domain, enter the domain and add the DNS records GitHub lists.

## Layers and data notes
- Wind, gusts, temperature, rain, clouds, humidity and pressure: 16-day Open-Meteo forecast (about 4 days from GFS files when the GitHub pipeline is running in the India region).
- Waves (Open-Meteo Marine, 16 days) and Air quality (Open-Meteo Air Quality, about 5 days) load only when you pick that layer. Waves show over the sea only.

## Android app
**Install from the browser (easiest, free):** open your site in Chrome on Android → ⋮ menu → "Install app" (or "Add to Home screen"). It then opens full-screen like a normal app with its own icon.

**A real .apk / Play Store app (optional):** go to pwabuilder.com, paste your site address (it must be https, for example your netlify.app address) and choose Android. PWABuilder gives you an Android package you can install directly or upload to Google Play (Play Store needs a one-time $25 developer account).
