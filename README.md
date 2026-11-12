# Minnewaska · Terrain & exposure

[Open the map](https://nicoleluu.github.io/minnewaska-field-atlas/)

From the project directory, run `python3 -m http.server 8000` and open
`http://localhost:8000/` in a WebGL-enabled browser. The basemap requires
internet access. The exported study layers are included in this repository.

`maps/terrain.yaml` defines the layers and their symbology. `street-style.json`
contains the flat OpenFreeMap Liberty street basemap and Census town boundaries. `atlas.js` connects the two
views, filters and observation popups. See [code and data credits](CODE_SOURCES.txt).

The optional `prepare_data.py` export script uses the original sibling GIS
workspace folders `spatial_relatedness/data` and `interactive_mapping_part_1`.
The published map runs directly from the included files.
