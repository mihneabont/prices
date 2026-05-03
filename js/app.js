/**
 * Normalized catalog row (sealed product or legacy card entry).
 * @typedef {{ id: string; name?: string; imageUrl?: string; categoryName?: string; idCategory?: number; idExpansion?: number; setCode?: string; setName?: string; number?: string; [k: string]: unknown }} CatalogRow
 */
/** @typedef {{ cardId?: string; id?: string; idProduct?: number; productId?: number; [k: string]: unknown }} PriceRow */

const STORAGE_KEY = "pokemon-tcg-portfolio-v1";

/** Keys that are IDs or metadata, not price amounts, on price rows */
const PRICE_ROW_NUMERIC_SKIP = new Set([
  "id",
  "cardId",
  "idProduct",
  "productId",
  "idCategory",
  "idExpansion",
  "idMetacard",
  "version",
]);

/**
 * CardMarket-style catalog: `{ version, createdAt, products: [{ idProduct, name, ... }] }`
 * Legacy: flat array of `{ id: string, ... }`.
 * @param {unknown} raw
 * @returns {CatalogRow[]}
 */
function normalizeCatalog(raw) {
  if (!raw || typeof raw !== "object") return [];

  const products = /** @type {{ products?: unknown }} */ (raw).products;
  if (Array.isArray(products)) {
    const out = [];
    for (const p of products) {
      if (!p || typeof p !== "object") continue;
      const row = /** @type {Record<string, unknown>} */ (p);
      const idProduct = row.idProduct;
      if (typeof idProduct !== "number" || !Number.isFinite(idProduct)) continue;
      out.push({
        ...row,
        id: String(idProduct),
        name: typeof row.name === "string" ? row.name : undefined,
        categoryName: typeof row.categoryName === "string" ? row.categoryName : undefined,
        idCategory: typeof row.idCategory === "number" ? row.idCategory : undefined,
        idExpansion: typeof row.idExpansion === "number" ? row.idExpansion : undefined,
      });
    }
    return out;
  }

  if (Array.isArray(raw)) {
    return raw
      .filter((c) => c && typeof c === "object" && typeof /** @type {CatalogRow} */ (c).id === "string")
      .map((c) => /** @type {CatalogRow} */ ({ .../** @type {object} */ (c) }));
  }

  return [];
}

/** @returns {{ lines: PortfolioLine[] }} */
function loadPortfolio() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { lines: [] };
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.lines)) return { lines: [] };
    return { lines: data.lines };
  } catch {
    return { lines: [] };
  }
}

/** @param {{ lines: PortfolioLine[] }} p */
function savePortfolio(p) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, lines: p.lines }));
}

/**
 * Accept: `{ priceGuides: [...] }` (CardMarket export), a price row array,
 * or Record<string, Record<string, number>>.
 * @param {unknown} raw
 * @returns {Map<string, Record<string, number>>}
 */
function normalizePrices(raw) {
  const map = new Map();

  /** @param {unknown} rows */
  function addPriceRows(rows) {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const pr = /** @type {PriceRow} */ (row);
      const id = priceRowCatalogId(pr);
      if (!id) continue;
      const nums = numericFields(pr);
      if (Object.keys(nums).length) map.set(id, nums);
    }
  }

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const guides = /** @type {{ priceGuides?: unknown }} */ (raw).priceGuides;
    if (Array.isArray(guides)) {
      addPriceRows(guides);
      return map;
    }
  }

  if (Array.isArray(raw)) {
    addPriceRows(raw);
    return map;
  }

  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (raw))) {
      if (!v || typeof v !== "object" || Array.isArray(v)) continue;
      const pr = /** @type {PriceRow} */ (v);
      const id = priceRowCatalogId(pr) || k;
      if (!id) continue;
      const nums = numericFields(pr);
      if (Object.keys(nums).length) map.set(id, nums);
    }
  }
  return map;
}

