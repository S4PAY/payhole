// Builds the blog: blog/*.md (front matter + markdown) -> dist/blog/<slug>/index.html, dist/blog/index.html,
// dist/blog/feed.xml. Pages reuse the nav and footer of the docs page so they match the rest of the site.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const SITE = "https://payhole.org";

function frontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error("post without front matter");
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  return { meta, body: m[2] };
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function skeleton(docsHtml) {
  const headEnd = docsHtml.indexOf("<body>") + "<body>\n".length;
  const navEnd = docsHtml.indexOf('<div style="max-width:1200px;margin:0 auto;padding:clamp(64px,9vw,112px) 24px 40px');
  const footStart = docsHtml.indexOf('<div style="border-top:1px solid var(--border)"><div data-r="foot"');
  return { head: docsHtml.slice(0, headEnd), nav: docsHtml.slice(headEnd, navEnd), foot: docsHtml.slice(footStart) };
}

function head(base, title, desc, url, extra = "", image = `${SITE}/og.jpg`) {
  let h = base.replace(/<title>.*?<\/title>/, `<title>${escapeHtml(title)}</title>`);
  h = h.replace(/https:\/\/payhole\.org\/(?:og\.jpg|cards\/[a-z-]+\.png)/g, image);
  if (image.endsWith(".png")) h = h.replace('content="image/jpeg"', 'content="image/png"').replace('content="630"', 'content="630"');
  h = h.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeHtml(desc)}">`);
  for (const k of ["og:title", "twitter:title"]) h = h.replace(new RegExp(`(<meta (?:property|name)="${k}" content=")[^"]*(">)`), `$1${escapeHtml(title)}$2`);
  for (const k of ["og:description", "twitter:description"]) h = h.replace(new RegExp(`(<meta (?:property|name)="${k}" content=")[^"]*(">)`), `$1${escapeHtml(desc)}$2`);
  h = h.replaceAll("https://payhole.org/docs.html", url);
  h = h.replace(/<script type="module" src="[^"]*"><\/script>\n/, "");
  return h.replace("</head>", `${extra}</head>`);
}

const ARTICLE_CSS = `<style>
.ph-post{max-width:760px;margin:0 auto;padding:clamp(56px,8vw,96px) 24px}
.ph-post h1{font:600 clamp(32px,4.6vw,48px) 'Space Grotesk';letter-spacing:-0.03em;line-height:1.08;margin:12px 0 16px}
.ph-post h2{font:600 26px 'Space Grotesk';letter-spacing:-0.02em;margin:40px 0 12px}
.ph-post h3{font:600 19px 'Space Grotesk';letter-spacing:-0.02em;margin:28px 0 8px}
.ph-post p,.ph-post li{font:400 17px/1.7 Inter;color:var(--muted)}
.ph-post li{margin:6px 0}.ph-post ul,.ph-post ol{padding-left:22px}
.ph-post a{color:var(--accent-text)}
.ph-post strong{color:var(--text);font-weight:600}
.ph-post img{display:block;max-width:min(100%,360px);height:auto;margin:28px auto;border-radius:18px;border:1px solid var(--line)}
.ph-post code{font:400 14px 'JetBrains Mono';background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:1px 6px;color:var(--text)}
.ph-post pre{margin:16px 0;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px 20px;overflow-x:auto}
.ph-post pre code{border:0;padding:0;background:none;font:400 13.5px/1.7 'JetBrains Mono'}
.ph-post table{width:100%;border-collapse:collapse;font:400 15px Inter;color:var(--muted);margin:16px 0}
.ph-post th{font:500 11px Inter;letter-spacing:0.08em;text-transform:uppercase;text-align:left;padding:10px 12px;border-bottom:1px solid var(--border);color:var(--muted)}
.ph-post td{padding:10px 12px;border-bottom:1px solid var(--border)}
.ph-post hr{border:0;border-top:1px solid var(--border);margin:32px 0}
.ph-meta{font:500 12px 'JetBrains Mono';color:var(--muted);letter-spacing:0.06em;text-transform:uppercase}
.ph-lead{font:400 19px/1.6 Inter;color:var(--text);margin:0 0 8px}
.ph-list{max-width:760px;margin:0 auto;padding:clamp(56px,8vw,96px) 24px;display:flex;flex-direction:column;gap:12px}
.ph-item{display:block;padding:22px 24px;border-radius:12px;color:inherit;text-decoration:none}
.ph-item h2{font:600 24px 'Space Grotesk';letter-spacing:-0.02em;margin:6px 0 8px;color:var(--text)}
.ph-item p{font:400 15px/1.6 Inter;color:var(--muted);margin:0}
</style>`;

