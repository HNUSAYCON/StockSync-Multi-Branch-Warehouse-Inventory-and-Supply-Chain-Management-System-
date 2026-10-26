-- =====================================================================
-- StockSync | Migration 003: Stored functions
-- Part A: permission helpers (used by RLS policies and workflows)
-- Part B: business workflows (purchase orders, transfers, adjustments)
--
-- Why functions and not PROCEDUREs? Supabase's API (supabase.rpc) can only
-- call FUNCTIONS. They work the same way: parameterized, stored in the
-- database, and each call runs as ONE transaction (all or nothing).
--
-- "security definer" = the function runs with the owner's rights, so it can
-- write to tables the app user cannot touch directly. Every workflow
-- therefore checks the caller's permissions FIRST.
-- =====================================================================

-- =====================================================================
-- PART A: permission helpers
-- =====================================================================

-- Role of the logged-in user (null if not logged in or deactivated)
create or replace function public.current_user_role()
returns public.user_role language sql stable security definer set search_path = public as $$
  select role from users where user_id = auth.uid() and is_active;
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select current_user_role() is not null;
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(current_user_role() = 'admin', false);
$$;

-- employee_id linked to the logged-in (active) account
create or replace function public.current_employee_id()
returns integer language sql stable security definer set search_path = public as $$
  select e.employee_id
  from employees e
  join users u on u.user_id = e.user_id
  where u.user_id = auth.uid() and u.is_active;
$$;

-- Admin, or anyone with an ACTIVE assignment to this warehouse
create or replace function public.has_warehouse_access(p_warehouse_id integer)
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or exists (
    select 1 from employee_assignments a
    where a.employee_id = current_employee_id()
      and a.warehouse_id = p_warehouse_id
      and a.status = 'active');
$$;

-- Admin, or a manager-tier user with an active MANAGER assignment here
create or replace function public.is_warehouse_manager(p_warehouse_id integer)
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or (
    current_user_role() = 'manager'
    and exists (
      select 1 from employee_assignments a
      where a.employee_id = current_employee_id()
        and a.warehouse_id = p_warehouse_id
        and a.assigned_role = 'manager'
        and a.status = 'active'));
$$;

-- Like current_employee_id(), but raises a clear error instead of returning null
create or replace function public.require_employee()
returns integer language plpgsql stable security definer set search_path = public as $$
declare
  v_emp integer;
begin
  v_emp := current_employee_id();
  if v_emp is null then
    raise exception 'Access denied: your account is inactive or has no employee profile.'
      using errcode = '42501';
  end if;
  return v_emp;
end;
$$;

-- =====================================================================
-- PART B: business workflows
-- All item lists are passed as JSON arrays, e.g.
--   [{"item_id": 3, "qty": 50}, {"item_id": 7, "qty": 20, "unit_cost": 12.50}]
-- =====================================================================

-- Validates a JSON item list: must be a non-empty array, no duplicate
-- items, every qty a positive whole number, every item must exist.
create or replace function public.validate_item_list(p_items jsonb, p_allow_zero boolean default false)
returns void language plpgsql stable security definer set search_path = public as $$
declare
  v_count integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'The item list is empty.';
  end if;

  select count(*) into v_count
  from jsonb_to_recordset(p_items) as x(item_id integer, qty integer)
  where x.item_id is null or x.qty is null
     or (x.qty < 0) or (x.qty = 0 and not p_allow_zero);
  if v_count > 0 then
    raise exception 'Every line needs an item_id and a quantity greater than 0.';
  end if;

  select count(*) - count(distinct x.item_id) into v_count
  from jsonb_to_recordset(p_items) as x(item_id integer);
  if v_count > 0 then
    raise exception 'The same item appears more than once in the list.';
  end if;

  select count(*) into v_count
  from jsonb_to_recordset(p_items) as x(item_id integer)
  where not exists (select 1 from items i where i.item_id = x.item_id);
  if v_count > 0 then
    raise exception 'The list contains an item that does not exist.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- B1. PURCHASE ORDERS
-- ---------------------------------------------------------------------

