// Crawler: starts at a domain's home page, follows same-domain links breadth-first,
// and turns each page into a { url, title, tag[], companyId, companyName } record.
const cheerio = require('cheerio');

const USER_AGENT = 'SimonAPI-Crawler/1.0';
const SKIP_EXT = /\.(pdf|jpe?g|png|gif|svg|webp|ico|css|js|json|xml|zip|mp4|mp3|docx?|xlsx?|pptx?)$/i;

// Path keywords that map to a broader tag, alongside the keyword itself.
const TAG_GROUPS = {
  'company information': ['about', 'about-us', 'who-we-are', 'company', 'our-story', 'history', 'leadership', 'team', 'people', 'mission', 'values'],
  careers: ['careers', 'career', 'jobs', 'join-us', 'work-with-us', 'vacancies', 'graduates', 'internships'],
  contact: ['contact', 'contact-us', 'locations', 'offices', 'find-us'],
  news: ['news', 'press', 'media', 'newsroom', 'blog', 'insights', 'articles', 'events'],
  services: ['services', 'service', 'solutions', 'what-we-do', 'industries', 'products', 'capabilities', 'expertise'],
  legal: ['privacy', 'privacy-policy', 'terms', 'cookies', 'legal', 'accessibility', 'disclaimer'],
};

function normalizeDomain(input) {
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  return new URL(withScheme).host.toLowerCase().replace(/^www\./, '');
}

// Plain http only when the caller asks for it explicitly ("http://...").
function startUrl(input, domain) {
  return /^http:\/\//i.test(input) ? `http://${domain}/` : `https://${domain}/`;
}

// "grantthornton.com" -> "grantthornton"
function deriveCompanyId(domain) {
  return domain.split(/[.:]/)[0].replace(/[^a-z0-9-]/g, '');
}

function cleanUrl(href, base) {
  try {
    const u = new URL(href, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    u.search = '';
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    return u.toString();
  } catch {
    return null;
  }
}

function sameSite(url, domain) {
  const host = new URL(url).host.toLowerCase().replace(/^www\./, '');
  return host === domain;
}

function inferTags(url, title) {
  const tags = new Set();
  const segments = new URL(url).pathname.toLowerCase().split('/').filter(Boolean);
  if (segments.length === 0) tags.add('home');

  // Language/locale prefixes like /en or /en-gb aren't useful tags.
  const words = segments.filter((s) => !/^[a-z]{2}(-[a-z]{2})?$/.test(s)).slice(0, 2);
  const titleWords = (title || '').toLowerCase();

  for (const seg of words) tags.add(seg.replace(/-us$/, '').replace(/-/g, ' '));
  for (const [group, keywords] of Object.entries(TAG_GROUPS)) {
    if (keywords.some((k) => words.includes(k) || titleWords.includes(k.replace(/-/g, ' ')))) {
      tags.add(group);
    }
  }
  return [...tags];
}

function pageTitle($) {
  const raw = $('title').first().text() || $('meta[property="og:title"]').attr('content') || $('h1').first().text() || '';
  // "About | Grant Thornton" -> "About"
  return raw.split(/\s[|\-–—:]\s/)[0].replace(/\s+/g, ' ').trim();
}

function siteName($, domain) {
  const og = $('meta[property="og:site_name"]').attr('content');
  if (og) return og.trim();
  const parts = ($('title').first().text() || '').split(/\s[|\-–—:]\s/).map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) return parts[parts.length - 1];
  const id = deriveCompanyId(domain);
  return id.charAt(0).toUpperCase() + id.slice(1);
}

async function fetchPage(url, timeoutMs) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const type = res.headers.get('content-type') || '';
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!type.includes('text/html')) return null;
  return { finalUrl: res.url, html: await res.text() };
}

async function crawl(domainInput, opts = {}) {
  const domain = normalizeDomain(domainInput);
  const maxPages = Math.min(opts.maxPages || 50, 500);
  const concurrency = opts.concurrency || 5;
  const timeoutMs = opts.timeoutMs || 10000;
  let companyId = opts.companyId || deriveCompanyId(domain);
  let companyName = opts.companyName || null;

  const start = startUrl(domainInput, domain);
  const queue = [start];
  const seen = new Set([start]);
  const records = [];
  const errors = [];

  async function visit(url) {
    let page;
    try {
      page = await fetchPage(url, timeoutMs);
    } catch (err) {
      errors.push({ url, error: err.message });
      return;
    }
    if (!page) return;

    const $ = cheerio.load(page.html);
    if (!companyName) companyName = siteName($, domain);

    const url_ = cleanUrl(page.finalUrl, page.finalUrl) || url;
    const title = pageTitle($);
    records.push({ url: url_, title, tag: inferTags(url_, title), companyId, companyName });

    $('a[href]').each((_, a) => {
      const link = cleanUrl($(a).attr('href'), page.finalUrl);
      if (!link || seen.has(link) || SKIP_EXT.test(link) || !sameSite(link, domain)) return;
      seen.add(link);
      queue.push(link);
    });
  }

  // Simple worker pool: N workers pull from the shared queue until it's empty or we hit maxPages.
  let inFlight = 0;
  async function worker() {
    while (records.length + inFlight < maxPages) {
      const next = queue.shift();
      if (!next) {
        if (inFlight === 0) return;
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }
      inFlight++;
      await visit(next);
      inFlight--;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  // De-duplicate pages that redirected to the same final URL.
  const unique = [...new Map(records.map((r) => [r.url, r])).values()];
  for (const r of unique) r.companyName = companyName;

  return {
    companyId,
    companyName,
    domain,
    crawledAt: new Date().toISOString(),
    records: unique,
    errors,
  };
}

module.exports = { crawl, normalizeDomain, inferTags };
