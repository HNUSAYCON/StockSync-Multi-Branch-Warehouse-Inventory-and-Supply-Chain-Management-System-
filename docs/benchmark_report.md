# StockSync: Query Benchmark and Stress Test Report

**Group SAYCON** · Advanced Database Systems

This report measures how StockSync's indexes speed up the queries the website actually runs, explains the execution plans before and after indexing, and shows a concurrency stress test of the rule that stock can never go negative.

---

## 1. Test setup

| | |
|---|---|
| Database engine | PostgreSQL 16 (the same engine Supabase runs) |
| Schema | StockSync migrations `001`–`005` and `008` |
| Benchmark script | `tests/benchmark.sql` |
| Test data | 20 warehouses, 20,000 items, 400,000 stock rows, 500,000 ledger movements, 40,000 purchase orders |
| Timing method | `EXPLAIN ANALYZE`, median of 5 runs after 1 warm-up run |

The benchmark runs in a separate temporary schema (`bench`) that is created, filled with generated data, measured, and deleted. It never touches the real tables, so it is safe to run on the live Supabase database. Generated data uses a fixed random seed, so every run produces the same data. Popular items receive more movements than others, as in a real warehouse.

Each query was measured twice: first with only primary keys (the "before" state), then again after adding the index defined for it in `001_schema.sql`.

> The numbers below were measured on a local PostgreSQL 16 test server. Absolute times on Supabase's free tier will differ (shared hardware, network), but the before/after difference comes from the execution plan, so the same pattern appears there. Run `tests/benchmark.sql` in the Supabase SQL Editor to get production figures.

---

## 2. Results

| Query | Used by | Index | Before (plan, time) | After (plan, time) | Speed-up |
|---|---|---|---|---|---|
| **Q1.** Item history in one warehouse (latest 50) | Movement history page | `idx_mov_wh_item_time` | Seq Scan, 17.613 ms | Bitmap Index Scan, 0.026 ms | **677×** |
| **Q2.** Movement report: one warehouse, last 30 days | Reports page (`get_movement_report`) | `idx_mov_wh_item_time` | Seq Scan, 21.804 ms | Bitmap Index Scan, 2.439 ms | **8.9×** |
| **Q3.** Which warehouses stock one item | Stock page **Find** button (`get_item_availability`) | `idx_stock_item` | Seq Scan, 12.068 ms | Bitmap Index Scan, 0.012 ms | **1,006×** |
| **Q4.** Item search by partial name (`ILIKE '%…%'`) | `search_items` | `idx_items_name_trgm` (GIN trigram) | Seq Scan, 8.096 ms | Bitmap Index Scan, 0.298 ms | **27×** |
| **Q5.** Open purchase orders of one warehouse | Purchase orders page, dashboard | `idx_po_warehouse_status` | Seq Scan, 2.274 ms | Bitmap Index Scan, 0.091 ms | **25×** |

A second run gave the same pattern (Q1 606×, Q2 11.3×, Q3 887×, Q4 24×, Q5 25×).

**Reading the results:**
- Every query switched from a **sequential scan** (reading the whole table) to an **index scan** (jumping straight to the matching rows).
- The biggest gains are lookups that return a few rows from a large table (Q1, Q3). Without an index, PostgreSQL reads all 500,000 or 400,000 rows to find a few dozen.
- Q2 gains less (9–11×) because a whole month of one warehouse's movements is a larger slice of the table, so more rows must be read even with the index. It still drops from about 22 ms to about 2.4 ms.
- These tables only grow (the ledger is append-only). A sequential scan gets slower with every new row, while an index lookup stays nearly constant, so the gap widens over time.

---

## 3. Execution plan analysis

### Q1: item history in one warehouse

```sql
SELECT * FROM stock_movements
WHERE warehouse_id = 7 AND item_id = 25
ORDER BY created_at DESC LIMIT 50;
```

**Before (no index):**
```
Limit (actual rows=38)
  ->  Gather Merge
        Workers Launched: 2
        ->  Sort  (Sort Key: created_at DESC)
              ->  Parallel Seq Scan on stock_movements (actual rows=13 loops=3)
                    Filter: ((warehouse_id = 7) AND (item_id = 25))
                    Rows Removed by Filter: 166654
Execution Time: 20.562 ms
```
PostgreSQL started 2 extra worker processes and read the **entire** 500,000-row ledger, throwing away 166,654 rows per process (about 499,960 in total) to keep 38.

**After `idx_mov_wh_item_time (warehouse_id, item_id, created_at DESC)`:**
```
Limit (actual rows=38)
  ->  Sort  (Sort Key: created_at DESC)
        ->  Bitmap Heap Scan on stock_movements (actual rows=38)
              Recheck Cond: ((warehouse_id = 7) AND (item_id = 25))
              Heap Blocks: exact=38
              ->  Bitmap Index Scan on idx_mov_wh_item_time (actual rows=38)
                    Index Cond: ((warehouse_id = 7) AND (item_id = 25))
Execution Time: 0.119 ms
```
The index found the 38 matching rows directly and read only 38 table blocks. No parallel workers were needed.

**Why the column order matters:** the index is `(warehouse_id, item_id, created_at)`. The most selective filters (warehouse and item) come first, so the same index also serves warehouse-only filters like Q2. An index ordered `(created_at, …)` could not be used for these lookups.

