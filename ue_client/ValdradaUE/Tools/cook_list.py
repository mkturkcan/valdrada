"""The levels the release cooks: only those Data/city.json names. The project's Content keeps every earlier build of a
block (/Game/CCB) and far package (/Game/CF) beside the current one, and a directory rule would cook them all (0.5.1: 1,098
block levels cooked for 981 listed). This rewrites the "Map" primary asset type in Config/DefaultGame.ini: /Game/Client by
directory, the city's block and far levels as SpecificAssets; the chunk rules (CCB chunk 1, CF chunk 2) stay.

    python3 ue_client/ValdradaUE/Tools/cook_list.py          after make_manifests.py, before the cook
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
INI = os.path.join(HERE, '..', 'Config', 'DefaultGame.ini')
city = json.load(open(os.path.join(HERE, '..', 'Data', 'city.json')))
lv = sorted({p for k in ('blocks', 'far') for p in city[k].values()})
assert all(p.startswith(('/Game/CCB/', '/Game/CF/')) for p in lv)
spec = ','.join(f'"{p}.{p.rsplit("/", 1)[1]}"' for p in lv)
line = ('+PrimaryAssetTypesToScan=(PrimaryAssetType="Map",AssetBaseClass=/Script/Engine.World,bHasBlueprintClasses=False,'
        'bIsEditorOnly=False,Directories=((Path="/Game/Client")),SpecificAssets=(' + spec + '),'
        'Rules=(Priority=-1,ChunkId=-1,bApplyRecursively=True,CookRule=AlwaysCook))')
text = open(INI).read()
pat = re.compile(r'^\+PrimaryAssetTypesToScan=\(PrimaryAssetType="Map".*$', re.M)
assert len(pat.findall(text)) == 1
text = pat.sub(lambda m: line, text)
open(INI, 'w').write(text)
print(f'{len(lv)} levels: {sum(p.startswith("/Game/CCB/") for p in lv)} block, {sum(p.startswith("/Game/CF/") for p in lv)} far')
