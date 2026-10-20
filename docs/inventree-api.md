# InvenTree 1.6.0 (API 560): facts for the Owner stock app

Read this before writing code that calls InvenTree. Every status code and payload below was observed against a real
InvenTree 1.6.0 instance (`inventree/inventree:1.6.0`, commit 4d05a10) loaded with `seed/seed_electrical.py`, not
recalled from memory. Re-verify if `INVENTREE_TAG` changes.

The OpenAPI schema is `frontend/inventree-openapi-1.6.0.json`. It was generated inside that image with
`manage.py migrate && manage.py schema --format openapi-json` using the env from `invoke dev.schema`
(`INVENTREE_SITE_URL=http://localhost:8000`, `INVENTREE_PLUGINS_ENABLED=False`,
`INVENTREE_CURRENCY_CODES=AUD,CAD,CNY,EUR,GBP,JPY,NZD,USD`): OpenAPI 3.0.3, `info.version: "560"`, 327 paths.
The schema says decimals are strings, but the server sends JSON numbers (see Gotchas).

## 1. Environment

- The seed creates **no users**. Sign-in uses the superuser from `invoke superuser`.
- Create users with `invoke superuser` / `createsuperuser`, **not** `manage.py shell`. A user created in `shell` gets
  no `UserProfile` (shell is a "read-only command"), and its login then fails with 500 `User has no profile`.
- The seed is idempotent: the marker is Part `IPN=KIT-SVC-200`. Seeded counts: 79 parts, 146 stock items,
  15 companies, 4 project codes, 4 purchase orders. The seed sets the global setting `PROJECT_CODES_ENABLED=True`.
- The Postgres password is fixed when `inventree-data/pgdb` is first created. Changing `INVENTREE_DB_PASSWORD` in
  `.env` afterwards makes the server fail with `password authentication failed for user "inventree"`.

## 2. Browser session auth (django-allauth headless, browser client)

Settings: `HEADLESS_ONLY=True` and `HEADLESS_CLIENTS='browser'`. Headless is mounted at **`/api/auth/v1/...`**
(no `/_allauth/browser/` prefix). The CSRF cookie is `csrftoken` (readable by JS) and the header is
**`X-CSRFToken`**. The session cookie is `sessionid` (Django default age 2 weeks, so it persists between visits).
SameSite is unset unless `INVENTREE_COOKIE_SAMESITE` is set. All requests are same-origin, so use
`credentials: 'same-origin'`.

| Step | Request | Response (observed) |
|---|---|---|
| Session check / get CSRF | `GET /api/auth/v1/auth/session` | signed out: **401** `{"status":401,"data":{"flows":[{"id":"login"},{"id":"mfa_login_webauthn"}]},"meta":{"is_authenticated":false}}` + sets `csrftoken` cookie. Signed in: **200** `{"status":200,"data":{"user":{"id":1,"display":"probe","email":"…","has_usable_password":true,"username":"probe"},"methods":[{"method":"password","at":…,"username":"probe"}]},"meta":{"is_authenticated":true}}` |
| Config (optional) | `GET /api/auth/v1/config` | 200, also sets `csrftoken`. `account.login_methods:["username"]`, `is_open_for_signup:false` |
| Login | `POST /api/auth/v1/auth/login` JSON `{"username":"…","password":"…"}` + header `X-CSRFToken` | **200** same body as the signed-in session, sets `sessionid` and rotates `csrftoken` (re-read the cookie after login). Bad password: **400** `{"status":400,"errors":[{"message":"The username and/or password you specified are not correct.","code":"username_password_mismatch","param":"password"}]}`. No CSRF header: **403** `{"detail":"CSRF verification failed. …(CSRF token missing.)"}`. 401 with `flows` incl. `mfa_authenticate` = MFA needed (not in scope). |
| Logout | `DELETE /api/auth/v1/auth/session` + `X-CSRFToken` | **401** (allauth convention: "you are now logged out", with the same `flows` body). Clears `sessionid`. **Treat 401 here as success.** |
| Current user | `GET /api/user/me/` | 200 `{pk,username,first_name,last_name,email,groups,is_staff,is_superuser,is_active,profile,…}` |

- **Unauthenticated REST call** (`/api/...` not under `/api/auth/`): **401** `application/json`
  `{"detail":"Authentication credentials were not provided."}` with header `WWW-Authenticate: Token`. It is never 403,
  so 401 means "send to sign-in". **403** happens for missing or invalid CSRF on writes
  (`{"detail":"CSRF Failed: CSRF token missing."}`) or for a lack of role permissions.
