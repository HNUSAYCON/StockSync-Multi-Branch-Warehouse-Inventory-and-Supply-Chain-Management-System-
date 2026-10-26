-- =====================================================================
-- StockSync | Migration 001: Schema
-- Tables, primary/foreign keys, constraints, and indexes.
-- Target: Supabase (PostgreSQL 15+). Run in the Supabase SQL Editor.
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------
-- Enumerated types (fixed value lists, so no extra lookup tables needed)
-- ---------------------------------------------------------------------
create type public.user_role         as enum ('admin', 'manager', 'staff');
create type public.assignment_role   as enum ('manager', 'staff');
create type public.assignment_status as enum ('active', 'ended');
create type public.po_status         as enum ('ordered', 'partially_received', 'received', 'cancelled');
create type public.transfer_status   as enum ('requested', 'approved', 'rejected', 'in_transit', 'completed', 'cancelled');
create type public.movement_type     as enum ('opening_balance', 'po_receipt', 'transfer_out', 'transfer_in', 'adjustment');
create type public.adjustment_reason as enum ('damaged', 'lost', 'recount', 'other');
create type public.adjustment_status as enum ('pending', 'approved', 'rejected');
create type public.audit_action      as enum ('INSERT', 'UPDATE', 'DELETE');

-- ---------------------------------------------------------------------
-- users: one row per login account. Passwords live in Supabase's own
-- auth.users table, so there is no password_hash column here.
-- New accounts start inactive until an admin activates them.
-- ---------------------------------------------------------------------
create table public.users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      varchar(100) not null unique,
  role       public.user_role not null default 'staff',
  is_active  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- employees: personal profile, optionally linked to one login account (1:0..1)
-- ---------------------------------------------------------------------
create table public.employees (
  employee_id integer generated always as identity primary key,
  user_id     uuid unique references public.users (user_id) on delete set null,
  first_name  varchar(50) not null,
  last_name   varchar(50) not null,
  contact_no  varchar(15),
  hired_at    date not null default current_date
);

create table public.warehouses (
  warehouse_id integer generated always as identity primary key,
  name         varchar(100) not null unique,
  address      varchar(255) not null,
  contact_no   varchar(15),
  created_at   timestamptz not null default now()
);

create table public.categories (
  category_id integer generated always as identity primary key,
  name        varchar(50) not null unique,
  description text
);

create table public.suppliers (
  supplier_id    integer generated always as identity primary key,
  name           varchar(100) not null unique,
  contact_person varchar(100),
  email          varchar(100),
  contact_no     varchar(15),
  address        varchar(255)
);

create table public.items (
  item_id       integer generated always as identity primary key,
  category_id   integer not null references public.categories (category_id) on delete restrict,
  sku           varchar(30)  not null unique,
  name          varchar(100) not null,
  unit          varchar(20)  not null default 'pc',
  unit_cost     numeric(10,2) not null default 0 check (unit_cost >= 0),
  reorder_level integer not null default 0 check (reorder_level >= 0)
);

-- ---------------------------------------------------------------------
-- employee_assignments (junction: employees N:M warehouses)
-- Intersection attributes: assigned_role, status, assigned_at, ended_at
-- ---------------------------------------------------------------------
create table public.employee_assignments (
  assignment_id integer generated always as identity primary key,
  employee_id   integer not null references public.employees (employee_id) on delete cascade,
  warehouse_id  integer not null references public.warehouses (warehouse_id) on delete cascade,
  assigned_role public.assignment_role not null,
  status        public.assignment_status not null default 'active',
  assigned_at   timestamptz not null default now(),
  ended_at      timestamptz,
  constraint chk_assignment_end check (
    (status = 'active' and ended_at is null) or (status = 'ended' and ended_at is not null)),
  constraint chk_assignment_dates check (ended_at is null or ended_at >= assigned_at)
);
-- An employee can have only ONE active assignment per warehouse
create unique index uq_active_assignment
  on public.employee_assignments (employee_id, warehouse_id) where status = 'active';

