import { Popup, Marker } from "maplibre-gl";
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
  const [map, study, detail, observations, cells] = await Promise.all([
    host.mapReady(), dataset("boundary"), dataset("creative_lens_footprint"), dataset("observations"),
    fetch("data/candidate-cells.json").then(response => response.json())
  ]);
  let comparing = false;
  let landscapeCamera;
  let localCenter;
  const initialIntro = id("intro").textContent;
  const selections = new Map();
  const duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 480;
  function clearPicks() {
    for (const {marker} of selections.values()) marker.remove();
    selections.clear();
    drawPicks();
  }
  function drawPicks() {
    const panel = id("picks");
    panel.replaceChildren();
    const describe = text => {
      const line = document.createElement("p");
      line.textContent = text;
      panel.append(line);
    };
    for (const [code, name] of [[1,"North"], [2,"South"]]) {
      const sample = selections.get(code)?.cell;
      describe(sample ? name + " · " + sample[4] + " m elevation · " + sample[5] +
        "° slope · bearing " + sample[6] + "° · " + (sample[3] ? "within" : "beyond") + " 100 m of trails"
        : "Select a " + name.toLowerCase() + "-facing slope.");
    }
    if (selections.size === 2) {
      const n = selections.get(1), s = selections.get(2);
      const separation = Math.round(n.marker.getLngLat().distanceTo(s.marker.getLngLat()));
      describe(separation.toLocaleString() + " m apart · " + Math.abs(n.cell[4]-s.cell[4]) + " m elevation difference.");
    }
    id("clear").hidden = selections.size === 0;
  }
  function pick(point, feature) {
    const code = feature.properties.aspect === "North" ? 1 : 2;
    const near = Number(feature.properties.near === true);
    const lonScale = Math.cos(point.lat * Math.PI / 180);
    let best, distance = Infinity;
    for (const cell of cells) {
      if (cell[2] !== code || cell[3] !== near) continue;
      const dx = (cell[0] / 1e6 - point.lng) * lonScale;
      const dy = cell[1] / 1e6 - point.lat;
      if (dx*dx + dy*dy < distance) {
        distance = dx*dx + dy*dy;
        best = cell;
      }
    }
    if (!best) return;
    selections.get(code)?.marker.remove();
    const dot = document.createElement("span");
    dot.className = "pick " + (code === 1 ? "north" : "south");
    dot.textContent = code === 1 ? "N" : "S";
    const marker = new Marker({element:dot}).setLngLat([best[0]/1e6,best[1]/1e6]).addTo(map);
    selections.set(code, {cell:best, marker});
    drawPicks();
  }
  const popup = new Popup({maxWidth:"260px"});
  const extents = [bounds(study), bounds(detail)];
  function frame(animate = true) {
    if (comparing && localCenter) {
      map.easeTo({center:localCenter, zoom:14, bearing:0, pitch:0, duration:animate ? duration : 0});
      return;
    }
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
  function view(compare, center = null) {
    if (compare === comparing) return;
    map.stop();
    if (compare) {
      landscapeCamera = {center:map.getCenter(), zoom:map.getZoom(), bearing:map.getBearing(), pitch:map.getPitch()};
      localCenter = center;
    }
    comparing = compare;
    popup.remove();
    clearPicks();
    id("back").hidden = !compare;
    id("heading").textContent=compare?"Opposing slopes":"Reading the ridge";
    id("intro").textContent=compare?"Select a blue north-facing slope and an orange south-facing slope. Compare their elevation and steepness, then try a different pair. Each selection samples a 30 m forest cell.":initialIntro;
    id("land-tools").hidden=compare;
    id("slope-tools").hidden=!compare;
    id("landscape").setAttribute("aria-pressed",String(!compare));
    id("compare").setAttribute("aria-pressed",String(compare));
    refresh();
    if (compare) frame(); else map.easeTo({...landscapeCamera, duration});
    if (matchMedia("(max-width:760px)").matches) document.querySelector(".canvas").scrollIntoView({block:"start"});
  }
  function enter(center = null) {
    if (comparing) return;
    history.pushState({atlasDetail:true}, "", "#slopes");
    view(true, center);
    id("back").focus({preventScroll:true});
  }
  function leave() {
    if (!comparing) return;
    if (history.state?.atlasDetail) history.back();
    else {history.replaceState(null, "", location.pathname+location.search);view(false);}
  }
  window.addEventListener("popstate", () => {
    view(location.hash === "#slopes", localCenter);
    if (!comparing) id("explore").focus({preventScroll:true});
  });
  document.addEventListener("keydown", event => { if(event.key === "Escape" && comparing) leave(); });
  id("compare").onclick=id("explore").onclick=()=>enter();
  id("back").onclick=id("landscape").onclick=leave;
  id("clear").onclick=clearPicks;
  id("reset").onclick=()=>frame();
  document.querySelectorAll("aside input").forEach(el=>el.onchange=refresh);
  map.on("click",event=>{
    const hits = map.queryRenderedFeatures(event.point,{layers:["laurel","candidates","study-hit-area"]});
    if (hits.some(f=>f.layer.id==="laurel")) return;
    if (comparing) {
      const slope = hits.find(f=>f.layer.id==="candidates");
      if (slope) pick(event.lngLat, slope);
    } else if (hits.some(f=>f.layer.id==="study-hit-area")) enter(event.lngLat);
  });
  map.on("mousemove",event=>{
    const layers = [comparing ? "candidates" : "study-hit-area","laurel"];
    map.getCanvas().style.cursor = map.queryRenderedFeatures(event.point,{layers}).length ? "pointer" : "";
  });
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
  refresh();frame(false);
  if (location.hash === "#slopes") view(true);
  id("status").textContent="";
}
start().catch(error=>{id("status").textContent="Map could not load. Refresh using a WebGL-enabled browser.";console.error(error);});
