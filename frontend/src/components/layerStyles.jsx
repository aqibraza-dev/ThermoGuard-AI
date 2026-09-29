import React from 'react';

// 24x24 stroke-based glyphs (lucide-style) drawn inside pins / badges
const GLYPHS = {
  plus: ['M12 5v14', 'M5 12h14'],
  shield: ['M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z'],
  flame: ['M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z'],
  droplet: ['M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z'],
  factory: ['M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z', 'M17 18h1', 'M12 18h1', 'M7 18h1'],
  zap: ['M13 2L3 14h9l-1 8 10-12h-9l1-8z'],
  thermo: ['M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z'],
  dot: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'],
};

// color = pin / badge color. zoneAlpha = polygon fill opacity (0-255).
export const LAYER_STYLES = {
  hospitals:            { label: 'Hospitals',         color: '#10b981', glyph: 'plus' },
  police:               { label: 'Police stations',   color: '#2563eb', glyph: 'shield' },
  fire_stations:        { label: 'Fire stations',     color: '#dc2626', glyph: 'flame' },
  water:                { label: 'Water sources',     color: '#06b6d4', glyph: 'droplet' },
  factories:            { label: 'Factories',         color: '#475569', glyph: 'factory' },
  ext_industrial_zones: { label: 'Industrial zones',  color: '#ff8a00', glyph: 'factory', zoneAlpha: 205 },
  ext_power_plants:     { label: 'Power plants',      color: '#e11df0', glyph: 'zap',     zoneAlpha: 205 },
  ext_thermal_points:   { label: 'Thermal points',    color: '#ec4899', glyph: 'thermo' },
};

const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.substring(i, i + 2), 16));
};

const prettify = (name) => {
  const s = name.replace('ext_', '').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const styleCache = {};
export const getLayerStyle = (name) => {
  if (styleCache[name]) return styleCache[name];
  const base = LAYER_STYLES[name] || { label: prettify(name), color: '#64748b', glyph: 'dot' };
  const rgb = hexToRgb(base.color);
  const light = rgb.map(v => Math.round(v + (255 - v) * 0.65));
  styleCache[name] = {
    ...base,
    rgb,
    paths: GLYPHS[base.glyph] || GLYPHS.dot,
    zoneFill: [...rgb, base.zoneAlpha || 140],
    zoneLine: [...light, 255],
  };
  return styleCache[name];
};

// Google-Maps-style teardrop pin, rasterised to a PNG data URL (deck.gl can't
// reliably decode SVG images, so we draw the SVG onto a canvas first).
const pinPromises = {};
export const loadPinIcon = (name) => {
  if (pinPromises[name]) return pinPromises[name];
  const s = getLayerStyle(name);
  const paths = s.paths.map(d => `<path d="${d}"/>`).join('');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="120" viewBox="0 0 48 60">` +
    `<path d="M24 2C11.6 2 2 11.6 2 23.6 2 40 24 58 24 58S46 40 46 23.6C46 11.6 36.4 2 24 2z" fill="${s.color}" stroke="#ffffff" stroke-width="3"/>` +
    `<circle cx="24" cy="23.5" r="15" fill="#ffffff"/>` +
    `<g transform="translate(14,13.5) scale(0.83)" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${paths}</g>` +
    `</svg>`;
  pinPromises[name] = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 96;
      c.height = 120;
      c.getContext('2d').drawImage(img, 0, 0, 96, 120);
      resolve({ url: c.toDataURL('image/png'), width: 96, height: 120, anchorY: 120 });
    };
    img.onerror = () => resolve(null);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  return pinPromises[name];
};

// Small round badge used in the sidebar, chips and popups
export const LayerBadge = ({ name, size = 28 }) => {
  const s = getLayerStyle(name);
  return (
    <span
      style={{
        width: size, height: size, borderRadius: '50%', background: s.color, flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
      }}
    >
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" stroke="#fff"
           strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        {s.paths.map((d, i) => <path key={i} d={d} />)}
      </svg>
    </span>
  );
};