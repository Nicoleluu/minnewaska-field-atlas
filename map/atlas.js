const map = L.map("map", {zoomSnap:0.1, zoomDelta:0.5, maxZoom:16, minZoom:9, attributionControl:false});
L.control.scale({imperial:false}).addTo(map);
const byId = id => document.getElementById(id);
const outline = L.geoJSON(geography.boundary,{style:{color:"#4e6959",weight:1.4,fill:false},interactive:false}).addTo(map);
const trailLines = L.geoJSON(geography.trails,{style:{color:"#5e5546",weight:1.25,dashArray:"4 3",opacity:0.8},interactive:false});
const lens = L.geoJSON(geography.lens,{style:{color:"#925822",weight:2,dashArray:"6 4",fillOpacity:0.05}}).bindTooltip("Explore the comparison area");
const raster = name => L.imageOverlay("data/"+name+".png",geography.bounds,{interactive:false});
raster("terrain").addTo(map);
const candidates = {};
for(const name of ["north","south","north-near","south-near"]) candidates[name]=raster(name);
const records = L.layerGroup();
for (const [location, visits] of observationSites) {
  const popup = document.createElement("div");
  const heading = document.createElement("strong");
  heading.textContent = "Mountain laurel";
  popup.append(heading);
  for (const visit of visits) {
    const entry = document.createElement("p");
    const link = document.createElement("a");
    link.href = visit.source_url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "View iNaturalist record";
    const accuracy = visit.positional_accuracy_m;
    entry.append(visit.observed_on + " · " + visit.observer, document.createElement("br"),
      accuracy == null ? "Location accuracy unreported" : "Reported accuracy: " + accuracy + " m",
      document.createElement("br"), link);
    popup.append(entry);
  }
  L.circleMarker(location, {radius:5, stroke:true, weight:1.4, color:"white",
    fillColor:"#85365d",fillOpacity:1}).bindPopup(popup).addTo(records);
}
let comparing = false;
function frame() {
  map.fitBounds((comparing ? lens : outline).getBounds(),{padding:[20,20],animate:false});
}
function draw(){
  const aspect = document.querySelector("[name=aspect]:checked").value;
  const close = byId("near").checked;
  Object.values(candidates).forEach(layer=>layer.remove());
  const key = [["#adc19f","Forest, 2016"],["#e0d7b8","Other land cover"],["#84b5c1","Open water"]];
  const totals = [];
  for(const [direction,color,all,near] of [["north","#216b64",854,191],["south","#ad502e",893,211]]){
    if(comparing && (aspect==="both" || aspect===direction)){
      candidates[direction+(close?"-near":"")].addTo(map);
      key.unshift([color,direction==="north"?"North-facing candidate":"South-facing candidate"]);
      totals.push((close?near:all)+" ha "+direction+"-facing");
    }
  }
  if(comparing) lens.remove(); else {lens.addTo(map);key.push(["#925822","Dashed ring · comparison area"]);}
  if(byId("trails").checked){trailLines.addTo(map);key.push(["#5e5546","Dashed line · historical trail"]);}else trailLines.remove();
  const showRecords = byId("observations").checked;
  byId("recordNote").hidden = !showRecords;
  if (showRecords) {
    records.addTo(map);
    records.eachLayer(marker => marker.bringToFront());
    key.push(["#85365d","Mountain-laurel observation"]);
  } else records.remove();
  byId("area").textContent="Across the study area: "+totals.join(" · ")+".";
  byId("key").replaceChildren(...key.map(([color,text])=>{
    const row=document.createElement("li"), swatch=document.createElement("i");
    swatch.className="swatch";swatch.style.background=color;
    row.append(swatch,text);return row;
  }));
}
function setView(compare){
  comparing=compare;
  byId("overview").setAttribute("aria-pressed",String(!compare));
  byId("comparison").setAttribute("aria-pressed",String(compare));
  byId("title").textContent=compare?"Two sides of the same mountain.":"A little shelter, somewhere.";
  byId("intro").textContent=compare?"Compare forested slopes of at least 10° around the atlas detail area. Opposing aspects offer places to investigate differences in exposure. Field measurements would establish how conditions differ.":"Where could terrain and forest cover create different growing conditions for plants? Explore the ridges of Minnewaska, then look closer at two slopes that face different directions.";
  byId("overviewTools").hidden=compare;byId("comparisonTools").hidden=!compare;
  byId("caption").textContent="Minnewaska · "+(compare?"Slope comparison":"Landscape");
  draw();frame();
}
byId("overview").onclick=()=>setView(false);
byId("comparison").onclick=byId("explore").onclick=()=>setView(true);
lens.on("click",()=>setView(true));
byId("reset").onclick=frame;
document.querySelectorAll("aside input").forEach(input=>input.addEventListener("change",draw));
setView(false);