- Every unsafe method (POST/PUT/PATCH/DELETE) on `/api/` needs `X-CSRFToken` = the current `csrftoken` cookie
  (DRF SessionAuthentication). Django also checks the `Origin` header against `CSRF_TRUSTED_ORIGINS`, which is
  `INVENTREE_SITE_URL` (plus `INVENTREE_TRUSTED_ORIGINS`). So the page origin must equal `INVENTREE_SITE_URL`
  (for example `http://localhost`). The Vite dev server proxies `/api` with the Origin rewritten to the site URL.
- Every response carries the header `X-InvenTree-API: 560`. `GET /api/` returns
  `{"server":"InvenTree","version":"1.6.0","apiVersion":560,"instance":"Taka Electrical Inventory",…}`.
- One-off: in one probe run, a session vanished after 3 good requests (401 + cookie cleared). It did not
  reproduce. The app must handle a 401 at any point anyway.

## 3. Read endpoints

**Pagination:** this is DRF LimitOffset, and it is **opt-in**. Without `limit` you get a **bare JSON array of all rows**.
With `?limit=N&offset=M` you get `{"count":79,"next":"http://<Host>/api/part/?limit=2&offset=2","previous":null,"results":[…]}`.
`next` uses the request Host, so it is fine behind Caddy. The generated types describe list endpoints as paginated,
so the app always passes `limit` and walks pages with `everyRow` (`frontend/src/api.ts`). `*_detail=true` query
flags embed related objects.

### Stock locations `GET /api/stock/location/` (also `/api/stock/location/{id}/`, `/api/stock/location/tree/`)
Filters: `parent`, `structural`, `top_level`, `name`, `search`, `cascade`, `depth`, `ordering=pathstring|name|level…`.
Row: `pk, name, description, parent (int|null), pathstring ("Main Warehouse/Aisle A - Wire & Cable"), level (0 = top),
items (stock item count), sublocations, structural (bool), external, icon, location_type, tags`.
`/tree/` gives a slim row: `pk,name,description,pathstring,parent,tree_id,level,icon,structural,sublocations`.
Location pks differ between databases, so **look up by name/pathstring, never hard-code**. Structural locations:
Main Warehouse, Service Vans, Job Sites. Job Site `description` = street address; `name` starts with the project code
(`"PRJ-101 Alvarez Residence"`).

### Stock items `GET /api/stock/`
Filters: `part`, `location` (**cascades into sub-locations by default**: `?location=<Main Warehouse>` returns every item
in every aisle; add `cascade=false` for that node only), `in_stock`, `IPN`, `supplier_part`, `purchase_order`,
`part_detail=true`, `location_detail=true`, `path_detail`, `supplier_part_detail`, `ordering=quantity|-quantity|…`.
Row: `pk, part, quantity (number), location, status (10=OK), in_stock, serial, batch, supplier_part, SKU, MPN,
purchase_price (number), purchase_price_currency, purchase_order, purchase_order_reference, updated,
location_detail {pk,name,pathstring}, part_detail (PartBrief)`.
Example: `{"pk":18,"part":10,"quantity":2000.0,"location":2,"status":10,"supplier_part":10,"SKU":"RWC-10063",
"location_detail":{"pk":2,"name":"Aisle A - Wire & Cable","pathstring":"Main Warehouse/Aisle A - Wire & Cable"}, …}`

### Parts `GET /api/part/`, `GET /api/part/{id}/`
Filters: `IPN` (exact), `search` (name, IPN, **description**, keywords; case-insensitive partial: `search=gfci` →
PLT-1G-DEC, BRK-1P-20-DF, DEV-GFCI-20-WH), `category`, `active`, `purchaseable`, `low_stock=true`, `has_stock`,
`category_detail=true`, `parameters=true` (embeds parameters), `location_detail`, `ordering=name|IPN|total_in_stock…`.
Fields used: `pk, name, IPN, full_name ("IPN | name"), description, units ("ft" or "", see gotchas),
minimum_stock (number), category, category_name, category_detail {pk,name,pathstring,default_location,…},
default_location, category_default_location, in_stock, total_in_stock, unallocated_stock, ordering (on order),
stock_item_count, trackable, consumable, assembly, parameters[]`.
GFCI example: `{"pk":37,"IPN":"DEV-GFCI-20-WH","name":"20A GFCI Receptacle, White","units":"","minimum_stock":60.0,
"category":13,"category_name":"Receptacles","default_location":4,"category_default_location":4,"in_stock":28.0,
"total_in_stock":28.0,"ordering":60.0, …}`.
`low_stock=true` returns exactly the 5 spec parts (`in_stock < minimum_stock`): BRK-1P-20-DF 14/20, DEV-GFCI-20-WH
28/60, BRK-2P-60 6/10, LGT-HB-150 6/20, EV-L2-48 2/4. Kits (KIT-*) are assemblies with min 0 and no stock.

