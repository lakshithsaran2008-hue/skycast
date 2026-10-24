#!/usr/bin/env python3
"""Download NOAA GFS (0.25 degree) forecasts for South and Southeast Asia and write
compact files that the Skycast website reads directly.

Run by GitHub Actions every few hours:
    python pipeline/fetch_gfs.py --out site/data/gfs

Source: NOAA GFS on the public AWS bucket noaa-gfs-bdp-pds (no account or key needed).
Only the 8 fields we need are downloaded, using the .idx index and HTTP byte ranges.

Output (in --out):
    manifest.json   grid and run description
    f000.bin.gz ... one file per forecast step; int16 little endian, byte-shuffled, gzip.
                    layout [variable][row][col], rows run south to north.
                    value = raw / scale + offset ; raw -32768 means "missing".
"""
import argparse
import datetime as dt
import gzip
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np

BUCKET = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
SOUTH, NORTH, WEST, EAST = -2.0, 42.0, 50.0, 112.0
STEP_DEG = 0.25
# every 3 h for the first 4 days, then every 6 h out to 16 days (the website blends between steps)
HOURS = list(range(0, 97, 3)) + list(range(102, 385, 6))
MISSING = -32768

# name, GRIB variable, level, scale, offset, unit after conversion
VARS = [
    ("u10",   "UGRD",  "10 m above ground", 50,  0,    "km/h"),
    ("v10",   "VGRD",  "10 m above ground", 50,  0,    "km/h"),
    ("gust",  "GUST",  "surface",           50,  0,    "km/h"),
    ("t2m",   "TMP",   "2 m above ground",  100, 0,    "degC"),
    ("rh",    "RH",    "2 m above ground",  100, 0,    "%"),
    ("cloud", "TCDC",  "entire atmosphere", 100, 0,    "%"),
    ("pres",  "PRMSL", "mean sea level",    100, 1000, "hPa"),
    ("rain",  "PRATE", "surface",           100, 0,    "mm/h"),
]


def convert(name, a):
    """Convert GRIB units to the units used on the website."""
    if name in ("u10", "v10", "gust"):
        return a * 3.6            # m/s -> km/h
    if name == "t2m":
        return a - 273.15         # K -> degC
    if name == "pres":
        return a / 100.0          # Pa -> hPa
    if name == "rain":
        return a * 3600.0         # kg m-2 s-1 -> mm/h
    return a


# ---------------------------------------------------------------- index parsing
def parse_idx(text):
    """Return a list of (start, end_or_None, varname, level, fcst) for each message."""
    rows = []
    for line in text.strip().splitlines():
        p = line.split(":")
        if len(p) < 6:
            continue
        rows.append((int(p[1]), p[3], p[4], p[5]))
    out = []
    for i, (start, var, level, fc) in enumerate(rows):
        end = rows[i + 1][0] - 1 if i + 1 < len(rows) else None
        out.append((start, end, var, level, fc))
    return out


def pick(entries, var, level):
    """Pick the message for a variable/level, or None."""
    exact = [e for e in entries if e[2] == var and e[3] == level]
    if exact:
        return exact[0]
    loose = [e for e in entries if e[2] == var and e[3].startswith(level)]
    return loose[0] if loose else None


# ---------------------------------------------------------------- network
def http_get(url, rng=None, tries=4):
    last = None
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "skycast-pipeline"})
            if rng:
                req.add_header("Range", rng)
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (403, 404):
                raise
        except Exception as e:  # network hiccup
            last = e
        time.sleep(2 + 3 * k)
    raise last


def base_url(cycle, fh):
    ymd, hh = cycle.strftime("%Y%m%d"), cycle.strftime("%H")
    return f"{BUCKET}/gfs.{ymd}/{hh}/atmos/gfs.t{hh}z.pgrb2.0p25.f{fh:03d}"


def find_cycle():
    """Latest GFS cycle whose last step is already published."""
    now = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0)
    cyc = now.replace(hour=now.hour - now.hour % 6)
    for _ in range(8):
        try:
            http_get(base_url(cyc, HOURS[-1]) + ".idx", tries=1)
            return cyc
        except Exception:
            cyc -= dt.timedelta(hours=6)
    raise SystemExit("No complete GFS cycle found in the last 48 hours")


