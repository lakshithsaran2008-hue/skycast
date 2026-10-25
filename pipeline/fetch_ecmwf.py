#!/usr/bin/env python3
"""Download ECMWF IFS open data (0.25 degree) for South and Southeast Asia and write the same
compact files as fetch_gfs.py, into site/data/ecmwf.

ECMWF is the model Windy shows by default, so the storms, rain and wind line up with Windy.
Source: ECMWF open data on AWS (ecmwf-forecasts bucket), with ECMWF's own server and Azure as backups.
Only 8 fields are downloaded, using the .index file and HTTP byte ranges.

    python pipeline/fetch_ecmwf.py --out site/data/ecmwf
"""
import argparse
import datetime as dt
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_gfs as G  # noqa: E402  (shared grid, encoding and file writing code)

SOURCES = [
    "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com",
    "https://data.ecmwf.int/forecasts",
    "https://ai4edataeuwest.blob.core.windows.net/ecmwf",
]
# 00z and 12z runs: every 3 h to day 6, then every 6 h to day 10 (the free HRES run ends at 240 h)
HOURS = list(range(0, 145, 3)) + list(range(150, 361, 6))
# website variable -> ECMWF parameter, in download order
PARAMS = [("u10", "10u"), ("v10", "10v"), ("gust", "10fg"), ("t2m", "2t"), ("d2m", "2d"),
          ("cloud", "tcc"), ("pres", "msl"), ("tp", "tp")]


def file_url(src, cycle, fh):
    ymd, hh = cycle.strftime("%Y%m%d"), cycle.strftime("%H")
    return f"{src}/{ymd}/{hh}z/ifs/0p25/oper/{ymd}{hh}0000-{fh}h-oper-fc.grib2"


def index_url(src, cycle, fh):
    return file_url(src, cycle, fh)[:-len(".grib2")] + ".index"


def parse_index(text):
    """ECMWF .index files hold one JSON object per line with _offset and _length."""
    out = []
    for line in text.strip().splitlines():
        try:
            d = json.loads(line)
        except ValueError:
            continue
        out.append(d)
    return out


def choose(entries, param):
    for d in entries:
        if d.get("param") == param and d.get("levtype", "sfc") == "sfc":
            return d
    return None


def find_cycle():
    """Newest 00z/12z run whose forecast files exist. Tries the longest range first
    (240 h) and falls back to shorter ranges, then trims HOURS to what exists."""
    now = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0)
    cyc = now.replace(hour=now.hour - now.hour % 12)
    for _ in range(6):
        for src in SOURCES[:2]:
            for last in (360, 240, 144, 90, 48, 24):
                u = index_url(src, cyc, last)
                try:
                    G.http_get(u, tries=1)
                except Exception as e:
                    print("  not usable:", u, "->", type(e).__name__, e, flush=True)
                    continue
                HOURS[:] = [h for h in HOURS if h <= last]
                return cyc, src
        cyc -= dt.timedelta(hours=12)
    raise SystemExit("No complete ECMWF cycle found in the last 3 days")


def rh_from_dewpoint(t_c, td_c):
    a, b = 17.625, 243.04
    return np.clip(100.0 * np.exp(a * td_c / (b + td_c)) / np.exp(a * t_c / (b + t_c)), 0, 100)


def fetch_step(cycle, src, fh, workdir):
    import pygrib
    url = file_url(src, cycle, fh)
    entries = parse_index(G.http_get(index_url(src, cycle, fh)).decode())
    chosen = []
    for k, (name, param) in enumerate(PARAMS):
        d = choose(entries, param)
        if d is not None:
            chosen.append((name, d))
    path = os.path.join(workdir, f"e{fh:03d}.grib2")
    with open(path, "wb") as f:
        for _n, d in chosen:
            start = int(d["_offset"]); end = start + int(d["_length"]) - 1
            f.write(G.http_get(url, f"bytes={start}-{end}"))
    grbs = pygrib.open(path)
    msgs = list(grbs)
    try:
        if len(msgs) != len(chosen):
            raise RuntimeError(f"expected {len(chosen)} messages, found {len(msgs)}")
        raw = {}
        rows = cols = origin = None
        for (name, _d), m in zip(chosen, msgs):
            if rows is None:
                lats, lons = m.latlons()
                rows, cols = G.grid_indices(lats[:, 0], lons[0, :])
                origin = (float(lats[rows[0], 0]), float(lons[0, cols[0]]))
            vals = np.ma.filled(m.values.astype("float64"), np.nan)
            raw[name] = vals[np.ix_(rows, cols)]
        return raw, rows, cols, origin
    finally:
        grbs.close()
        os.remove(path)


