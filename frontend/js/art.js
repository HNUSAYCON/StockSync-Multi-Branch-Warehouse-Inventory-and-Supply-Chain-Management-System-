// =====================================================================
// StockSync | Warehouse illustrations, drawn as inline SVG
// (no image files to download, so they load instantly and never break)
// =====================================================================

const C = {
  wall: '#2A5DB5', wallDark: '#2352A3', floor: '#163C7E', floorLine: '#1B4590',
  upright: '#0F2A55', uprightHi: '#3D6BC0', beam: '#E8762B', beamDark: '#C25E1C',
  box: '#C89B62', boxDark: '#A97E48', boxTape: '#E2C08C', label: '#F7F4EC',
  tape: '#F2C230', tapeDark: '#0F2A55', pallet: '#8A6A43',
  lift: '#F2C230', liftDark: '#C99A12', liftMast: '#1A2333', tire: '#1A2333',
};

// Repeatable "random" numbers so the boxes look the same on every load
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

function box(x, y, w, h, rnd) {
  const labelW = Math.min(18, w * 0.4);
  const showLabel = rnd() > 0.35;
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.box}"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h * 0.16}" fill="${C.boxDark}"/>
    <rect x="${x + w / 2 - 2}" y="${y}" width="4" height="${h}" fill="${C.boxTape}" opacity=".7"/>
    ${showLabel ? `<rect x="${x + w - labelW - 5}" y="${y + h * 0.45}" width="${labelW}" height="${Math.min(12, h * 0.25)}" rx="1" fill="${C.label}"/>` : ''}`;
}

// One pallet-rack bay: uprights, orange beams, cartons on each level
function rack(x, y, w, h, levels, rnd) {
  const levelH = h / levels;
  let s = '';
  for (let l = 0; l < levels; l++) {
    const beamY = y + levelH * (l + 1) - 8;
    // cartons sitting on this beam
    let bx = x + 14;
    while (bx < x + w - 40) {
      const bw = 34 + Math.floor(rnd() * 34);
      const bh = 26 + Math.floor(rnd() * (levelH - 46));
      if (bx + bw > x + w - 12) break;
      if (rnd() > 0.15) s += box(bx, beamY - bh, bw, bh, rnd);
      bx += bw + 4 + Math.floor(rnd() * 8);
    }
    s += `<rect x="${x}" y="${beamY}" width="${w}" height="8" fill="${C.beam}"/>
          <rect x="${x}" y="${beamY + 6}" width="${w}" height="2" fill="${C.beamDark}"/>`;
  }
  // uprights with punched holes
  for (const ux of [x - 6, x + w - 4]) {
    s += `<rect x="${ux}" y="${y}" width="10" height="${h}" fill="${C.upright}"/>
          <rect x="${ux + 2}" y="${y}" width="2" height="${h}" fill="${C.uprightHi}" opacity=".6"/>`;
    for (let hy = y + 10; hy < y + h - 4; hy += 14) {
      s += `<rect x="${ux + 5}" y="${hy}" width="3" height="5" fill="${C.wallDark}"/>`;
    }
  }
  return s;
}

function forklift(x, y, scale = 1) {
  return `
  <g transform="translate(${x} ${y}) scale(${scale})" class="art-forklift">
    <!-- pallet with boxes on the forks -->
    <rect x="-118" y="-22" width="96" height="10" fill="${C.pallet}"/>
    <rect x="-112" y="-12" width="12" height="8" fill="${C.pallet}"/>
    <rect x="-76" y="-12" width="12" height="8" fill="${C.pallet}"/>
    <rect x="-40" y="-12" width="12" height="8" fill="${C.pallet}"/>
    ${box(-114, -70, 44, 48, seeded(7))}
    ${box(-68, -62, 42, 40, seeded(11))}
    ${box(-104, -104, 40, 34, seeded(3))}
    <!-- forks + mast -->
    <rect x="-122" y="-6" width="104" height="5" fill="${C.liftMast}"/>
    <rect x="-22" y="-150" width="9" height="148" fill="${C.liftMast}"/>
    <rect x="-10" y="-150" width="9" height="148" fill="${C.liftMast}"/>
    <!-- body -->
    <path d="M0 -70 h86 a14 14 0 0 1 14 14 v50 h-100 z" fill="${C.lift}"/>
    <rect x="62" y="-96" width="44" height="30" rx="4" fill="${C.liftDark}"/>
    <!-- cab cage -->
    <path d="M6 -70 V-138 H58 L70 -70" fill="none" stroke="${C.liftMast}" stroke-width="6" stroke-linejoin="round"/>
    <rect x="22" y="-96" width="22" height="26" rx="3" fill="${C.liftMast}"/>
    <!-- wheels -->
    <circle cx="20" cy="0" r="17" fill="${C.tire}"/><circle cx="20" cy="0" r="6" fill="#5B6577"/>
    <circle cx="82" cy="2" r="13" fill="${C.tire}"/><circle cx="82" cy="2" r="5" fill="#5B6577"/>
  </g>`;
}

function hazardTape(x, y, w, h) {
  const id = `hz${Math.round(x)}${Math.round(y)}`;
  return `
    <defs><pattern id="${id}" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="14" height="28" fill="${C.tape}"/><rect x="14" width="14" height="28" fill="${C.tapeDark}"/>
    </pattern></defs>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id})"/>`;
}

// Large scene for the login page
export function warehouseScene() {
  const rnd = seeded(42);
  const floorY = 600;
  let racks = '';
  [[60, 150, 300], [400, 150, 300], [740, 150, 300], [1080, 150, 300]].forEach(([x, y, w]) => {
    racks += rack(x, y, w, floorY - y, 3, rnd);
  });
  return `
  <svg class="art-scene" viewBox="0 0 1400 800" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <rect width="1400" height="800" fill="${C.wall}"/>
    <!-- high windows on the back wall -->
    ${[120, 460, 800, 1140].map((wx) => `<rect x="${wx}" y="48" width="200" height="56" rx="3" fill="#3B6DC4"/><rect x="${wx + 98}" y="48" width="4" height="56" fill="${C.wall}"/>`).join('')}
    ${racks}
    <!-- floor -->
    <rect x="0" y="${floorY}" width="1400" height="200" fill="${C.floor}"/>
    <rect x="0" y="${floorY}" width="1400" height="6" fill="${C.floorLine}"/>
    <!-- yellow aisle line -->
    <rect x="0" y="${floorY + 44}" width="1400" height="7" fill="${C.tape}"/>
    ${hazardTape(0, floorY + 150, 1400, 22)}
    ${forklift(1010, floorY + 112, 1.25)}
  </svg>`;
}

// Short strip for the dashboard banner
export function aisleStrip() {
  const rnd = seeded(9);
  return `
  <svg class="art-strip" viewBox="0 0 640 190" preserveAspectRatio="xMaxYMax meet" aria-hidden="true">
    ${rack(20, 18, 240, 150, 2, rnd)}
    ${rack(290, 18, 230, 150, 2, rnd)}
    <rect x="0" y="168" width="640" height="22" fill="${C.floor}"/>
    <rect x="0" y="176" width="640" height="4" fill="${C.tape}"/>
    ${forklift(560, 182, 0.62)}
  </svg>`;
}
