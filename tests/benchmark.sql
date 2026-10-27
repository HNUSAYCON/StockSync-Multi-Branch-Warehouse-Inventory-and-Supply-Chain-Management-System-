-- =====================================================================
-- StockSync | Query benchmark (indexes before vs after)
--
-- SAFE TO RUN ON THE LIVE DATABASE: everything happens in a separate
-- temporary schema called "bench" that is deleted at the end. Your real
-- tables are never read or changed.
--
-- What it does:
--   1. Builds copies of the main tables in schema "bench" (same columns),
--      with only their primary keys, then fills them with realistic bulk
--      data: 20 warehouses, 20,000 items, 400,000 stock rows,
--      500,000 ledger movements (popular items move more often),
--      40,000 purchase orders.
--   2. Times 5 queries the website really runs, using EXPLAIN ANALYZE
--      (median of 5 runs, after 1 warm-up run).
--   3. Adds the index that migration 001 defines for that query, then
--      times it again.
--   4. Deletes the bench schema and shows the results table.
--
-- Runtime: roughly 30-90 seconds on Supabase's free tier.
-- =====================================================================

drop schema if exists bench cascade;
create schema bench;
select setseed(0.42);   -- same "random" data every run

-- ---------------------------------------------------------------------
-- 1. Tables (same columns as public.*, primary keys only)
-- ---------------------------------------------------------------------
create table bench.items (
  item_id       integer primary key,
  category_id   integer not null,
  sku           varchar(30) not null,
  name          varchar(100) not null,
  unit_cost     numeric(10,2) not null,
  reorder_level integer not null);

create table bench.warehouse_stock (
  warehouse_id      integer not null,
  item_id           integer not null,
  quantity_on_hand  integer not null,
  quantity_reserved integer not null default 0,
  primary key (warehouse_id, item_id));

create table bench.stock_movements (
  movement_id   bigint primary key,
  warehouse_id  integer not null,
  item_id       integer not null,
  movement_type text not null,
  qty_change    integer not null,
  balance_after integer not null,
  created_at    timestamptz not null);

create table bench.purchase_orders (
  po_id        integer primary key,
  supplier_id  integer not null,
  warehouse_id integer not null,
  status       text not null,
  ordered_at   timestamptz not null);

-- ---------------------------------------------------------------------
-- 2. Bulk data
-- ---------------------------------------------------------------------
insert into bench.items
select i, 1 + i % 12,
       'SKU-' || lpad(i::text, 6, '0'),
       (array['Claw Hammer','LED Bulb','PVC Pipe','Gate Valve','Wood Screw','Latex Paint',
              'Circuit Breaker','THHN Wire','Concrete Primer','Common Nail','Door Hinge','Faucet'])[1 + i % 12]
         || ' ' || (array['Small','Medium','Large','Heavy Duty','Premium','Basic'])[1 + (i / 12) % 6]
         || ' #' || i,
       round((50 + random() * 2950)::numeric, 2), 5 + (i % 40)
from generate_series(1, 20000) i;

insert into bench.warehouse_stock (warehouse_id, item_id, quantity_on_hand)
select w, i, floor(random() * 300)::int
from generate_series(1, 20) w, generate_series(1, 20000) i;

insert into bench.stock_movements
select m, 1 + floor(random() * 20)::int,
       1 + floor(20000 * power(random(), 3))::int,   -- popular items move more often
       (array['po_receipt','transfer_out','transfer_in','adjustment'])[1 + floor(random() * 4)::int],
       (floor(random() * 50)::int + 1) * (case when random() < 0.5 then 1 else -1 end),
       floor(random() * 300)::int,
       now() - (random() * interval '365 days')
from generate_series(1, 500000) m;

insert into bench.purchase_orders
select p, 1 + p % 30, 1 + floor(random() * 20)::int,
       case when random() < 0.06 then 'ordered' when random() < 0.04 then 'partially_received'
            when random() < 0.05 then 'cancelled' else 'received' end,
       now() - (random() * interval '730 days')
from generate_series(1, 40000) p;

analyze bench.items, bench.warehouse_stock, bench.stock_movements, bench.purchase_orders;

-- ---------------------------------------------------------------------
-- 3. Timing helper: median execution time of 5 EXPLAIN ANALYZE runs
-- ---------------------------------------------------------------------
create table bench.results (
  id          serial primary key,
  query       text,
  used_by     text,
  index_added text,
  plan_before text,
  ms_before   numeric,
  plan_after  text,
  ms_after    numeric);

create function bench.measure(p_sql text, out ms numeric, out plan text)
language plpgsql as $$
declare
  j     json;
  times numeric[] := '{}';
  i     int;
