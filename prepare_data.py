"""Rebuild web layers using the Assignment 3 analysis and Part 1 style."""
import json
from pathlib import Path

import fiona
import numpy as np
import rasterio
from PIL import Image
from rasterio.features import shapes
from rasterio.warp import calculate_default_transform, reproject, transform_geom, transform_bounds

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
    dump(out / "candidate-cells.json", values.tolist())
    dst,w,h = calculate_default_transform(src.crs,"EPSG:3857",src.width,src.height,*src.bounds)
    def warp(arr):
        result = np.zeros((h,w),dtype="uint8")
        reproject(arr,result,src_transform=src.transform,src_crs=src.crs,dst_transform=dst,dst_crs="EPSG:3857")
        return result
    with rasterio.open(source/"hillshade.tif") as hs:
        light = np.clip(1+(warp(hs.read(1)).astype(float)-175)/420,0.62,1.16)
    cover = warp(classes)
    colors = np.array([[0,0,0]]+[[185,199,194]]*3+[[218,211,191],[137,178,197]])
    rgba = np.dstack([np.clip(colors[cover]*light[:,:,None],0,255),(cover>0)*255]).astype("uint8")
    Image.fromarray(rgba).save(out/"relief.png")
    from rasterio.transform import array_bounds
    west,south,east,north = transform_bounds("EPSG:3857","EPSG:4326",*array_bounds(h,w,dst))
style = json.loads((root.parent/"interactive_mapping_part_1/style.json").read_text())
style["name"]="Minnewaska | Terrain survey"
style["sources"]["study-relief"]=dict(type="image",url="./data/relief.png",
    coordinates=[[west,north],[east,north],[east,south],[west,south]])
index = next(i for i,l in enumerate(style["layers"]) if l["type"]=="symbol")
style["layers"].insert(index,dict(id="study-relief",type="raster",source="study-relief",paint={"raster-opacity":0.93}))
dump(root/"style.json",style)
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
