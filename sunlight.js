// Daily solar geometry (NOAA fractional-year declination). Integrate the
// incidence cosine in local solar time; divide by the same flat-site integral.
export function relativeSunlight(cell, month) {
  const radians = Math.PI / 180;
  const lat = cell[1] / 1e6 * radians;
  const tilt = cell[5] * radians;
  const aspect = cell[6] * radians;
  const eastNormal = Math.sin(tilt) * Math.sin(aspect);
  const northNormal = Math.sin(tilt) * Math.cos(aspect);
  const upNormal = Math.cos(tilt);
  const [first,last] = ({"04":[91,120],"05":[121,151],"06":[152,181],"":[91,181]})[month];
  let inclined = 0, horizontal = 0;
  for (let day = first; day <= last; day++) {
    const g = 2 * Math.PI * (day - 1) / 365;
    const decl = .006918 - .399912*Math.cos(g) + .070257*Math.sin(g)
      - .006758*Math.cos(2*g) + .000907*Math.sin(2*g)
      - .002697*Math.cos(3*g) + .00148*Math.sin(3*g);
    const sd = Math.sin(decl), cd = Math.cos(decl);
    for (let minute = 5; minute < 1440; minute += 10) {
      const hour = (minute / 4 - 180) * radians;
      const up = Math.sin(lat)*sd + Math.cos(lat)*cd*Math.cos(hour);
      if (up <= 0) continue;
      const east = -cd*Math.sin(hour);
      const north = Math.cos(lat)*sd - Math.sin(lat)*cd*Math.cos(hour);
      inclined += Math.max(0,east*eastNormal + north*northNormal + up*upNormal);
      horizontal += up;
    }
  }
  return Math.round(100 * inclined / horizontal);
}