### Q4: partial-name item search

```sql
SELECT item_id, sku, name FROM items WHERE name ILIKE '%valve heavy duty #19%';
```

**Before:**
```
Seq Scan on items (actual rows=16)
  Filter: ((name)::text ~~* '%valve heavy duty #19%'::text)
  Rows Removed by Filter: 19984
Execution Time: 8.177 ms
```

**After `idx_items_name_trgm` (GIN, `gin_trgm_ops`):**
```
Bitmap Heap Scan on items (actual rows=16)
  ->  Bitmap Index Scan on idx_items_name_trgm (actual rows=16)
        Index Cond: ((name)::text ~~* '%valve heavy duty #19%'::text)
Execution Time: 0.395 ms
```

A normal B-tree index **cannot** help a search with a leading wildcard (`'%valve…'`), because it only works for prefix matches. The **trigram index** (`pg_trgm` extension) breaks each name into 3-letter pieces ("val", "alv", "lve", …) and can find names containing any substring. That is why the search box works quickly on any part of an item name or SKU (`idx_items_sku_trgm` does the same for SKUs).

---

## 4. Indexing strategy

`001_schema.sql` defines **31 indexes** in four groups:

| Type | Indexes | Purpose |
|---|---|---|
| **Foreign key indexes** | `idx_items_category`, `idx_po_supplier`, `idx_po_created_by`, `idx_poi_item`, `idx_ti_item`, `idx_adj_item`, `idx_adj_requested`, `idx_adj_reviewed`, `idx_transfer_requested`, `idx_transfer_approved`, `idx_assign_employee`, `idx_stock_item`, `idx_mov_item`, `idx_mov_performed`, `idx_audit_changed_by` | PostgreSQL does not index foreign keys automatically. Without them, joins are slow, and checking `ON DELETE RESTRICT` (e.g. deleting a category) must scan the whole child table. |
| **Composite (multi-column)** | `idx_mov_wh_item_time`, `idx_po_warehouse_status`, `idx_transfer_from`, `idx_transfer_to`, `idx_adj_warehouse_status`, `idx_audit_record` | Match the filters the pages actually use, e.g. "this warehouse + this status". Most selective column first. |
| **Partial** | `idx_assign_warehouse` (active only), `idx_mov_po`, `idx_mov_transfer`, `idx_mov_adjustment` (non-null only), `uq_active_assignment` | Index only the rows that are searched. Most ledger rows have a NULL `po_id`, so indexing only non-null values keeps the index small. `uq_active_assignment` also *enforces* that an employee has at most one active assignment per warehouse. |
| **GIN trigram** | `idx_items_name_trgm`, `idx_items_sku_trgm` | Substring search (`ILIKE '%…%'`) on names and SKUs. |
| **Time ordering** | `idx_mov_created`, `idx_po_ordered_at`, `idx_audit_changed_at` | "Newest first" lists and date-range reports. |

**Row-Level Security optimization:** policies call permission functions like `is_admin()` wrapped as `(select public.is_admin())`. The `select` wrapper lets PostgreSQL run the check **once per query** instead of once per row, which matters on tables with thousands of rows.

**Trade-off:** each index makes inserts slightly slower and uses storage, because the index must be updated too. StockSync is read-heavy (people browse stock and reports far more often than they record movements), so this trade-off favors indexing. Indexes were only added for columns that a real page or foreign key uses.

---

## 5. Concurrency stress test: stock can never go negative

**Goal:** prove that simultaneous requests cannot push stock below zero, which is the core problem StockSync solves.

**Setup:**
- One item with exactly **300 units** in one warehouse.
- `pgbench` (PostgreSQL's load-testing tool) opened **40 simultaneous connections** across 8 threads.
- Each connection repeatedly deducted a random 1–3 units through the stock ledger, all at the same time.

**Result:**

| Measure | Value |
|---|---|
| Simultaneous connections | 40 |
| Successful deductions | 151 |
| Units deducted | **300 (exactly the starting stock)** |
| Final quantity on hand | **0** |
| Lowest balance ever recorded | **0** (never negative) |
| Ledger total equals stock balance | **Yes** |
| Requests after stock ran out | Refused: *"Insufficient stock for item 34 in warehouse 1: 0 on hand, 0 reserved, cannot apply change of -1."* |
| Throughput | ≈ 487 transactions per second |

**Why it holds:** every deduction is a row inserted into `stock_movements`. The trigger `apply_stock_movement()` first locks that item's stock row with `SELECT … FOR UPDATE`. Other connections touching the same item **wait in line** until the lock is released, then read the **updated** balance. If the change would drop the balance below the reserved quantity, the trigger raises an error and the whole transaction rolls back. The `CHECK (quantity_on_hand >= 0)` constraint is a second safety net.

The two-tab demonstration in `tests/concurrency_demo.sql` shows the same locking live in the Supabase SQL Editor.

---

## 6. How to reproduce

1. Open the Supabase dashboard → **SQL Editor** → **New query**.
2. Paste the contents of `tests/benchmark.sql` and click **Run** (about 30–90 seconds).
3. The result grid shows each query's plan and time before and after its index, plus the speed-up.
4. The temporary `bench` schema is deleted automatically, and no real data is changed.
