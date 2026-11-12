"""Rebuild web layers using the Assignment 3 analysis for the street-map atlas."""
import json
from pathlib import Path

import fiona
import numpy as np
import rasterio
from rasterio.features import shapes
from rasterio.warp import transform_geom

root = Path(__file__).resolve().parent
source = root.parent / "spatial_relatedness" / "data"
out = root / "data"

def dump(path, value):
    path.write_text(json.dumps(value, separators=(",", ":")))

def feature(geometry, props):
    return dict(type="Feature", geometry=geometry, properties=props)

def collection(name, features):
    dump(out / (name + ".geojson"), dict(type="FeatureCollection", features=features))

def vector(name, cols=()):
    with fiona.open(source / (name + ".gpkg")) as src:
        return [feature(transform_geom(src.crs, "EPSG:4326", f["geometry"], precision=6),
                        {k: f["properties"][k] for k in cols}) for f in src]

for name, cols in [("boundary",()), ("contours",("ELEV",))]:
    collection(name, vector(name, cols))
# Only the camera extent is needed on the web.
from rasterio.features import bounds as geometry_bounds
west, south, east, north = geometry_bounds(vector("creative_lens_footprint")[0]["geometry"])
dump(out / "comparison-bounds.json", [[west, south], [east, north]])

with rasterio.open(source / "screening_classes.tif") as src, rasterio.open(source / "trail_near.tif") as trail:
    classes = src.read(1)
    near = trail.read(1) > 0
    cells = (classes + 10 * near).astype("uint8")
    groups = []
    for geom, value in shapes(cells, mask=np.isin(classes, [1,2]), transform=src.transform):
        code = int(value)
        groups.append(feature(transform_geom(src.crs, "EPSG:4326", geom, precision=6),
                              dict(aspect="North" if code%10==1 else "South", near=code>10)))
    collection("slopes", groups)
    # Store candidate cell centres, in grid order, for point-to-point comparisons.
    from rasterio.warp import transform
    rows, cols = np.where(np.isin(classes, [1, 2]))
    xs, ys = rasterio.transform.xy(src.transform, rows, cols)
    lng, lat = transform(src.crs, "EPSG:4326", xs, ys)
    fields = []
    for name in ["dem_30m", "slope", "aspect"]:
        with rasterio.open(source / (name + ".tif")) as grid:
            fields.append(np.rint(grid.read(1)[rows, cols]).astype(int))
    values = np.column_stack((np.rint(np.array(lng)*1e6), np.rint(np.array(lat)*1e6),
                              classes[rows,cols], near[rows,cols], *fields)).astype(int)
    # Index short pieces of the same projected trail lines used by the 100 m screen.
    import shapely
    from shapely.geometry import shape, mapping, box
    from shapely.ops import substring
    from math import ceil
    segments, labels = [], []
    with fiona.open(source / "trails.gpkg") as layer:
        for record in layer:
            line = shape(record.geometry)
            for start in range(0, ceil(line.length), 150):
                piece = substring(line, start, min(start + 150, line.length))
                if piece.geom_type == "LineString":
                    segments.append(piece)
                    labels.append(record.properties["Name"] or "Unnamed mapped trail")
    tree = shapely.STRtree(segments)
    indices, distances = tree.query_nearest(shapely.points(xs, ys), all_matches=False, return_distance=True)
    order = np.argsort(indices[0])
    nearest = indices[1][order]
    window = box(west, south, east, north)
    paths = []
    for i, piece in enumerate(segments):
        geom = transform_geom(src.crs, "EPSG:4326", mapping(piece), precision=6)
        paths.append(feature(geom, dict(segment=i, name=labels[i], example=shape(geom).intersects(window))))
    collection("field-trails", paths)
    field_cells = np.column_stack((values, nearest, np.rint(distances[order]).astype(int)))
    dump(out / "field-cells.json", field_cells.tolist())
from shapely.geometry import shape, mapping
boundary = shape(vector("boundary")[0]["geometry"])
trails = []
for f in json.loads((source/"trails.geojson").read_text())["features"]:
    line = shape(f["geometry"]).intersection(boundary)
    if not line.is_empty and line.geom_type in ("LineString","MultiLineString"):
        trails.append(feature(mapping(line.simplify(.000045)),{}))
collection("trails",trails)
observations = []
for f in json.loads((source/"minnewaska_observations.geojson").read_text())["features"]:
    p=f["properties"]
    if p["map_include"]:
        observations.append(feature(f["geometry"], dict(date=p["observed_on"],observer=p["observer"],
          url=p["source_url"],accuracy=p["positional_accuracy_m"],color={4:"#974675",5:"#b17d09",6:"#4357a1"}[p["month"]])))
collection("observations",observations)

# Featured pair: original observation positions with Assignment 3 raster samples.
pair = []
with fiona.open(source / "observations_with_terrain.gpkg") as sampled:
    for record in sampled:
        p = record.properties
        if p["record_id"] in ("M23", "M30"):
            pair.append(dict(id=p["record_id"], coordinates=[p["longitude"], p["latitude"]],
                             date=str(p["observed_on"]), observer=p["observer"], url=p["source_url"],
                             accuracy=p["positional_accuracy_m"], elevation=round(p["elev_1"]),
                             slope=round(p["slope_1"]), bearing=round(p["aspect_1"]),
                             aspect={1:"North", 2:"South"}[p["screen_1"]]))
dump(out / "featured-pair.json", sorted(pair, key=lambda sample: sample["id"]))
