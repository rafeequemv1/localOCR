// Smoke test: serve the repo, run localOCR in Chromium on the examples, check every export.
//   node test/smoke.js        (needs Playwright: npm i -D playwright)
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.pdf': 'application/pdf', '.gz': 'application/gzip', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/demo/index.html`);
  const result = await page.evaluate(async () => {
    const out = {};
    const png = await LocalOCR.recognize('../examples/sample-slide.png');
    out.png = { pages: png.pages.length, blocks: png.pages[0].blocks.length, pictures: png.pages[0].pictures.length, text: png.text.slice(0, 160) };
    const pdf = await LocalOCR.recognize('../examples/sample-slides.pdf', { pages: [1, 4] });
    out.pdf = { pages: pdf.pages.length, blocks: pdf.pages.map((p) => p.blocks.length) };
    const b64 = (blob) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
    const editable = await pdf.toEditablePdf(), searchable = await pdf.toSearchablePdf(), pptx = await pdf.toPptx();
    out.exports = { editable: [editable.type, editable.size], searchable: [searchable.type, searchable.size], pptx: [pptx.type, pptx.size], json: JSON.stringify(pdf.toJSON()).length };
    out.searchableB64 = await b64(searchable);
    return out;
  });
  fs.writeFileSync(path.join(__dirname, 'out-searchable.pdf'), Buffer.from(result.searchableB64, 'base64'));
  delete result.searchableB64;
  console.log(JSON.stringify(result, null, 1));
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close();
  server.close();
  const ok = result.png.blocks > 0 && result.pdf.pages === 2 && result.exports.editable[1] > 1000 && result.exports.searchable[1] > 1000 && result.exports.pptx[1] > 1000 && !errors.length;
  process.exit(ok ? 0 : 1);
})();