### Parameters (specs: rating, colour, size)
Either `GET /api/part/?…&parameters=true`, or `GET /api/parameter/?model_type=part.part&model_id=<part pk>`.
Row: `{pk, template, model_type:"part.part", model_id, data:"20", data_numeric:20.0,
template_detail:{pk,name:"Current Rating",units:"A",description,…}}`. Display as `name: data units`.
(The old `/api/part/parameter/` is gone in 1.x; parameters are generic now.)

### Part categories `GET /api/part/category/` (`/{id}/`, `/tree/`)
Row: `pk, name, description, parent, pathstring, level, structural, default_location, parent_default_location, part_count, subcategories`.
Every seed category has `default_location` set (an aisle, the Tool Crib, or "Main Warehouse" for Install Kits).
The seed also copies it onto each Part's `default_location`.

### Project codes `GET /api/project-code/`
`[{"pk":1,"code":"PRJ-101","description":"Alvarez Residence - 200A service upgrade & kitchen remodel","active":true,"responsible":null}, …]`

### Companies `GET /api/company/`
Row: `pk, name, description, currency, is_supplier, is_customer, is_manufacturer, active, parts_supplied, parts_manufactured`.
**`is_supplier=true` is useless here**: the model defaults `is_supplier=True` and the seed doesn't clear it, so customers
and manufacturers come back too. Real suppliers = companies with `parts_supplied > 0`: Northgate Electrical Supply,
Ridgeline Wire & Cable, BrightPath Lighting Distributors. Or derive them from supplier parts.

### Supplier parts `GET /api/company/part/`
Filters: `part`, `supplier`, `SKU`, `active`, `supplier_detail=true`, `part_detail=true`, `price_breaks=true`.
Row: `pk, part (internal part pk), supplier, SKU, MPN, description, packaging, pack_quantity ("500"),
pack_quantity_native (500.0), primary, active, on_order, in_stock, supplier_detail{pk,name,currency}, price_breaks[{pk,part,quantity,price,price_currency}]`.
Seed: exactly one supplier part per part (`primary:true`), SKU like `NES-10252`, two price breaks per supplier part.
Wire (`units:"ft"`) is sold in 500 ft reels (`pack_quantity "500"`), and its price breaks are per reel.
Also `GET /api/company/price-break/?part=<supplierpart pk>`.

### Purchase orders `GET /api/order/po/` (`/{id}/`)
Filters: `status` (int), `outstanding=true` (status in OPEN = pending, placed, on hold), `supplier`, `project_code`,
`has_project_code=true|false`, `reference`, `part`, `supplier_part`, `supplier_detail=true`, `project_code_detail=true`,
`ordering=target_date|reference…`.
Row: `pk, reference, supplier, supplier_name, supplier_detail, supplier_reference, status, status_text,
project_code (int|null), project_code_label ("PRJ-103"), project_code_detail, target_date ("2026-10-27"),
issue_date, creation_date, complete_date, description, destination (location pk), line_items, completed_lines,
total_price (number), order_currency, overdue`.
**Status codes** (`order/status_codes.py`, also `GET /api/order/po/status/` or `/api/generic/status/PurchaseOrderStatus/`):
`PENDING 10, PLACED 20, ON_HOLD 25, COMPLETE 30, CANCELLED 40, LOST 50, RETURNED 60`. OPEN group = [10, 25, 20].
The app names these once, as `ORDER_STATUS` in `frontend/src/stock-rules.ts`.
Seed: PO-0001 BrightPath PRJ-103 placed (ref BPL-88412); PO-0002 Ridgeline PRJ-103 placed (RWC-55190); PO-0003 Northgate
PRJ-104 pending; PO-0004 Northgate no project, pending. All have `destination` = Main Warehouse (structural!).
"Expected deliveries" = `?status=20` (PLACED). Only PLACED orders can be received.