-- ---------------------------------------------------------------------
-- warehouse_stock (junction: warehouses N:M items)
-- Intersection attributes: quantity_on_hand, quantity_reserved, updated_at
-- The CHECKs make negative stock impossible at the database level.
-- ---------------------------------------------------------------------
create table public.warehouse_stock (
  warehouse_id      integer not null references public.warehouses (warehouse_id) on delete restrict,
  item_id           integer not null references public.items (item_id) on delete restrict,
  quantity_on_hand  integer not null default 0,
  quantity_reserved integer not null default 0,
  updated_at        timestamptz not null default now(),
  primary key (warehouse_id, item_id),
  constraint chk_stock_nonnegative   check (quantity_on_hand >= 0 and quantity_reserved >= 0),
  constraint chk_reserved_le_on_hand check (quantity_reserved <= quantity_on_hand)
);

create table public.purchase_orders (
  po_id        integer generated always as identity primary key,
  supplier_id  integer not null references public.suppliers (supplier_id) on delete restrict,
  warehouse_id integer not null references public.warehouses (warehouse_id) on delete restrict,
  created_by   integer not null references public.employees (employee_id) on delete restrict,
  status       public.po_status not null default 'ordered',
  ordered_at   timestamptz not null default now(),
  expected_at  date
);

-- purchase_order_items (junction: purchase_orders N:M items)
create table public.purchase_order_items (
  po_id        integer not null references public.purchase_orders (po_id) on delete cascade,
  item_id      integer not null references public.items (item_id) on delete restrict,
  qty_ordered  integer not null check (qty_ordered > 0),
  qty_received integer not null default 0,
  unit_cost    numeric(10,2) not null check (unit_cost >= 0),
  primary key (po_id, item_id),
  constraint chk_poi_received check (qty_received between 0 and qty_ordered)
);

create table public.stock_transfers (
  transfer_id       integer generated always as identity primary key,
  from_warehouse_id integer not null references public.warehouses (warehouse_id) on delete restrict,
  to_warehouse_id   integer not null references public.warehouses (warehouse_id) on delete restrict,
  requested_by      integer not null references public.employees (employee_id) on delete restrict,
  approved_by       integer references public.employees (employee_id) on delete restrict,
  status            public.transfer_status not null default 'requested',
  requested_at      timestamptz not null default now(),
  completed_at      timestamptz,
  constraint chk_transfer_distinct  check (from_warehouse_id <> to_warehouse_id),
  constraint chk_transfer_completed check ((status = 'completed') = (completed_at is not null))
);

-- transfer_items (junction: stock_transfers N:M items)
create table public.transfer_items (
  transfer_id   integer not null references public.stock_transfers (transfer_id) on delete cascade,
  item_id       integer not null references public.items (item_id) on delete restrict,
  qty_requested integer not null check (qty_requested > 0),
  qty_sent      integer not null default 0,
  primary key (transfer_id, item_id),
  constraint chk_ti_sent check (qty_sent between 0 and qty_requested)
);

-- ---------------------------------------------------------------------
-- stock_adjustments: damaged / lost / recount requests that need a
-- manager's approval before they change stock. (NEW: add to your ERD.)
-- ---------------------------------------------------------------------
create table public.stock_adjustments (
  adjustment_id integer generated always as identity primary key,
  warehouse_id  integer not null references public.warehouses (warehouse_id) on delete restrict,
  item_id       integer not null references public.items (item_id) on delete restrict,
  qty_change    integer not null check (qty_change <> 0),
  reason        public.adjustment_reason not null,
  notes         text,
  status        public.adjustment_status not null default 'pending',
  requested_by  integer not null references public.employees (employee_id) on delete restrict,
  reviewed_by   integer references public.employees (employee_id) on delete restrict,
  requested_at  timestamptz not null default now(),
  reviewed_at   timestamptz,
  constraint chk_adjustment_review check ((status = 'pending') = (reviewed_at is null))
);