def convert(raw):
    """Raw ECMWF fields -> the fields and units the website uses (rain handled separately)."""
    f = {}
    for n in ("u10", "v10", "gust"):
        if n in raw:
            f[n] = raw[n] * 3.6
    if "t2m" in raw:
        f["t2m"] = raw["t2m"] - 273.15
        if "d2m" in raw:
            f["rh"] = rh_from_dewpoint(f["t2m"], raw["d2m"] - 273.15)
    if "cloud" in raw:
        c = raw["cloud"]
        f["cloud"] = c * 100.0 if np.nanmax(c) <= 1.5 else c
    if "pres" in raw:
        f["pres"] = raw["pres"] / 100.0
    return f


def rain_rates(tp_by_hour):
    """Total precipitation is accumulated since the start of the run (metres).
    The rate for each step is the average mm/h over the interval that ends at that step."""
    rates, prev = {}, None
    for fh in HOURS:
        a = tp_by_hour.get(fh)
        if a is None:
            continue
        if prev is None:
            rates[fh] = np.zeros_like(a)
        else:
            ph, pa = prev
            rates[fh] = np.maximum(a - pa, 0) * 1000.0 / (fh - ph)
        prev = (fh, a)
    return rates


def write_manifest(out_dir, cycle, rows, cols, lat0, lon0):
    G.HOURS = HOURS
    man = G.write_manifest(out_dir, cycle, rows, cols, lat0, lon0)
    man["source"] = "ECMWF IFS 0.25 degree (open data)"
    with open(os.path.join(out_dir, "manifest.json"), "w") as f:
        json.dump(man, f, separators=(",", ":"))
    return man


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="site/data/ecmwf")
    ap.add_argument("--demo", action="store_true")
    a = ap.parse_args()
    G.HOURS = HOURS
    if a.demo:
        m = G.demo(a.out)
        man = write_manifest(a.out, dt.datetime.strptime(m["cycle"], "%Y%m%d%H").replace(tzinfo=dt.timezone.utc), m["rows"], m["cols"], m["south"], m["west"])
        print("demo written", man["rows"], "x", man["cols"])
        return
    os.makedirs(a.out, exist_ok=True)
    work = os.path.join(a.out, "_tmp")
    os.makedirs(work, exist_ok=True)
    cycle, src = find_cycle()
    print("Using ECMWF cycle", cycle.isoformat(), "from", src, flush=True)

    def job(fh):
        return fh, fetch_step(cycle, src, fh, work)

    fields_by_hour, tp_by_hour = {}, {}
    grid = origin = None
    with ThreadPoolExecutor(max_workers=3) as ex:
        for fh, (raw, rows, cols, org) in ex.map(job, HOURS):
            if grid is None:
                grid, origin = (len(rows), len(cols)), org
            fields_by_hour[fh] = convert(raw)
            if "tp" in raw:
                tp_by_hour[fh] = raw["tp"]
            print(f"f{fh:03d} ok", flush=True)
    rates = rain_rates(tp_by_hour)
    total = 0
    for fh in HOURS:
        f = fields_by_hour[fh]
        f["rain"] = rates.get(fh, np.zeros(grid))
        total += G.write_step(a.out, fh, G.finish(f, grid))
    man = write_manifest(a.out, cycle, grid[0], grid[1], origin[0], origin[1])
    try:
        os.rmdir(work)
    except OSError:
        pass
    print("Done:", man["rows"], "x", man["cols"], "grid,", round(total / 1e6, 1), "MB")


if __name__ == "__main__":
    sys.exit(main())
