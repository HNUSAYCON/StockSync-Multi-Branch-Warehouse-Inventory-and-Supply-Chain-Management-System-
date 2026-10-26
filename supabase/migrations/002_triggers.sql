-- =====================================================================
-- StockSync | Migration 002: Triggers
-- Automation that runs inside the database, no matter which app,
-- dashboard, or SQL client makes the change.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Auto-maintain updated_at columns
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_users_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

create trigger trg_warehouse_stock_updated_at
  before update on public.warehouse_stock
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 2. Create a public.users row whenever someone is added in
--    Supabase Authentication (and keep the email in sync).
-- ---------------------------------------------------------------------
create or replace function public.handle_auth_user_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (user_id, email) values (new.id, new.email);
  return new;
end;
$$;

create or replace function public.handle_auth_user_email_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.users set email = new.email where user_id = new.id;
  return new;
end;
$$;

create trigger trg_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_auth_user_created();

create trigger trg_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_auth_user_email_changed();

-- ---------------------------------------------------------------------
-- 3. Admins cannot demote or deactivate themselves (prevents lock-out)
-- ---------------------------------------------------------------------
create or replace function public.protect_own_account()
returns trigger language plpgsql as $$
begin
  if old.user_id = auth.uid()
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception 'You cannot change your own role or active status.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_users_protect_own_account
  before update on public.users
  for each row execute function public.protect_own_account();

-- ---------------------------------------------------------------------
-- 4. Ending an assignment stamps ended_at automatically
-- ---------------------------------------------------------------------
create or replace function public.stamp_assignment_end()
returns trigger language plpgsql as $$
begin
  if new.status = 'ended' and old.status = 'active' and new.ended_at is null then
    new.ended_at := now();
  elsif new.status = 'active' then
    new.ended_at := null;
  end if;
  return new;
end;
$$;

create trigger trg_assignment_end
  before update of status on public.employee_assignments
  for each row execute function public.stamp_assignment_end();

-- ---------------------------------------------------------------------
-- 5. THE LEDGER TRIGGER (core of the system)
--    Inserting a row into stock_movements automatically:
--      a) creates the warehouse_stock row if this is the item's first time here
--      b) LOCKS that stock row (SELECT ... FOR UPDATE) so simultaneous
--         requests for the same item+warehouse wait in line
--      c) rejects the change if it would push stock below what is reserved
--         (so stock can never go negative)
--      d) updates quantity_on_hand and records balance_after
-- ---------------------------------------------------------------------
create or replace function public.apply_stock_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_on_hand  integer;
  v_reserved integer;
begin
  insert into warehouse_stock (warehouse_id, item_id)
  values (new.warehouse_id, new.item_id)
  on conflict (warehouse_id, item_id) do nothing;

  select quantity_on_hand, quantity_reserved
    into v_on_hand, v_reserved
  from warehouse_stock
  where warehouse_id = new.warehouse_id and item_id = new.item_id
  for update;

  if v_on_hand + new.qty_change < v_reserved then
    raise exception 'Insufficient stock for item % in warehouse %: % on hand, % reserved, cannot apply change of %.',
      new.item_id, new.warehouse_id, v_on_hand, v_reserved, new.qty_change
      using errcode = 'P0001', hint = 'Stock cannot go below zero or below the reserved quantity.';
  end if;

  -- tell the guard trigger (below) that this update comes from the ledger
  perform set_config('stocksync.ledger', 'on', true);
  update warehouse_stock
     set quantity_on_hand = v_on_hand + new.qty_change
   where warehouse_id = new.warehouse_id and item_id = new.item_id;
  perform set_config('stocksync.ledger', 'off', true);

  new.balance_after := v_on_hand + new.qty_change;
  new.created_at    := now();
  return new;
end;
$$;

create trigger trg_apply_stock_movement
  before insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

-- ---------------------------------------------------------------------
-- 6. Guard: quantity_on_hand may ONLY change through the ledger.
--    Even someone editing warehouse_stock directly in a DB client is blocked,
--    so the ledger and the stock balance can never disagree.
-- ---------------------------------------------------------------------
create or replace function public.guard_stock_quantity()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('stocksync.ledger', true), 'off') <> 'on' then
    if tg_op = 'INSERT' and new.quantity_on_hand <> 0 then
      raise exception 'Stock must start at 0. Add an opening_balance movement instead.';
    elsif tg_op = 'UPDATE' and new.quantity_on_hand <> old.quantity_on_hand then
      raise exception 'quantity_on_hand can only change by inserting into stock_movements.';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_guard_stock_quantity
  before insert or update on public.warehouse_stock
  for each row execute function public.guard_stock_quantity();