### PO line items `GET /api/order/po-line/`
Filters: `order`, `part` (= **supplier part** pk), `base_part` (= internal part pk), `pending=true` (received < quantity),
`order_status`, `order_complete`, `received`, `part_detail=true`, `supplier_part_detail=true` (**only works together
with `part_detail=true`**), `order_detail=true`, `ordering=…`.
Row: `pk, order, part (supplier part pk), quantity, received, purchase_price (number|null), purchase_price_currency,
total_price, project_code (line-level, set by the seed same as the order), destination, destination_detail
(falls back to the part's default location), sku, mpn, ipn, internal_part, internal_part_name, part_detail (PartBrief),
supplier_part_detail (incl. pack_quantity_native, supplier)`.
Example: `{"pk":1,"order":1,"part":56,"quantity":40.0,"received":0.0,"purchase_price":129.0,"purchase_price_currency":"USD",
"project_code":3,"project_code_label":"PRJ-103","ipn":"LGT-HB-150","internal_part":56,"internal_part_name":"LED High-Bay 150W 5000K", …}`
**Last supplier / last price:** `GET /api/order/po-line/?base_part=<part pk>&order_detail=true&ordering=-order` (or
sort by `order_detail.creation_date`). Supplier = `supplier_part_detail.supplier` or `order_detail.supplier`.

## 4. Write endpoints (all observed)

### Stock transfer `POST /api/stock/transfer/`
```json
{"items":[{"pk":18,"quantity":250},{"pk":35,"quantity":10}],"location":10,"notes":"Restock Van 01"}
```
`201` echoes the input: `{"items":[{"pk":18,"quantity":"250.00000","status":null,"merge":false}],"notes":"Restock Van 01","location":10}`.
**No new stock item pks are returned**, so refetch. A partial quantity splits the item (a new item at the destination).
`merge:true` per item merges into an existing matching item at the destination. All lines run in one transaction.
Errors (400): `{"location":["Structural locations cannot be assigned stock items"]}`;
`{"items":{"0":{"pk":["Invalid pk \"999999\" - object does not exist."]},"1":{"quantity":["Quantity must be greater than zero"]}}}`
(keyed by line index, so the app can mark the failed lines).
**quantity > item.quantity is NOT rejected**: it returns 201 and moves the WHOLE item (2000 ft moved for 999999). The app must guard.
Each line is a stock item pk, not a part. To move N of a part from an aisle, pick the stock item(s) at that location.

### Create purchase order `POST /api/order/po/`
```json
{"supplier":1,"description":"Warehouse restock","target_date":"2026-11-01"}
```
`reference` is **optional**: omitted, it auto-generates from `PURCHASEORDER_REFERENCE_PATTERN = PO-{ref:04d}` →
`"PO-0005"`. Sending a duplicate gives 400 `{"reference":["Purchase Order with this Reference already exists."]}`.
`201` = full PurchaseOrder (`pk`, `reference`, `status:10`, `project_code:null`, `destination:null`). Leave out
`project_code` (reorders have no Project). You could also set `destination` to a non-structural aisle.

