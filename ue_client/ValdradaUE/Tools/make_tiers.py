"""Data/tiers.json, the client's graphics tiers (low, medium, high, cinematic), from the persistent city's
tools/ue/persist_tiers.json: each tier's engine console variables, without the persistent level's own ranges
(valdrada.*), its output size (res) and its notes. AValdradaClient::ApplyTier sets the chosen tier's variables at start.

    python3 ue_client/ValdradaUE/Tools/make_tiers.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '..', '..', 'tools', 'ue', 'persist_tiers.json')
OUT = os.path.join(HERE, '..', 'Data', 'tiers.json')
src = json.load(open(SRC))
out = {t: {k: v for k, v in sorted(cv.items()) if not k.startswith(('_', 'valdrada.')) and k != 'res'}
       for t, cv in src.items() if not t.startswith('_') and isinstance(cv, dict)}
# (under 1024 MB the city-block worlds' street trees draw from their coarse Nanite pages, flat green shards from the street)
low = {t: v.get('r.Nanite.Streaming.StreamingPoolSize') for t, v in out.items() if float(v.get('r.Nanite.Streaming.StreamingPoolSize', 1024)) < 1024}
if low: raise SystemExit(f'make_tiers: the Nanite streaming pool is under 1024 MB in {low}; fix tools/ue/persist_tiers.json')
json.dump(out, open(OUT, 'w'), indent=1)
print({t: len(v) for t, v in out.items()})