const fmtDate = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

export function buildBlog(root, dist) {
  const docsHtml = readFileSync(join(root, "static", "docs.html"), "utf8");
  const sk = skeleton(docsHtml);
  const dir = join(root, "blog");
  const posts = readdirSync(dir).filter((f) => f.endsWith(".md")).sort().reverse().map((file) => {
    const { meta, body } = frontMatter(readFileSync(join(dir, file), "utf8"));
    const slug = meta.slug || file.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/\.md$/, "");
    const html = marked.parse(body);
    return { ...meta, slug, html, url: `${SITE}/blog/${slug}/`, path: `/blog/${slug}/` };
  });
  const back = `<a href="/blog/" style="font:500 14px Inter;color:var(--muted)">All posts</a>`;
  for (const p of posts) {
    const page = head(sk.head, `${p.title} · PayHole`, p.summary, p.url, ARTICLE_CSS, `${p.url}card.png`) + sk.nav +
      `<article class="ph-post"><div class="ph-meta">${fmtDate(p.date)} · ${escapeHtml(p.tag || "Release")}</div><h1>${escapeHtml(p.title)}</h1><p class="ph-lead">${escapeHtml(p.summary)}</p><hr>${p.html}<hr>${back}</article>\n` + sk.foot;
    mkdirSync(join(dist, "blog", p.slug), { recursive: true });
    writeFileSync(join(dist, "blog", p.slug, "index.html"), page);
  }
  const items = posts.map((p) => `<a class="ph-item ph-glass" href="${p.path}"><div class="ph-meta">${fmtDate(p.date)} · ${escapeHtml(p.tag || "Release")}</div><h2>${escapeHtml(p.title)}</h2><p>${escapeHtml(p.summary)}</p></a>`).join("\n");
  const index = head(sk.head, "Blog · PayHole", "Release notes and progress from PayHole: the extension, the contracts, Sinkhole, and the token.", `${SITE}/blog/`, ARTICLE_CSS + `<link rel="alternate" type="application/rss+xml" title="PayHole blog" href="/blog/feed.xml">`, `${SITE}/cards/blog.png`) + sk.nav +
    `<div class="ph-list"><div><div class="ph-meta">Blog</div><h1 style="font:600 clamp(32px,4.6vw,48px) 'Space Grotesk';letter-spacing:-0.03em;margin:12px 0 4px">Release notes and progress.</h1><p style="font:400 16px/1.6 Inter;color:var(--muted);margin:0">What shipped, what changed, and why. <a href="/blog/feed.xml" style="color:var(--accent-text)">RSS</a></p></div>${items}</div>\n` + sk.foot;
  writeFileSync(join(dist, "blog", "index.html"), index);
  const rss = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>PayHole blog</title><link>${SITE}/blog/</link><description>Release notes and progress from PayHole.</description>${posts.map((p) => `<item><title>${escapeHtml(p.title)}</title><link>${p.url}</link><guid>${p.url}</guid><pubDate>${new Date(p.date + "T12:00:00Z").toUTCString()}</pubDate><description>${escapeHtml(p.summary)}</description></item>`).join("")}</channel></rss>\n`;
  writeFileSync(join(dist, "blog", "feed.xml"), rss);
  return posts.map((p) => ({ url: p.url, date: p.date, slug: p.slug, tag: p.tag || "Release", title: p.title, summary: p.summary }));
}
