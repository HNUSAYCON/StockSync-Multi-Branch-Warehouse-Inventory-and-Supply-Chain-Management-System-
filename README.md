# StockSync Backend (Supabase)

Group SAYCON: Multi-Branch Warehouse Inventory & Supply Chain Management System

The whole backend lives **inside the database**: tables, triggers, stored functions, and row-level security. The frontend (HTML/Bootstrap/JS) talks to it through `supabase-js`.

## Folder layout

```
supabase/
  migrations/
    001_schema.sql          15 tables, constraints, foreign keys, indexes
    002_triggers.sql        ledger trigger, audit trigger, tamper guards, auto-timestamps
    003_functions.sql       permission helpers + PO / transfer / adjustment workflows
    004_views_reports.sql   dashboard & low-stock views, report functions, search
    005_security.sql        grants (RBAC) + row-level security policies
  seed/
    006_seed_data.sql       sample warehouses, categories, suppliers, items, opening stock
    007_demo_accounts.sql   links demo logins to roles and warehouses
tests/
  test_scenarios.sql        32 automated checks (runs inside a rollback)
  concurrency_demo.sql      two-tab row-locking demo for the defense
frontend/
  index.html                login page (sends each role to its own page)
  admin.html / manager.html / staff.html   role dashboards
  css/app.css               shared styles (on top of Bootstrap 5)
  js/config.js              YOUR Supabase URL + anon key go here
  js/api.js                 every call to the backend (reads + stored functions)
  js/ui.js                  tables, badges, pop-up forms, toasts
  js/layout.js              login check, role redirect, side menu
  js/sections/*.js          one file per feature (stock, orders, transfers, ...)
```

Run the frontend with VS Code's **Live Server** (right-click `index.html` → Open with Live Server). Opening the file by double-clicking won't work, because browsers block module scripts from `file://`.

## Setup (about 15 minutes)

1. **Create the project.** Go to [supabase.com](https://supabase.com) → New project. Save the database password somewhere safe.
2. **Run the migrations in order.** Open **SQL Editor** → New query, paste each file, click **Run**: `001` → `002` → `003` → `004` → `005` → `006`. Each should end with "Success. No rows returned."
3. **Turn off public sign-ups.** Go to **Authentication → Sign In / Providers** and disable "Allow new users to sign up". Only admins should create accounts.
4. **Create the demo logins.** Go to **Authentication → Users → Add user → Create new user**. Tick *Auto Confirm User* and create:
   - `admin@stocksync.test`
   - `manager.cebu@stocksync.test`
   - `manager.mandaue@stocksync.test`
   - `staff.cebu@stocksync.test`
   - `staff.mandaue@stocksync.test`
5. **Run `007_demo_accounts.sql`.** It shows a table of who is assigned where.
6. **Run `tests/test_scenarios.sql`.** You should see `32 / 32 passed`. Nothing is saved; it rolls back.
7. **Connect the frontend.** Copy the Project URL and the **anon public** key from **Project Settings → API** into `frontend/js/api.js`.

> New accounts start **inactive** with role `staff`. An admin activates them, sets the role, creates an employee profile, and assigns a warehouse. Everyone who performs work needs an employee profile, admins included.

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

**Database roles (for the "no root credentials" question):** the website connects as Supabase's limited `authenticated` role, never `postgres` or `service_role`. That role has `SELECT` only on stock tables, no `INSERT` on the ledger, and can run only the granted functions (`005_security.sql`). The anon key in `api.js` is public by design. The `service_role` key never leaves the Supabase dashboard.

## Changes from the original ERD (update the diagram)

- **`stock_adjustments` table added.** The proposal has staff record adjustments for manager approval, but the ERD had nowhere to store them. `stock_movements.adjustment_id` links to it.
- **`users.password_hash` removed.** Supabase Auth stores passwords. `users.user_id` is now a `UUID` referencing `auth.users`.
- **`audit_logs.record_id` is now `VARCHAR(100)`**, so composite keys like `"12,5"` fit. `changed_by` is a `UUID`.
- **`stock_movements.movement_type` gained `opening_balance`**, used to load starting stock through the ledger.
- **Enums defined:** see the top of `001_schema.sql` for every status value.
- Every other table and column matches the ERD.

## Suggested Git commit plan

Your instructor penalizes single big uploads. Commit these on separate branches, merged by pull request:

| Branch | Commit message |
|---|---|
| `feature/erd-schema-v1` | `feat: add core schema with constraints and indexes` |
| `feature/ledger-triggers` | `feat: add stock ledger trigger and tamper guards` |
| `feature/audit-trigger` | `feat: add generic audit logging trigger` |
| `feature/stored-procedures-po` | `feat: add purchase order create/receive/cancel functions` |
| `feature/stored-procedures-transfers` | `feat: add transfer workflow with stock reservation` |
| `feature/stored-procedures-adjustments` | `feat: add adjustment request and approval functions` |
| `feature/reports-views` | `feat: add dashboard views and report functions` |
| `feature/rls-security` | `feat: add RBAC grants and row-level security policies` |
| `feature/seed-tests` | `test: add seed data and automated test scenarios` |

## Common errors

- **"permission denied for table ..."**: working as intended. Use the workflow function instead of writing to the table.
- **"new row violates row-level security policy"**: the logged-in user's tier isn't allowed to do that.
- **"Access denied: your account is inactive or has no employee profile"**: activate the account and create an employee row linked to it.
- **Project paused**: free projects pause after inactivity. Open the dashboard and click *Restore* a day before your defense.
