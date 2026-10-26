-- =====================================================================
-- StockSync | Migration 004: Views and report functions
-- All views use security_invoker = true and report functions are
-- SECURITY INVOKER (the default), so Row-Level Security still applies:
-- a manager running a report only gets numbers for their own warehouses.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Current stock per warehouse with item details and low-stock flag
-- ---------------------------------------------------------------------
create or replace view public.v_stock_levels
with (security_invoker = true) as
select
  ws.warehouse_id,
  w.name                                           as warehouse_name,
  ws.item_id,
  i.sku,
  i.name                                           as item_name,
  c.name                                           as category_name,
  i.unit,
  ws.quantity_on_hand,
  ws.quantity_reserved,
  ws.quantity_on_hand - ws.quantity_reserved       as quantity_available,
  i.reorder_level,
  (ws.quantity_on_hand - ws.quantity_reserved) <= i.reorder_level as is_low_stock,
  (ws.quantity_on_hand * i.unit_cost)::numeric(14,2)             as stock_value,
  ws.updated_at
from public.warehouse_stock ws
join public.warehouses w on w.warehouse_id = ws.warehouse_id
join public.items      i on i.item_id      = ws.item_id
join public.categories c on c.category_id  = i.category_id;

-- ---------------------------------------------------------------------
-- Low-stock alerts (available quantity at or below the reorder level)
-- ---------------------------------------------------------------------
create or replace view public.v_low_stock
with (security_invoker = true) as
select
  warehouse_id, warehouse_name, item_id, sku, item_name, unit,
  quantity_available, reorder_level,
  reorder_level - quantity_available as shortfall
from public.v_stock_levels
where is_low_stock;

-- ---------------------------------------------------------------------
-- One summary row per warehouse the user can access (dashboard cards)
-- ---------------------------------------------------------------------
create or replace view public.v_warehouse_dashboard
with (security_invoker = true) as
select
  w.warehouse_id,
  w.name as warehouse_name,
  (select count(*) from public.warehouse_stock ws
     join public.items i on i.item_id = ws.item_id
    where ws.warehouse_id = w.warehouse_id
      and ws.quantity_on_hand - ws.quantity_reserved <= i.reorder_level)        as low_stock_items,
  (select coalesce(sum(ws.quantity_on_hand * i.unit_cost), 0)::numeric(14,2)
     from public.warehouse_stock ws
     join public.items i on i.item_id = ws.item_id
    where ws.warehouse_id = w.warehouse_id)                                     as stock_value,
  (select count(*) from public.purchase_orders p
    where p.warehouse_id = w.warehouse_id
      and p.status in ('ordered', 'partially_received'))                        as open_purchase_orders,
  (select count(*) from public.stock_transfers t
    where w.warehouse_id in (t.from_warehouse_id, t.to_warehouse_id)
      and t.status in ('requested', 'approved', 'in_transit'))                  as active_transfers,
  (select count(*) from public.stock_adjustments a
    where a.warehouse_id = w.warehouse_id and a.status = 'pending')             as pending_adjustments
from public.warehouses w
where public.has_warehouse_access(w.warehouse_id);

-- ---------------------------------------------------------------------
-- Movement history with readable names (the "ledger" screen)
-- ---------------------------------------------------------------------
create or replace view public.v_movement_history
with (security_invoker = true) as
select
  m.movement_id,
  m.created_at,
  m.warehouse_id,
  w.name as warehouse_name,
  m.item_id,
  i.sku,
  i.name as item_name,
  m.movement_type,
  m.qty_change,
  m.balance_after,
  m.po_id,
  m.transfer_id,
  m.adjustment_id,
  m.performed_by,
  e.first_name || ' ' || e.last_name as performed_by_name
from public.stock_movements m
join public.warehouses w on w.warehouse_id = m.warehouse_id
join public.items      i on i.item_id      = m.item_id
left join public.employees e on e.employee_id = m.performed_by;

-- =====================================================================
-- Report functions (parameterized)
-- =====================================================================

-- Movement report: per item, how much came in, went out, and net change
create or replace function public.get_movement_report(
  p_warehouse_id integer,
  p_from         date,
  p_to           date)
returns table (
  item_id        integer,
  sku            varchar,
  item_name      varchar,
  qty_in         bigint,
  qty_out        bigint,
  net_change     bigint,
  movement_count bigint)
language sql stable set search_path = public as $$
  select
    m.item_id, i.sku, i.name,
    coalesce(sum(m.qty_change) filter (where m.qty_change > 0), 0),
    coalesce(-sum(m.qty_change) filter (where m.qty_change < 0), 0),
    sum(m.qty_change),
    count(*)
  from stock_movements m
  join items i on i.item_id = m.item_id
  where m.warehouse_id = p_warehouse_id
    and m.created_at >= p_from
    and m.created_at <  p_to + 1
  group by m.item_id, i.sku, i.name
  order by i.name;
$$;

-- Purchase report: ordered vs received value per supplier
create or replace function public.get_purchase_report(p_from date, p_to date)
returns table (
  supplier_id    integer,
  supplier_name  varchar,
  po_count       bigint,
  ordered_value  numeric,
  received_value numeric)
language sql stable set search_path = public as $$
  select
    s.supplier_id, s.name,
    count(distinct p.po_id),
    coalesce(sum(poi.qty_ordered  * poi.unit_cost), 0)::numeric(14,2),
    coalesce(sum(poi.qty_received * poi.unit_cost), 0)::numeric(14,2)
  from purchase_orders p
  join suppliers s              on s.supplier_id = p.supplier_id
  join purchase_order_items poi on poi.po_id     = p.po_id
  where p.ordered_at >= p_from
    and p.ordered_at <  p_to + 1
    and p.status <> 'cancelled'
  group by s.supplier_id, s.name
  order by 4 desc;
$$;

-- Fast item search by name or SKU (uses the trigram indexes)
create or replace function public.search_items(p_query text)
returns setof public.items
language sql stable set search_path = public, extensions as $$
  select *
  from items
  where name ilike '%' || p_query || '%'
     or sku  ilike '%' || p_query || '%'
  order by similarity(name, p_query) desc, name
  limit 50;
$$;

-- "Which branch has this item?" Managers can see AVAILABLE quantities in
-- every warehouse (no costs or values), so they know where to request
-- a transfer from. Runs as definer on purpose, but only returns totals.
create or replace function public.get_item_availability(p_item_id integer)
returns table (
  warehouse_id       integer,
  warehouse_name     varchar,
  quantity_available integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_admin() or current_user_role() = 'manager') then
    raise exception 'Only managers and administrators can check other warehouses.' using errcode = '42501';
  end if;
  return query
    select ws.warehouse_id, w.name, ws.quantity_on_hand - ws.quantity_reserved
    from warehouse_stock ws
    join warehouses w on w.warehouse_id = ws.warehouse_id
    where ws.item_id = p_item_id
      and ws.quantity_on_hand - ws.quantity_reserved > 0
    order by 3 desc;
end;
$$;