# ---------------------------------------------------------------- decoding
def grid_indices(lats, lons):
    """Row and column indices of the region inside the global grid (rows south to north)."""
    rows = np.where((lats >= SOUTH - 1e-6) & (lats <= NORTH + 1e-6))[0]
    cols = np.where((lons >= WEST - 1e-6) & (lons <= EAST + 1e-6))[0]
    rows = rows[np.argsort(lats[rows])]
    return rows, cols


def encode(name, arr, scale, offset):
    a = np.asarray(arr, dtype="float64")
    raw = np.rint((a - offset) * scale)
    raw[~np.isfinite(a)] = MISSING
    raw = np.clip(raw, MISSING + 1, 32767)
    raw[~np.isfinite(a)] = MISSING
    return raw.astype("<i2")


def fetch_step(cycle, fh, workdir):
    import pygrib  # imported here so the self test does not need it

    url = base_url(cycle, fh)
    entries = parse_idx(http_get(url + ".idx").decode())
    chosen = []  # (index into VARS, entry)
    for k, (name, var, level, *_rest) in enumerate(VARS):
        e = pick(entries, var, level)
        if e is not None:
            chosen.append((k, e))
    path = os.path.join(workdir, f"f{fh:03d}.grib2")
    with open(path, "wb") as f:
        for _, (start, end, *_r) in chosen:
            rng = f"bytes={start}-{end}" if end is not None else f"bytes={start}-"
            f.write(http_get(url, rng))
    grbs = pygrib.open(path)
    msgs = list(grbs)
    try:
        return decode_messages(msgs, [k for k, _e in chosen])
    finally:
        grbs.close()
        os.remove(path)


def decode_messages(msgs, var_indexes):
    """Turn GRIB messages (in the order downloaded) into cropped, converted arrays."""
    if len(msgs) != len(var_indexes):
        raise RuntimeError(f"expected {len(var_indexes)} messages, found {len(msgs)}")
    fields = {}
    rows = cols = origin = None
    for k, m in zip(var_indexes, msgs):
        if rows is None:
            lats, lons = m.latlons()
            rows, cols = grid_indices(lats[:, 0], lons[0, :])
            origin = (float(lats[rows[0], 0]), float(lons[0, cols[0]]))
        vals = np.ma.filled(m.values.astype("float64"), np.nan)
        fields[VARS[k][0]] = convert(VARS[k][0], vals[np.ix_(rows, cols)])
    return fields, rows, cols, origin


def finish(fields, shape):
    """Fill gaps: gusts fall back to wind speed, rain to zero."""
    out = {}
    speed = None
    if "u10" in fields and "v10" in fields:
        speed = np.hypot(fields["u10"], fields["v10"])
    for name, *_ in VARS:
        a = fields.get(name)
        if a is None:
            if name == "gust" and speed is not None:
                a = speed.copy()
            elif name == "rain":
                a = np.zeros(shape)
            else:
                a = np.full(shape, np.nan)
        out[name] = a
    return out


def pack(blob):
    """Byte-shuffle the int16 values (all low bytes, then all high bytes) and gzip them."""
    a = np.frombuffer(blob, dtype="<i2")
    sh = np.concatenate([(a & 0xFF).astype("u1"), ((a >> 8) & 0xFF).astype("u1")]).tobytes()
    return gzip.compress(sh, 9, mtime=0)


def unpack(data):
    """Inverse of pack (used by the self test; the browser does the same in JavaScript)."""
    sh = np.frombuffer(gzip.decompress(data), dtype="u1")
    n = len(sh) // 2
    return (sh[:n].astype("<u2") | (sh[n:].astype("<u2") << 8)).astype("<i2")


def write_step(out_dir, fh, fields):
    blob = b"".join(encode(n, fields[n], s, o).tobytes() for n, _v, _l, s, o, _u in VARS)
    data = pack(blob)
    with open(os.path.join(out_dir, f"f{fh:03d}.bin.gz"), "wb") as f:
        f.write(data)
    return len(data)


