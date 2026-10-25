"""Offline self test for the pipeline (no internet). Run: python pipeline/selftest.py"""
import numpy as np, fetch_gfs as g

IDX = """1:0:d=2026102406:PRMSL:mean sea level:anl:
2:900:d=2026102406:UGRD:10 m above ground:anl:
3:1800:d=2026102406:VGRD:10 m above ground:anl:
4:2700:d=2026102406:TMP:2 m above ground:anl:
5:3600:d=2026102406:RH:2 m above ground:anl:
6:4500:d=2026102406:TCDC:entire atmosphere (considered as a single layer):anl:
7:5400:d=2026102406:TCDC:entire atmosphere:6 hour ave fcst:
8:6300:d=2026102406:PRATE:surface:6 hour ave fcst:
9:7200:d=2026102406:GUST:surface:6 hour fcst:
"""
e = g.parse_idx(IDX)
assert len(e) == 9 and e[0][1] == 899 and e[-1][1] is None
assert g.pick(e, "UGRD", "10 m above ground")[0] == 900
assert g.pick(e, "TCDC", "entire atmosphere")[0] == 5400      # exact level wins
assert g.pick(e, "NOPE", "surface") is None

# fake GRIB messages on a global 0.25 grid (north to south, lon 0..359.75)
lat1 = np.arange(90, -90.1, -0.25); lon1 = np.arange(0, 360, 0.25)
LA, LO = np.meshgrid(lat1, lon1, indexing="ij")
class M:
    def __init__(self, v): self.v = v
    def latlons(self): return LA, LO
    @property
    def values(self): return np.ma.masked_invalid(self.v)
vals = {"u10": 10 + 0 * LA, "v10": -5 + 0 * LA, "gust": 12 + 0 * LA, "t2m": 300 + LA / 100, "rh": 70 + 0 * LA,
        "cloud": 50 + 0 * LA, "pres": 101300 + 0 * LA, "rain": 0.0005 + 0 * LA}
order = [k for k in range(len(g.VARS))]
msgs = [M(vals[g.VARS[k][0]]) for k in order]
f, rows, cols, org = g.decode_messages(msgs, order)
assert org == (-2.0, 50.0), org
assert (len(rows), len(cols)) == (177, 249), (len(rows), len(cols))
assert abs(f["u10"][0, 0] - 36.0) < 1e-9                       # 10 m/s -> 36 km/h
assert abs(f["pres"][0, 0] - 1013.0) < 1e-9
assert abs(f["rain"][0, 0] - 1.8) < 1e-9                       # mm/h
assert f["t2m"][0, 0] < f["t2m"][-1, 0]                        # south row first, lat/100 grows north
# round trip through the int16 encoding
fin = g.finish(f, (len(rows), len(cols)))
for n, _v, _l, sc, off, _u in g.VARS:
    raw = g.encode(n, fin[n], sc, off)
    back = raw.astype(float) / sc + off
    assert np.nanmax(np.abs(back - fin[n])) <= 0.5 / sc + 1e-9, n
blob = b"".join(g.encode(n, fin[n], sc, off).tobytes() for n, _v, _l, sc, off, _u in g.VARS)
back = g.unpack(g.pack(blob))
assert back.tobytes() == blob
print("pipeline self test OK; grid", len(rows), "x", len(cols))

# ---- ECMWF helpers
import fetch_ecmwf as e2
idx = '{"param": "2t", "levtype": "sfc", "_offset": 0, "_length": 100}\n{"param": "msl", "levtype": "sfc", "_offset": 100, "_length": 50}\n'
ents = e2.parse_index(idx)
assert e2.choose(ents, "msl")["_offset"] == 100 and e2.choose(ents, "tp") is None
assert abs(float(e2.rh_from_dewpoint(np.array(20.0), np.array(20.0))) - 100) < 1e-6
assert 40 < float(e2.rh_from_dewpoint(np.array(30.0), np.array(17.0))) < 50
cv = e2.convert({"u10": np.array([10.0]), "v10": np.array([0.0]), "t2m": np.array([300.0]), "d2m": np.array([290.0]),
                 "cloud": np.array([0.5]), "pres": np.array([101300.0])})
assert abs(cv["u10"][0] - 36) < 1e-9 and abs(cv["cloud"][0] - 50) < 1e-9 and abs(cv["pres"][0] - 1013) < 1e-9
tp = {0: np.array([0.0]), 3: np.array([0.003]), 6: np.array([0.006]), 9: np.array([0.0066])}
r = e2.rain_rates(tp)
assert r[0][0] == 0 and abs(r[3][0] - 1.0) < 1e-9 and abs(r[9][0] - 0.2) < 1e-9, r   # mm/h averaged over each step
assert e2.HOURS[0] == 0 and e2.HOURS[-1] == 240 and len(e2.HOURS) == 65
print("ECMWF helper tests OK")
