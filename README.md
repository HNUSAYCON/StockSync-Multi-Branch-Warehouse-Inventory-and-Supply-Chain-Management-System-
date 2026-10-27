# StockSync

**Multi-Branch Warehouse Inventory and Supply Chain Management System**

**Group SAYCON**
- BUNIAO, Geokkee Rod
- SAYCON, Karl Christian
- DEIPARINE, Luke Maverick

---

## What problem does the system solve?

Businesses with several warehouses or branches often track inventory in separate spreadsheets or logbooks. Stock counts become inaccurate, branches don't know what other branches have, transfers get lost between locations, and nobody can trace who changed a stock count or why. When two employees release the same item at the same time, records can show stock that doesn't exist, or even negative stock.

StockSync centralizes inventory for all warehouses in one cloud database. Every stock change, whether a delivery, transfer, release, or adjustment, goes through database transactions that lock the stock row, so stock can never go negative even under simultaneous requests. Triggers automatically record every movement and data change, giving a complete, tamper-resistant audit trail. Managers and staff see only the warehouses they are assigned to.

## Features

- User login with role-based access
- Employee profile management
- Warehouse (branch) management
- Item catalog and category management
- Supplier management
- Real-time stock levels per warehouse
- Purchase orders to suppliers, with partial and full receiving
- Stock transfers between warehouses (request, approve, send, receive)
- Stock adjustments for damaged, lost, or recounted items
- Automatic stock movement history (ledger) for every item
- Low-stock alerts based on reorder levels
- Search and filter items, orders, and transfers
- Inventory, movement, and purchase reports
- Audit trail of all data changes
- Admin dashboard for monitoring all warehouses

## Users and their capabilities

### Administrator
- Manage user and employee accounts
- Create and manage warehouses
- Assign employees to warehouses
- Manage item catalog, categories, and suppliers
- View stock and reports across all warehouses
- Approve stock transfers between warehouses
- View the system audit logs

### Warehouse Manager
- View and manage stock only in their assigned warehouse(s)
- Create purchase orders for their warehouse
- Request stock transfers to and from other warehouses
- Approve stock adjustments
- View low-stock alerts
- Generate reports for their warehouse

### Warehouse Staff (Stock Clerk)
- View stock in their assigned warehouse only
- Receive deliveries from purchase orders
- Send and receive stock transfers
- Record stock adjustments for manager approval
- View their own transaction history

## Technologies used

| Technology | Purpose |
|---|---|
| HTML, CSS, JavaScript, Bootstrap | Frontend interface |
| Supabase (cloud PostgreSQL) | Database hosting and auto-generated REST API, with triggers, stored functions, views, and row-level security for role-based data access |
| Supabase Auth | User login and secure password storage |
| supabase-js | JavaScript client library that connects the frontend to the database API |
| Visual Studio Code | Writing and managing source code |
| Live Server (VS Code extension) | Local testing; the system connects directly to the cloud database |
| Git / GitHub | Version control with protected branches and pull requests |

---

# Technical guide

The backend logic lives **inside the database**: tables, triggers, stored functions, and row-level security. The frontend talks to it through `supabase-js`.

## Folder layout

```
supabase/
  migrations/
    001_schema.sql          15 tables, constraints, foreign keys, indexes
    002_triggers.sql        ledger trigger, audit trigger, tamper guards, auto-timestamps
    003_functions.sql       permission helpers + PO / transfer / adjustment workflows
    004_views_reports.sql   dashboard & low-stock views, report functions, search
    005_security.sql        grants (RBAC) + row-level security policies
    008_admin_accounts.sql  admin-only functions to create accounts and reset passwords
  seed/
    006_seed_data.sql       sample warehouses, categories, suppliers, items, opening stock
    007_demo_accounts.sql   links team logins to roles and warehouses
tests/
  test_scenarios.sql        32 automated checks (runs inside a rollback)
  concurrency_demo.sql      two-tab row-locking demo
  benchmark.sql             index benchmark on bulk data (safe: uses a temporary schema)
docs/
  StockSync_ERD.png / .svg  entity-relationship diagram
  data_dictionary.md        every table, column, key, and constraint
  benchmark_report.md       query benchmark, execution plans, concurrency stress test
frontend/
  index.html                login page (sends each role to its own page)
  admin.html / manager.html / staff.html   role dashboards
  css/app.css               shared styles (on top of Bootstrap 5)
  js/config.js              Supabase project URL + public (anon) key
  js/api.js                 every call to the backend (reads + stored functions)
  js/ui.js                  tables, badges, pop-up forms, toasts
  js/layout.js              login check, role redirect, side menu
  js/art.js                 warehouse illustrations (inline SVG)
  js/sections/*.js          one file per feature (stock, orders, transfers, ...)
```

Run the frontend with VS Code's **Live Server** (right-click `frontend/index.html` → Open with Live Server). Opening the file by double-clicking won't work, because browsers block module scripts from `file://`.

## Setup

