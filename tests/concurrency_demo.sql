-- =====================================================================
-- StockSync | Live demo: row locking (for the defense)
-- Shows that a second request for the same stock row WAITS instead of
-- reading a stale balance. Needs two SQL Editor tabs.
-- =====================================================================

-- ---------- TAB 1: run this first. It locks LED Bulb stock at Cebu for 15 seconds.
begin;
select ws.quantity_on_hand
from public.warehouse_stock ws
join public.items i on i.item_id = ws.item_id
join public.warehouses w on w.warehouse_id = ws.warehouse_id
where i.sku = 'EL-LED-9' and w.name = 'Cebu Main Warehouse'
for update of ws;
select pg_sleep(15);
commit;

-- ---------- TAB 2: run this right after Tab 1 (within 15 seconds).
-- It keeps "Running..." until Tab 1 commits, then continues.
-- This is exactly what happens inside apply_stock_movement() when two
-- users deduct the same item from the same warehouse at the same moment.
/*
select ws.quantity_on_hand, clock_timestamp() as got_lock_at
from public.warehouse_stock ws
join public.items i on i.item_id = ws.item_id
join public.warehouses w on w.warehouse_id = ws.warehouse_id
where i.sku = 'EL-LED-9' and w.name = 'Cebu Main Warehouse'
for update of ws;
*/
