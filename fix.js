const fs = require('fs');

const ui = fs.readFileSync('frontend/scripts/verify-ui.mjs', 'utf8');
const main = fs.readFileSync('verify_main.mjs', 'utf16le');

const startMarker = '// 14. Cinematic introduction';
const endMarker = 'console.log(`\\n${checks.filter((c) => c.ok).length}/${checks.length} checks passed`);';

const uiStart = ui.indexOf(startMarker);
const uiEnd = ui.indexOf(endMarker);

const mainStart = main.indexOf(startMarker);
const mainEnd = main.indexOf(endMarker);

if (uiStart === -1 || uiEnd === -1 || mainStart === -1 || mainEnd === -1) {
  console.error('Failed to find markers!', {uiStart, uiEnd, mainStart, mainEnd});
  process.exit(1);
}

const mainIntro = main.substring(mainStart, mainEnd);

const newUi = ui.substring(0, uiStart) + mainIntro + ui.substring(uiEnd);

fs.writeFileSync('frontend/scripts/verify-ui.mjs', newUi, 'utf8');
console.log('Successfully restored cinematic introduction.');