begin
  execute 'explain (analyze, format json) ' || p_sql into j;   -- warm-up (loads data into cache)
  for i in 1..5 loop
    execute 'explain (analyze, format json) ' || p_sql into j;
    times := times || (j -> 0 ->> 'Execution Time')::numeric;
  end loop;
  select percentile_cont(0.5) within group (order by t) into ms from unnest(times) t;
  ms := round(ms, 3);
  -- the main access method, e.g. "Seq Scan on stock_movements" or "Index Scan using ..."
  with recursive nodes(n) as (
    select j -> 0 -> 'Plan'
    union all
    select c from nodes, json_array_elements(coalesce(n -> 'Plans', '[]'::json)) c)
  select string_agg(distinct (n ->> 'Node Type') || coalesce(' using ' || (n ->> 'Index Name'), ''), ', ')
    into plan
  from nodes
  where n ->> 'Node Type' in ('Seq Scan', 'Index Scan', 'Index Only Scan', 'Bitmap Index Scan', 'Parallel Seq Scan');
end;
$$;

create function bench.compare(p_query text, p_used_by text, p_index_name text, p_index_sql text, p_sql text)
returns void language plpgsql as $$
declare
  b record; a record;
begin
  select * into b from bench.measure(p_sql);
  execute p_index_sql;
  execute 'analyze bench.items, bench.warehouse_stock, bench.stock_movements, bench.purchase_orders';
  select * into a from bench.measure(p_sql);
  insert into bench.results (query, used_by, index_added, plan_before, ms_before, plan_after, ms_after)
  values (p_query, p_used_by, p_index_name, b.plan, b.ms, a.plan, a.ms);
end;
$$;

-- ---------------------------------------------------------------------
-- 4. The five queries (same shape as the website's real queries)
-- ---------------------------------------------------------------------

-- Q1: movement history of one item in one warehouse, newest first
select bench.compare(
  'Q1. Item history in one warehouse (latest 50)',
  'Movement history page, item ledger',
  'idx_mov_wh_item_time (warehouse_id, item_id, created_at desc)',
  'create index idx_mov_wh_item_time on bench.stock_movements (warehouse_id, item_id, created_at desc)',
  $q$ select * from bench.stock_movements
      where warehouse_id = 7 and item_id = 25
      order by created_at desc limit 50 $q$);

-- Q2: movement report: one warehouse, one month, totals per item
select bench.compare(
  'Q2. Movement report: one warehouse, last 30 days',
  'Reports page, get_movement_report()',
  'idx_mov_wh_item_time (same index as Q1)',
  'select 1',   -- index already exists from Q1; measures it again for a range query
  $q$ select item_id,
             sum(qty_change) filter (where qty_change > 0) as qty_in,
             -sum(qty_change) filter (where qty_change < 0) as qty_out
      from bench.stock_movements
      where warehouse_id = 7 and created_at >= now() - interval '30 days'
      group by item_id $q$);

-- Q3: "Find": which warehouses have this item?
select bench.compare(
  'Q3. Which warehouses stock one item',
  'Stock page Find button, get_item_availability()',
  'idx_stock_item (item_id)',
  'create index idx_stock_item on bench.warehouse_stock (item_id)',
  $q$ select warehouse_id, quantity_on_hand - quantity_reserved as available
      from bench.warehouse_stock
      where item_id = 1234 and quantity_on_hand - quantity_reserved > 0 $q$);

-- Q4: item search by partial name (ILIKE '%...%')
select bench.compare(
  'Q4. Item search by partial name',
  'search_items()',
  'idx_items_name_trgm (GIN trigram)',
  'create index idx_items_name_trgm on bench.items using gin (name extensions.gin_trgm_ops)',
  $q$ select item_id, sku, name from bench.items where name ilike '%valve heavy duty #19%' $q$);

-- Q5: open purchase orders of one warehouse
select bench.compare(
  'Q5. Open purchase orders of one warehouse',
  'Purchase orders page, dashboard open-PO count',
  'idx_po_warehouse_status (warehouse_id, status)',
  'create index idx_po_warehouse_status on bench.purchase_orders (warehouse_id, status)',
  $q$ select * from bench.purchase_orders
      where warehouse_id = 7 and status in ('ordered', 'partially_received')
      order by po_id desc $q$);

-- Q2 used the Q1 index for both runs; re-measure its "before" without it
do $$
declare b record;
begin
  drop index bench.idx_mov_wh_item_time;
  select * into b from bench.measure($q$ select item_id,
             sum(qty_change) filter (where qty_change > 0) as qty_in,
             -sum(qty_change) filter (where qty_change < 0) as qty_out
      from bench.stock_movements
      where warehouse_id = 7 and created_at >= now() - interval '30 days'
      group by item_id $q$);
  update bench.results set plan_before = b.plan, ms_before = b.ms where query like 'Q2.%';
end $$;

-- ---------------------------------------------------------------------
-- 5. Keep the results, delete the bench schema, show the table
-- ---------------------------------------------------------------------
create temp table benchmark_results as
select query, used_by, index_added, plan_before, ms_before, plan_after, ms_after,
       round(ms_before / nullif(ms_after, 0), 1) as times_faster
from bench.results order by id;

drop schema bench cascade;

select * from benchmark_results;
