// Renders the SVG logos as PNG files, because the Marketplace does not
// accept SVG files in a package. The extension icon is 256 px; menu icons are
// 64 px, so they stay sharp at 16 px on high-density displays. Run after
// changing an SVG: npm run icons
const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');

const media = path.join(__dirname, '..', 'media');

function render(svgFile, pngFile, width) {
  const svg = fs.readFileSync(svgFile);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
  fs.writeFileSync(pngFile, png);
}

render(path.join(media, 'icon.svg'), path.join(media, 'icon.png'), 256);

const icons = path.join(media, 'icons');
for (const file of fs.readdirSync(icons).filter((name) => name.endsWith('.svg'))) {
  render(path.join(icons, file), path.join(icons, file.replace(/\.svg$/, '.png')), 64);
}
