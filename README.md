# localOCR

Turn images and image-only PDFs into **editable documents**, entirely in the browser. Screenshots, scans, photos of slides, NotebookLM slide decks: localOCR reads the text with its size, weight, colour and position, cuts out the pictures, rebuilds a clean background, and exports an editable PDF, a searchable PDF or a PowerPoint file.

Nothing is uploaded. Recognition (Tesseract.js), PDF reading (PDF.js) and writing (pdf-lib, PptxGenJS) all run on the user's device. It is the engine behind the [NotebookTools](https://www.notebooktools.com) slide editor.

**Try it:** [rafeequemv1.github.io/localOCR](https://rafeequemv1.github.io/localOCR/), or serve the folder and open `demo/` (see [Run the demo](#run-the-demo)).

## What you get

| From | To |
|---|---|
| Image (PNG, JPG, WebP…), canvas, `<img>` | Plain text, positioned text blocks with style, cut-out pictures, a clean background |
| Image-only PDF (every page) | The same, per page |
| | **Editable PDF**: real text over the cleaned page (fonts matched: sans, serif, mono; bold, italic) |
| | **Searchable PDF**: the original image, unchanged, with an invisible text layer to search and copy |
| | **PowerPoint (.pptx)**: text boxes, pictures and shapes on the cleaned page |
| | **JSON**: everything above, for your own app |

What it recognises beyond plain OCR:

- paragraphs, bullets, alignment and line spacing
- font size, bold, italic, colour, serif or sans
- styled words inside a line (a bold word, a coloured phrase) and superscripts and subscripts (cm⁻¹, H₂O)
- numbers in circles (step badges)
- labels on charts and diagrams
- pictures, charts and drawings as separate images, with their shadows
- tables, frames, cards and callouts kept as background, with what's inside them cut out separately

## Use it

Copy the folder into your site (or install from GitHub, below) and load one script:

```html
<script src="/localocr/src/localocr.js"></script>
<script>
  const input = document.querySelector('input[type=file]');
  input.onchange = async () => {
    const doc = await LocalOCR.recognize(input.files[0], {
      onProgress: ({ page, pages, progress }) => console.log(`page ${page}/${pages}`, progress),
    });

    console.log(doc.text);                       // all the text, in reading order
    console.log(doc.pages[0].blocks);            // [{ text, x, y, width, height, fontSize, bold, ... }]

    const pdf = await doc.toEditablePdf();       // Blob
    const scan = await doc.toSearchablePdf();    // Blob
    const pptx = await doc.toPptx();             // Blob
  };
</script>
```

The script finds the engine (`src/engine/`) and the libraries (`vendor/`) next to itself. If you serve them elsewhere:

```js
LocalOCR.configure({ base: 'https://cdn.example.com/localocr' });   // folder holding src/ and vendor/
// or only the libraries:
LocalOCR.configure({ vendor: '/static/ocr-vendor' });
```

### Install from GitHub

```bash
npm install github:rafeequemv1/localOCR
```

Then serve `node_modules/localocr/` as static files (the script loads its engine and libraries at runtime; it is not a bundler module).

## API

### `LocalOCR.recognize(input, options?) → Promise<Document>`

`input`: a `File`, `Blob`, `ArrayBuffer`, URL string, `<canvas>`, `<img>`, `ImageBitmap`, or an array of these. PDFs are detected by type or content.

| Option | Default | |
|---|---|---|
| `pictures` | `true` | Also cut out pictures, charts and drawings. `false` is faster and keeps them in the background. |
| `pages` | all | PDF page numbers to read, e.g. `[1, 3, 4]`. |
| `onProgress` | | `({ page, pages, progress })`, progress 0–1 over the whole document. |
| `name` | file name | Base name for exported files. |

### `LocalOCR.text(input, options?) → Promise<string>`

Just the text (pictures off).

### `Document`

| | |
|---|---|
| `text` | All text; pages separated by a form feed. |
| `pages` | `Page[]` |
| `toEditablePdf()` | `Promise<Blob>`: editable text over the cleaned page. |
| `toSearchablePdf()` | `Promise<Blob>`: original image plus an invisible text layer. |
| `toPptx()` | `Promise<Blob>`: PowerPoint. |
| `toPngs()` | `Promise<Blob>`: the rebuilt pages as PNG (a ZIP when there are several). |
| `toJSON()` | Plain data: `{ pages: [{ width, height, text, blocks, pictures, shapes }] }`. |

### `Page`

Coordinates are in page pixels; every page is read at 1600 px wide (height keeps the aspect ratio).

```js
{
  index, width: 1600, height,
  text,                                  // this page's text
  blocks: [{
    text, x, y, width, height,
    fontSize, lineHeight, fontFamily,    // "Arial", "Georgia", "Courier New"…
    bold, italic, color, align,          // "#1f1f1f", "left" | "center" | "right"
    runs: [{ start, end, bold?, italic?, color?, sup?, sub? }],   // styled words inside the text
    badge?                               // a number in a circle
  }],
  pictures: [{ src, x, y, width, height }],   // src: PNG/JPEG data URL with transparency
  shapes: [...],                              // lines and arrows, when found
  background(),                               // data URL: the page with text (and pictures) removed
  original()                                  // data URL: the page as it came in
}
```

## Run the demo

```bash
npx http-server -c-1 -p 8080 .
```

Open <http://localhost:8080/demo/>, drop `examples/sample-slides.pdf` or any image. The demo shows the original next to the page rebuilt from editable parts (click any text to edit it) and offers every export.

The page must be served over HTTP(S); browsers don't run the OCR workers from `file://`.

## Test

```bash
npm install
npx playwright install chromium   # once, if you don't have it
npm test
```

`test/smoke.js` reads the examples in headless Chromium and checks every export.

## Good to know

- **Browser only.** It needs `<canvas>`, Web Workers and WebAssembly. For a server, run it in a headless browser (as the test does).
- **English** recognition is included. Other Tesseract languages can be added to `vendor/tesseract/lang/`; the engine currently asks for `eng`.
- **Speed:** about a second per page on a laptop after the first page (the first one loads the model, ~3 MB).
- **Accuracy** is measured on a benchmark of test slides with known answers in the NotebookTools repo (`bench/`): about 98 overall, 100 on text found and on picture separation, on its latest run.
- **Size:** `vendor/` is about 14 MB, mostly the OCR core and model; they load only when you call `recognize()`.

## Updating the engine

`src/engine/` is copied unchanged from NotebookTools, where it is developed and benchmarked:

```bash
scripts/sync-engine.sh /path/to/notebooktools
```

## License

MIT for localOCR. The libraries in `vendor/` keep their own licenses: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
