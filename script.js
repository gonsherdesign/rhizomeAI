const NS = "http://www.w3.org/2000/svg";
const SVG_W = 1200;
const SVG_H = 760;
const NODE_R = 46;

const svg = document.getElementById("graph");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const btnRhizome = document.getElementById("mode-rhizomatic");
const btnTree = document.getElementById("mode-arborescent");
const btnReset = document.getElementById("reset-view");
const btnResetMode = document.getElementById("reset-mode");
const chatLog = document.getElementById("chat-log");
const linkList = document.getElementById("link-list");

const state = {
  mode: "rhizome",
  tx: 0,
  ty: 0,
  scale: 1,
  panning: false,
  draggingNodeId: null,
  pointerX: 0,
  pointerY: 0,
  didDrag: false,
  selectedId: null,
  nodeCounter: 0,
  nodes: [],
  links: [],
  nodeById: new Map(),
  titleToNode: new Map(),
  resetErase: false,
};

const world = make("g", { class: "world" });
const defs = make("defs");
const linkLayer = make("g");
const nodeLayer = make("g");
world.append(linkLayer, nodeLayer);
svg.append(defs, world);

function make(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 24);
}

function normTitle(title) {
  return String(title || "").toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function clearSelection() {
  state.selectedId = null;
  for (const msg of chatLog.querySelectorAll(".msg")) msg.classList.remove("selected");
  linkList.innerHTML = "";
  searchForm.classList.remove("active-query");
}

function setSelectedNode(nodeId) {
  if (!nodeId) {
    clearSelection();
    return;
  }

  const node = state.nodeById.get(nodeId);
  if (!node) {
    clearSelection();
    return;
  }

  state.selectedId = nodeId;
  for (const msg of chatLog.querySelectorAll(".msg")) {
    msg.classList.toggle("selected", msg.dataset.nodeId === nodeId);
  }

  searchForm.classList.add("active-query");
  searchInput.value = node.title || node.label || "";
  renderLinkList(node);
}

function toggleSelectedNode(nodeId) {
  if (state.selectedId === nodeId) clearSelection();
  else setSelectedNode(nodeId);
}

function addChatEntry(node) {
  const msg = document.createElement("div");
  msg.className = "msg";
  msg.dataset.nodeId = node.id;
  const title = node.title || node.label;
  const summary = node.summary || "No summary available.";
  msg.innerHTML = `<strong>${title}</strong><span class="meta">${summary.slice(0, 180)}</span>`;
  msg.addEventListener("click", () => {
    toggleSelectedNode(node.id);
    if (state.selectedId === node.id) {
      state.tx = SVG_W / 2 - node.x * state.scale;
      state.ty = SVG_H / 2 - node.y * state.scale;
    }
  });
  chatLog.prepend(msg);
}

function edgeKey(a, b) {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function hasEdge(a, b) {
  const key = edgeKey(a, b);
  return state.links.some(([x, y]) => edgeKey(x, y) === key);
}

function linkNodes(a, b) {
  if (!a || !b || a === b) return;
  if (!hasEdge(a, b)) state.links.push([a, b]);
}

function createNode(article, parentId = null) {
  const id = `n-${state.nodeCounter}-${slugify(article.title) || "article"}`;
  state.nodeCounter += 1;
  const node = {
    id,
    title: article.title,
    label: article.title.slice(0, 28),
    summary: article.summary || "",
    url: article.url || "",
    links: Array.isArray(article.links) ? article.links : [],
    x: SVG_W / 2 + (Math.random() - 0.5) * 260,
    y: SVG_H / 2 + (Math.random() - 0.5) * 260,
    vx: 0,
    vy: 0,
    image: article.imageUrl || "",
  };

  state.nodes.push(node);
  state.nodeById.set(id, node);
  state.titleToNode.set(normTitle(article.title), id);
  if (parentId) linkNodes(parentId, id);

  addChatEntry(node);
  return node;
}

function renderLinkList(node) {
  linkList.innerHTML = "";
  const links = Array.isArray(node.links) ? node.links : [];
  for (const entry of links) {
    const li = document.createElement("li");
    const existingId = state.titleToNode.get(normTitle(entry.title));
    if (existingId && existingId === state.selectedId) li.classList.add("selected");

    const a = document.createElement("a");
    a.href = entry.url;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = entry.title;
    a.addEventListener("click", (event) => {
      event.preventDefault();
      submitQuery(entry.title, node.id);
    });

    li.appendChild(a);
    linkList.appendChild(li);
  }
}

async function fetchArticle(query) {
  const res = await fetch(`/api/article?q=${encodeURIComponent(query)}`);
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || "Wikipedia lookup failed.");
  return data.article;
}

function rebuildSvgGraph() {
  defs.innerHTML = "";
  linkLayer.innerHTML = "";
  nodeLayer.innerHTML = "";

  for (const [a, b] of state.links) {
    const line = make("line", { class: `link ${state.mode}`, "data-a": a, "data-b": b });
    linkLayer.append(line);
  }

  for (const node of state.nodes) {
    if (node.image) {
      const pattern = make("pattern", {
        id: `img-${node.id}`,
        patternUnits: "objectBoundingBox",
        width: "1",
        height: "1",
      });
      const img = make("image", {
        href: node.image,
        width: 120,
        height: 120,
        preserveAspectRatio: "xMidYMid slice",
        x: -12,
        y: -12,
      });
      pattern.append(img);
      defs.append(pattern);
    }

    const g = make("g", { class: "node", "data-id": node.id });
    const ring = make("circle", { r: NODE_R, class: "ring" });
    const fill = make("circle", {
      r: NODE_R - 4,
      class: "fill",
      fill: node.image ? `url(#img-${node.id})` : "#ffffff",
    });
    const label = make("text", { y: NODE_R + 20 });
    label.textContent = node.label;

    g.append(ring, fill, label);
    nodeLayer.append(g);
  }
}

function setMode(next) {
  state.mode = next;
  btnRhizome.classList.toggle("active", next === "rhizome");
  btnTree.classList.toggle("active", next === "tree");
  for (const line of linkLayer.querySelectorAll(".link")) {
    line.setAttribute("class", `link ${next}`);
  }
  if (next === "tree") setTreePositions();
}

function setTreePositions() {
  if (!state.nodes.length) return;
  const root = state.nodes[0];
  root.x = SVG_W / 2;
  root.y = 110;

  const rest = state.nodes.slice(1);
  rest.forEach((node, i) => {
    const row = Math.floor(i / 4);
    const col = i % 4;
    const cols = Math.min(4, rest.length - row * 4);
    node.x = ((col + 1) * SVG_W) / (cols + 1);
    node.y = 290 + row * 190;
    node.vx = 0;
    node.vy = 0;
  });
}

function forceTick() {
  if (state.mode !== "rhizome") return;
  const repel = 11000;

  for (let i = 0; i < state.nodes.length; i += 1) {
    for (let j = i + 1; j < state.nodes.length; j += 1) {
      const a = state.nodes[i];
      const b = state.nodes[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d2 = dx * dx + dy * dy + 0.1;
      const f = repel / d2;
      const dist = Math.sqrt(d2);
      a.vx += (dx / dist) * f * 0.001;
      a.vy += (dy / dist) * f * 0.001;
      b.vx -= (dx / dist) * f * 0.001;
      b.vy -= (dy / dist) * f * 0.001;
    }
  }

  for (const [aId, bId] of state.links) {
    const a = state.nodeById.get(aId);
    const b = state.nodeById.get(bId);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const spring = (dist - 220) * 0.007;
    a.vx += (dx / dist) * spring;
    a.vy += (dy / dist) * spring;
    b.vx -= (dx / dist) * spring;
    b.vy -= (dy / dist) * spring;
  }

  for (const node of state.nodes) {
    if (node.id === state.draggingNodeId) continue;
    node.vx *= 0.88;
    node.vy *= 0.88;
    node.x = Math.max(NODE_R, Math.min(SVG_W - NODE_R, node.x + node.vx));
    node.y = Math.max(NODE_R, Math.min(SVG_H - NODE_R, node.y + node.vy));
  }
}

function renderGraph() {
  for (const line of linkLayer.querySelectorAll(".link")) {
    const a = state.nodeById.get(line.getAttribute("data-a"));
    const b = state.nodeById.get(line.getAttribute("data-b"));
    if (!a || !b) continue;
    line.setAttribute("x1", a.x);
    line.setAttribute("y1", a.y);
    line.setAttribute("x2", b.x);
    line.setAttribute("y2", b.y);
  }

  for (const nodeEl of nodeLayer.querySelectorAll(".node")) {
    const id = nodeEl.getAttribute("data-id");
    const node = state.nodeById.get(id);
    if (!node) continue;
    nodeEl.setAttribute("transform", `translate(${node.x.toFixed(2)} ${node.y.toFixed(2)})`);
    nodeEl.classList.toggle("active", state.selectedId === id);
  }

  world.setAttribute(
    "transform",
    `translate(${state.tx.toFixed(2)} ${state.ty.toFixed(2)}) scale(${state.scale.toFixed(3)})`
  );
}

function toWorld(clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * SVG_W;
  const y = ((clientY - rect.top) / rect.height) * SVG_H;
  return { x: (x - state.tx) / state.scale, y: (y - state.ty) / state.scale };
}

function loop() {
  forceTick();
  renderGraph();
  requestAnimationFrame(loop);
}

async function submitQuery(query, forcedParentId = null) {
  const cleaned = String(query || "").trim();
  if (!cleaned) return;

  searchInput.value = "";
  searchForm.classList.remove("has-text");

  try {
    const article = await fetchArticle(cleaned);
    const key = normTitle(article.title);
    const existingId = state.titleToNode.get(key);
    const parentId = forcedParentId || state.selectedId || state.nodes[0]?.id || null;

    if (existingId) {
      linkNodes(parentId, existingId);
      setSelectedNode(existingId);
      rebuildSvgGraph();
      if (state.mode === "tree") setTreePositions();
      renderGraph();
      return;
    }

    const node = createNode(article, parentId);
    setSelectedNode(node.id);
    rebuildSvgGraph();
    if (state.mode === "tree") setTreePositions();
    renderGraph();
  } catch (error) {
    const msg = document.createElement("div");
    msg.className = "msg";
    msg.textContent = `Error: ${error.message}`;
    chatLog.prepend(msg);
  }
}

function initializeGraph() {
  state.nodes = [];
  state.links = [];
  state.nodeById = new Map();
  state.titleToNode = new Map();
  state.selectedId = null;
  state.nodeCounter = 0;
  chatLog.innerHTML = "";
  linkList.innerHTML = "";

  const rootArticle = {
    title: "Wikipedia",
    summary: "Start by searching for an article. Click links to branch the map.",
    url: "https://en.wikipedia.org/wiki/Main_Page",
    imageUrl: "",
    links: [],
  };

  const root = createNode(rootArticle, null);
  root.x = SVG_W / 2;
  root.y = SVG_H / 2;
  clearSelection();
  searchInput.value = "";
  rebuildSvgGraph();
  renderGraph();
}

svg.addEventListener("pointerdown", (e) => {
  const nodeEl = e.target.closest(".node");
  state.pointerX = e.clientX;
  state.pointerY = e.clientY;
  state.didDrag = false;

  if (nodeEl) {
    state.draggingNodeId = nodeEl.getAttribute("data-id");
  } else {
    state.panning = true;
  }
  svg.setPointerCapture(e.pointerId);
});

svg.addEventListener("pointermove", (e) => {
  const dx = e.clientX - state.pointerX;
  const dy = e.clientY - state.pointerY;
  state.pointerX = e.clientX;
  state.pointerY = e.clientY;

  if (Math.abs(dx) + Math.abs(dy) > 2) state.didDrag = true;

  if (state.draggingNodeId) {
    const node = state.nodeById.get(state.draggingNodeId);
    if (!node) return;
    const p = toWorld(e.clientX, e.clientY);
    node.x = p.x;
    node.y = p.y;
    node.vx = 0;
    node.vy = 0;
  } else if (state.panning) {
    state.tx += (dx / svg.clientWidth) * SVG_W;
    state.ty += (dy / svg.clientHeight) * SVG_H;
  }
});

svg.addEventListener("pointerup", (e) => {
  const nodeEl = e.target.closest(".node");
  if (nodeEl && !state.didDrag) {
    const id = nodeEl.getAttribute("data-id");
    toggleSelectedNode(id);
  }

  state.draggingNodeId = null;
  state.panning = false;
  svg.releasePointerCapture(e.pointerId);
});

svg.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const p = toWorld(e.clientX, e.clientY);
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    const newScale = Math.max(0.45, Math.min(2.8, state.scale * factor));
    state.tx += p.x * (state.scale - newScale);
    state.ty += p.y * (state.scale - newScale);
    state.scale = newScale;
  },
  { passive: false }
);

searchInput.addEventListener("input", () => {
  searchForm.classList.toggle("has-text", Boolean(searchInput.value.trim()));
});

searchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  await submitQuery(searchInput.value);
});

btnRhizome.addEventListener("click", () => setMode("rhizome"));
btnTree.addEventListener("click", () => setMode("tree"));
btnResetMode.addEventListener("click", () => {
  state.resetErase = !state.resetErase;
  btnResetMode.textContent = state.resetErase ? "ERASE" : "KEEP";
  btnResetMode.classList.toggle("erase", state.resetErase);
});

btnReset.addEventListener("click", () => {
  state.tx = 0;
  state.ty = 0;
  state.scale = 1;
  searchInput.value = "";
  searchForm.classList.remove("has-text");

  if (state.resetErase) {
    initializeGraph();
  } else {
    clearSelection();
    renderGraph();
  }
});

initializeGraph();
setMode("rhizome");
loop();
