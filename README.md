# Simon API

Information server for Simon's job application. Two parts:

1. **Crawler** (`POST /simonapi/crawl`): give it a domain, it crawls same-site pages and stores one record per page in a local JSON database (`data/db.json`).
2. **Read-only API** (`GET /simonapi/company...`): list crawled companies, fetch a company's pages, or search pages by tag.

Each record looks like:

```json
{
  "url": "https://grantthornton.com/about-us",
  "title": "About Grant Thornton",
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

| method | path | what it does |
|---|---|---|
| `POST` | `/simonapi/crawl` | crawl a domain and store its pages |
| `GET` | `/simonapi/company` | list crawled companies |
| `GET` | `/simonapi/company/search` | search stored pages by tag |
| `GET` | `/simonapi/company/:id` | all stored pages for one company |
| `GET` | `/simonapi/docs` | interactive API docs |
| `GET` | `/simonapi/openapi.json` | OpenAPI spec as JSON |

Errors come back as `{"error": "..."}`.

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

Returns `201` with a summary:

```json
{"companyId":"gram","companyName":"Grant Thornton","domain":"grantthornton.com","pagesStored":50,"failedPages":0,"results":"/simonapi/company/gram"}
```

The request waits for the crawl to finish. Re-crawling a company replaces its stored records. Errors: `400` if `domain` is missing or invalid, `502` if no page could be fetched (nothing is stored), `500` on an unexpected error.

### `GET /simonapi/company/search`

Finds stored pages by tag, across every crawled company.

```bash
curl -G localhost:3000/simonapi/company/search --data-urlencode 'tags=about,company information'
```

| query | required | notes |
|---|---|---|
| `tags` | yes | comma-separated; repeated `tag=` params also work |
| `match` | no | `all` (default, page needs every tag) or `any` |
| `companyId` | no | limit to one company (id or domain); 404 if unknown |

Tags match case-insensitively and exactly (`about` does not match `about us`). Returns an array of records (empty if nothing matches); `400` if no tags are given or `match` isn't `all`/`any`.

### `GET /simonapi/company`

Lists every stored company with its page count and crawl time (`[]` if nothing has been crawled):

```json
[{"companyId":"gram","companyName":"Grant Thornton","domain":"grantthornton.com","crawledAt":"2026-10-04T19:10:49.129Z","pageCount":50}]
```

### `GET /simonapi/company/:id`

Returns the array of records. `:id` can be the `companyId` or the crawled domain (case-insensitive, `www.` ignored). 404 if it hasn't been crawled.

## How tags are inferred

Tags come from the first two URL path segments (`/about-us` gives `about`; language prefixes like `/en` are skipped), plus a broader group when the path or title matches a known keyword: `company information`, `careers`, `contact`, `news`, `services`, `legal`. The home page is tagged `home`. Edit `TAG_GROUPS` in `src/crawler.js` to change these.
