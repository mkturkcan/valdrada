---
title: Valdrada
hide:
  - navigation
  - toc
---

# Valdrada { .visually-hidden }

![A simulator frame at W 125th St and Lenox Ave in Harlem, with its semantic segmentation and depth](assets/figures/hero.jpg){ .hero }

<p class="lead">Valdrada is a city-scale digital twin of New York City
compiled from public municipal records. It
renders the five boroughs in real time, simulates traffic and pedestrians on the city's own
street network, and returns pixel-exact ground truth through a Python API modelled on CARLA.</p>

[Quick start](quickstart.md){ .md-button .md-button--primary }
[Tutorials](tutorials/index.md){ .md-button }
[Python API](api/python_api.md){ .md-button }
[Download for Windows](https://github.com/mkturkcan/valdrada/releases){ .md-button }
[Demo in the browser](https://huggingface.co/spaces/mehmetkeremturkcan/valdrada){ .md-button }
[Compiled city](https://huggingface.co/datasets/mehmetkeremturkcan/valdrada){ .md-button }

## How it works

<figure markdown="span">
  ![Public records, the compiled city, the real-time render and its ground truth for one block of Harlem](assets/figures/pipeline.jpg)
</figure>

Every element of the city traces back to a record. Building footprints come from NYC Building Footprints and are
joined to the tax-lot database (PLUTO) for floors, use and year of construction, and to the facade inspection filings
for the wall material. Each building is classified into a facade typology and dressed procedurally: windows on the
recorded floor count, cornices, storefronts, fire escapes, stoops and rooftop equipment. Streets come from the city's
centreline database with their recorded widths, lane counts, directions and speed limits. They become carriageways,
kerbs, crosswalks, lane paint, bus lanes, and the lane and sidewalk graphs that traffic and pedestrians move on.

The compiler is a Node.js pipeline and the renderer is three.js on WebGL2, so nothing needs an engine build. Changing
how the city looks or behaves is an edit to a JavaScript module and a page reload, and the whole city can be
recompiled from the public records ([Building from source](building.md)).

## Ground truth for every frame

<figure markdown="span">
  ![RGB, semantic segmentation, instance segmentation with visible and amodal boxes, and depth for one step at W 120th St and Amsterdam Ave](assets/figures/sensors.jpg)
</figure>

Each synchronous step can return RGB, semantic segmentation in Cityscapes-compatible classes, instance segmentation
with visible and amodal boxes, occlusion ratios and 3D poses, and metric depth. The labels are rendered from the same
scene state as the image, so they need no annotation. The Python package writes COCO detection files directly, and the
[tutorials](tutorials/index.md) go from a first connection to a recorded dataset.

## The whole city, streamed

<figure markdown="span">
  ![Every building of the five boroughs shaded by height, with the tile grid and the streaming radii around a camera in Harlem](assets/figures/coverage.jpg)
</figure>

The compiled city holds every building of the five boroughs, 1,085,937 in 3,532 tiles of 512 m. The client keeps full
detail around the camera and draws coarser far-field tiles beyond it, so any street of the city can be rendered on a
laptop GPU.

## Areas modelled in detail

Some areas go beyond the compiled records. On 125th Street, from Twelfth Avenue to the Harlem River, every frontage is
built from a per-building specification (storeys, bays, materials, storefronts and signs) with a facade kit and a
library of 35 CC0 material sets; the street surface, furniture and street life are laid out along the corridor. The
Riverside Drive viaduct follows its published 1900 design, and the Manhattan Valley viaduct, the 1 train's 125th Street
station, the Park Avenue Viaduct and the bridge approaches at the Harlem River are modelled to their documented
dimensions, with the 1 train and Metro-North running on them. In Central Park, the relief comes from USGS 3DEP and the
water bodies, paths and landmarks from OpenStreetMap; tree crowns are segmented by watershed on a vegetation index from
NAIP near-infrared imagery, and the resulting 16,951 trees are assigned to 33 species groups fitted to the park's
published composition. Towers over 45 m are rebuilt near the camera by a tower kit on the facade shader's grid, among
them 111 West 57th with its ten setbacks and fluted piers. The Metropolitan Museum of Art, the American Museum of
Natural History with the Rose Center and the Gilder Center, and the Guggenheim are modelled whole on their footprints,
and the Statue of Liberty is a scan fitted to the Historic American Engineering Record's drawings (HAER NY-138).

## Offline rendering

A recorded take can be exported to OpenUSD and rendered in Blender Cycles or Unreal Engine 5.
`client/tools/ar34/export/harvest.mjs` boots the page as the film recorder does and writes every visible mesh,
instance set and camera sample of the take; `usd_write.py` turns this into USD layers. `blender_take.py` renders the
frames in Cycles with the web client's materials rebuilt as node groups, baked facade windows with interiors,
film-detail street trees and physical light; `ue_take.py` renders the same USD with Unreal's Lumen and Movie Render
Queue, with master materials per family, CC0 layered materials, Nanite foliage and a cinematic preset.
[One city, three renderers](architecture.md) describes the design, and the guides for
[Blender Cycles](blender-cycles.md) and [Unreal Engine 5](unreal.md) take one shot through each renderer. For Unreal the
whole city can also be built once, every 128 m cell as a table of kit instances and its own meshes in 1 km block
packages over a shared material library, so that a shot is a cut of that build and needs only its take and its render
([The whole city](unreal.md#the-whole-city)).

## Architecture

<figure markdown="span">
  ![Public records are compiled into binary tiles; the client streams, simulates and renders them inside the simulation server, which the Python API drives over TCP](assets/figures/architecture.png)
</figure>

The compiler turns the public records into binary tiles. The client streams the tiles around the camera, dresses the
facades, simulates traffic and pedestrians, and renders each frame with its ground truth. The same client runs in two
hosts. In a browser, as on the Hugging Face Space, it is an interactive explorer. Inside the simulation server, an
Electron application, it advances one fixed step per request and sends sensor data over TCP to the Python API
([wire protocol](api/protocol.md)).

The Unreal Engine 5 client, ValdradaUE, runs the simulation in a headless core and renders it in a packaged Unreal
Engine 5 application connected to that core: the renderer streams the city's 128 m cells round the cameras the core
names and returns the camera images, and the Python API and the wire protocol are the same
([The Unreal Engine 5 client](ue-client.md); [Building the Unreal Engine 5 client](ue-client-build.md)).

## Gallery

<figure markdown="span">
  ![Six frames from the simulator: Fifth Avenue, 125th Street, Times Square at night, Harlem brownstones, Williamsburg in the rain and Columbia's Low Library](assets/figures/gallery.jpg)
</figure>

## Citation

Valdrada is developed and maintained by Mehmet Kerem Turkcan. If you use
Valdrada, the compiled city or imagery rendered with it, please cite Valdrada itself:

```bibtex
@software{turkcan2026valdrada,
  author  = {Turkcan, Mehmet Kerem},
  title   = {{Valdrada}: a real-data, real-time digital twin of New York City},
  year    = {2026},
  version = {0.6.1},
  url     = {https://github.com/mkturkcan/valdrada}
}
```