-- ---------------------------------------------------------------------
-- stock_movements: the append-only ledger. Every stock change is a row
-- here; a trigger applies it to warehouse_stock (see migration 003).
-- ---------------------------------------------------------------------
create table public.stock_movements (
  movement_id   bigint generated always as identity primary key,
  warehouse_id  integer not null references public.warehouses (warehouse_id) on delete restrict,
  item_id       integer not null references public.items (item_id) on delete restrict,
  movement_type public.movement_type not null,
  qty_change    integer not null check (qty_change <> 0),
  balance_after integer not null,
  po_id         integer references public.purchase_orders (po_id) on delete restrict,
  transfer_id   integer references public.stock_transfers (transfer_id) on delete restrict,
  adjustment_id integer references public.stock_adjustments (adjustment_id) on delete restrict,
  performed_by  integer references public.employees (employee_id) on delete restrict,
  created_at    timestamptz not null default now(),
  -- each movement type must point to exactly the document that caused it
  constraint chk_movement_source check (
    case movement_type
      when 'po_receipt'      then po_id is not null and transfer_id is null and adjustment_id is null
      when 'transfer_out'    then transfer_id is not null and po_id is null and adjustment_id is null
      when 'transfer_in'     then transfer_id is not null and po_id is null and adjustment_id is null
      when 'adjustment'      then adjustment_id is not null and po_id is null and transfer_id is null
      when 'opening_balance' then po_id is null and transfer_id is null and adjustment_id is null
    end),
  -- incoming types must add stock, transfer_out must remove it
  constraint chk_movement_sign check (
    (movement_type in ('po_receipt', 'transfer_in', 'opening_balance') and qty_change > 0)
    or (movement_type = 'transfer_out' and qty_change < 0)
    or movement_type = 'adjustment')
);

create table public.audit_logs (
  log_id     bigint generated always as identity primary key,
  table_name varchar(50)  not null,
  record_id  varchar(100) not null,   -- text so composite keys fit, e.g. '12,5'
  action     public.audit_action not null,
  old_values jsonb,
  new_values jsonb,
  changed_by uuid references public.users (user_id) on delete set null,
  changed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Indexes: every foreign key, plus the columns used by filters/reports
-- ---------------------------------------------------------------------
create index idx_assign_employee      on public.employee_assignments (employee_id);
create index idx_assign_warehouse     on public.employee_assignments (warehouse_id) where status = 'active';
create index idx_items_category       on public.items (category_id);
create index idx_items_name_trgm      on public.items using gin (name extensions.gin_trgm_ops);
create index idx_items_sku_trgm       on public.items using gin (sku extensions.gin_trgm_ops);
create index idx_stock_item           on public.warehouse_stock (item_id);
create index idx_po_warehouse_status  on public.purchase_orders (warehouse_id, status);
create index idx_po_supplier          on public.purchase_orders (supplier_id);
create index idx_po_created_by        on public.purchase_orders (created_by);
create index idx_po_ordered_at        on public.purchase_orders (ordered_at);
create index idx_poi_item             on public.purchase_order_items (item_id);
create index idx_transfer_from        on public.stock_transfers (from_warehouse_id, status);
create index idx_transfer_to          on public.stock_transfers (to_warehouse_id, status);
create index idx_transfer_requested   on public.stock_transfers (requested_by);
create index idx_transfer_approved    on public.stock_transfers (approved_by);
create index idx_ti_item              on public.transfer_items (item_id);
create index idx_adj_warehouse_status on public.stock_adjustments (warehouse_id, status);
create index idx_adj_item             on public.stock_adjustments (item_id);
create index idx_adj_requested        on public.stock_adjustments (requested_by);
create index idx_adj_reviewed         on public.stock_adjustments (reviewed_by);
create index idx_mov_wh_item_time     on public.stock_movements (warehouse_id, item_id, created_at desc);
create index idx_mov_created          on public.stock_movements (created_at desc);
create index idx_mov_item             on public.stock_movements (item_id);
create index idx_mov_po               on public.stock_movements (po_id) where po_id is not null;
create index idx_mov_transfer         on public.stock_movements (transfer_id) where transfer_id is not null;
create index idx_mov_adjustment       on public.stock_movements (adjustment_id) where adjustment_id is not null;
create index idx_mov_performed        on public.stock_movements (performed_by);
create index idx_audit_record         on public.audit_logs (table_name, record_id);
create index idx_audit_changed_at     on public.audit_logs (changed_at desc);
create index idx_audit_changed_by     on public.audit_logs (changed_by);
