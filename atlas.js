import { Popup } from "maplibre-gl";
import "./vendor/register.browser.js";

const id = key => document.getElementById(key);
const host = document.querySelector("ml-map");
const coordinates = geo => geo.features[0].geometry.coordinates.flat(Infinity);
function bounds(geo) {
  const points = coordinates(geo);
  const xs = points.filter((_, i) => i % 2 === 0);
  const ys = points.filter((_, i) => i % 2 === 1);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
}
async function dataset(name) {
  const response = await fetch("data/" + name + ".geojson");
  if (!response.ok) throw Error(name + " could not load");
  return response.json();
}
async function start() {
  const [map, study, detail, observations] = await Promise.all([
    host.mapReady(), dataset("boundary"), dataset("creative_lens_footprint"), dataset("observations")
  ]);
  let comparing = false;
  const popup = new Popup({maxWidth:"260px"});
  const extents = [bounds(study), bounds(detail)];
  function frame(animate = true) {
    map.fitBounds(extents[Number(comparing)], {padding:28, duration:
      animate && !matchMedia("(prefers-reduced-motion: reduce)").matches ? 650 : 0});
  }
  function visible(layer, show) {
    map.setLayoutProperty(layer, "visibility", show ? "visible" : "none");
  }
  function refresh() {
    const aspect = document.querySelector("[name=aspect]:checked").value;
    const near = id("near").checked;
    const filter = ["all"];
    if (aspect !== "both") filter.push(["==", ["get","aspect"], aspect]);
    if (near) filter.push(["==", ["get","near"], true]);
    map.setFilter("candidates",filter.length > 1 ? filter : null);
    visible("candidates", comparing);
    visible("detail-window", !comparing);
    visible("historical-trails", id("trails").checked);
    visible("laurel", id("observations").checked);
    id("months").hidden = !id("observations").checked;
    if (!id("observations").checked) popup.remove();
    id("bars").replaceChildren();
    for (const [name, color, area] of [["North","#275ca4",near?191:854],["South","#d87e32",near?211:893]]) {
      if (aspect !== "both" && name !== aspect) continue;
      const row = document.createElement("div");
      row.className="bar";
      const bar = document.createElement("i");
      bar.style.background=color;
      bar.style.width=(area/893*100)+"%";
      row.append(name,bar,area+" ha");
      id("bars").append(row);
    }
  }
  function view(compare) {
    comparing = compare;
    id("heading").textContent=compare?"Opposing slopes":"Reading the ridge";
    id("intro").textContent=compare?"Compare north- and south-facing forest on slopes of at least 10°. Hold the view steady to see where aspect changes along the same ridge.":"Trace the relief beneath the forest canopy. The dashed blue ring marks a place where opposing slopes meet near historical trails.";
    id("land-tools").hidden=compare;
    id("slope-tools").hidden=!compare;
    id("landscape").setAttribute("aria-pressed",String(!compare));
    id("compare").setAttribute("aria-pressed",String(compare));
    refresh(); frame();
  }
  id("compare").onclick=id("explore").onclick=()=>view(true);
  id("landscape").onclick=()=>view(false);
  id("reset").onclick=()=>frame();
  document.querySelectorAll("aside input").forEach(el=>el.onchange=refresh);
  map.on("click","detail-window",()=>view(true));
  map.on("click","laurel",event=>{
    const content=document.createElement("div");
    const title=document.createElement("strong"); title.textContent="Mountain laurel";content.append(title);
    const hits=map.queryRenderedFeatures([[event.point.x-5,event.point.y-5],[event.point.x+5,event.point.y+5]],{layers:["laurel"]});
    const urls=new Set(hits.map(hit=>hit.properties.url));
    for (const {properties:p} of observations.features.filter(f=>urls.has(f.properties.url))) {
      const row=document.createElement("p"), link=document.createElement("a");
      link.href=p.url;link.target="_blank";link.rel="noopener";link.textContent="iNaturalist record";
      row.append(p.date+" · "+p.observer,document.createElement("br"),p.accuracy==null?"Accuracy unreported":"Reported accuracy: "+p.accuracy+" m",document.createElement("br"),link);
      content.append(row);
    }
    popup.setLngLat(event.lngLat).setDOMContent(content).addTo(map);
  });
  map.on("moveend",()=>{
    const c=map.getCenter();
    id("location").textContent=c.lat.toFixed(3)+"° N · "+Math.abs(c.lng).toFixed(3)+"° W";
  });
  refresh();frame(false);id("status").textContent="";
}
start().catch(error=>{id("status").textContent="Map could not load. Refresh using a WebGL-enabled browser.";console.error(error);});