1. **Create the project.** Go to [supabase.com](https://supabase.com) → New project. Save the database password somewhere safe.
2. **Run the migrations in order.** Open **SQL Editor** → New query, paste each file, click **Run**: `001` → `002` → `003` → `004` → `005` → `006` → `008`. Each should end with "Success. No rows returned."
3. **Turn off public sign-ups.** Go to **Authentication → Sign In / Providers** and disable "Allow new users to sign up". Only admins create accounts.
4. **Create the logins.** Go to **Authentication → Users → Add user → Create new user**. Tick *Auto Confirm User* and create:
   - `saycon.karl_christian@hnu.edu.ph` (administrator)
   - `buniao.geokkee_rod@hnu.edu.ph` (manager: Cebu Main, Tagbilaran)
   - `deiparine.luke_maverick@hnu.edu.ph` (manager: Mandaue)
   - `staff.cebu@stocksync.test` (staff: Cebu Main)
   - `staff.mandaue@stocksync.test` (staff: Mandaue)
5. **Run `007_demo_accounts.sql`.** It shows a table of who is assigned where.
6. **Run `tests/test_scenarios.sql`.** You should see `32 / 32 passed`. Nothing is saved; it rolls back.
7. **Connect the frontend.** Copy the Project URL and the **anon public** key from **Project Settings → API** into `frontend/js/config.js`.

> After setup, administrators create new accounts from the website: **Users & employees → Create account** sets up the login, role, employee profile, and warehouse in one step. Accounts added directly in Supabase Authentication instead start **inactive** with role `staff` until an admin activates them, creates an employee profile, and assigns a warehouse.

## How the main pieces work

**Stock can never go negative.** Nobody updates `warehouse_stock` directly. Every change is a row inserted into `stock_movements`. The trigger `apply_stock_movement()` then:

1. locks that item's stock row (`SELECT ... FOR UPDATE`), so a second request for the same item and warehouse waits;
2. rejects the change if the balance would drop below the reserved quantity;
3. updates `quantity_on_hand` and records `balance_after`.

The `CHECK (quantity_on_hand >= 0)` constraint is a second safety net. A guard trigger blocks direct edits of `quantity_on_hand`, even from the database owner, so the ledger and the balance always match.

**Transfers reserve stock.** When an admin approves a transfer, the quantity is reserved at the source. It can't be adjusted away or promised to another transfer before it ships.

**Every function is one transaction.** If any step fails, everything in that call is undone. For example, a rejected adjustment approval leaves the request `pending`.

**Audit trail.** `audit_row_change()` logs every INSERT/UPDATE/DELETE on 12 tables with before/after JSON and the user who made it. `audit_logs` and `stock_movements` are append-only.

## Who can do what

| | Admin | Manager | Staff |
|---|---|---|---|
| See stock | all warehouses | assigned warehouses | assigned warehouses |
| Users, employees, warehouses, catalog, suppliers | ✅ manage | read | read |
| Create / cancel purchase orders | ✅ | own warehouse | ❌ |
| Receive deliveries | ✅ | own warehouse | own warehouse |
| Request transfers | ✅ | if managing source or destination | ❌ |
| Approve / reject transfers | ✅ | ❌ | ❌ |
| Send / receive transfers | ✅ | source / destination | source / destination |
| Request adjustments | ✅ | ✅ | ✅ |
| Approve adjustments | ✅ | own warehouse, not own requests | ❌ |
| Movement history | all | own warehouse | only their own transactions |
| Check other branches' availability | ✅ | ✅ (quantities only) | ❌ |
| Audit logs | ✅ | ❌ | ❌ |

These rules are enforced in the database by RLS and function checks, not in the frontend, so hiding a button is never the only protection.

**Database credentials:** the website connects as Supabase's limited `authenticated` role, never `postgres` or `service_role`. That role has `SELECT` only on stock tables, no `INSERT` on the ledger, and can run only the granted functions (`005_security.sql`). The anon key in `config.js` is public by design. The `service_role` key and database password never appear in the code.

## Changes from the original ERD

- **`stock_adjustments` table added** to store adjustment requests awaiting manager approval. `stock_movements.adjustment_id` links to it.
- **`users.password_hash` removed.** Supabase Auth stores passwords. `users.user_id` is now a `UUID` referencing `auth.users`.
- **`audit_logs.record_id` is now `VARCHAR(100)`**, so composite keys like `"12,5"` fit. `changed_by` is a `UUID`.
- **`stock_movements.movement_type` gained `opening_balance`**, used to load starting stock through the ledger.
- **Enums defined:** see the top of `001_schema.sql` for every status value.

## Common errors

- **"permission denied for table ..."**: working as intended. Use the workflow function instead of writing to the table.
- **"new row violates row-level security policy"**: the logged-in user's role isn't allowed to do that.
- **"Access denied: your account is inactive or has no employee profile"**: activate the account and create an employee row linked to it.
- **"Invalid login credentials"**: check the email in **Authentication → Users** for typos or spaces.
- **Project paused**: free Supabase projects pause after inactivity. Open the dashboard and click *Restore*.
