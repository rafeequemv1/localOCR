// localOCR demo: read a file, show the original and the page rebuilt from
// editable parts, and offer every export.
const $ = (s) => document.querySelector(s);
let doc = null;

function status(message, error) {
  const el = $("#status");
  el.hidden = !message;
  el.textContent = message || "";
  el.classList.toggle("is-error", !!error);
}

function save(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// A block's text with its styled words (bold, italic, colour, super/subscript)
function styled(block) {
  const frag = document.createDocumentFragment();
  const cuts = new Set([0, block.text.length]);
  for (const r of block.runs) { cuts.add(r.start); cuts.add(r.end); }
  const points = [...cuts].sort((a, b) => a - b);
  for (let i = 0; i < points.length - 1; i += 1) {
    const [a, b] = [points[i], points[i + 1]];
    const run = block.runs.find((r) => r.start <= a && r.end >= b) || {};
    const piece = block.text.slice(a, b);
    if (!run.bold && !run.italic && !run.color && !run.sup && !run.sub) { frag.append(piece); continue; }
    const el = document.createElement(run.sup ? "sup" : run.sub ? "sub" : "span");
    el.textContent = piece;
    if (run.bold) el.style.fontWeight = "700";
    if (run.italic) el.style.fontStyle = "italic";
    if (run.color) el.style.color = run.color;
    frag.append(el);
  }
  return frag;
}

// The page rebuilt from what localOCR found: background, pictures, then text
function rebuilt(page, box) {
  box.innerHTML = "";
  const bg = new Image();
  bg.className = "full";
  bg.src = page.background();
  box.append(bg);
  const layer = document.createElement("div");
  layer.className = "layer";
  layer.style.width = `${page.width}px`;
  layer.style.height = `${page.height}px`;
  for (const p of page.pictures) {
    const img = new Image();
    img.src = p.src;
    Object.assign(img.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${p.width}px`, height: `${p.height}px` });
    layer.append(img);
  }
  for (const b of page.blocks) {
    const t = document.createElement("div");
    t.contentEditable = "true";
    t.append(styled(b));
    Object.assign(t.style, {
      left: `${b.x}px`, top: `${b.y}px`, width: `${b.width}px`,
      fontSize: `${b.fontSize}px`, lineHeight: String(b.lineHeight || 1.2), color: b.color,
      fontWeight: b.bold ? "700" : "400", fontStyle: b.italic ? "italic" : "normal",
      fontFamily: b.fontFamily || "Arial", textAlign: b.align,
    });
    layer.append(t);
  }
  box.append(layer);
  const fit = () => { layer.style.transform = `scale(${box.clientWidth / page.width})`; };
  bg.onload = fit;
  new ResizeObserver(fit).observe(box);
}

async function run(file) {
  try {
    $("#result").hidden = true;
    status("Reading…");
    doc = await LocalOCR.recognize(file, {
      pictures: $("#pictures").checked,
      onProgress: ({ page, pages, progress }) => status(`Reading page ${page} of ${pages}… ${Math.round(progress * 100)}%`),
    });
    const page = doc.pages[0];
    $("#original").innerHTML = `<img class="full" src="${page.original()}" alt="">`;
    rebuilt(page, $("#rebuilt"));
    $("#text").textContent = doc.text || "(no text found)";
    $("#result").hidden = false;
    status(`Done: ${doc.pages.length} page${doc.pages.length === 1 ? "" : "s"}, ${doc.pages.reduce((n, p) => n + p.blocks.length, 0)} text boxes, ${doc.pages.reduce((n, p) => n + p.pictures.length, 0)} pictures.`);
  } catch (error) {
    console.error(error);
    status(error.message || "Something went wrong.", true);
  }
}

$("#file").addEventListener("change", (e) => e.target.files[0] && run(e.target.files[0]));
const drop = $("#drop");
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("is-over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("is-over"); if (e.dataTransfer.files[0]) run(e.dataTransfer.files[0]); });

document.querySelector(".actions").addEventListener("click", async (e) => {
  const kind = e.target.dataset.export;
  if (!kind || !doc) return;
  status("Preparing the file…");
  if (kind === "editable") save(await doc.toEditablePdf(), "editable.pdf");
  if (kind === "searchable") save(await doc.toSearchablePdf(), "searchable.pdf");
  if (kind === "pptx") save(await doc.toPptx(), "slides.pptx");
  if (kind === "json") save(new Blob([JSON.stringify(doc.toJSON(), null, 2)], { type: "application/json" }), "document.json");
  if (kind === "text") save(new Blob([doc.text], { type: "text/plain" }), "document.txt");
  status("");
});