/** @param {PriceRow} row */
function priceRowCatalogId(row) {
  if (typeof row.cardId === "string" && row.cardId.trim() !== "") return row.cardId.trim();
  if (typeof row.id === "string" && row.id.trim() !== "") return row.id.trim();
  if (typeof row.idProduct === "number" && Number.isFinite(row.idProduct)) return String(Math.trunc(row.idProduct));
  if (typeof row.productId === "number" && Number.isFinite(row.productId)) return String(Math.trunc(row.productId));
  if (typeof row.idProduct === "string" && row.idProduct.trim() !== "") return row.idProduct.trim();
  if (typeof row.productId === "string" && row.productId.trim() !== "") return row.productId.trim();
  return "";
}

/** @param {PriceRow} row */
function numericFields(row) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (PRICE_ROW_NUMERIC_SKIP.has(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) out[k] = Number(v);
  }
  return out;
}

/** @param {CatalogRow} card @param {Map<string, Record<string, number>>} prices */
function mergedCard(card, prices) {
  const id = card.id;
  const priceFields = prices.get(id) ?? {};
  const defaultKey = pickDefaultPriceKey(priceFields);
  const defaultPrice = defaultKey != null ? priceFields[defaultKey] : null;
  return { ...card, _prices: priceFields, _defaultKey: defaultKey, _displayPrice: defaultPrice };
}

/**
 * @param {Record<string, number>} pf
 * @returns {string | null}
 */
function pickDefaultPriceKey(pf) {
  const keys = Object.keys(pf);
  if (!keys.length) return null;
  /** 7-day avg when present, else trend (CardMarket-style guide). */
  const preferred = [
    "avg7",
    "avg7-holo",
    "trend",
    "trend-holo",
    "trendPrice",
    "avg30",
    "avg30-holo",
    "avg1",
    "avg1-holo",
    "avg",
    "avg-holo",
    "low",
    "low-holo",
    "usdMarket",
    "market",
    "average",
    "mid",
    "high",
    "usdNearMint",
    "nearMint",
    "nm",
    "price",
  ];
  for (const p of preferred) {
    if (pf[p] != null && Number.isFinite(pf[p])) return p;
  }
  const rest = keys.filter((k) => Number.isFinite(pf[k])).sort((a, b) => pf[b] - pf[a]);
  return rest[0] ?? null;
}

/**
 * @typedef {{ cardId: string; quantity: number; priceKey: string }} PortfolioLine
 */

/**
 * Format EUR (guide prices are euro amounts).
 * @param {number} n
 */
function fmtEur(n) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "EUR",
    currencyDisplay: "narrowSymbol",
  }).format(n);
}

const els = {
  totalValue: /** @type {HTMLElement} */ (document.getElementById("total-value")),
  distinctCount: /** @type {HTMLElement} */ (document.getElementById("distinct-count")),
  qtyCount: /** @type {HTMLElement} */ (document.getElementById("qty-count")),
  catalogGrid: /** @type {HTMLElement} */ (document.getElementById("catalog-grid")),
  catalogStatus: /** @type {HTMLElement} */ (document.getElementById("catalog-status")),
  catalogSearch: /** @type {HTMLInputElement} */ (document.getElementById("catalog-search")),
  holdingsBody: /** @type {HTMLTableSectionElement} */ (document.getElementById("holdings-body")),
  holdingsTable: /** @type {HTMLTableElement} */ (document.getElementById("holdings-table")),
  portfolioEmpty: /** @type {HTMLElement} */ (document.getElementById("portfolio-empty")),
  addDialog: /** @type {HTMLDialogElement} */ (document.getElementById("add-dialog")),
  addForm: /** @type {HTMLFormElement} */ (document.getElementById("add-form")),
  addQty: /** @type {HTMLInputElement} */ (document.getElementById("add-qty")),
  addTier: /** @type {HTMLSelectElement} */ (document.getElementById("add-tier")),
  addDialogTitle: /** @type {HTMLElement} */ (document.getElementById("add-dialog-title")),
  addDialogMeta: /** @type {HTMLElement} */ (document.getElementById("add-dialog-meta")),
  addCancel: /** @type {HTMLButtonElement} */ (document.getElementById("add-cancel")),
};

