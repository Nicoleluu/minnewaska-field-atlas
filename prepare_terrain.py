"""Export portable Leaflet layers from the Assignment 3 analysis."""
import json
from pathlib import Path

import fiona
import numpy as np
import rasterio
from PIL import Image
from rasterio.transform import array_bounds
from rasterio.warp import calculate_default_transform, reproject, transform_bounds
from shapely.geometry import mapping, shape

root = Path(__file__).resolve().parent
source = root.parent / "spatial_relatedness" / "data"
out = root / "map" / "data"
with rasterio.open(source / "screening_classes.tif") as grid:
    dest, width, height = calculate_default_transform(
        grid.crs, "EPSG:3857", grid.width, grid.height, *grid.bounds
    )

def read_grid(name):
    with rasterio.open(source / f"{name}.tif") as layer:
        arr = np.zeros((height, width), dtype=np.uint8)
        reproject(rasterio.band(layer, 1), arr, dst_transform=dest,
                  dst_crs="EPSG:3857", resampling=rasterio.enums.Resampling.nearest)
        return arr

def leaflet_bounds(bounds):
    west, south, east, north = bounds
    return [[south, west], [north, east]]

classes = read_grid("screening_classes")
shade = read_grid("hillshade").astype(float)
near = read_grid("trail_near") > 0
palette = np.array([[0,0,0], [173,193,159], [173,193,159], [173,193,159],
                    [224,215,184], [132,181,193]])
relief = np.clip(1 + (shade - 175) / 380, 0.60, 1.22)
base = np.clip(palette[classes] * relief[:,:,None], 0, 255)
Image.fromarray(np.dstack([base, 255*(classes>0)]).astype("uint8")).save(out/"terrain.png")
for code, name, rgb in [(1,"north",[33,107,100]),(2,"south",[173,80,46])]:
    for suffix, mask in [("",classes==code),("-near",(classes==code)&near)]:
        rgba = np.zeros((height,width,4), dtype="uint8")
        rgba[mask] = rgb + [255]
        Image.fromarray(rgba).save(out/f"{name}{suffix}.png")

def geometry(name):
    with fiona.open(source / f"{name}.gpkg") as layer:
        from rasterio.warp import transform_geom
        return transform_geom(layer.crs, "EPSG:4326", next(iter(layer))["geometry"], precision=6)

boundary = geometry("boundary")
lens = geometry("creative_lens_footprint")
region = shape(boundary)
trails = []
for feature in json.loads((source/"trails.geojson").read_text())["features"]:
    line = shape(feature["geometry"]).intersection(region)
    if not line.is_empty and line.geom_type in ("MultiLineString","LineString"):
        trails.append(mapping(line.simplify(0.00005)))
bounds = transform_bounds("EPSG:3857","EPSG:4326",*array_bounds(height,width,dest))
data = dict(bounds=leaflet_bounds(bounds), boundary=boundary, lens=lens,
            trails=dict(type="GeometryCollection",geometries=trails))
(out/"geography.js").write_text("const geography = "+json.dumps(data,separators=(",",":"))+";\n")
