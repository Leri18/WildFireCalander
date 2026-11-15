// Builds presentation/ThumbPressers_FireMap.pptx (7 slides). Run: node build_deck.js
const pptxgen = require('pptxgenjs');
const { applyTheme } = require('/root/.claude/skills/synced/7bf13ccb-d322-4f0a-9fb2-585c5ce45246_eecbb0bf-0e3c-428a-9147-2414cb514c1d/pptx/scripts/apply_theme.js');
const THEME = { name: 'Fire Map', headFontFace: 'Arial', bodyFontFace: 'Calibri',
  colors: { dk1: '111110', lt1: 'F0EFEC', dk2: '1E1E1C', lt2: 'C3C2B7', accent1: 'F1801E', accent2: 'FDDC58', accent3: 'D1401F',
    accent4: '3987E5', accent5: '199E70', accent6: '898781', hlink: 'FAB02A', folHlink: 'FAB02A' } };
const S = 'screenshots/';
(async () => {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_16x9';
  pres.title = 'Fire Map Germany';
  pres.author = 'ThumbPressers';
  pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
  const C = pres.SchemeColor;
  const foot = { x: 0.5, y: 5.2, w: 7.5, h: 0.25, fontSize: 10, color: C.accent6, margin: 0, isTextBox: true };
  pres.defineSlideMaster({ title: 'COVER', background: { color: '111110' } });
  pres.defineSlideMaster({ title: 'CONTENT', background: { color: '111110' },
    objects: [
      { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.32, w: 9, h: 0.75, fontSize: 32, bold: true, color: C.background1, align: 'left', valign: 'middle', margin: 0 }, text: '' } },
      { text: { text: 'ThumbPressers · Fire Map Germany · NASA Space Apps 2026', options: foot } },
    ],
    slideNumber: { x: 9.0, y: 5.2, w: 0.5, h: 0.25, fontSize: 10, color: C.accent6, align: 'right' } });
  const body = (extra) => Object.assign({ fontSize: 18, color: C.background2, margin: 0, isTextBox: true, valign: 'top', paraSpaceAfter: 8 }, extra);
  const stat = (s, x, y, big, label, w = 3.2) => {
    s.addText(big, { x, y, w, h: 0.85, fontSize: 48, bold: true, color: C.accent2, margin: 0, isTextBox: true, fontFace: 'Arial', objectName: 'stat' });
    s.addText(label, { x, y: y + 0.85, w, h: 0.7, fontSize: 16, color: C.background2, margin: 0, isTextBox: true, valign: 'top', objectName: 'stat label' });
  };
  const frame = (s, path, x, y, w, h, alt) => {
    s.addShape(pres.ShapeType.roundRect, { x: x - 0.04, y: y - 0.04, w: w + 0.08, h: h + 0.08, fill: { color: '2C2C2A' }, line: { color: '383835', width: 0.75 }, rectRadius: 0.06, objectName: 'image frame' });
    s.addImage({ path, x, y, w, h, altText: alt, objectName: 'screenshot' });
  };

  // 1 ---------------------------------------------------------------- cover
  pres.addSection({ title: 'Fire Map Germany' });
  let s = pres.addSlide({ masterName: 'COVER', sectionTitle: 'Fire Map Germany' });
  s.addImage({ path: S + '01_map.jpg', x: 0, y: 0, w: 10, h: 5.625, altText: 'Satellite map of Germany with fire detections as dots' });
  s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 5.3, h: 5.625, fill: { color: '111110', transparency: 8 }, line: { color: '111110', width: 0 }, objectName: 'text panel' });
  s.addText('NASA SPACE APPS 2026', { x: 0.5, y: 0.5, w: 4.4, h: 0.3, fontSize: 12, bold: true, color: C.accent1, charSpacing: 3, margin: 0, isTextBox: true });
  s.addText('Fire Map Germany', { x: 0.5, y: 0.95, w: 4.5, h: 1.3, fontSize: 40, bold: true, color: C.background1, margin: 0, isTextBox: true, valign: 'top', fontFace: 'Arial' });
  s.addText('25 years of satellite fire detections on one scale', { x: 0.5, y: 2.3, w: 4.4, h: 0.7, fontSize: 18, color: C.background2, margin: 0, isTextBox: true, valign: 'top' });
  s.addText([
    { text: 'Team ThumbPressers', options: { bold: true, color: C.background1, fontSize: 18, breakLine: true } },
    { text: 'Lenny (18) and Leandro (17), students from Germany', options: { color: C.background2, fontSize: 16, breakLine: true } },
    { text: 'Challenge: Harmonization of MODIS and VIIRS Hot Spots', options: { color: C.background2, fontSize: 16 } },
  ], { x: 0.5, y: 3.25, w: 4.4, h: 1.35, margin: 0, isTextBox: true, valign: 'top', paraSpaceAfter: 6 });
  s.addText('leri18.github.io/WildFireCalander', { x: 0.5, y: 4.85, w: 4.4, h: 0.3, fontSize: 14, color: C.accent2, margin: 0, isTextBox: true, hyperlink: { url: 'https://leri18.github.io/WildFireCalander/' } });

  // 2 ---------------------------------------------------------------- problem
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Fire Map Germany' });
  s.addText('Two sensors, two scales', { placeholder: 'title' });
  stat(s, 0.5, 1.35, '4.3×', 'VIIRS counts 4.3 times as many vegetation fires as MODIS over Germany');
  s.addText('MODIS watched from 2000, VIIRS took over in 2012. Joined as delivered, the record jumps in 2012. Nothing changed on the ground.', body({ x: 0.5, y: 3.2, w: 3.3, h: 1.7 }));
  frame(s, S + '02_cal_raw.png', 4.2, 1.3, 5.3, 3.72, 'Calendar of raw monthly counts: rows before 2012 are much darker than rows after');
  s.addText('Raw counts: upper rows (MODIS) look quiet', { x: 4.2, y: 5.2, w: 4.6, h: 0.25, fontSize: 10, color: C.accent6, margin: 0, isTextBox: true, align: 'right' });

  // 3 ---------------------------------------------------------------- solution
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Fire Map Germany' });
  s.addText('One scale for every month since 2000', { placeholder: 'title' });
  frame(s, S + '03_cal_harm.png', 0.5, 1.3, 5.3, 3.72, 'Harmonized calendar: years as rows, months as columns, evenly coloured across 2012');
  s.addText([
    { text: 'MODIS months are converted to the count VIIRS would have reported.', options: { breakLine: true } },
    { text: 'The conversion is learned from 14 years in which both sensors flew.', options: { breakLine: true } },
    { text: 'A month in 2003 can now be compared with a month in 2023.', options: {} },
  ], body({ x: 6.2, y: 1.35, w: 3.3, h: 3.6, paraSpaceAfter: 14 }));

  // 4 ---------------------------------------------------------------- user experience
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Fire Map Germany' });
  s.addText('Draw your area, see only your fires', { placeholder: 'title' });
  frame(s, S + '04_area.jpg', 3.9, 1.3, 5.6, 3.15, 'Map with a rectangle drawn over central Germany; only detections inside it are shown');
  const steps = [['1', 'Drag a rectangle on the map'], ['2', 'Pick a period on the timeline'], ['3', 'Save the detections as CSV']];
  steps.forEach(([n, t], i) => {
    const y = 1.4 + i * 1.0;
    s.addShape(pres.ShapeType.ellipse, { x: 0.5, y, w: 0.55, h: 0.55, fill: { color: C.accent1 }, line: { color: C.accent1, width: 0 }, objectName: 'step ' + n });
    s.addText(n, { x: 0.5, y, w: 0.55, h: 0.55, fontSize: 20, bold: true, color: C.text1, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
    s.addText(t, { x: 1.25, y, w: 2.4, h: 0.55, fontSize: 18, color: C.background1, valign: 'middle', margin: 0, isTextBox: true });
  });
  s.addText('Satellite or street map, zoom down to single villages', { x: 0.5, y: 4.4, w: 3.2, h: 0.6, fontSize: 14, color: C.background2, margin: 0, isTextBox: true, valign: 'top' });

  // 5 ---------------------------------------------------------------- month vs median
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Fire Map Germany' });
  s.addText('Is this month unusual?', { placeholder: 'title' });
  stat(s, 0.5, 1.35, '+57 %', 'August 2022 against a typical August in Germany');
  s.addText('Click any month. The calendar compares it with the median of that calendar month and shows it on the map.', body({ x: 0.5, y: 3.2, w: 3.3, h: 1.7 }));
  frame(s, S + '05_cal_month.png', 4.2, 1.3, 5.3, 3.72, 'Calendar with August 2022 selected: 467 detections, above the median');

  // 6 ---------------------------------------------------------------- space data
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Fire Map Germany' });
  s.addText('Made possible by open space data', { placeholder: 'title' });
  frame(s, S + '06_streets.jpg', 0.5, 1.3, 4.7, 2.64, 'Street map zoomed in on a region in eastern Germany with fire detections');
  stat(s, 0.5, 4.1, '765,054', '', 4.7);
  s.addText('detections, Nov 2000 to Nov 2026', { x: 3.05, y: 4.42, w: 2.2, h: 0.5, fontSize: 14, color: C.background2, margin: 0, isTextBox: true, valign: 'top' });
  s.addText([
    { text: 'NASA FIRMS', options: { bold: true, color: C.accent2, breakLine: true } },
    { text: 'MODIS on Terra and Aqua, 1 km, since 2000', options: { breakLine: true } },
    { text: 'VIIRS on Suomi NPP, NOAA-20, NOAA-21, 375 m', options: { breakLine: true } },
    { text: 'NASA GIBS', options: { bold: true, color: C.accent2, breakLine: true } },
    { text: 'Blue Marble satellite background', options: { breakLine: true } },
    { text: 'Partners and open data', options: { bold: true, color: C.accent2, breakLine: true } },
    { text: 'Meteosat via FIRMS, OpenStreetMap, Eurostat', options: {} },
  ], body({ x: 5.6, y: 1.3, w: 3.9, h: 3.7, fontSize: 16, paraSpaceAfter: 6 }));

  // 7 ---------------------------------------------------------------- validation and limits
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Fire Map Germany' });
  s.addText('How we checked it, and its limits', { placeholder: 'title' });
  s.addShape(pres.ShapeType.roundRect, { x: 0.5, y: 1.3, w: 5.2, h: 2.2, fill: { color: 'FCFCFB' }, line: { color: 'FCFCFB', width: 0 }, rectRadius: 0.06, objectName: 'chart card' });
  s.addImage({ path: S + '07_validation.png', x: 0.58, y: 1.36, w: 5.04, h: 1.72 * 5.04 / 5.04 * 1.0, sizing: { type: 'contain', w: 5.04, h: 2.08 }, altText: 'Line chart: harmonized MODIS follows observed VIIRS closely in held-out years, Argentina 2012 to 2025' });
  s.addText('Test region Argentina: each year hidden once, predicted from MODIS, compared with VIIRS', { x: 0.5, y: 3.6, w: 5.2, h: 0.5, fontSize: 12, color: C.accent6, margin: 0, isTextBox: true, valign: 'top' });
  s.addText([
    { text: 'Argentina: R² 0.98', options: { bold: true, color: C.accent2, breakLine: true } },
    { text: 'Monthly error 1,114 against a typical 16,733 detections', options: { breakLine: true } },
    { text: 'Germany: 77 %', options: { bold: true, color: C.accent2, breakLine: true } },
    { text: 'agreement on “above or below the median”. MODIS sees few fires here, so values before 2012 are rough', options: {} },
  ], body({ x: 6.0, y: 1.3, w: 3.5, h: 2.9, fontSize: 16, paraSpaceAfter: 6 }));
  s.addText('A gap in satellite coverage is not the same as no fire. AI use: code and analysis were generated with Claude; the idea is ours.', { x: 0.5, y: 4.3, w: 9, h: 0.6, fontSize: 14, color: C.background2, margin: 0, isTextBox: true, valign: 'top' });

  await pres.writeFile({ fileName: 'ThumbPressers_FireMap.pptx' });
  await applyTheme('ThumbPressers_FireMap.pptx', THEME);
})();
