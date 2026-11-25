// Renders the PNG files the package needs, because the Marketplace does not
// accept SVG files in a package. Runs before packaging; the PNG files are not
// committed.
//
// - media/icon.png: the extension icon, 256 px
// - media/icons/<agent>.png: logos in brand colors, for the profile menu
// - media/icons/<agent>-light.png and -dark.png: logos in the theme's text
//   color, made from <agent>-mono.svg, or <agent>.svg when the logo has no
//   brand colors
// - media/icons/editor/<icon>[-light|-dark].png: the same logos with the
//   inset of VS Code's file icons, for editor tabs
// - media/icons/editor/status/<status>[-color]-<light|dark>.png: the status
//   icons for editor tabs, in the text color or in VS Code's default status
//   colors. The working dots are an animated PNG that fades them like the
//   webview's `dot-fade` animation.
//
// Menu icons are 64 px, so they stay sharp at 16 px on high-density displays.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { Resvg } = require('@resvg/resvg-js');

const media = path.join(__dirname, '..', 'media');
const icons = path.join(media, 'icons');
const editorIcons = path.join(icons, 'editor');

/** The logo's box in a 16 px editor tab icon, which VS Code shows without any inset */
const EDITOR_BOX = { x: 6, y: 3, size: 10 };

/** VS Code's default text colors on light and dark themes */
const TEXT_COLORS = { light: '#424242', dark: '#C5C5C5' };

/**
 * VS Code's default colors for `charts.blue`, `editorWarning.foreground`,
 * `charts.green` and `errorForeground`, which the webview uses for the
 * statuses. Images cannot follow the theme's colors.
 */
const STATUS_COLORS = {
  working: { light: '#0063D3', dark: '#59A4F9' },
  blocked: { light: '#BF8803', dark: '#CCA700' },
  done: { light: '#388A34', dark: '#89D185' },
  error: { light: '#A1260D', dark: '#F48771' }
};

/** The webview's `dot-fade` animation: 1.6 s, the dots 0.2 s apart */
const DOT_FADE = { period: 1.6, delay: 0.2, frames: 32 };

function renderPng(svg, width) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
}

function render(svg, pngFile, width) {
  fs.writeFileSync(pngFile, renderPng(svg, width));
}

function insetForEditor(svg) {
  const { x, y, size } = EDITOR_BOX;
  const inset = svg.replace('<svg ', `<svg x="${x}" y="${y}" width="${size}" height="${size}" `);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${inset}</svg>`;
}

function renderLogo(svg, name) {
  render(svg, path.join(icons, `${name}.png`), 64);
  render(insetForEditor(svg), path.join(editorIcons, `${name}.png`), 64);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** The chunks of a PNG file, in order */
function readChunks(png) {
  const chunks = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    chunks.push({
      type: png.toString('latin1', at + 4, at + 8),
      data: png.subarray(at + 8, at + 8 + length)
    });
    at += length + 12;
  }
  return chunks;
}

/**
 * Joins PNG files of the same size and format into an animated PNG that
 * repeats forever. Each frame replaces the last for `delayMs`.
 */
function animatePng(frames, delayMs) {
  const parsed = frames.map(readChunks);
  const header = parsed[0].find((c) => c.type === 'IHDR').data;
  const control = Buffer.alloc(8);
  control.writeUInt32BE(frames.length);
  const out = [frames[0].subarray(0, 8), chunk('IHDR', header), chunk('acTL', control)];
  let sequence = 0;
  parsed.forEach((chunks, index) => {
    const frame = Buffer.alloc(26);
    frame.writeUInt32BE(sequence++, 0);
    header.copy(frame, 4, 0, 8);
    frame.writeUInt16BE(delayMs, 20);
    frame.writeUInt16BE(1000, 22);
    out.push(chunk('fcTL', frame));
    for (const { data } of chunks.filter((c) => c.type === 'IDAT')) {
      if (index === 0) {
        out.push(chunk('IDAT', data));
      } else {
        const number = Buffer.alloc(4);
        number.writeUInt32BE(sequence++);
        out.push(chunk('fdAT', Buffer.concat([number, data])));
      }
    }
  });
  out.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(out);
}

/** CSS `ease-in-out`, cubic-bezier(0.42, 0, 0.58, 1), at progress `x` */
function easeInOut(x) {
  const bezier = (t, a, b) => 3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (low + high) / 2;
    if (bezier(mid, 0.42, 0.58) < x) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return bezier((low + high) / 2, 0, 1);
}

/** A dot's opacity in `dot-fade` at `phase`, 0 to 1: 0.35, 1 at 30 %, 0.35 from 60 % */
function dotOpacity(phase) {
  const dim = 0.35;
  if (phase < 0.3) {
    return dim + (1 - dim) * easeInOut(phase / 0.3);
  }
  if (phase < 0.6) {
    return 1 - (1 - dim) * easeInOut((phase - 0.3) / 0.3);
  }
  return dim;
}

function renderWorking(svg, pngFile) {
  const { period, delay, frames } = DOT_FADE;
  const pngs = [];
  for (let frame = 0; frame < frames; frame++) {
    const time = (frame / frames) * period;
    let dot = 0;
    const faded = svg.replace(/<circle /g, () => {
      const phase = ((((time - dot++ * delay) / period) % 1) + 1) % 1;
      return `<circle fill-opacity="${dotOpacity(phase).toFixed(3)}" `;
    });
    pngs.push(renderPng(insetForEditor(faded), 64));
  }
  fs.writeFileSync(pngFile, animatePng(pngs, Math.round((period * 1000) / frames)));
}

fs.mkdirSync(path.join(editorIcons, 'status'), { recursive: true });

render(fs.readFileSync(path.join(media, 'icon.svg')), path.join(media, 'icon.png'), 256);

const files = fs.readdirSync(icons);
// Also the terminal and sparkle codicons, which editor tabs show as images
const agents = files.filter((f) => /^[a-z]+\.svg$/.test(f)).map((f) => f.slice(0, -4));
for (const agent of agents) {
  const color = fs.readFileSync(path.join(icons, `${agent}.svg`), 'utf8');
  const monoFile = path.join(icons, `${agent}-mono.svg`);
  const mono = fs.existsSync(monoFile) ? fs.readFileSync(monoFile, 'utf8') : color;
  if (mono !== color) {
    renderLogo(color, agent);
  }
  for (const [theme, textColor] of Object.entries(TEXT_COLORS)) {
    renderLogo(mono.replaceAll('currentColor', textColor), `${agent}-${theme}`);
  }
}

for (const [status, colors] of Object.entries(STATUS_COLORS)) {
  const svg = fs.readFileSync(path.join(icons, 'status', `${status}.svg`), 'utf8');
  for (const theme of Object.keys(TEXT_COLORS)) {
    for (const [suffix, color] of [
      ['', TEXT_COLORS[theme]],
      ['-color', colors[theme]]
    ]) {
      const colored = svg.replaceAll('currentColor', color);
      const file = path.join(editorIcons, 'status', `${status}${suffix}-${theme}.png`);
      if (status === 'working') {
        renderWorking(colored, file);
      } else {
        render(insetForEditor(colored), file, 64);
      }
    }
  }
}