/** @type {ReturnType<typeof mergedCard>[] | null} */
let merged = null;

function setTabs() {
  const tabs = document.querySelectorAll(".tab");
  const panels = {
    catalog: document.getElementById("panel-catalog"),
    portfolio: document.getElementById("panel-portfolio"),
  };
  for (const btn of tabs) {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-tab");
      if (!key || !(key in panels)) return;
      for (const t of tabs) {
        const on = t === btn;
        t.classList.toggle("active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      }
      for (const [name, panel] of Object.entries(panels)) {
        if (!panel) continue;
        const on = name === key;
        panel.classList.toggle("active", on);
        panel.hidden = !on;
      }
    });
  }
}

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

/**
 * @param {CatalogRow[]} cards
 * @param {Map<string, Record<string, number>>} prices
 */
function rebuildMerged(cards, prices) {
  merged = cards.map((c) => mergedCard(c, prices));
}

/** @param {CatalogRow | ReturnType<typeof mergedCard>} c */
function catalogMetaLine(c) {
  const parts = [];
  if (typeof c.categoryName === "string" && c.categoryName.trim() !== "") parts.push(c.categoryName.trim());
  if (typeof c.idExpansion === "number" && Number.isFinite(c.idExpansion)) parts.push(`Exp. ${c.idExpansion}`);
  const legacySet = [c.setName, c.setCode].filter((x) => typeof x === "string" && x.trim() !== "").join(" ").trim();
  if (legacySet) parts.push(legacySet);
  if (typeof c.number === "string" && c.number.trim() !== "") parts.push(`#${c.number.trim()}`);
  return parts.join(" · ");
}

/**
 * @param {string} q
 */
