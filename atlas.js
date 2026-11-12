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
  const [map, study, detail, observations, cells, pair] = await Promise.all([
    host.mapReady(), dataset("boundary"), fetch("data/comparison-bounds.json").then(response => response.json()), dataset("observations"),
    fetch("data/candidate-cells.json").then(response => response.json()),
    fetch("data/featured-pair.json").then(response => response.json())
  ]);
  let mode = "landscape";
  let localCenter;
  let plantMarkers = [];
  const guided = () => mode === "records" || mode === "reveal";
  const sampling = () => mode === "slopes" || mode === "explore";
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
  const extents = [bounds(study), detail];
  function frame(animate = true) {
    if (guided() || mode === "explore") {
      const positions = guided() ? pair.map(record=>record.coordinates)
        : observations.features.map(record=>record.geometry.coordinates);
      const bbox = positions.reduce(([lo,hi],[x,y])=>[
        [Math.min(lo[0],x), Math.min(lo[1],y)], [Math.max(hi[0],x), Math.max(hi[1],y)]
      ], [[Infinity,Infinity],[-Infinity,-Infinity]]);
      map.fitBounds(bbox,{padding:60,maxZoom:16,duration:animate ? duration : 0});
      return;
    }
    if (mode === "slopes" && localCenter) {
      map.easeTo({center:localCenter, zoom:14, bearing:0, pitch:0, duration:animate ? duration : 0});
      return;
    }
    map.fitBounds(extents[Number(mode === "slopes")], {padding:28, duration:
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
    map.setFilter("candidates",!guided() && filter.length > 1 ? filter : null);
    const showSlopes = sampling() || mode === "reveal";
    visible("candidates", showSlopes);
    id("north-key").hidden = !showSlopes || (!guided() && aspect === "South");
    id("south-key").hidden = !showSlopes || (!guided() && aspect === "North");

    visible("historical-trails", id("trails").checked);
    visible("laurel", !guided() && id("observations").checked);
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
  function showRecords() {
    id("records").replaceChildren();
    for (const record of pair) {
      const revealed = mode === "reveal";
      const pin = document.createElement("span");
      pin.className = "record-pin" + (revealed ? " " + record.aspect.toLowerCase() : "");
      pin.textContent = record.id;
      plantMarkers.push(new Marker({element:pin}).setLngLat(record.coordinates).addTo(map));
      const card = document.createElement("article");
      card.className = "sample-record";
      const title = document.createElement("h2"), data = document.createElement("p"), link = document.createElement("a");
      title.textContent = record.id + " · " + record.date;
      data.textContent = record.elevation + " m elevation · " +
        (record.accuracy == null ? "Location accuracy unreported" : "Reported accuracy ±" + record.accuracy + " m");
      link.href = record.url; link.target = "_blank"; link.rel = "noopener";
      link.textContent = record.observer + " on iNaturalist ↗";
      card.append(title,data,link);
      if (revealed) {
        const reading = document.createElement("p");
        reading.textContent = record.aspect + "-facing · " + record.slope + "° slope · bearing " + record.bearing + "°";
        card.append(reading);
      }
      id("records").append(card);
    }
  }
  const titles = {landscape:"Reading the ridge", slopes:"Opposing slopes", records:"Two mountain laurels",
    reveal:"Across the ridge", explore:"Explore the observations"};
  const descriptions = {landscape:initialIntro,
    slopes:"Select a blue north-facing slope and an orange south-facing slope. Compare their elevation and steepness, then try a different pair. Each selection samples a 30 m forest cell.",
    records:"Two observers recorded mountain laurel 224 m apart. Their mapped elevations differ by just 4 m. How does the ground beneath them differ?",
    reveal:"M23 sits on a north-facing forest cell and M30 on a south-facing one. The colors show where those settings continue around the two records.",
    explore:"Explore all 34 observations. Select a point for its field record, or choose a blue and an orange slope to compare terrain. Some slopes have no nearby observations."};
  function render(next, camera) {
    const previous = mode;
    map.stop();
    mode = next;
    popup.remove(); clearPicks();
    plantMarkers.forEach(marker=>marker.remove());
    plantMarkers = [];
    id("heading").textContent=titles[mode];
    id("intro").textContent=descriptions[mode];
    id("land-tools").hidden=mode !== "landscape";
    id("slope-tools").hidden=!sampling();
    id("plants").hidden=guided() || mode === "explore";
    id("plant-story").hidden=!guided();
    id("layers").hidden=guided();
    id("back").hidden=mode === "landscape";
    const parent = history.state?.parent || "landscape";
    id("back").textContent = "← Back to " + ({landscape:"landscape",slopes:"slope comparison",
      records:"observations",reveal:"slope reveal",explore:"exploration"}[parent]);
    id("landscape").setAttribute("aria-pressed",String(mode === "landscape"));
    id("compare").setAttribute("aria-pressed",String(mode === "slopes"));
    if (guided()) {
      showRecords();
      id("study-note").hidden=mode !== "reveal";
      id("next-stage").textContent=mode === "records" ? "Reveal slope aspects" : "Explore all observations";
    }
    if (mode === "explore" && previous !== mode) {
      id("observations").checked=true;
      id("near").checked=false;
      document.querySelector("[value=both]").checked=true;
    }
    refresh();
    if (camera) map.jumpTo(camera);
    else if (!(mode === "reveal" && previous === "records")) frame(previous !== next);
    if (matchMedia("(max-width:760px)").matches) document.querySelector(".canvas").scrollIntoView({block:"start"});
  }
  function navigate(next, center = null) {
    if (next === mode) return;
    const camera = {center:map.getCenter().toArray(),zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()};
    history.replaceState({...history.state,camera}, "");
    history.pushState({parent:mode,center}, "", location.pathname + location.search + (next === "landscape" ? "" : "#" + next));
    localCenter = center;
    render(next);
  }
  function leave() {
    if (mode === "landscape") return;
    if (history.state?.parent) history.back();
    else navigate("landscape");
  }
  function currentRoute() {
    const route = location.hash.slice(1);
    return Object.hasOwn(titles,route) ? route : "landscape";
  }
  window.addEventListener("popstate", () => {
    localCenter = history.state?.center;
    render(currentRoute(),history.state?.camera);
  });
  document.addEventListener("keydown", event => { if(event.key === "Escape") leave(); });
  id("plants").onclick=()=>navigate("records");
  id("next-stage").onclick=()=>navigate(mode === "records" ? "reveal" : "explore");
  id("compare").onclick=id("explore").onclick=()=>navigate("slopes");
  id("back").onclick=leave;
  id("landscape").onclick=()=>history.state?.parent === "landscape" ? leave() : navigate("landscape");
  id("clear").onclick=clearPicks;
  id("reset").onclick=()=>frame();
  document.querySelectorAll("aside input").forEach(el=>el.onchange=refresh);
  map.on("click",event=>{
    if (guided()) return;
    const hits = map.queryRenderedFeatures(event.point,{layers:["laurel","candidates","study-hit-area"]});
    if (hits.some(f=>f.layer.id==="laurel")) return;
    if (sampling()) {
      const slope = hits.find(f=>f.layer.id==="candidates");
      if (slope) pick(event.lngLat, slope);
    } else if (hits.some(f=>f.layer.id==="study-hit-area")) navigate("slopes",event.lngLat.toArray());
  });
  map.on("mousemove",event=>{
    const layers = [sampling() ? "candidates" : "study-hit-area","laurel"];
    map.getCanvas().style.cursor = !guided() && map.queryRenderedFeatures(event.point,{layers}).length ? "pointer" : "";
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
  localCenter = history.state?.center;
  render(currentRoute(),history.state?.camera);
  id("status").textContent="";
}
start().catch(error=>{id("status").textContent="Map could not load. Refresh using a WebGL-enabled browser.";console.error(error);});
