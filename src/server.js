const fs = require('fs');
const path = require('path');
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yaml');
const { crawl, normalizeDomain } = require('./crawler');
const db = require('./db');

const app = express();
app.use(express.json());

// API docs: interactive Swagger UI at /simonapi/docs, raw spec at /simonapi/openapi.json.
const spec = YAML.parse(fs.readFileSync(path.join(__dirname, '..', 'openapi.yaml'), 'utf8'));
app.get('/simonapi/openapi.json', (_req, res) => res.json(spec));
app.use('/simonapi/docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'Simon API Docs' }));

// Part 1: crawl a domain and store the results.
// POST /simonapi/crawl  { "domain": "grantthornton.com", "companyId"?: "gram", "companyName"?: "Grant Thornton", "maxPages"?: 50 }
app.post('/simonapi/crawl', async (req, res) => {
  const { domain, companyId, companyName, maxPages } = req.body || {};
  if (!domain || typeof domain !== 'string') {
    return res.status(400).json({ error: 'Body must include a "domain" string, e.g. {"domain":"grantthornton.com"}' });
  }
  try {
    normalizeDomain(domain);
  } catch {
    return res.status(400).json({ error: `Invalid domain: ${domain}` });
  }

  try {
    const { errors, ...company } = await crawl(domain, { companyId, companyName, maxPages: Number(maxPages) || undefined });
    if (company.records.length === 0) {
      return res.status(502).json({ error: `Could not fetch any pages from ${company.domain}`, errors });
    }
    await db.saveCompany(company);
    res.status(201).json({
      companyId: company.companyId,
      companyName: company.companyName,
      domain: company.domain,
      pagesStored: company.records.length,
      failedPages: errors.length,
      results: `/simonapi/company/${company.companyId}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Part 2: read-only access to stored results.
app.get('/simonapi/company', async (_req, res) => {
  res.json(await db.listCompanies());
});

// Search stored pages by tag. Registered before /company/:id so "search" isn't taken as an id.
// GET /simonapi/company/search?tags=about,company information[&companyId=gram][&match=all|any]
app.get('/simonapi/company/search', async (req, res) => {
  const { tags, tag, companyId, match = 'all' } = req.query;
  const list = [tags, tag].flat().filter((v) => typeof v === 'string').flatMap((v) => v.split(','));
  const wanted = list.map((t) => t.trim()).filter(Boolean);
  if (wanted.length === 0) {
    return res.status(400).json({ error: 'Pass at least one tag, e.g. ?tags=about,company information' });
  }
  if (match !== 'all' && match !== 'any') {
    return res.status(400).json({ error: 'match must be "all" or "any"' });
  }
  const id = typeof companyId === 'string' && companyId.trim() ? companyId.trim() : undefined;
  const records = await db.searchRecords(wanted, { idOrDomain: id, match });
  if (!records) return res.status(404).json({ error: `No results for "${id}". Crawl it first via POST /simonapi/crawl.` });
  res.json(records);
});

// :id is the companyId, or the domain that was crawled.
app.get('/simonapi/company/:id', async (req, res) => {
  const company = await db.findCompany(req.params.id);
  if (!company) return res.status(404).json({ error: `No results for "${req.params.id}". Crawl it first via POST /simonapi/crawl.` });
  res.json(company.records);
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Simon API listening on http://localhost:${PORT} (docs: /simonapi/docs, db: ${db.DB_PATH})`));
}

module.exports = app;
