# Simon API

Information server for Simon's job application. Two parts:

1. **Crawler** (`POST /simonapi/crawl`): give it a domain, it crawls same-site pages and stores one record per page in a local JSON database (`data/db.json`).
2. **Read-only API** (`GET /simonapi/company/:id`): serves the stored records as JSON.

Each record looks like:

```json
{
  "url": "https://www.grantthornton.com/about-us",
  "title": "About",
  "tag": ["about", "company information"],
  "companyId": "gram",
  "companyName": "Grant Thornton"
}
```

## Run

```bash
npm install
npm start            # http://localhost:3000
```

Env vars: `PORT` (default 3000), `DB_PATH` (default `data/db.json`).

## Docs

With the server running, open http://localhost:3000/simonapi/docs for interactive API docs (you can send requests from the page). The OpenAPI 3.1 spec lives in `openapi.yaml` and is also served as JSON at `/simonapi/openapi.json`.

## Endpoints

### `POST /simonapi/crawl`

```bash
curl -X POST localhost:3000/simonapi/crawl \
  -H 'content-type: application/json' \
  -d '{"domain":"grantthornton.com","companyId":"gram","companyName":"Grant Thornton","maxPages":50}'
```

| field | required | default |
|---|---|---|
| `domain` | yes | e.g. `grantthornton.com` or `https://www.grantthornton.com` |
| `companyId` | no | first part of the domain (`grantthornton`) |
| `companyName` | no | the site's `og:site_name`, else the suffix of the home page `<title>` |
| `maxPages` | no | 50 (cap 500) |

Returns a summary (`pagesStored`, `failedPages`, and the results URL). Re-crawling a company replaces its stored records.

### `GET /simonapi/company/:id`

Returns the array of records. `:id` can be the `companyId` or the crawled domain. 404 if it hasn't been crawled.

### `GET /simonapi/company`

Lists every stored company with its page count and crawl time.

## How tags are inferred

Tags come from the first two URL path segments (`/about-us` gives `about`), plus a broader group when the path or title matches a known keyword: `company information`, `careers`, `contact`, `news`, `services`, `legal`. The home page is tagged `home`. Edit `TAG_GROUPS` in `src/crawler.js` to change these.
