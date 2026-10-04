// Local "database": a single JSON file on disk.
// Shape: { companies: { [companyId]: { companyId, companyName, domain, crawledAt, records: [...] } } }
const fs = require('fs/promises');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'db.json');

let writeQueue = Promise.resolve();

async function load() {
  try {
    return JSON.parse(await fs.readFile(DB_PATH, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { companies: {} };
    throw err;
  }
}

// Writes go through a queue and land atomically (write temp file, then rename),
// so concurrent crawls can't interleave or leave a half-written file.
function saveCompany(company) {
  writeQueue = writeQueue.then(async () => {
    const db = await load();
    db.companies[company.companyId] = company;
    await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
    const tmp = `${DB_PATH}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(db, null, 2));
    await fs.rename(tmp, DB_PATH);
  });
  return writeQueue;
}

// Look a company up by its companyId or by the domain it was crawled from.
async function findCompany(idOrDomain) {
  const db = await load();
  const key = idOrDomain.toLowerCase().replace(/^www\./, '');
  if (db.companies[key]) return db.companies[key];
  return Object.values(db.companies).find((c) => c.domain === key) || null;
}

// Records carrying the given tags (case-insensitive, exact match on each tag).
// match 'all' needs every tag, 'any' needs at least one. Returns null if idOrDomain is unknown.
async function searchRecords(tags, { idOrDomain, match = 'all' } = {}) {
  let companies;
  if (idOrDomain) {
    const company = await findCompany(idOrDomain);
    if (!company) return null;
    companies = [company];
  } else {
    companies = Object.values((await load()).companies);
  }
  const wanted = tags.map((t) => t.trim().toLowerCase());
  const test = match === 'any' ? 'some' : 'every';
  return companies.flatMap((c) =>
    c.records.filter((r) => {
      const have = new Set(r.tag.map((t) => t.toLowerCase()));
      return wanted[test]((t) => have.has(t));
    })
  );
}

async function listCompanies() {
  const db = await load();
  return Object.values(db.companies).map(({ records, ...summary }) => ({
    ...summary,
    pageCount: records.length,
  }));
}

module.exports = { saveCompany, findCompany, searchRecords, listCompanies, DB_PATH };