function filterMerged(q) {
  if (!merged) return [];
  const s = q.trim().toLowerCase();
  if (!s) return merged;
  return merged.filter((c) => {
    const hay = [
      c.name,
      c.categoryName,
      c.idExpansion != null ? String(c.idExpansion) : "",
      c.setName,
      c.setCode,
      c.number,
      c.id,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(s);
  });
}

/**
 * @param {ReturnType<typeof mergedCard>} card
 */
function renderCatalogTile(card) {
  const li = document.createElement("li");
  li.className = "product-tile";

  const fig = document.createElement("figure");
  if (card.imageUrl && typeof card.imageUrl === "string") {
    const img = document.createElement("img");
    img.src = card.imageUrl;
    img.alt = card.name ?? card.id;
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.onerror = () => {
      fig.replaceChildren();
      fig.appendChild(placeholdProduct(card.name ?? card.id));
    };
    fig.appendChild(img);
  } else {
    fig.appendChild(placeholdProduct(card.name ?? card.id));
  }
  li.appendChild(fig);

  const body = document.createElement("div");
  body.className = "body";

  const name = document.createElement("div");
  name.className = "name";
  name.textContent = card.name ?? card.id;

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = catalogMetaLine(card) || `#${card.id}`;

  const row = document.createElement("div");
  row.className = "price-row";

  const price = document.createElement("span");
  price.className = "price";
  price.textContent =
    typeof card._displayPrice === "number" && Number.isFinite(card._displayPrice) ? fmtEur(card._displayPrice) : "—";

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn primary";
  addBtn.textContent = "Add";
  addBtn.disabled = Object.keys(card._prices).length === 0;
  addBtn.addEventListener("click", () => openAddDialog(card));

  row.appendChild(price);
  row.appendChild(addBtn);

  body.appendChild(name);
  body.appendChild(meta);
  body.appendChild(row);
  li.appendChild(body);

  return li;
}

/** @param {string} label */
function placeholdProduct(label) {
  const d = document.createElement("div");
  d.className = "placeholder";
  d.textContent = label ? `Sealed · no image\n${label}` : "Sealed product";
  return d;
}

/** @param {ReturnType<typeof mergedCard>} card */
function openAddDialog(card) {
  const keys = Object.keys(card._prices).sort();
  els.addDialogTitle.textContent = "Add to portfolio";
  els.addDialogMeta.textContent = [card.name, `#${card.id}`, catalogMetaLine(card)].filter(Boolean).join(" · ");
  els.addQty.value = "1";

  els.addTier.innerHTML = "";
  for (const k of keys) {
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = `${k} (${fmtEur(card._prices[k])})`;
    els.addTier.appendChild(opt);
  }

  els.addDialog.dataset.cardId = card.id;

  els.addTier.value = keys.includes(String(card._defaultKey)) ? String(card._defaultKey) : keys[0];

  if (typeof els.addDialog.showModal === "function") els.addDialog.showModal();
  else alert("Browser does not support dialogs; use Chrome, Edge, or Firefox.");
}

/** @returns {PortfolioLine[]} */
function getLinesSafe() {
  return loadPortfolio().lines.filter(
    (l) => l && typeof l.cardId === "string" && typeof l.quantity === "number" && typeof l.priceKey === "string"
  );
}

function refreshHeader(lines) {
  if (!merged) return;

  /** @type {Map<string, ReturnType<typeof mergedCard>>} */
  const byId = new Map(merged.map((c) => [c.id, c]));

  let total = 0;
  let qty = 0;
  for (const line of lines) {
    const c = byId.get(line.cardId);
    if (!c) continue;
    const unit = c._prices[line.priceKey];
    if (!Number.isFinite(unit)) continue;
    const q = Math.max(0, Math.floor(line.quantity));
    total += unit * q;
    qty += q;
  }

  els.totalValue.textContent = fmtEur(total);
  els.distinctCount.textContent = String(new Set(lines.map((l) => l.cardId)).size);
  els.qtyCount.textContent = String(qty);
}

function renderPortfolio() {
  const lines = getLinesSafe();
  refreshHeader(lines);

  const empty = lines.length === 0;
  els.portfolioEmpty.hidden = !empty;
  els.holdingsTable.hidden = empty;

  els.holdingsBody.replaceChildren();

  if (!merged) return;

  const byId = new Map(merged.map((c) => [c.id, c]));

  for (const line of lines) {
    const c = byId.get(line.cardId);
    const unit = c?._prices[line.priceKey];

    const tr = document.createElement("tr");

    const tdCard = document.createElement("td");
    tdCard.dataset.label = "Product";
    tdCard.className = "cell-card";
    if (c?.imageUrl) {
      const img = document.createElement("img");
      img.src = /** @type {string} */ (c.imageUrl);
      img.alt = "";
      img.className = "thumb";
      img.loading = "lazy";
      tdCard.appendChild(img);
    }
    const text = document.createElement("span");
    text.textContent = c?.name ?? line.cardId;
    tdCard.appendChild(text);

    const tdSet = document.createElement("td");
    tdSet.dataset.label = "Type / expansion";
    tdSet.textContent = c ? catalogMetaLine(c) || "—" : "—";

    const tdQty = document.createElement("td");
    tdQty.dataset.label = "Qty";
    const wrap = document.createElement("div");
    wrap.className = "qty-control";
    const inp = document.createElement("input");
    inp.type = "number";
    inp.min = "1";
    inp.step = "1";
    inp.valueAsNumber = Math.max(1, Math.floor(line.quantity));
    inp.addEventListener("change", () => {
      const next = Math.max(1, Math.floor(inp.valueAsNumber || 1));
      const p = loadPortfolio();
      const i = p.lines.findIndex((l) => l.cardId === line.cardId && l.priceKey === line.priceKey);
      if (i >= 0) p.lines[i].quantity = next;
      savePortfolio(p);
      refreshHeader(getLinesSafe());
      updateLineTotals(tr, line.cardId, line.priceKey, next);
    });
    wrap.appendChild(inp);
    tdQty.appendChild(wrap);

    const tdUnit = document.createElement("td");
    tdUnit.dataset.label = "Unit price";
    tdUnit.textContent = Number.isFinite(unit) ? fmtEur(unit) : "—";

    const tdLine = document.createElement("td");
    tdLine.dataset.label = "Line total";
    const q = Math.max(1, Math.floor(line.quantity));
    tdLine.textContent = Number.isFinite(unit) ? fmtEur(unit * q) : "—";

    const tdAct = document.createElement("td");
    tdAct.dataset.label = "";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn danger";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      const p = loadPortfolio();
      p.lines = p.lines.filter((l) => !(l.cardId === line.cardId && l.priceKey === line.priceKey));
      savePortfolio(p);
      renderPortfolio();
      renderCatalog(els.catalogSearch.value);
    });
    tdAct.appendChild(remove);

    tr.dataset.cardId = line.cardId;
    tr.dataset.priceKey = line.priceKey;

    tr.appendChild(tdCard);
    tr.appendChild(tdSet);
    tr.appendChild(tdQty);
    tr.appendChild(tdUnit);
    tr.appendChild(tdLine);
    tr.appendChild(tdAct);

    els.holdingsBody.appendChild(tr);
  }
}

