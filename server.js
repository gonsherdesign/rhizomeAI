import dotenv from "dotenv";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 8787);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

function wikiTitleUrl(title) {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(String(title).replace(/\s+/g, "_"))}`;
}

async function wikipediaSearchTopTitle(query) {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*" +
    `&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Wikipedia search error ${response.status}`);
  const json = await response.json();
  const first = json?.query?.search?.[0];
  if (!first?.title) throw new Error("No matching Wikipedia article found.");
  return first.title;
}

async function wikipediaArticleByTitle(title) {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*" +
    `&titles=${encodeURIComponent(title)}` +
    "&prop=info|extracts|pageimages|links" +
    "&inprop=url&exintro=1&explaintext=1&pithumbsize=720&pllimit=100&plnamespace=0";

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Wikipedia article error ${response.status}`);

  const json = await response.json();
  const pages = json?.query?.pages ? Object.values(json.query.pages) : [];
  const page = pages[0];

  if (!page || page.missing) throw new Error("Wikipedia article not found.");

  const links = Array.isArray(page.links)
    ? page.links
        .map((link) => String(link?.title || "").trim())
        .filter(Boolean)
        .slice(0, 80)
        .map((linkTitle) => ({
          title: linkTitle,
          url: wikiTitleUrl(linkTitle),
        }))
    : [];

  return {
    title: String(page.title || title),
    summary: String(page.extract || "").trim(),
    url: String(page.fullurl || wikiTitleUrl(page.title || title)),
    imageUrl: String(page?.thumbnail?.source || ""),
    links,
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, provider: "wikipedia" });
});

app.get("/api/article", async (req, res) => {
  const query = String(req.query.q || "").trim();
  if (!query) {
    return res.status(400).json({ ok: false, error: "Missing query parameter q." });
  }

  try {
    const title = await wikipediaSearchTopTitle(query);
    const article = await wikipediaArticleByTitle(title);
    return res.json({ ok: true, article });
  } catch (error) {
    return res.status(500).json({ ok: false, error: String(error?.message || error) });
  }
});

app.listen(PORT, () => {
  console.log(`RhizomeAI Wikipedia server running at http://localhost:${PORT}`);
});