### Add line `POST /api/order/po-line/`
```json
{"order":5,"part":37,"quantity":10,"purchase_price":"18.50","purchase_price_currency":"USD"}
```
`part` = **SupplierPart pk** (not the Part pk). `quantity` is in **supplier packs** (see gotchas). `201` = full line
(`received:0.0`, `total_price:185.0`, `destination_detail` = the part's default aisle). There is no bulk-create endpoint:
one POST per line, so the order is not atomic. On partial failure, show which lines failed.

### Place `POST /api/order/po/{id}/issue/` body `{}` → `201` full PO with `status:20`. The app leaves new POs pending,
so it doesn't call this; it is listed for tests and fixtures. Also `/hold/`, `/cancel/`, `/complete/`.

### Receive `POST /api/order/po/{id}/receive/`
```json
{"items":[{"line_item":1,"quantity":4,"location":2},{"line_item":2,"quantity":20,"location":7}]}
```
Optional top-level `location` (the default for lines without one) and per-line `batch_code, status, packaging, note, expiry_date, serial_numbers`.
`201` = **array of created StockItems** (full StockItem incl. `part_detail`, `purchase_order`, `location`, `quantity`).
Rules from `order/models.py receive_line_items` (verified):
- The order must be PLACED, otherwise 400 `{"non_field_errors":["Lines can only be received against an order marked as 'PLACED'"]}`.
- Location precedence: line `location` → top-level `location` → **order.destination** → line destination. Seed POs have
  destination = Main Warehouse (**structural**). Receiving with no location put stock INTO the structural Main Warehouse,
  and receiving into "Service Vans" (structural) also succeeded. **Receive does NOT block structural locations**, so
  always send a per-line aisle.
- **There is no over-receipt check**: receiving 50 against a line of 10 → `received:54`, 201. The app must guard.
  `quantity <= 0` gives a 400.
- With `PURCHASEORDER_AUTO_COMPLETE=True` (default, observed), the PO goes to COMPLETE (30) automatically when every
  line is fully received, so it drops off `status=20`.
- Stock created = `quantity × supplier_part.pack_quantity_native`.

## 5. How the app is served

Caddy serves the built app from `frontend/dist` (mounted at `/srv/app` in the `inventree-proxy` container) under
`/app`, with `try_files {path} /index.html` so deep links like `/app/move?van=…` reach the app's router. Vite builds
with `base: '/app/'`; API calls are relative to the root (`/api/...`). InvenTree's own UI is at `/web/`.
After editing the `Caddyfile`, run `docker compose restart inventree-proxy`. A rebuilt `dist/` is picked up live, but
on Windows deleting and recreating the mounted `dist` folder can leave the mount stale: restart the proxy if `/app`
serves old files.

## 6. Gotchas

1. **Pack quantities.** PO line `quantity`/`received` and prices are in *supplier packs*. Stock and Part numbers are in
   part units. Wire (`units:"ft"`) comes in 500 ft reels, so:
   - On Order in part units = Σ (line.quantity − line.received) × supplier_part_detail.pack_quantity_native.
   - Reorder converts the suggested feet to reels (ceil(qty / pack)) when creating lines.
   - The seed writes its purchase order lines in reels (PO-0002 = 5 reels = 2,500 ft). A database seeded before that
     fix shows PO-0002 as 2500 reels (1,250,000 ft); only a fresh database picks up the corrected seed.
   - All non-wire parts have pack 1, including the 5 low parts.
2. **`Part.ordering` counts every open PO incl. Project POs** (GFCI 60, HB-150 40, EV 8, BRK-2P-60 8). It cannot be used
   for On Order. Compute from `po-line` + `po` (`status in [10,20,25]` and `project_code == null`).
   Expected: GFCI 60, DF breaker 24, others 0. Check the order's `project_code` (lines also carry one; the seed sets both the same).
3. **Units**: `units` is `"ft"` for wire/cable and `""` (empty string, not null, not "each") for everything else. Render "" as "each"/"ea".
4. **Structural** locations (Main Warehouse, Service Vans, Job Sites) can't receive transfers (400). Receive *does*
   allow them (see §4), so filter both destination pickers to `structural:false`.
5. **Over-quantity is not enforced server-side** for transfer (moves the whole item) or receive (over-receives). Guard client-side.
6. **Decimals**: the OpenAPI schema types `PartBrief.minimum_stock`, prices, and transfer quantities as `string decimal`.
   At runtime Part endpoints send numbers (`minimum_stock:60.0`, `purchase_price:18.5`), but
   `part_detail.minimum_stock` is the string `"1000.000000"`, and the transfer echo has `"250.00000"`. Coerce with `Number()`.
   The generated TS types claim `string` for some of these.
7. **Default put-away aisle**: the spec says the part *category's* default location. Read it from
   `category_detail.default_location` (fetch parts with `category_detail=true`); `category_default_location` is null in
   `part_detail` blocks even when the category has one. The app falls back to the part's own `default_location` only
   when the category has none.
8. Tools (TL-DMM, TL-CLAMP) are `trackable`: one stock item per serial, qty 1 each, minimum_stock 0, never low.
   Kits (KIT-*) have no stock and min 0.
9. Stock `?location=` cascades by default. Aisle part counts should group items by their own `location`, not query per aisle with cascade.
10. A transfer's `items[].pk` is a StockItem. "Most stock aisle first" = pick the warehouse stock item with the
    largest quantity for that part. One move may need several items if no single item has enough.
11. 401 = signed out (always JSON `detail`). Logout's 401 = success. 403 on a write = CSRF (re-read the cookie) or permissions.
12. Part and location pks differ between databases, so test fixtures are keyed by name/IPN and generated from the seed
    (`npm run generate:fixtures`).