def write_manifest(out_dir, cycle, rows, cols, lat0, lon0):
    man = {
        "source": "NOAA GFS 0.25 degree",
        "cycle": cycle.strftime("%Y%m%d%H"),
        "cycleTime": cycle.strftime("%Y-%m-%dT%H:00:00Z"),
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "south": lat0, "west": lon0,
        "north": lat0 + (rows - 1) * STEP_DEG, "east": lon0 + (cols - 1) * STEP_DEG,
        "dlat": STEP_DEG, "dlon": STEP_DEG, "rows": rows, "cols": cols,
        "hours": HOURS,
        "vars": [{"name": n, "scale": s, "offset": o, "unit": u} for n, _v, _l, s, o, u in VARS],
        "missing": MISSING,
        "format": "int16 little endian, byte-shuffled, gzip",
    }
    with open(os.path.join(out_dir, "manifest.json"), "w") as f:
        json.dump(man, f, separators=(",", ":"))
    return man


# ---------------------------------------------------------------- demo data (tests only)
def demo(out_dir):
    """Synthetic fields with a storm, to test the website without internet. Never deployed."""
    os.makedirs(out_dir, exist_ok=True)
    lats = np.arange(SOUTH, NORTH + 1e-6, STEP_DEG)
    lons = np.arange(WEST, EAST + 1e-6, STEP_DEG)
    LA, LO = np.meshgrid(lats, lons, indexing="ij")
    cycle = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0)
    cycle -= dt.timedelta(hours=cycle.hour % 6 + 4)
    for fh in HOURS:
        cy, cx = 14 + 0.05 * fh, 88 - 0.04 * fh
        dy, dx = LA - cy, LO - cx
        r = np.hypot(dy, dx) + 0.3
        mag = 15 + 120 * np.exp(-((r - 1.5) ** 2) / 1.2)
        u = -dy / r * mag * 0.9 + 8
        v = dx / r * mag * 0.9 + 3
        f = {
            "u10": u, "v10": v, "gust": np.hypot(u, v) * 1.4,
            "t2m": 30 - 0.35 * np.abs(LA - 15) + 2 * np.sin(LO / 8 + fh / 12),
            "rh": 60 + 30 * np.exp(-r / 4), "cloud": 20 + 80 * np.exp(-r / 3),
            "pres": 1010 - 30 * np.exp(-r / 2), "rain": 12 * np.exp(-((r - 1.5) ** 2) / 1.0),
        }
        write_step(out_dir, fh, f)
    return write_manifest(out_dir, cycle, len(lats), len(lons), SOUTH, WEST)


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="site/data/gfs")
    ap.add_argument("--demo", action="store_true", help="write synthetic test data and exit")
    a = ap.parse_args()
    if a.demo:
        m = demo(a.out)
        print("demo written", m["rows"], "x", m["cols"])
        return
    os.makedirs(a.out, exist_ok=True)
    work = os.path.join(a.out, "_tmp")
    os.makedirs(work, exist_ok=True)
    cycle = find_cycle()
    print("Using GFS cycle", cycle.isoformat(), flush=True)

    def job(fh):
        return fh, fetch_step(cycle, fh, work)

    grid = origin = None
    total = 0
    with ThreadPoolExecutor(max_workers=3) as ex:
        for fh, (fields, rows, cols, org) in ex.map(job, HOURS):
            if grid is None:
                grid, origin = (len(rows), len(cols)), org
            fields = finish(fields, (len(rows), len(cols)))
            total += write_step(a.out, fh, fields)
            print(f"f{fh:03d} ok", flush=True)
    man = write_manifest(a.out, cycle, grid[0], grid[1], origin[0], origin[1])
    try:
        os.rmdir(work)
    except OSError:
        pass
    print("Done:", man["rows"], "x", man["cols"], "grid,", round(total / 1e6, 1), "MB")


if __name__ == "__main__":
    sys.exit(main())
