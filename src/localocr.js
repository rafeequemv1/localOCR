/*!
 * localOCR: turn images and image-only PDFs into editable documents, in the
 * browser. Nothing is uploaded: OCR (Tesseract.js), PDF reading (pdf.js) and
 * writing (pdf-lib, PptxGenJS) all run on the user's device.
 *
 *   <script src="localocr/src/localocr.js"></script>
 *   const doc = await LocalOCR.recognize(file);   // image, PDF, canvas or URL
 *   doc.text                                        // all the text, in reading order
 *   doc.pages[0].blocks                             // positioned, styled text
 *   doc.pages[0].pictures                           // cut-out pictures (PNG/JPEG data URLs)
 *   await doc.toEditablePdf()                       // Blob: real text over the cleaned page
 *   await doc.toSearchablePdf()                     // Blob: the original image + invisible text
 *   await doc.toPptx()                              // Blob: PowerPoint with text boxes and pictures
 *
 * MIT licensed. Third-party libraries in vendor/ keep their own licenses.
 */
(function (global) {
  "use strict";

  const SCRIPT_URL = (document.currentScript && document.currentScript.src) || "";
  const ROOT = SCRIPT_URL ? new URL("../", SCRIPT_URL).href.replace(/\/$/, "") : "";
  const settings = {
    base: ROOT, // where src/ and vendor/ live
    vendor: null, // defaults to `${base}/vendor`
  };
  let readyPromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`localOCR: could not load ${src}`));
      document.head.append(s);
    });
  }

  /** Optional: where the library's files are served from (default: next to this script). */
  function configure(options = {}) {
    if (readyPromise) throw new Error("localOCR: configure() before the first recognize() or ready()");
    Object.assign(settings, options);
    return LocalOCR;
  }

  /** Load the engine (once). recognize() calls this for you. */
  function ready() {
    readyPromise ||= (async () => {
      global.NT_VENDOR = settings.vendor || `${settings.base}/vendor`;
      if (!global.NTPdf) await loadScript(`${settings.base}/src/engine/pdf-kit.js`);
      if (!global.NTSlides) await loadScript(`${settings.base}/src/engine/slide-engine.js`);
      return { pdf: global.NTPdf, engine: global.NTSlides };
    })();
    return readyPromise;
  }

  /* ---------- Inputs ---------- */
  const WIDTH = 1600; // the engine works on pages 1600 px wide

  function toWidth(source, w, h) {
    const scale = WIDTH / w;
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function imageFromBlob(blob) {
    if (global.createImageBitmap) {
      try { return await createImageBitmap(blob); } catch (_) { /* fall back to <img> */ }
    }
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  const isPdf = (blob, bytes) =>
    /pdf/i.test(blob.type || "") || /\.pdf$/i.test(blob.name || "") ||
    (bytes && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);

  /** Every page of the input as a canvas 1600 px wide. */
  async function pagesOf(input, options) {
    const { engine } = await ready();
    if (typeof input === "string") input = await (await fetch(input)).blob();
    if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) input = new Blob([input]);
    if (input instanceof Blob) {
      const bytes = new Uint8Array(await input.arrayBuffer());
      if (isPdf(input, bytes)) {
        const { pdf, pageCount } = await engine.loadPdf(bytes);
        const wanted = options.pages ? options.pages.filter((n) => n >= 1 && n <= pageCount) : Array.from({ length: pageCount }, (_, i) => i + 1);
        const out = [];
        for (const n of wanted) out.push(await engine.renderOriginal(pdf, n));
        return out;
      }
      const img = await imageFromBlob(input);
      return [toWidth(img, img.width, img.height)];
    }
    if (input && typeof input.getContext === "function") return [toWidth(input, input.width, input.height)];
    if (global.ImageBitmap && input instanceof ImageBitmap) return [toWidth(input, input.width, input.height)];
    if (global.HTMLImageElement && input instanceof HTMLImageElement) {
      if (!input.complete) await input.decode();
      return [toWidth(input, input.naturalWidth, input.naturalHeight)];
    }
    if (Array.isArray(input)) {
      const all = [];
      for (const item of input) all.push(...(await pagesOf(item, options)));
      return all;
    }
    throw new Error("localOCR: give an image or PDF (File, Blob, ArrayBuffer, URL), a canvas or an <img>");
  }

  /* ---------- Results ---------- */
  const round = (v) => Math.round(v * 10) / 10;

  function pageResult(slide, index) {
    const texts = slide.elements.filter((e) => e.type === "text");
    const blocks = texts.map((e) => ({
      text: e.text,
      x: round(e.x), y: round(e.y), width: round(e.w), height: round(e.h),
      fontSize: round(e.fontSize),
      lineHeight: e.lineHeight,
      fontFamily: e.fontFamily,
      bold: !!e.bold,
      italic: !!e.italic,
      color: e.color,
      align: e.align || "left",
      // styled words inside the text: { start, end, bold?, italic?, color?, sup?, sub? }
      runs: (e.runs || []).map((r) => ({ ...r })),
      ...(e.badge ? { badge: true } : {}),
    }));
    const pictures = slide.elements.filter((e) => e.type === "image").map((e) => ({
      src: e.src, x: round(e.x), y: round(e.y), width: round(e.w), height: round(e.h),
    }));
    const shapes = slide.elements.filter((e) => e.type !== "text" && e.type !== "image").map((e) => ({ ...e }));
    const sorted = blocks.slice().sort((a, b) => (Math.abs(a.y - b.y) < 12 ? a.x - b.x : a.y - b.y));
    return {
      index,
      width: slide.w,
      height: slide.h,
      text: sorted.map((b) => b.text).join("\n\n"),
      blocks,
      pictures,
      shapes,
      /** The page with its text (and, with pictures on, its pictures) removed */
      background: () => slide.clean.toDataURL("image/jpeg", 0.92),
      /** The page as it came in */
      original: () => slide.original.toDataURL("image/jpeg", 0.92),
      _slide: slide,
    };
  }

  // The engine saves its exports itself; catch the file instead of downloading it
  async function capture(run) {
    const { pdf } = await ready();
    const save = pdf.saveBlob;
    let blob = null;
    pdf.saveBlob = (b) => { blob = b; };
    try { await run(); } finally { pdf.saveBlob = save; }
    return blob;
  }

  function makeDocument(slides, name) {
    const pages = slides.map(pageResult);
    const deck = { slides, name, title: name };
    return {
      pages,
      text: pages.map((p) => p.text).join("\n\n\f\n\n"),
      /** PDF with real, selectable and editable text drawn over each cleaned page */
      toEditablePdf: async (onProgress) => capture(async () => (await ready()).engine.exportPdf(deck, `${name}.pdf`, onProgress || (() => {}))),
      /** PowerPoint: text boxes, pictures and shapes, on the cleaned page as background */
      toPptx: async (onProgress) => capture(async () => (await ready()).engine.exportPptx(deck, `${name}.pptx`, onProgress || (() => {}))),
      /** The original page image with an invisible text layer: looks unchanged, text can be searched and copied */
      toSearchablePdf: () => searchablePdf(slides),
      /** One PNG per page, rebuilt from the editable parts */
      toPngs: async () => capture(async () => (await ready()).engine.exportPngs(deck, name)),
      toJSON: () => ({ pages: pages.map(({ background, original, _slide, ...rest }) => rest) }),
    };
  }

  async function searchablePdf(slides) {
    const { pdf } = await ready();
    const { PDFDocument, StandardFonts } = await pdf.pdfLib();
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const PT = 0.75; // 1600 px page = 1200 pt wide
    for (const slide of slides) {
      const jpg = await new Promise((r) => slide.original.toBlob(r, "image/jpeg", 0.9));
      const image = await doc.embedJpg(await jpg.arrayBuffer());
      const pw = slide.w * PT, ph = slide.h * PT;
      const page = doc.addPage([pw, ph]);
      page.drawImage(image, { x: 0, y: 0, width: pw, height: ph });
      for (const el of slide.elements) {
        if (el.type !== "text" || !el.text) continue;
        const lines = el.text.split("\n");
        const lh = el.fontSize * (el.lineHeight || 1.2);
        lines.forEach((line, i) => {
          const clean = line.replace(/[^\x20-\x7E -ÿ]/g, " ").trimEnd();
          if (!clean.trim()) return;
          let size = el.fontSize * PT;
          const want = (el._lines && el._lines[i] ? el._lines[i].w : el.w) * PT;
          const have = font.widthOfTextAtSize(clean, size);
          if (have > 0 && want > 0) size = Math.max(2, Math.min(size * 1.6, size * (want / have)));
          const baseline = el.y + i * lh + (lh - el.fontSize) / 2 + el.fontSize * 0.8;
          page.drawText(clean, { x: el.x * PT, y: ph - baseline * PT, size, font, opacity: 0 });
        });
      }
    }
    return new Blob([await doc.save()], { type: "application/pdf" });
  }

  /**
   * Read an image or PDF and rebuild every page as editable parts.
   * options.pictures (default true): also cut out pictures, drawings and charts
   * options.pages: PDF page numbers to read, e.g. [1, 2, 5]
   * options.onProgress({ page, pages, progress }): progress 0..1 overall
   * options.name: base file name for exports (default "document")
   */
  async function recognize(input, options = {}) {
    const { engine } = await ready();
    const canvases = await pagesOf(input, options);
    const slides = [];
    for (let i = 0; i < canvases.length; i += 1) {
      const slide = engine.newSlide(canvases[i]);
      await engine.analyze(slide, (p) => {
        options.onProgress?.({ page: i + 1, pages: canvases.length, progress: (i + (p || 0)) / canvases.length });
      }, { objects: options.pictures !== false });
      slides.push(slide);
      options.onProgress?.({ page: i + 1, pages: canvases.length, progress: (i + 1) / canvases.length });
    }
    const name = options.name || (input && input.name ? String(input.name).replace(/\.[^.]+$/, "") : "document");
    return makeDocument(slides, name);
  }

  /** Just the text: a quick read without pictures. */
  async function text(input, options = {}) {
    return (await recognize(input, { ...options, pictures: false })).text;
  }

  const LocalOCR = { version: "1.0.0", configure, ready, recognize, text };
  global.LocalOCR = LocalOCR;
})(typeof window !== "undefined" ? window : globalThis);
