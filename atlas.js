import { relativeSunlight } from "./sunlight.js";
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
  const [map, study, detail, cells, pair, allPlants, photoIndex, trailPieces] = await Promise.all([
    host.mapReady(), dataset("boundary"), fetch("data/comparison-bounds.json").then(response => response.json()),
    fetch("data/field-cells.json").then(response => response.json()),
    fetch("data/featured-pair.json").then(response => response.json()), dataset("all-plants"),
    fetch("data/observation-photos.json").then(response=>response.json()), dataset("field-trails")
  ]);

  const forMonth = (records,month) => records.filter(f=>!month || f.properties.date.slice(5,7) === month);
  const plantLayers = ["plant-clusters","plant-counts","plant-points"];
  map.addSource("plant-records",{type:"geojson",data:allPlants,cluster:true,clusterRadius:36,clusterMaxZoom:15});
  const clusterFilter = ["has","point_count"];
  map.addLayer({id:"plant-clusters",type:"circle",source:"plant-records",filter:clusterFilter,
    layout:{visibility:"none"},paint:{"circle-color":"#374e60","circle-stroke-color":"white","circle-stroke-width":1.5,
      "circle-radius":["step",["get","point_count"],13,10,16,50,19]}});
  map.addLayer({id:"plant-counts",type:"symbol",source:"plant-records",filter:clusterFilter,
    layout:{visibility:"none","text-field":["to-string",["get","point_count"]],"text-size":12,
      "text-font":["Noto Sans Regular"],"text-allow-overlap":true,"text-ignore-placement":true},paint:{"text-color":"white"}});
  map.addLayer({id:"plant-points",type:"circle",source:"plant-records",filter:["!",clusterFilter],
    layout:{visibility:"none"},paint:{"circle-radius":6,"circle-stroke-width":1.4,"circle-stroke-color":"white",
      "circle-color":"#633752"}});
  let sourceMonth = "";
  let overviewCamera;
  let plantMarkers = [];

  const selections = new Map();
  const duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 480;
  const highlightSource = "field-trail-highlight";
  const collection = features => ({type:"FeatureCollection",features});
  const exampleTrails = trailPieces.features.filter(f=>f.properties.example);
  map.addSource(highlightSource,{type:"geojson",data:collection([])});
  for (const [suffix,color,width] of [["halo","white",6],["line","#67366e",3]]) {
    map.addLayer({id:highlightSource+"-"+suffix,type:"line",source:highlightSource,
      paint:{"line-color":color,"line-width":width},layout:{"line-cap":"round","line-join":"round"}},"plant-clusters");
  }
  // Dotted measurements show straight-line separation, independently of trail geometry.
  for (const [layer,color] of [["site-distance","#67366e"],["sighting-distance","#344a40"]]) {
    map.addSource(layer,{type:"geojson",data:collection([])});
    map.addLayer({id:layer,type:"line",source:layer,
      paint:{"line-color":color,"line-width":1.6,"line-dasharray":[1,2]}}, "plant-clusters");
  }
  const measurement = coordinates => ({type:"Feature",geometry:{type:"LineString",coordinates},properties:{}});
  function closestOnSection(point, line) {
    const scale=Math.cos(point[1]*Math.PI/180);
    let best=line[0], distance=Infinity;
    for(let i=1;i<line.length;i++){
      const a=line[i-1], b=line[i];
      const dx=(b[0]-a[0])*scale, dy=b[1]-a[1];
      const length=dx*dx+dy*dy;
      if (!length) continue;
      const t=Math.max(0,Math.min(1,((point[0]-a[0])*scale*dx+(point[1]-a[1])*dy)/length));
      const q=[a[0]+t*(b[0]-a[0]),a[1]+t*dy];
      const d=((q[0]-point[0])*scale)**2+(q[1]-point[1])**2;
      if (d<distance) {best=q;distance=d;}
    }
    return best;
  }
  let exampleActive = false;
  let sunlightShown = false;
  let notes = "";
  function updateTrails() {
    const selected = [...selections.values()].map(({cell})=>trailPieces.features[cell[7]]);
    const features = selected.length ? [...new Set(selected)] : exampleActive ? exampleTrails : [];
    map.getSource(highlightSource).setData(collection(features));
    const links=[...selections.values()].map(({cell,marker})=>{
      const start=marker.getLngLat().toArray();
      return measurement([start,closestOnSection(start,trailPieces.features[cell[7]].geometry.coordinates)]);
    });
    map.getSource("site-distance").setData(collection(links));
    id("trail-key").hidden = !features.length;
    id("trail-hint").textContent = selected.length ? "Purple highlights the nearest trail section. The dotted line measures straight-line distance to it."
      : exampleActive ? "Purple marks mapped trails in the example area. Select a teal patch and an orange patch nearby."
      : "Zoom to the trail-side example, or turn on slopes to select sites anywhere.";
    id("terrain-example").textContent = selected.length ? "Show selected sites and nearby trails" : "Zoom to slopes near trails";
  }
  function clearPicks() {
    for (const {marker} of selections.values()) marker.remove();
    selections.clear();
    exampleActive = false;
    sunlightShown = false;
    drawPicks();
  }
  function drawPicks() {
    const panel = id("picks");
    panel.replaceChildren();
    const lines=[];
    for (const [code,name] of [[1,"North"],[2,"South"]]) {
      const cell = selections.get(code)?.cell;
      const card=document.createElement("div");
      card.className="site-reading " + (code===1?"site-north":"site-south");
      const heading=document.createElement("strong");
      heading.textContent=name+" site";
      card.append(heading);
      if (cell) {
        const trail=trailPieces.features[cell[7]].properties.name;
        const metrics=cell[4]+" m elevation · "+cell[5]+"° slope · "+cell[6]+"° bearing";
        const access="Nearest trail: "+trail+" · about "+cell[8]+" m straight-line distance";
        card.append(document.createElement("br"),metrics,document.createElement("br"),access);
        lines.push(name+" site: "+(cell[1]/1e6).toFixed(6)+", "+(cell[0]/1e6).toFixed(6)+" (WGS84)",metrics,access);
      } else card.append(" · Select a "+(code===1?"teal":"orange")+" patch.");
      panel.append(card);
    }
    for (const {marker} of selections.values()) marker.getElement().querySelector(".sun-index")?.remove();
    updateTrails();
    const complete=selections.size===2;
    id("clear").hidden=selections.size===0;
    id("pair-actions").hidden=!complete;
    id("sun-result").replaceChildren();
    id("sunlight").hidden=sunlightShown;
    if (!complete) return;
    const n=selections.get(1), s=selections.get(2);
    const gap=Math.abs(n.cell[4]-s.cell[4]);
    const separation=Math.round(n.marker.getLngLat().distanceTo(s.marker.getLngLat()));
    const difference=gap+" m elevation difference · "+separation.toLocaleString()+" m apart";
    const summary=document.createElement("h3"); summary.textContent=difference; panel.append(summary);
    const prompt=document.createElement("p");
    prompt.textContent="To reduce elevation as a competing explanation, try replacing either site with a "+(gap ? "closer elevation match." : "site of similar steepness; the rounded elevations already match.");
    panel.append(prompt);
    const month=document.querySelector("[name=month]:checked").value;
    const period=({"":"April–June","04":"April","05":"May","06":"June"})[month]+" 2025";
    id("sunlight").textContent="Compare potential sunlight · "+period;
    const followup="Visit both sites over the same period. Check canopy cover, measure light, temperature and soil moisture, and record plant species and growth stage. Verify trail condition and permitted access before visiting.";
    lines.push(difference);
    if (sunlightShown) {
      const result=id("sun-result");
      const heading=document.createElement("h3");
      heading.textContent="Potential direct sunlight · "+period;
      result.append(heading);
      const scores=[relativeSunlight(n.cell,month),relativeSunlight(s.cell,month)];
      for (const [i,name] of ["North","South"].entries()) {
        const p=document.createElement("p"); p.textContent=name+" site: "+scores[i]+"% of flat-ground exposure";
        result.append(p); lines.push(period+" · "+p.textContent);
        const badge=document.createElement("span");
        badge.className="sun-index";
        badge.textContent="Sun index "+scores[i]+"%";
        selections.get(i+1).marker.getElement().append(badge);
      }
      const p=document.createElement("p");
      p.textContent="100% is level ground under the same idealized open sky. Canopy, terrain shadows and cloud are excluded. Test this prediction by measuring light at plant height at both sites.";
      result.append(p);lines.push(p.textContent);
    }
    notes=["Minnewaska · candidate field pair",...lines,followup,"Sources: USGS 3DEP, NLCD 2016 via Cornell CUGIR, historical NY State Parks trails."].join("\n");
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
    dot.textContent = (code === 1 ? "N · " : "S · ") + best[4] + " m";
    const marker = new Marker({element:dot}).setLngLat([best[0]/1e6,best[1]/1e6]).addTo(map);
    selections.set(code, {cell:best, marker});
    sunlightShown=false;
    drawPicks();
  }
  const popup = new Popup({maxWidth:"260px"});
  const preview = new Popup({closeButton:false,closeOnClick:false,focusAfterOpen:false,
    className:"observation-preview",maxWidth:"220px",offset:12});
  let hoverKey = "";
  function clearHover() {
    hoverKey = "";
    preview.remove();
  }
  function photoCard(record, hint = "") {
    const card = document.createElement("article");
    card.className = "observation-card";
    const title = document.createElement("strong");
    title.textContent = record.name || "Mountain laurel";
    card.append(title);
    if (record.scientific && record.scientific !== record.name) {
      const scientific = document.createElement("em");
      scientific.textContent = record.scientific;
      card.append(scientific);
    }
    const photo = photoIndex[record.url.split("/").pop()];
    const credit = document.createElement("small");
    if (photo) {
      const image = document.createElement("img");
      image.src = photo.src;
      image.alt = photo.reference ? "Species reference photograph of " + title.textContent
        : title.textContent + " photographed on " + record.date;
      if (photo.reference) {
        const label = document.createElement("strong");
        label.textContent = "Species reference photo · original record has no photo";
        card.append(label);
      }
      image.onerror = () => { image.hidden = true; credit.textContent = "Photo unavailable from source."; };
      credit.textContent = photo.credit;
      card.append(image,credit);
      if (!hint) {
        const source = document.createElement("a");
        source.href = "https://www.inaturalist.org/photos/" + photo.id;
        source.target = "_blank"; source.rel = "noopener"; source.textContent = "Original photo";
        card.append(source);
      }
    } else {
      credit.textContent = "No photograph in this observation.";
      card.append(credit);
    }
    const details = document.createElement("div");
    details.textContent = record.date + " · " + record.observer;
    card.append(details);
    if (record.accuracy != null) {
      const accuracy = document.createElement("small");
      accuracy.textContent = "Reported accuracy: " + record.accuracy + " m";
      card.append(accuracy);
    }
    if (hint) {
      const note = document.createElement("small");
      note.textContent = hint;
      card.append(note);
    } else {
      const link = document.createElement("a");
      link.href=record.url;link.target="_blank";link.rel="noopener";link.textContent="iNaturalist record ↗";
      card.append(link);
    }
    return card;
  }
  function pinRecords(features, coordinates) {
    clearHover();
    const records = [...new Map(features.map(f=>[f.properties.url,f.properties])).values()];
    let index = 0;
    function draw() {
      const content = photoCard(records[index]);
      if (records.length > 1) {
        const next = document.createElement("button");
        next.textContent = (index+1) + " of " + records.length + " here · Next photo →";
        next.onclick = () => { index = (index + 1) % records.length; draw(); };
        content.append(next);
      }
      popup.setDOMContent(content);
    }
    draw();
    popup.setLngLat(coordinates).addTo(map);
  }
  map.getCanvas().addEventListener("mouseleave",clearHover);
  map.on("movestart",clearHover);
  const studyExtent = bounds(study);
  function frame(animate = true) {
    map.fitBounds(studyExtent,{padding:28,duration:animate ? duration : 0});
  }
  function visible(layer, show) {
    map.setLayoutProperty(layer, "visibility", show ? "visible" : "none");
  }
  function refresh() {
    clearHover();
    const showSlopes=id("show-slopes").checked;
    visible("candidates",showSlopes);
    visible("study-boundary",showSlopes);
    visible("historical-trails",showSlopes);
    id("terrain-key").hidden=!showSlopes;
    plantLayers.forEach(layer=>visible(layer,true));
    const month = document.querySelector("[name=month]:checked").value;
    const records = forMonth(allPlants.features,month);
    if (month !== sourceMonth) {
      sourceMonth = month;
      map.getSource("plant-records").setData({type:"FeatureCollection",features:records});
    }
    const totals = new Map();
    for (const {properties} of records) {
      const name = properties.name || properties.scientific;
      totals.set(name,(totals.get(name) || 0) + 1);
    }
    const highest = Math.max(...totals.values());
    const leaders = [...totals].filter(([,count])=>count===highest).map(([name])=>name);
    id("period").textContent = "Most reported: " + leaders.join(" and ") + " (" + highest +
      (leaders.length > 1 ? " sightings each)." : " sightings).");
  }
  const photos = {
    M23:{path:"data/photos/M23.jpg",credit:"rachelgoland98",source:"https://www.inaturalist.org/photos/521611947",
      description:"Clusters of open, pale flowers sit between dark green leaves."},
    M30:{path:"data/photos/M30.jpg",credit:"Courtney Kelly Jett",source:"https://www.inaturalist.org/photos/528767985",
      description:"Pink buds and open flowers share a cluster beside the observer’s hand."}
  };
  function showRecords() {
    for (const record of pair) {
      const photo = photos[record.id];
      const date = new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",timeZone:"UTC"}).format(new Date(record.date));
      const openPhoto = () => {
        id("photo-heading").textContent = "Mountain laurel · " + date + ", 2025";
        id("full-photo").src = photo.path; id("full-photo").alt = photo.description;
        id("photo-caption").textContent = photo.description;
        id("photo-source").href = photo.source;
        id("photo-source").textContent = "Photograph © " + photo.credit;
        clearHover();
        id("photo-dialog").showModal();
      };
      const pin = document.createElement("button");
      pin.className = "record-pin " + record.aspect.toLowerCase();
      pin.setAttribute("aria-label", "Enlarge " + date + " photograph, " + record.id);
      const thumb = document.createElement("img");
      thumb.src = photo.path; thumb.alt = "";
      const label = document.createElement("span");
      label.textContent = record.aspect + "-facing · " + record.elevation + " m";
      const metadata=document.createElement("small");
      metadata.textContent=date+" · "+record.slope+"° slope";
      pin.append(thumb,label,metadata);
      pin.addEventListener("pointerenter",event=>{
        if (event.pointerType !== "mouse") return;
        const content = document.createElement("article");
        content.className = "observation-card";
        const picture = document.createElement("img"), caption=document.createElement("small");
        picture.src=photo.path; picture.alt=photo.description;
        caption.textContent=date+" · © "+photo.credit+" · CC BY-NC";
        content.append(picture,caption);
        preview.setLngLat(record.coordinates).setDOMContent(content).addTo(map);
      });
      pin.addEventListener("pointerleave",clearHover);
      pin.onclick = event => {event.stopPropagation();openPhoto();};
      plantMarkers.push(new Marker({element:pin,anchor:"bottom"}).setLngLat(record.coordinates).addTo(map));
    }
    const midpoint=pair[0].coordinates.map((v,i)=>(v+pair[1].coordinates[i])/2);
    const distance=document.createElement("span");
    distance.className="pair-distance"; distance.textContent="224 m apart";
    plantMarkers.push(new Marker({element:distance}).setLngLat(midpoint).addTo(map));
  }
  function fitCoordinates(coords, padding, maxZoom) {
    const xs=coords.map(p=>p[0]),ys=coords.map(p=>p[1]);
    map.stop();
    map.resize();
    map.fitBounds([[Math.min(...xs),Math.min(...ys)],[Math.max(...xs),Math.max(...ys)]],
      {padding,maxZoom,bearing:0,pitch:0,duration,linear:true});
  }
  function closeComparison(restore) {
    if (!plantMarkers.length) return;
    for (const marker of plantMarkers) marker.remove();
    plantMarkers=[];
    map.getSource("sighting-distance").setData(collection([]));
    clearHover();
    id("back").hidden=true;
    if (restore && overviewCamera) map.easeTo({...overviewCamera,duration});
  }
  function comparePhotos() {
    if (plantMarkers.length) {closeComparison(true);return;}
    map.stop();
    overviewCamera={center:map.getCenter().toArray(),zoom:map.getZoom(),pitch:map.getPitch(),bearing:map.getBearing()};
    id("show-slopes").checked=true;refresh();
    popup.remove();clearHover();showRecords();
    map.getSource("sighting-distance").setData(collection([measurement(pair.map(r=>r.coordinates))]));
    id("back").hidden=false;
    fitCoordinates(pair.map(r=>r.coordinates),{top:140,bottom:45,left:84,right:84},17);
  }
  id("back").onclick=()=>closeComparison(true);
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape" && !id("photo-dialog").open) closeComparison(true);
  });
  id("show-slopes").onchange=refresh;
  id("terrain-example").onclick=()=>{
    id("show-slopes").checked=true;refresh();
    closeComparison(false);
    clearHover();popup.remove();
    exampleActive=true;
    updateTrails();
    if (selections.size) {
      const coords=[...selections.values()].flatMap(({cell,marker})=>[
        marker.getLngLat().toArray(),...trailPieces.features[cell[7]].geometry.coordinates]);
      const canvas=map.getCanvas();
      const margin=Math.round(Math.min(canvas.clientWidth,canvas.clientHeight)*0.12);
      fitCoordinates(coords,Math.max(38,Math.min(90,margin)),17);
    } else fitCoordinates(detail,28,16);
    if (matchMedia("(max-width:760px)").matches) document.querySelector(".canvas").scrollIntoView({block:"start"});
  };
  id("sunlight").onclick=()=>{sunlightShown=true;drawPicks();id("terrain-example").click();};
  id("field-notes").onclick=()=>{
    const url=URL.createObjectURL(new Blob([notes],{type:"text/plain;charset=utf-8"}));
    const link=document.createElement("a");link.href=url;link.download="Minnewaska-field-pair.txt";
    link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
  };
  id("month-picker").onchange=()=>{ popup.remove(); refresh(); drawPicks(); };
  id("clear").onclick=clearPicks;
  id("reset").onclick=()=>{closeComparison(false);frame();};

  map.on("click",async event=>{
    const hits = map.queryRenderedFeatures(event.point,{layers:["plant-clusters","plant-points","candidates"]});
    const cluster = hits.find(f=>f.layer.id==="plant-clusters");
    if (cluster) {
      const zoom = await map.getSource("plant-records").getClusterExpansionZoom(cluster.properties.cluster_id);
      map.easeTo({center:cluster.geometry.coordinates,zoom,duration});
      return;
    }
    const pointHit = hits.find(f=>f.layer.id==="plant-points");
    if (pointHit) {
      const box=[[event.point.x-3,event.point.y-3],[event.point.x+3,event.point.y+3]];
      pinRecords(map.queryRenderedFeatures(box,{layers:[pointHit.layer.id]}),pointHit.geometry.coordinates);
      return;
    }
    const slope = hits.find(f=>f.layer.id==="candidates");
    if (slope) {
      pick(event.lngLat,slope);
    }
  });
  map.on("mousemove",async event=>{
    const layers = ["plant-points","plant-clusters"];
    layers.push("candidates");
    const hits = map.queryRenderedFeatures(event.point,{layers});
    map.getCanvas().style.cursor = hits.length ? "pointer" : "";
    const hit = hits.find(f=>["plant-points","plant-clusters"].includes(f.layer.id));
    if (!hit || popup.isOpen() || event.originalEvent.buttons) { clearHover(); return; }
    const group = hit.layer.id === "plant-clusters";
    const key = group ? "group-" + hit.properties.cluster_id : hit.properties.url;
    if (key === hoverKey) return;
    clearHover();
    hoverKey = key;
    let record = hit.properties;
    if (group) {
      try {
        const [leaf] = await map.getSource("plant-records").getClusterLeaves(hit.properties.cluster_id,1,0);
        if (hoverKey !== key || !leaf) return;
        record = leaf.properties;
      } catch { return; }
    }
    const hint = group ? "One of " + hit.properties.point_count + " observations · Click to expand"
      : "Click to keep this photograph open.";
    preview.setLngLat(hit.geometry.coordinates).setDOMContent(photoCard(record,hint)).addTo(map);
  });
  map.moveLayer("candidates","road_area_pattern");
  drawPicks();refresh();frame(false);
  if (["#records","#reveal"].includes(location.hash)) comparePhotos();
  if (location.hash === "#slopes") id("terrain-example").click();
  id("status").textContent="";
}
start().catch(error=>{id("status").textContent="Map could not load. Refresh using a WebGL-enabled browser.";console.error(error);});
