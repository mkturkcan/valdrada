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
json.dump(out, open(OUT, 'w'), indent=1)
print({t: len(v) for t, v in out.items()})