-- ---------------------------------------------------------------------
-- 7. Append-only tables: the ledger and the audit log cannot be edited
--    or deleted (tamper resistance).
-- ---------------------------------------------------------------------
create or replace function public.block_ledger_changes()
returns trigger language plpgsql as $$
begin
  raise exception 'stock_movements is append-only: % is not allowed. Record a correcting movement instead.', tg_op;
end;
$$;

create or replace function public.block_audit_changes()
returns trigger language plpgsql as $$
begin
  -- The only change allowed: FK "ON DELETE SET NULL" when a user account is removed
  if tg_op = 'UPDATE' then
    if new.changed_by is null
       and (to_jsonb(new) - 'changed_by') = (to_jsonb(old) - 'changed_by') then
      return new;
    end if;
  end if;
  raise exception 'audit_logs is append-only: % is not allowed.', tg_op;
end;
$$;

create trigger trg_block_ledger_changes
  before update or delete on public.stock_movements
  for each row execute function public.block_ledger_changes();
create trigger trg_block_ledger_truncate
  before truncate on public.stock_movements
  for each statement execute function public.block_ledger_changes();

create trigger trg_block_audit_changes
  before update or delete on public.audit_logs
  for each row execute function public.block_audit_changes();
create trigger trg_block_audit_truncate
  before truncate on public.audit_logs
  for each statement execute function public.block_audit_changes();

-- ---------------------------------------------------------------------
-- 8. AUDIT TRIGGER: one generic function logs INSERT/UPDATE/DELETE with
--    before/after values and who did it. Trigger arguments = PK column(s).
-- ---------------------------------------------------------------------
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_ids text[] := '{}';
  i     integer;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;

  -- skip updates that changed nothing
  if tg_op = 'UPDATE' and v_old = v_new then
    return null;
  end if;

  v_row := coalesce(v_new, v_old);
  for i in 0 .. tg_nargs - 1 loop
    v_ids := v_ids || (v_row ->> tg_argv[i]);
  end loop;

  insert into audit_logs (table_name, record_id, action, old_values, new_values, changed_by)
  values (tg_table_name, array_to_string(v_ids, ','), tg_op::audit_action, v_old, v_new,
          (select user_id from users where user_id = auth.uid()));
  return null;
end;
$$;

create trigger trg_audit_users                after insert or update or delete on public.users                for each row execute function public.audit_row_change('user_id');
create trigger trg_audit_employees            after insert or update or delete on public.employees            for each row execute function public.audit_row_change('employee_id');
create trigger trg_audit_employee_assignments after insert or update or delete on public.employee_assignments for each row execute function public.audit_row_change('assignment_id');
create trigger trg_audit_warehouses           after insert or update or delete on public.warehouses           for each row execute function public.audit_row_change('warehouse_id');
create trigger trg_audit_categories           after insert or update or delete on public.categories           for each row execute function public.audit_row_change('category_id');
create trigger trg_audit_suppliers            after insert or update or delete on public.suppliers            for each row execute function public.audit_row_change('supplier_id');
create trigger trg_audit_items                after insert or update or delete on public.items                for each row execute function public.audit_row_change('item_id');
create trigger trg_audit_purchase_orders      after insert or update or delete on public.purchase_orders      for each row execute function public.audit_row_change('po_id');
create trigger trg_audit_purchase_order_items after insert or update or delete on public.purchase_order_items for each row execute function public.audit_row_change('po_id', 'item_id');
create trigger trg_audit_stock_transfers      after insert or update or delete on public.stock_transfers      for each row execute function public.audit_row_change('transfer_id');
create trigger trg_audit_transfer_items       after insert or update or delete on public.transfer_items       for each row execute function public.audit_row_change('transfer_id', 'item_id');
create trigger trg_audit_stock_adjustments    after insert or update or delete on public.stock_adjustments    for each row execute function public.audit_row_change('adjustment_id');
-- warehouse_stock is not audited here: every change to it is already
-- recorded in the stock_movements ledger with who, what, and why.