-- Manager creates a PO for their warehouse. Returns the new po_id.
create or replace function public.create_purchase_order(
  p_supplier_id  integer,
  p_warehouse_id integer,
  p_items        jsonb,
  p_expected_at  date default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_emp   integer := require_employee();
  v_po_id integer;
begin
  if not is_warehouse_manager(p_warehouse_id) then
    raise exception 'Only a manager of this warehouse can create purchase orders.' using errcode = '42501';
  end if;
  if not exists (select 1 from suppliers where supplier_id = p_supplier_id) then
    raise exception 'Supplier % does not exist.', p_supplier_id;
  end if;
  if p_expected_at is not null and p_expected_at < current_date then
    raise exception 'The expected delivery date cannot be in the past.';
  end if;
  perform validate_item_list(p_items);

  insert into purchase_orders (supplier_id, warehouse_id, created_by, expected_at)
  values (p_supplier_id, p_warehouse_id, v_emp, p_expected_at)
  returning po_id into v_po_id;

  -- unit_cost defaults to the catalog cost if not given
  insert into purchase_order_items (po_id, item_id, qty_ordered, unit_cost)
  select v_po_id, x.item_id, x.qty, coalesce(x.unit_cost, i.unit_cost)
  from jsonb_to_recordset(p_items) as x(item_id integer, qty integer, unit_cost numeric)
  join items i on i.item_id = x.item_id;

  return v_po_id;
end;
$$;

-- Staff/manager receives a delivery (partial or full). Each received line
-- becomes a 'po_receipt' movement, and the ledger trigger adds the stock.
-- Returns the PO's new status.
create or replace function public.receive_purchase_order(p_po_id integer, p_items jsonb)
returns public.po_status language plpgsql security definer set search_path = public as $$
declare
  v_emp    integer := require_employee();
  v_po     purchase_orders%rowtype;
  v_line   record;
  v_poi    purchase_order_items%rowtype;
  v_status po_status;
begin
  -- lock the PO so two people can't receive the same delivery at once
  select * into v_po from purchase_orders where po_id = p_po_id for update;
  if not found then
    raise exception 'Purchase order % not found.', p_po_id;
  end if;
  if not has_warehouse_access(v_po.warehouse_id) then
    raise exception 'You are not assigned to this purchase order''s warehouse.' using errcode = '42501';
  end if;
  if v_po.status not in ('ordered', 'partially_received') then
    raise exception 'Purchase order % is already %.', p_po_id, v_po.status;
  end if;
  perform validate_item_list(p_items);

  -- process lines in item_id order (consistent lock order prevents deadlocks)
  for v_line in
    select x.item_id, x.qty
    from jsonb_to_recordset(p_items) as x(item_id integer, qty integer)
    order by x.item_id
  loop
    select * into v_poi from purchase_order_items
    where po_id = p_po_id and item_id = v_line.item_id
    for update;

    if not found then
      raise exception 'Item % is not on purchase order %.', v_line.item_id, p_po_id;
    end if;
    if v_poi.qty_received + v_line.qty > v_poi.qty_ordered then
      raise exception 'Item %: receiving % would exceed the % still expected.',
        v_line.item_id, v_line.qty, v_poi.qty_ordered - v_poi.qty_received;
    end if;

    update purchase_order_items
       set qty_received = qty_received + v_line.qty
     where po_id = p_po_id and item_id = v_line.item_id;

    insert into stock_movements (warehouse_id, item_id, movement_type, qty_change, po_id, performed_by)
    values (v_po.warehouse_id, v_line.item_id, 'po_receipt', v_line.qty, p_po_id, v_emp);
  end loop;

  v_status := case
    when exists (select 1 from purchase_order_items
                 where po_id = p_po_id and qty_received < qty_ordered)
    then 'partially_received'::po_status
    else 'received'::po_status
  end;
  update purchase_orders set status = v_status where po_id = p_po_id;
  return v_status;
end;
$$;

-- Manager cancels a PO that has not received anything yet
create or replace function public.cancel_purchase_order(p_po_id integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_po purchase_orders%rowtype;
begin
  perform require_employee();
  select * into v_po from purchase_orders where po_id = p_po_id for update;
  if not found then
    raise exception 'Purchase order % not found.', p_po_id;
  end if;
  if not is_warehouse_manager(v_po.warehouse_id) then
    raise exception 'Only a manager of this warehouse can cancel purchase orders.' using errcode = '42501';
  end if;
  if v_po.status <> 'ordered' then
    raise exception 'Only orders with nothing received yet can be cancelled (this one is %).', v_po.status;
  end if;
  update purchase_orders set status = 'cancelled' where po_id = p_po_id;
end;
$$;

-- ---------------------------------------------------------------------
-- B2. STOCK TRANSFERS: request -> approve -> send -> receive
-- ---------------------------------------------------------------------

-- A manager of EITHER warehouse requests a transfer. Returns transfer_id.
create or replace function public.request_transfer(
  p_from_warehouse_id integer,
  p_to_warehouse_id   integer,
  p_items             jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_emp         integer := require_employee();
  v_transfer_id integer;
begin
  if p_from_warehouse_id = p_to_warehouse_id then
    raise exception 'Source and destination warehouse must be different.';
  end if;
  if not (is_warehouse_manager(p_from_warehouse_id) or is_warehouse_manager(p_to_warehouse_id)) then
    raise exception 'You must manage the source or destination warehouse to request a transfer.' using errcode = '42501';
  end if;
  perform validate_item_list(p_items);

  insert into stock_transfers (from_warehouse_id, to_warehouse_id, requested_by)
  values (p_from_warehouse_id, p_to_warehouse_id, v_emp)
  returning transfer_id into v_transfer_id;

  insert into transfer_items (transfer_id, item_id, qty_requested)
  select v_transfer_id, x.item_id, x.qty
  from jsonb_to_recordset(p_items) as x(item_id integer, qty integer);

  return v_transfer_id;
end;
$$;

-- Admin approves or rejects. Approving RESERVES the stock at the source,
-- so it cannot be adjusted away or promised twice before it is sent.
create or replace function public.review_transfer(p_transfer_id integer, p_approve boolean)
returns public.transfer_status language plpgsql security definer set search_path = public as $$
declare
  v_emp       integer := require_employee();
  v_transfer  stock_transfers%rowtype;
  v_line      record;
  v_available integer;
begin
  if not is_admin() then
    raise exception 'Only an administrator can approve or reject transfers.' using errcode = '42501';
  end if;

  select * into v_transfer from stock_transfers where transfer_id = p_transfer_id for update;
  if not found then
    raise exception 'Transfer % not found.', p_transfer_id;
  end if;
  if v_transfer.status <> 'requested' then
    raise exception 'Transfer % is already %.', p_transfer_id, v_transfer.status;
  end if;

  if not p_approve then
    update stock_transfers set status = 'rejected', approved_by = v_emp where transfer_id = p_transfer_id;
    return 'rejected';
  end if;

  for v_line in
    select ti.item_id, ti.qty_requested
    from transfer_items ti where ti.transfer_id = p_transfer_id
    order by ti.item_id
  loop
    -- lock the source stock row while we check and reserve
    select ws.quantity_on_hand - ws.quantity_reserved into v_available
    from warehouse_stock ws
    where ws.warehouse_id = v_transfer.from_warehouse_id and ws.item_id = v_line.item_id
    for update;

    if coalesce(v_available, 0) < v_line.qty_requested then
      raise exception 'Cannot approve: item % has only % available at the source warehouse (% requested).',
        v_line.item_id, coalesce(v_available, 0), v_line.qty_requested;
    end if;

    update warehouse_stock
       set quantity_reserved = quantity_reserved + v_line.qty_requested
     where warehouse_id = v_transfer.from_warehouse_id and item_id = v_line.item_id;
  end loop;

  update stock_transfers set status = 'approved', approved_by = v_emp where transfer_id = p_transfer_id;
  return 'approved';
end;
$$;

-- Source warehouse staff/manager ships the goods. Optionally send less than
-- requested: p_items = [{"item_id": 3, "qty": 40}]. Lines not listed are
-- sent in full. The reservation is released and stock leaves the source.
create or replace function public.send_transfer(p_transfer_id integer, p_items jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_emp        integer := require_employee();
  v_transfer   stock_transfers%rowtype;
  v_line       record;
  v_send       integer;
  v_total_sent integer := 0;
begin
  select * into v_transfer from stock_transfers where transfer_id = p_transfer_id for update;
  if not found then
    raise exception 'Transfer % not found.', p_transfer_id;
  end if;
  if not has_warehouse_access(v_transfer.from_warehouse_id) then
    raise exception 'Only staff of the source warehouse can send this transfer.' using errcode = '42501';
  end if;
  if v_transfer.status <> 'approved' then
    raise exception 'Transfer % must be approved before sending (it is %).', p_transfer_id, v_transfer.status;
  end if;

  if p_items is not null then
    perform validate_item_list(p_items, true);
    if exists (
      select 1 from jsonb_to_recordset(p_items) as x(item_id integer)
      where not exists (select 1 from transfer_items ti
                        where ti.transfer_id = p_transfer_id and ti.item_id = x.item_id)) then
      raise exception 'The list contains an item that is not part of transfer %.', p_transfer_id;
    end if;
  end if;

  for v_line in
    select ti.item_id, ti.qty_requested
    from transfer_items ti where ti.transfer_id = p_transfer_id
    order by ti.item_id
  loop
    select coalesce((select x.qty from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
                       as x(item_id integer, qty integer)
                     where x.item_id = v_line.item_id), v_line.qty_requested)
      into v_send;

    if v_send > v_line.qty_requested then
      raise exception 'Item %: cannot send % (only % were approved).', v_line.item_id, v_send, v_line.qty_requested;
    end if;

    -- release the reservation made at approval
    update warehouse_stock
       set quantity_reserved = quantity_reserved - v_line.qty_requested
     where warehouse_id = v_transfer.from_warehouse_id and item_id = v_line.item_id;

    update transfer_items set qty_sent = v_send
     where transfer_id = p_transfer_id and item_id = v_line.item_id;

    if v_send > 0 then
      insert into stock_movements (warehouse_id, item_id, movement_type, qty_change, transfer_id, performed_by)
      values (v_transfer.from_warehouse_id, v_line.item_id, 'transfer_out', -v_send, p_transfer_id, v_emp);
      v_total_sent := v_total_sent + v_send;
    end if;
  end loop;

  if v_total_sent = 0 then
    raise exception 'Nothing would be sent. Cancel the transfer instead.';
  end if;

  update stock_transfers set status = 'in_transit' where transfer_id = p_transfer_id;
end;
$$;

-- Destination warehouse staff/manager confirms arrival; stock is added there.
create or replace function public.receive_transfer(p_transfer_id integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_emp      integer := require_employee();
  v_transfer stock_transfers%rowtype;
  v_line     record;
begin
  select * into v_transfer from stock_transfers where transfer_id = p_transfer_id for update;
  if not found then
    raise exception 'Transfer % not found.', p_transfer_id;
  end if;
  if not has_warehouse_access(v_transfer.to_warehouse_id) then
    raise exception 'Only staff of the destination warehouse can receive this transfer.' using errcode = '42501';
  end if;
  if v_transfer.status <> 'in_transit' then
    raise exception 'Transfer % is not in transit (it is %).', p_transfer_id, v_transfer.status;
  end if;

  for v_line in
    select ti.item_id, ti.qty_sent
    from transfer_items ti
    where ti.transfer_id = p_transfer_id and ti.qty_sent > 0
    order by ti.item_id
  loop
    insert into stock_movements (warehouse_id, item_id, movement_type, qty_change, transfer_id, performed_by)
    values (v_transfer.to_warehouse_id, v_line.item_id, 'transfer_in', v_line.qty_sent, p_transfer_id, v_emp);
  end loop;

  update stock_transfers
     set status = 'completed', completed_at = now()
   where transfer_id = p_transfer_id;
end;
$$;

-- The requester or an admin cancels a transfer that has not been sent.
-- If it was already approved, the reservation is released.
create or replace function public.cancel_transfer(p_transfer_id integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_emp      integer := require_employee();
  v_transfer stock_transfers%rowtype;
begin
  select * into v_transfer from stock_transfers where transfer_id = p_transfer_id for update;
  if not found then
    raise exception 'Transfer % not found.', p_transfer_id;
  end if;
  if not (is_admin() or v_transfer.requested_by = v_emp) then
    raise exception 'Only the requester or an administrator can cancel this transfer.' using errcode = '42501';
  end if;
  if v_transfer.status not in ('requested', 'approved') then
    raise exception 'Transfer % is % and can no longer be cancelled.', p_transfer_id, v_transfer.status;
  end if;

  if v_transfer.status = 'approved' then
    update warehouse_stock ws
       set quantity_reserved = ws.quantity_reserved - ti.qty_requested
      from transfer_items ti
     where ti.transfer_id = p_transfer_id
       and ws.warehouse_id = v_transfer.from_warehouse_id
       and ws.item_id = ti.item_id;
  end if;

  update stock_transfers set status = 'cancelled' where transfer_id = p_transfer_id;
end;
$$;

-- ---------------------------------------------------------------------
-- B3. STOCK ADJUSTMENTS: staff records, manager approves
-- ---------------------------------------------------------------------

-- p_qty_change is the difference: -3 for 3 damaged units, +2 if a recount
-- found 2 extra. Returns adjustment_id.
create or replace function public.request_adjustment(
  p_warehouse_id integer,
  p_item_id      integer,
  p_qty_change   integer,
  p_reason       public.adjustment_reason,
  p_notes        text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_emp integer := require_employee();
  v_id  integer;
begin
  if not has_warehouse_access(p_warehouse_id) then
    raise exception 'You are not assigned to this warehouse.' using errcode = '42501';
  end if;
  if p_qty_change is null or p_qty_change = 0 then
    raise exception 'The quantity change cannot be zero.';
  end if;
  if p_reason in ('damaged', 'lost') and p_qty_change > 0 then
    raise exception 'Damaged or lost items must be a negative change.';
  end if;
  if not exists (select 1 from items where item_id = p_item_id) then
    raise exception 'Item % does not exist.', p_item_id;
  end if;

  insert into stock_adjustments (warehouse_id, item_id, qty_change, reason, notes, requested_by)
  values (p_warehouse_id, p_item_id, p_qty_change, p_reason, p_notes, v_emp)
  returning adjustment_id into v_id;
  return v_id;
end;
$$;

-- Manager approves (stock changes through the ledger) or rejects.
-- Managers cannot approve their own requests; admins can.
create or replace function public.review_adjustment(p_adjustment_id integer, p_approve boolean)
returns public.adjustment_status language plpgsql security definer set search_path = public as $$
declare
  v_emp integer := require_employee();
  v_adj stock_adjustments%rowtype;
begin
  select * into v_adj from stock_adjustments where adjustment_id = p_adjustment_id for update;
  if not found then
    raise exception 'Adjustment % not found.', p_adjustment_id;
  end if;
  if not is_warehouse_manager(v_adj.warehouse_id) then
    raise exception 'Only a manager of this warehouse can review adjustments.' using errcode = '42501';
  end if;
  if v_adj.requested_by = v_emp and not is_admin() then
    raise exception 'You cannot approve your own adjustment request.' using errcode = '42501';
  end if;
  if v_adj.status <> 'pending' then
    raise exception 'Adjustment % was already %.', p_adjustment_id, v_adj.status;
  end if;

  if p_approve then
    -- the ledger trigger rejects this if it would make stock negative,
    -- which rolls back the whole function (adjustment stays pending)
    insert into stock_movements (warehouse_id, item_id, movement_type, qty_change, adjustment_id, performed_by)
    values (v_adj.warehouse_id, v_adj.item_id, 'adjustment', v_adj.qty_change, p_adjustment_id, v_emp);
  end if;

  update stock_adjustments
     set status      = case when p_approve then 'approved'::adjustment_status else 'rejected'::adjustment_status end,
         reviewed_by = v_emp,
         reviewed_at = now()
   where adjustment_id = p_adjustment_id;

  return case when p_approve then 'approved'::adjustment_status else 'rejected'::adjustment_status end;
end;
$$;
