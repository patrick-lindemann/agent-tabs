// Renders the PNG files the package needs, because the Marketplace does not
// accept SVG files in a package. Runs before packaging; the PNG files are not
// committed.
//
// - media/icon.png: the extension icon, 256 px
// - media/icons/<agent>.png: logos in brand colors, for the profile menu
// - media/icons/<agent>-light.png and -dark.png: logos in the theme's text
//   color, made from <agent>-mono.svg, or <agent>.svg when the logo has no
//   brand colors
//
// Menu icons are 64 px, so they stay sharp at 16 px on high-density displays.
const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');

const media = path.join(__dirname, '..', 'media');
const icons = path.join(media, 'icons');

/** VS Code's default text colors on light and dark themes */
const TEXT_COLORS = { light: '#424242', dark: '#C5C5C5' };

function render(svg, pngFile, width) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
  fs.writeFileSync(pngFile, png);
}

render(fs.readFileSync(path.join(media, 'icon.svg')), path.join(media, 'icon.png'), 256);

const files = fs.readdirSync(icons);
const agents = files.filter((f) => /^[a-z]+\.svg$/.test(f)).map((f) => f.slice(0, -4));
for (const agent of agents) {
  const color = fs.readFileSync(path.join(icons, `${agent}.svg`), 'utf8');
  const monoFile = path.join(icons, `${agent}-mono.svg`);
  const mono = fs.existsSync(monoFile) ? fs.readFileSync(monoFile, 'utf8') : color;
  if (mono !== color) {
    render(color, path.join(icons, `${agent}.png`), 64);
  }
  for (const [theme, textColor] of Object.entries(TEXT_COLORS)) {
    render(
      mono.replaceAll('currentColor', textColor),
      path.join(icons, `${agent}-${theme}.png`),
      64
    );
  }
}
