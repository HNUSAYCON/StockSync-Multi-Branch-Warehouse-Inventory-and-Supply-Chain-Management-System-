-- =====================================================================
-- StockSync | Migration 005: Security (RBAC + Row-Level Security)
--
-- How access works in Supabase:
--   * The website never uses the admin (postgres / service_role) login.
--   * Logged-in users reach the database as the limited role
--     "authenticated"; visitors who are not logged in are "anon".
--   * Layer 1, GRANTS: what the role may do at all (e.g. no INSERT on
--     stock_movements, ever).
--   * Layer 2, RLS POLICIES: which ROWS each person may see or change,
--     based on their tier (admin / manager / staff) and warehouse assignments.
--   * Stock-changing work goes only through the functions in 003, which
--     check permissions before doing anything.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Layer 1: privileges
-- ---------------------------------------------------------------------
-- Not-logged-in visitors get nothing
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Logged-in users: read-only by default ...
revoke all    on all tables in schema public from authenticated;
grant  select on all tables in schema public to authenticated;

-- Views (listed explicitly as well, in case the line above skipped them)
grant select on public.v_stock_levels, public.v_low_stock,
                public.v_warehouse_dashboard, public.v_movement_history
to authenticated;

-- ... plus writes only on the admin-managed master tables (RLS limits these to admins)
grant update (role, is_active)       on public.users                to authenticated;
grant insert, update, delete         on public.employees            to authenticated;
grant insert, update, delete         on public.employee_assignments to authenticated;
grant insert, update, delete         on public.warehouses           to authenticated;
grant insert, update, delete         on public.categories           to authenticated;
grant insert, update, delete         on public.suppliers            to authenticated;
grant insert, update, delete         on public.items                to authenticated;
-- No write grants on: warehouse_stock, purchase_orders, purchase_order_items,
-- stock_transfers, transfer_items, stock_adjustments, stock_movements, audit_logs.
-- Those change ONLY through the workflow functions.

-- Functions: nobody can call them unless granted below
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.current_user_role(),
  public.is_active_user(),
  public.is_admin(),
  public.current_employee_id(),
  public.has_warehouse_access(integer),
  public.is_warehouse_manager(integer),
  public.create_purchase_order(integer, integer, jsonb, date),
  public.receive_purchase_order(integer, jsonb),
  public.cancel_purchase_order(integer),
  public.request_transfer(integer, integer, jsonb),
  public.review_transfer(integer, boolean),
  public.send_transfer(integer, jsonb),
  public.receive_transfer(integer),
  public.cancel_transfer(integer),
  public.request_adjustment(integer, integer, integer, public.adjustment_reason, text),
  public.review_adjustment(integer, boolean),
  public.get_movement_report(integer, date, date),
  public.get_purchase_report(date, date),
  public.search_items(text),
  public.get_item_availability(integer)
to authenticated;

-- Supabase auto-grants new tables/functions to anon & authenticated.
-- Turn that off so anything added later starts locked.
alter default privileges in schema public revoke all     on tables    from anon, authenticated;
alter default privileges in schema public revoke all     on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Layer 2: Row-Level Security
-- (select fn()) wrappers let Postgres run the check once per query
-- instead of once per row, which is much faster on big tables.
-- ---------------------------------------------------------------------
alter table public.users                enable row level security;
alter table public.employees            enable row level security;
alter table public.employee_assignments enable row level security;
alter table public.warehouses           enable row level security;
alter table public.categories           enable row level security;
alter table public.suppliers            enable row level security;
alter table public.items                enable row level security;
alter table public.warehouse_stock      enable row level security;
alter table public.purchase_orders      enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.stock_transfers      enable row level security;
alter table public.transfer_items       enable row level security;
alter table public.stock_adjustments    enable row level security;
alter table public.stock_movements      enable row level security;
alter table public.audit_logs           enable row level security;

-- users: see your own account; admins see and edit all
create policy users_select on public.users for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy users_update on public.users for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- employees: yourself, co-workers in your warehouses; admins everything
create policy employees_select on public.employees for select to authenticated
  using (
    (select public.is_admin())
    or user_id = (select auth.uid())
    or exists (
      select 1 from public.employee_assignments a
      where a.employee_id = employees.employee_id
        and a.status = 'active'
        and public.has_warehouse_access(a.warehouse_id)));
create policy employees_admin_write on public.employees for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- employee_assignments: assignments in your warehouses; admins manage all
create policy assignments_select on public.employee_assignments for select to authenticated
  using (public.has_warehouse_access(warehouse_id));
create policy assignments_admin_write on public.employee_assignments for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Catalog tables: any ACTIVE user can read (needed for dropdowns); admins write
create policy warehouses_select on public.warehouses for select to authenticated
  using ((select public.is_active_user()));
create policy warehouses_admin_write on public.warehouses for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy categories_select on public.categories for select to authenticated
  using ((select public.is_active_user()));
create policy categories_admin_write on public.categories for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy suppliers_select on public.suppliers for select to authenticated
  using ((select public.is_active_user()));
create policy suppliers_admin_write on public.suppliers for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy items_select on public.items for select to authenticated
  using ((select public.is_active_user()));
create policy items_admin_write on public.items for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Stock: only your assigned warehouses (admins: all)
create policy stock_select on public.warehouse_stock for select to authenticated
  using (public.has_warehouse_access(warehouse_id));

-- Purchase orders and their lines: your warehouses only
create policy po_select on public.purchase_orders for select to authenticated
  using (public.has_warehouse_access(warehouse_id));
create policy poi_select on public.purchase_order_items for select to authenticated
  using (exists (
    select 1 from public.purchase_orders p
    where p.po_id = purchase_order_items.po_id
      and public.has_warehouse_access(p.warehouse_id)));

-- Transfers: visible to both the sending and the receiving warehouse
create policy transfers_select on public.stock_transfers for select to authenticated
  using (public.has_warehouse_access(from_warehouse_id)
      or public.has_warehouse_access(to_warehouse_id));
create policy transfer_items_select on public.transfer_items for select to authenticated
  using (exists (
    select 1 from public.stock_transfers t
    where t.transfer_id = transfer_items.transfer_id
      and (public.has_warehouse_access(t.from_warehouse_id)
        or public.has_warehouse_access(t.to_warehouse_id))));

-- Adjustments: managers see their warehouse's; staff see their own requests
create policy adjustments_select on public.stock_adjustments for select to authenticated
  using (public.is_warehouse_manager(warehouse_id)
      or requested_by = (select public.current_employee_id()));

-- Ledger: managers see their warehouse's; staff see their OWN transactions
create policy movements_select on public.stock_movements for select to authenticated
  using (public.is_warehouse_manager(warehouse_id)
      or performed_by = (select public.current_employee_id()));

-- Audit trail: admins only
create policy audit_select on public.audit_logs for select to authenticated
  using ((select public.is_admin()));