/**
 * @param {HTMLTableRowElement} tr
 * @param {string} cardId
 * @param {string} priceKey
 * @param {number} qty
 */
function updateLineTotals(tr, cardId, priceKey, qty) {
  if (!merged) return;
  const c = merged.find((x) => x.id === cardId);
  const unit = c?._prices[priceKey];
  const cells = tr.querySelectorAll("td");
  const lineCell = cells[4];
  if (lineCell && Number.isFinite(unit)) lineCell.textContent = fmtEur(unit * qty);
}

/** @param {string} query */
function renderCatalog(query) {
  if (!merged) return;
  const list = filterMerged(query);
  els.catalogGrid.replaceChildren();

  els.catalogStatus.textContent = `${list.length} product${list.length === 1 ? "" : "s"}`;

  const frag = document.createDocumentFragment();
  for (const c of list) frag.appendChild(renderCatalogTile(c));
  els.catalogGrid.appendChild(frag);
}

async function bootstrap() {
  setTabs();

  els.addCancel.addEventListener("click", () => els.addDialog.close());
  els.addForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = els.addDialog.dataset.cardId;
    if (!id || !merged) return;
    const qty = Math.max(1, Math.floor(els.addQty.valueAsNumber || 1));
    const priceKey = els.addTier.value;
    const p = loadPortfolio();
    const dup = p.lines.find((l) => l.cardId === id && l.priceKey === priceKey);
    if (dup) dup.quantity += qty;
    else p.lines.push({ cardId: id, quantity: qty, priceKey });
    savePortfolio(p);
    els.addDialog.close();
    renderPortfolio();
    renderCatalog(els.catalogSearch.value);
  });

  els.catalogSearch.addEventListener("input", () => {
    renderCatalog(els.catalogSearch.value);
  });

  try {
    const [cardsRaw, pricesRaw] = await Promise.all([loadJson("./data/cards.json"), loadJson("./data/prices.json")]);

    const cards = normalizeCatalog(cardsRaw);
    if (!cards.length) {
      throw new Error(
        "No products in cards.json. Expected `{ products: [{ idProduct, name, ... }] }` or a legacy array with string `id`."
      );
    }

    const priceMap = normalizePrices(pricesRaw);
    rebuildMerged(cards, priceMap);

    const missing = merged.filter((c) => Object.keys(c._prices).length === 0).length;
    els.catalogStatus.textContent = `${merged.length} products · ${merged.length - missing} with prices`;

    renderCatalog("");
    renderPortfolio();
  } catch (err) {
    console.error(err);
    els.catalogStatus.textContent = err instanceof Error ? err.message : "Failed to load data.";
  }
}

bootstrap();
