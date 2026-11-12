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
  const [map, study, detail, observations, cells, pair, allPlants, photoIndex] = await Promise.all([
    host.mapReady(), dataset("boundary"), fetch("data/comparison-bounds.json").then(response => response.json()), dataset("observations"),
    fetch("data/candidate-cells.json").then(response => response.json()),
    fetch("data/featured-pair.json").then(response => response.json()), dataset("all-plants"),
    fetch("data/observation-photos.json").then(response=>response.json())
  ]);
  let mode = "landscape";
  const allScope = () => mode === "explore" && id("scope").value === "all";
  const activeRecords = () => (allScope() ? allPlants : observations).features;
  const forMonth = (records,month) => records.filter(f=>!month || f.properties.date.slice(5,7) === month);
  const plantLayers = ["plant-clusters","plant-counts","plant-points"];
  map.addSource("plant-records",{type:"geojson",data:allPlants,cluster:true,clusterRadius:36,clusterMaxZoom:15});
  const clusterFilter = ["has","point_count"];
  map.addLayer({id:"plant-clusters",type:"circle",source:"plant-records",filter:clusterFilter,
    layout:{visibility:"none"},paint:{"circle-color":"#374e60","circle-stroke-color":"white","circle-stroke-width":1.5,
      "circle-radius":["step",["get","point_count"],13,10,16,50,19]}});
  map.addLayer({id:"plant-counts",type:"symbol",source:"plant-records",filter:clusterFilter,
    layout:{visibility:"none","text-field":["to-string",["get","point_count"]],"text-size":12,
      "text-font":["Roboto Regular"],"text-allow-overlap":true,"text-ignore-placement":true},paint:{"text-color":"white"}});
  map.addLayer({id:"plant-points",type:"circle",source:"plant-records",filter:["!",clusterFilter],
    layout:{visibility:"none"},paint:{"circle-radius":6,"circle-stroke-width":1.4,"circle-stroke-color":"white",
      "circle-color":["match",["slice",["get","date"],5,7],"04","#974675","05","#b17d09","#4357a1"]}});
  let sourceMonth = "";
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
  const extents = [bounds(study), detail];
  function frame(animate = true) {
    if (guided() || mode === "explore") {
      const positions = guided() ? pair.map(record=>record.coordinates)
        : forMonth(activeRecords(),id("month").value).map(record=>record.geometry.coordinates);
      const bbox = positions.reduce(([lo,hi],[x,y])=>[
        [Math.min(lo[0],x), Math.min(lo[1],y)], [Math.max(hi[0],x), Math.max(hi[1],y)]
      ], [[Infinity,Infinity],[-Infinity,-Infinity]]);
      map.fitBounds(bbox,{padding:guided() ? {top:132,bottom:32,left:59,right:59} : 60,maxZoom:16,duration:animate ? duration : 0});
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
    clearHover();
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
    const all = allScope();
    id("scope-control").hidden = mode !== "explore";
    id("obs-label").textContent = all ? "Plant observations" : "Mountain-laurel records";
    visible("laurel", !all && !guided() && id("observations").checked);
    plantLayers.forEach(layer=>visible(layer,all && id("observations").checked));
    const month = id("month").value;
    const records = activeRecords();
    for (const option of id("month").options) {
      const count = forMonth(records,option.value).length;
      const name = {"":"All","04":"April","05":"May","06":"June"}[option.value];
      option.textContent = name + " · " + count + (count === 1 ? " record" : " records");
    }
    if (all && month !== sourceMonth) {
      sourceMonth = month;
      map.getSource("plant-records").setData({type:"FeatureCollection",features:forMonth(allPlants.features,month)});
    }
    map.setFilter("laurel",month ? ["==",["slice",["get","date"],5,7],month] : null);
    id("months").hidden = !id("observations").checked;
    id("month-message").textContent = all ? "Hover to preview a photograph. Select a numbered group to zoom in, or tap a point to keep its photo open." : month ? "Hover or tap a point to see its photograph." : "28 of 34 records were made in June. Hover or tap a point for its photograph.";
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
  const photos = {
    M23:{path:"data/photos/M23.jpg",credit:"rachelgoland98",source:"https://www.inaturalist.org/photos/521611947",
      description:"Clusters of open, pale flowers sit between dark green leaves."},
    M30:{path:"data/photos/M30.jpg",credit:"Courtney Kelly Jett",source:"https://www.inaturalist.org/photos/528767985",
      description:"Pink buds and open flowers share a cluster beside the observer’s hand."}
  };
  function showRecords() {
    id("record-cards").replaceChildren();
    for (const record of pair) {
      const revealed = mode === "reveal";
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
      pin.className = "record-pin" + (revealed ? " " + record.aspect.toLowerCase() : "");
      pin.setAttribute("aria-label", "Enlarge " + date + " photograph, " + record.id);
      const thumb = document.createElement("img");
      thumb.src = photo.path; thumb.alt = "";
      const label = document.createElement("span");
      label.textContent = revealed ? record.aspect + "-facing" : date;
      pin.append(thumb,label);
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
      const card = document.createElement("article");
      card.className = "sample-record";
      const title = document.createElement("h2"), data = document.createElement("p"), link = document.createElement("a");
      title.textContent = date + " · " + record.id;
      data.textContent = record.elevation + " m elevation · " +
        (record.accuracy == null ? "Location accuracy unreported" : "Reported accuracy ±" + record.accuracy + " m");
      link.href = record.url; link.target = "_blank"; link.rel = "noopener";
      link.textContent = record.observer + " on iNaturalist ↗";
      const caption = document.createElement("p");
      caption.textContent = photo.description;
      const enlarge = document.createElement("button");
      enlarge.className = "photo-link"; enlarge.textContent = "View photograph"; enlarge.onclick=openPhoto;
      const credit = document.createElement("small");
      credit.textContent = "Photo © " + photo.credit + " · CC BY-NC";
      card.append(title,caption,data,enlarge,link,credit);
      if (revealed) {
        const reading = document.createElement("p");
        reading.textContent = record.aspect + "-facing · " + record.slope + "° slope · bearing " + record.bearing + "°";
        card.append(reading);
      }
      id("record-cards").append(card);
    }
  }
  const titles = {landscape:"Reading the ridge", slopes:"Opposing slopes", records:"Mountain laurel in June",
    reveal:"Across the ridge", explore:"Explore the observations"};
  const descriptions = {landscape:initialIntro,
    slopes:"Select a blue north-facing slope and an orange south-facing slope. Compare their elevation and steepness, then try a different pair. Each selection samples a 30 m forest cell.",
    records:"Both photographs show open mountain-laurel flowers. They were taken eight days and 224 m apart, at almost the same elevation. Tap either photograph to look closer.",
    reveal:"M23 sits on a north-facing forest cell and M30 on a south-facing one. The colors show where those settings continue around the two records.",
    explore:"Switch from mountain laurel to all plants to see what else people recorded here in spring 2025. Keep the same month and view to compare the records."};
  function render(next, camera) {
    const previous = mode;
    map.stop();
    mode = next;
    popup.remove(); clearPicks();
    plantMarkers.forEach(marker=>marker.remove());
    plantMarkers = [];
    id("heading").textContent=titles[mode];
    if (mode === "explore") id("slope-tools").before(id("layers"));
    else id("slope-tools").after(id("layers"));
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
      id("month").value="";
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
  document.addEventListener("keydown", event => { if(event.key === "Escape" && !id("photo-dialog").open) leave(); });
  id("plants").onclick=()=>navigate("records");
  id("next-stage").onclick=()=>navigate(mode === "records" ? "reveal" : "explore");
  id("compare").onclick=id("explore").onclick=()=>navigate("slopes");
  id("back").onclick=leave;
  id("landscape").onclick=()=>history.state?.parent === "landscape" ? leave() : navigate("landscape");
  id("scope").onchange=()=>{
    popup.remove();
    id("observations").checked=true;
    refresh();
  };
  id("month").onchange=()=>{
    popup.remove(); refresh();
    const month = id("month").value;
    const points = forMonth(activeRecords(),month)
      .map(f=>f.geometry.coordinates);
    if (points.length) {
      const xs=points.map(p=>p[0]), ys=points.map(p=>p[1]);
      map.fitBounds([[Math.min(...xs),Math.min(...ys)],[Math.max(...xs),Math.max(...ys)]],
        {padding:50,maxZoom:14,duration});
    }
  };
  id("clear").onclick=clearPicks;
  id("reset").onclick=()=>frame();
  document.querySelectorAll("aside input").forEach(el=>el.onchange=refresh);
  map.on("click",async event=>{
    if (guided()) return;
    const hits = map.queryRenderedFeatures(event.point,{layers:["plant-clusters","plant-points","laurel","candidates","study-hit-area"]});
    const cluster = hits.find(f=>f.layer.id==="plant-clusters");
    if (cluster) {
      const zoom = await map.getSource("plant-records").getClusterExpansionZoom(cluster.properties.cluster_id);
      if (allScope()) map.easeTo({center:cluster.geometry.coordinates,zoom,duration});
      return;
    }
    const pointHit = hits.find(f=>f.layer.id==="plant-points" || f.layer.id==="laurel");
    if (pointHit) {
      const box=[[event.point.x-3,event.point.y-3],[event.point.x+3,event.point.y+3]];
      pinRecords(map.queryRenderedFeatures(box,{layers:[pointHit.layer.id]}),pointHit.geometry.coordinates);
      return;
    }
    if (sampling()) {
      const slope = hits.find(f=>f.layer.id==="candidates");
      if (slope) pick(event.lngLat, slope);
    } else if (hits.some(f=>f.layer.id==="study-hit-area")) navigate("slopes",event.lngLat.toArray());
  });
  map.on("mousemove",async event=>{
    const layers = ["plant-points","laurel","plant-clusters",sampling() ? "candidates" : "study-hit-area"];
    const hits = guided() ? [] : map.queryRenderedFeatures(event.point,{layers});
    map.getCanvas().style.cursor = hits.length ? "pointer" : "";
    const hit = hits.find(f=>["plant-points","laurel","plant-clusters"].includes(f.layer.id));
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
  map.on("moveend",()=>{
    const c=map.getCenter();
    id("location").textContent=c.lat.toFixed(3)+"° N · "+Math.abs(c.lng).toFixed(3)+"° W";
  });
  localCenter = history.state?.center;
  render(currentRoute(),history.state?.camera);
  id("status").textContent="";
}
start().catch(error=>{id("status").textContent="Map could not load. Refresh using a WebGL-enabled browser.";console.error(error);});
