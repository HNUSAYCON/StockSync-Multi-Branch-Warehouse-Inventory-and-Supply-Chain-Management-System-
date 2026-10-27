# StockSync: Data Dictionary

**Group SAYCON** · Advanced Database Systems

This catalog describes every table, column, key, and constraint in the StockSync database (schema `public` on Supabase PostgreSQL). It was generated from the live database catalog, so types and constraints match the migration scripts exactly (`supabase/migrations/001`–`008`).

**Legend:** PK = primary key · FK = foreign key · Null = whether the column may be empty · ON DELETE = what happens to this row when the referenced (parent) row is deleted.

## Contents

1. [`users`](#users)
2. [`employees`](#employees)
3. [`warehouses`](#warehouses)
4. [`categories`](#categories)
5. [`suppliers`](#suppliers)
6. [`items`](#items)
7. [`employee_assignments`](#employee_assignments)
8. [`warehouse_stock`](#warehouse_stock)
9. [`purchase_orders`](#purchase_orders)
10. [`purchase_order_items`](#purchase_order_items)
11. [`stock_transfers`](#stock_transfers)
12. [`transfer_items`](#transfer_items)
13. [`stock_adjustments`](#stock_adjustments)
14. [`stock_movements`](#stock_movements)
15. [`audit_logs`](#audit_logs)
16. [Enumerated types](#enumerated-types)
17. [Views](#views)
18. [Stored functions](#stored-functions)
19. [Triggers](#triggers)

## Relationship summary

| Relationship | Type | Through |
|---|---|---|
| users ↔ employees | 1 : 0..1 | employees.user_id (unique) |
| employees ↔ warehouses | N : M | **employee_assignments** |
| warehouses ↔ items | N : M | **warehouse_stock** |
| purchase_orders ↔ items | N : M | **purchase_order_items** |
| stock_transfers ↔ items | N : M | **transfer_items** |
| categories → items | 1 : N | items.category_id |
| suppliers → purchase_orders | 1 : N | purchase_orders.supplier_id |
| warehouses → purchase_orders / stock_adjustments / stock_movements | 1 : N | warehouse_id |
| warehouses → stock_transfers | 1 : N (twice) | from_warehouse_id, to_warehouse_id |
| employees → purchase_orders / transfers / adjustments / movements | 1 : N | created_by, requested_by, approved_by, reviewed_by, performed_by |
| purchase_orders / stock_transfers / stock_adjustments → stock_movements | 1 : N | po_id, transfer_id, adjustment_id |
| users → audit_logs | 1 : N | audit_logs.changed_by |

## 1. `users`

One row per login account. Linked 1:1 to Supabase Auth (auth.users), which stores the email and the hashed password. Holds the account's role and whether it may log in.

| Column | Type | Key | Null | Default | Description |
|---|---|---|---|---|---|
| `user_id` | uuid | PK<br>FK → auth.users.id | no |  | Same ID as the Supabase Auth account |
| `email` | varchar(100) | UNIQUE | no |  | Login email (kept in sync with Supabase Auth by a trigger) |
| `role` | user_role |  | no | 'staff' | Access tier: admin, manager, or staff |
| `is_active` | boolean |  | no | false | Whether the account may use the system. New accounts start inactive |
| `created_at` | timestamptz |  | no | now() | When the account was created |
| `updated_at` | timestamptz |  | no | now() | Last change (set automatically by a trigger) |

**Foreign keys**

| Column | References | ON DELETE |
|---|---|---|
| `user_id` | auth.users.id | CASCADE |

## 2. `employees`

Personal profile of each employee. An employee may have zero or one login account.

| Column | Type | Key | Null | Default | Description |
|---|---|---|---|---|---|
| `employee_id` | integer | PK | no | auto-number | Unique employee number |
| `user_id` | uuid | FK → users.user_id<br>UNIQUE | yes |  | Linked login account, if any |
| `first_name` | varchar(50) |  | no |  | First name |
| `last_name` | varchar(50) |  | no |  | Last name |
| `contact_no` | varchar(15) |  | yes |  | Phone number |
| `hired_at` | date |  | no | today | Date hired |

**Foreign keys**

| Column | References | ON DELETE |
|---|---|---|
| `user_id` | users.user_id | SET NULL |

## 3. `warehouses`

Each warehouse or branch of the business.

| Column | Type | Key | Null | Default | Description |
|---|---|---|---|---|---|
| `warehouse_id` | integer | PK | no | auto-number | Unique warehouse number |
| `name` | varchar(100) | UNIQUE | no |  | Warehouse name (unique) |
| `address` | varchar(255) |  | no |  | Street address |
| `contact_no` | varchar(15) |  | yes |  | Phone number |
| `created_at` | timestamptz |  | no | now() | When the warehouse was added |

## 4. `categories`

Groups of items (e.g. Hardware, Electrical).

| Column | Type | Key | Null | Default | Description |
|---|---|---|---|---|---|
| `category_id` | integer | PK | no | auto-number | Unique category number |
| `name` | varchar(50) | UNIQUE | no |  | Category name (unique) |
| `description` | text |  | yes |  | What the category contains |

## 5. `suppliers`

Companies that items are purchased from.

| Column | Type | Key | Null | Default | Description |
|---|---|---|---|---|---|
| `supplier_id` | integer | PK | no | auto-number | Unique supplier number |
| `name` | varchar(100) | UNIQUE | no |  | Company name (unique) |
| `contact_person` | varchar(100) |  | yes |  | Person to contact |
| `email` | varchar(100) |  | yes |  | Supplier email |
| `contact_no` | varchar(15) |  | yes |  | Phone number |
| `address` | varchar(255) |  | yes |  | Supplier address |

## 6. `items`

The item catalog: every product the business stocks.

| Column | Type | Key | Null | Default | Description |
|---|---|---|---|---|---|
| `item_id` | integer | PK | no | auto-number | Unique item number |
| `category_id` | integer | FK → categories.category_id | no |  | Category the item belongs to |
| `sku` | varchar(30) | UNIQUE | no |  | Stock-keeping unit code (unique), e.g. HW-HAM-16 |
| `name` | varchar(100) |  | no |  | Item name |
| `unit` | varchar(20) |  | no | 'pc' | Unit of measure (pc, box, kg, roll, gal...) |
| `unit_cost` | numeric(10,2) |  | no | 0 | Catalog cost per unit in pesos |
| `reorder_level` | integer |  | no | 0 | Low-stock alert appears when available stock falls to this number |

**Foreign keys**

| Column | References | ON DELETE |
|---|---|---|
| `category_id` | categories.category_id | RESTRICT |

**Constraints**

- `items_reorder_level_check`: `((reorder_level >= 0))`
- `items_unit_cost_check`: `((unit_cost >= (0)))`

**Indexes**

- `idx_items_category`: btree (category_id)
- `idx_items_name_trgm`: gin (name trigram)
- `idx_items_sku_trgm`: gin (sku trigram)

## 7. `employee_assignments`

Junction table: employees N:M warehouses. Records which warehouse an employee works in and in what role. History is kept: ended assignments stay with status "ended".

| Column | Type | Key | Null | Default | Description |
|---|---|---|---|---|---|
| `assignment_id` | integer | PK | no | auto-number | Unique assignment number |
| `employee_id` | integer | FK → employees.employee_id | no |  | The employee |
| `warehouse_id` | integer | FK → warehouses.warehouse_id | no |  | The warehouse |
| `assigned_role` | assignment_role |  | no |  | Role in this warehouse: manager or staff |
| `status` | assignment_status |  | no | 'active' | active or ended |
| `assigned_at` | timestamptz |  | no | now() | When the assignment started |
| `ended_at` | timestamptz |  | yes |  | When it ended (set automatically when status becomes ended) |

**Foreign keys**

| Column | References | ON DELETE |
|---|---|---|
| `employee_id` | employees.employee_id | CASCADE |
| `warehouse_id` | warehouses.warehouse_id | CASCADE |

**Constraints**

- `chk_assignment_dates`: `(((ended_at IS NULL) OR (ended_at >= assigned_at)))`
- `chk_assignment_end`: `((((status = 'active'::assignment_status) AND (ended_at IS NULL)) OR ((status = 'ended'::assignment_status) AND (ended_at IS NOT NULL))))`

**Indexes**

- `idx_assign_employee`: btree (employee_id)
- `idx_assign_warehouse`: btree (warehouse_id) WHERE (status = 'active'::assignment_status)
- `uq_active_assignment`: btree (employee_id, warehouse_id) WHERE (status = 'active'::assignment_status)

## 8. `warehouse_stock`

Junction table: warehouses N:M items. The current balance of each item in each warehouse. Changed ONLY by the ledger trigger.

| Column | Type | Key | Null | Default | Description |
|---|---|---|---|---|---|
| `warehouse_id` | integer | PK<br>FK → warehouses.warehouse_id | no |  | The warehouse |
| `item_id` | integer | PK<br>FK → items.item_id | no |  | The item |
| `quantity_on_hand` | integer |  | no | 0 | Units physically in the warehouse. Can never be negative |
| `quantity_reserved` | integer |  | no | 0 | Units promised to approved transfers that have not been sent yet |
| `updated_at` | timestamptz |  | no | now() | Last change (set automatically) |

**Foreign keys**

| Column | References | ON DELETE |
|---|---|---|
| `item_id` | items.item_id | RESTRICT |
| `warehouse_id` | warehouses.warehouse_id | RESTRICT |

**Composite primary key:** `(warehouse_id, item_id)`

**Constraints**

- `chk_reserved_le_on_hand`: `((quantity_reserved <= quantity_on_hand))`
- `chk_stock_nonnegative`: `(((quantity_on_hand >= 0) AND (quantity_reserved >= 0)))`

**Indexes**

- `idx_stock_item`: btree (item_id)

## 9. `purchase_orders`

Orders placed with suppliers for one warehouse.

| Column | Type | Key | Null | Default | Description |
|---|---|---|---|---|---|
| `po_id` | integer | PK | no | auto-number | Purchase order number |
| `supplier_id` | integer | FK → suppliers.supplier_id | no |  | Supplier the order is placed with |
| `warehouse_id` | integer | FK → warehouses.warehouse_id | no |  | Warehouse that receives the delivery |
| `created_by` | integer | FK → employees.employee_id | no |  | Employee (manager) who created the order |
| `status` | po_status |  | no | 'ordered' | ordered, partially_received, received, or cancelled |
| `ordered_at` | timestamptz |  | no | now() | When the order was created |
| `expected_at` | date |  | yes |  | Expected delivery date |

**Foreign keys**

| Column | References | ON DELETE |
|---|---|---|
| `created_by` | employees.employee_id | RESTRICT |
| `supplier_id` | suppliers.supplier_id | RESTRICT |
| `warehouse_id` | warehouses.warehouse_id | RESTRICT |

**Indexes**

- `idx_po_created_by`: btree (created_by)
- `idx_po_ordered_at`: btree (ordered_at)
- `idx_po_supplier`: btree (supplier_id)
- `idx_po_warehouse_status`: btree (warehouse_id, status)

## 10. `purchase_order_items`

Junction table: purchase_orders N:M items. The lines of a purchase order, with ordered and received quantities.

| Column | Type | Key | Null | Default | Description |
|---|---|---|---|---|---|
| `po_id` | integer | PK<br>FK → purchase_orders.po_id | no |  | The purchase order |
| `item_id` | integer | PK<br>FK → items.item_id | no |  | The item ordered |
| `qty_ordered` | integer |  | no |  | Units ordered |
| `qty_received` | integer |  | no | 0 | Units received so far (0 up to qty_ordered) |
| `unit_cost` | numeric(10,2) |  | no |  | Agreed cost per unit for this order |

**Foreign keys**

| Column | References | ON DELETE |
|---|---|---|
| `item_id` | items.item_id | RESTRICT |
| `po_id` | purchase_orders.po_id | CASCADE |

**Composite primary key:** `(po_id, item_id)`

**Constraints**

- `chk_poi_received`: `(((qty_received >= 0) AND (qty_received <= qty_ordered)))`
- `purchase_order_items_qty_ordered_check`: `((qty_ordered > 0))`
- `purchase_order_items_unit_cost_check`: `((unit_cost >= (0)))`

**Indexes**

- `idx_poi_item`: btree (item_id)

## 11. `stock_transfers`

Requests to move stock from one warehouse to another (request, approve, send, receive).

| Column | Type | Key | Null | Default | Description |
|---|---|---|---|---|---|
| `transfer_id` | integer | PK | no | auto-number | Transfer number |
| `from_warehouse_id` | integer | FK → warehouses.warehouse_id | no |  | Warehouse sending the stock |
| `to_warehouse_id` | integer | FK → warehouses.warehouse_id | no |  | Warehouse receiving the stock |
| `requested_by` | integer | FK → employees.employee_id | no |  | Manager who requested it |
| `approved_by` | integer | FK → employees.employee_id | yes |  | Administrator who approved or rejected it |
| `status` | transfer_status |  | no | 'requested' | requested, approved, rejected, in_transit, completed, or cancelled |
| `requested_at` | timestamptz |  | no | now() | When it was requested |
| `completed_at` | timestamptz |  | yes |  | When the destination received it |

**Foreign keys**

| Column | References | ON DELETE |
|---|---|---|
| `approved_by` | employees.employee_id | RESTRICT |
| `from_warehouse_id` | warehouses.warehouse_id | RESTRICT |
| `requested_by` | employees.employee_id | RESTRICT |
| `to_warehouse_id` | warehouses.warehouse_id | RESTRICT |

**Constraints**

- `chk_transfer_completed`: `(((status = 'completed'::transfer_status) = (completed_at IS NOT NULL)))`
- `chk_transfer_distinct`: `((from_warehouse_id <> to_warehouse_id))`

**Indexes**

- `idx_transfer_approved`: btree (approved_by)
- `idx_transfer_from`: btree (from_warehouse_id, status)
- `idx_transfer_requested`: btree (requested_by)
- `idx_transfer_to`: btree (to_warehouse_id, status)

## 12. `transfer_items`

Junction table: stock_transfers N:M items. The lines of a transfer, with requested and sent quantities.

| Column | Type | Key | Null | Default | Description |
|---|---|---|---|---|---|
| `transfer_id` | integer | PK<br>FK → stock_transfers.transfer_id | no |  | The transfer |
| `item_id` | integer | PK<br>FK → items.item_id | no |  | The item |
| `qty_requested` | integer |  | no |  | Units requested (and reserved once approved) |
| `qty_sent` | integer |  | no | 0 | Units actually sent (may be less than requested) |

**Foreign keys**

| Column | References | ON DELETE |
|---|---|---|
| `item_id` | items.item_id | RESTRICT |
| `transfer_id` | stock_transfers.transfer_id | CASCADE |

**Composite primary key:** `(transfer_id, item_id)`

**Constraints**

- `chk_ti_sent`: `(((qty_sent >= 0) AND (qty_sent <= qty_requested)))`
- `transfer_items_qty_requested_check`: `((qty_requested > 0))`

**Indexes**

- `idx_ti_item`: btree (item_id)

## 13. `stock_adjustments`

Stock corrections (damaged, lost, recount) recorded by staff and approved or rejected by a manager.

| Column | Type | Key | Null | Default | Description |
|---|---|---|---|---|---|
| `adjustment_id` | integer | PK | no | auto-number | Adjustment number |
| `warehouse_id` | integer | FK → warehouses.warehouse_id | no |  | Warehouse being corrected |
| `item_id` | integer | FK → items.item_id | no |  | Item being corrected |
| `qty_change` | integer |  | no |  | Change in units: negative removes stock, positive adds it. Never 0 |
| `reason` | adjustment_reason |  | no |  | damaged, lost, recount, or other |
| `notes` | text |  | yes |  | Explanation from the requester |
| `status` | adjustment_status |  | no | 'pending' | pending, approved, or rejected |
| `requested_by` | integer | FK → employees.employee_id | no |  | Employee who recorded it |
| `reviewed_by` | integer | FK → employees.employee_id | yes |  | Manager or admin who approved or rejected it |
| `requested_at` | timestamptz |  | no | now() | When it was recorded |
| `reviewed_at` | timestamptz |  | yes |  | When it was reviewed (empty while pending) |

**Foreign keys**

| Column | References | ON DELETE |
|---|---|---|
| `item_id` | items.item_id | RESTRICT |
| `requested_by` | employees.employee_id | RESTRICT |
| `reviewed_by` | employees.employee_id | RESTRICT |
| `warehouse_id` | warehouses.warehouse_id | RESTRICT |

**Constraints**

- `chk_adjustment_review`: `(((status = 'pending'::adjustment_status) = (reviewed_at IS NULL)))`
- `stock_adjustments_qty_change_check`: `((qty_change <> 0))`

**Indexes**

- `idx_adj_item`: btree (item_id)
- `idx_adj_requested`: btree (requested_by)
- `idx_adj_reviewed`: btree (reviewed_by)
- `idx_adj_warehouse_status`: btree (warehouse_id, status)

## 14. `stock_movements`

The append-only stock ledger. Every change to stock is one row here; a trigger applies it to warehouse_stock. Rows can never be updated or deleted.

| Column | Type | Key | Null | Default | Description |
|---|---|---|---|---|---|
| `movement_id` | bigint | PK | no | auto-number | Ledger entry number |
| `warehouse_id` | integer | FK → warehouses.warehouse_id | no |  | Warehouse affected |
| `item_id` | integer | FK → items.item_id | no |  | Item affected |
| `movement_type` | movement_type |  | no |  | What caused it: opening_balance, po_receipt, transfer_out, transfer_in, adjustment |
| `qty_change` | integer |  | no |  | Units added (positive) or removed (negative). Never 0 |
| `balance_after` | integer |  | no |  | Stock on hand right after this movement (set by the trigger) |
| `po_id` | integer | FK → purchase_orders.po_id | yes |  | Source purchase order (for po_receipt) |
| `transfer_id` | integer | FK → stock_transfers.transfer_id | yes |  | Source transfer (for transfer_out / transfer_in) |
| `adjustment_id` | integer | FK → stock_adjustments.adjustment_id | yes |  | Source adjustment (for adjustment) |
| `performed_by` | integer | FK → employees.employee_id | yes |  | Employee who performed it |
| `created_at` | timestamptz |  | no | now() | When it happened (set by the trigger) |

**Foreign keys**

| Column | References | ON DELETE |
|---|---|---|
| `adjustment_id` | stock_adjustments.adjustment_id | RESTRICT |
| `item_id` | items.item_id | RESTRICT |
| `performed_by` | employees.employee_id | RESTRICT |
| `po_id` | purchase_orders.po_id | RESTRICT |
| `transfer_id` | stock_transfers.transfer_id | RESTRICT |
| `warehouse_id` | warehouses.warehouse_id | RESTRICT |

**Constraints**

- `chk_movement_sign`: `((((movement_type = ANY (ARRAY['po_receipt'::movement_type, 'transfer_in'::movement_type, 'opening_balance'::movement_type])) AND (qty_change > 0)) OR ((movement_type = 'transfer_out'::movement_type) AND (qty_change < 0)) OR (movement_type = 'adjustment'::movement_type)))`
- `chk_movement_source`: `( CASE movement_type WHEN 'po_receipt'::movement_type THEN ((po_id IS NOT NULL) AND (transfer_id IS NULL) AND (adjustment_id IS NULL)) WHEN 'transfer_out'::movement_type THEN ((transfer_id IS NOT NULL) AND (po_id IS NULL) AND (adjustment_id IS NULL)) WHEN 'transfer_in'::movement_type THEN ((transfer_id IS NOT NULL) AND (po_id IS NULL) AND (adjustment_id IS NULL)) WHEN 'adjustment'::movement_type THEN ((adjustment_id IS NOT NULL) AND (po_id IS NULL) AND (transfer_id IS NULL)) WHEN 'opening_balance'::movement_type THEN ((po_id IS NULL) AND (transfer_id IS NULL) AND (adjustment_id IS NULL)) ELSE NULL::boolean END)`
- `stock_movements_qty_change_check`: `((qty_change <> 0))`

**Indexes**

- `idx_mov_adjustment`: btree (adjustment_id) WHERE (adjustment_id IS NOT NULL)
- `idx_mov_created`: btree (created_at DESC)
- `idx_mov_item`: btree (item_id)
- `idx_mov_performed`: btree (performed_by)
- `idx_mov_po`: btree (po_id) WHERE (po_id IS NOT NULL)
- `idx_mov_transfer`: btree (transfer_id) WHERE (transfer_id IS NOT NULL)
- `idx_mov_wh_item_time`: btree (warehouse_id, item_id, created_at DESC)

## 15. `audit_logs`

Append-only audit trail written by a trigger: every INSERT, UPDATE, and DELETE on 12 tables, with before/after values and who made the change.

| Column | Type | Key | Null | Default | Description |
|---|---|---|---|---|---|
| `log_id` | bigint | PK | no | auto-number | Audit entry number |
| `table_name` | varchar(50) |  | no |  | Table that was changed |
| `record_id` | varchar(100) |  | no |  | Primary key of the changed row (composite keys as "12,5") |
| `action` | audit_action |  | no |  | INSERT, UPDATE, or DELETE |
| `old_values` | jsonb |  | yes |  | Row before the change (empty for INSERT) |
| `new_values` | jsonb |  | yes |  | Row after the change (empty for DELETE) |
| `changed_by` | uuid | FK → users.user_id | yes |  | Account that made the change (empty for changes made in the SQL editor) |
| `changed_at` | timestamptz |  | no | now() | When it happened |

**Foreign keys**

| Column | References | ON DELETE |
|---|---|---|
| `changed_by` | users.user_id | SET NULL |

**Indexes**

- `idx_audit_changed_at`: btree (changed_at DESC)
- `idx_audit_changed_by`: btree (changed_by)
- `idx_audit_record`: btree (table_name, record_id)

## Enumerated types

Fixed lists of allowed values, stored as PostgreSQL enum types.

| Type | Allowed values | Used in |
|---|---|---|
| `adjustment_reason` | damaged, lost, recount, other | stock_adjustments.reason |
| `adjustment_status` | pending, approved, rejected | stock_adjustments.status |
| `assignment_role` | manager, staff | employee_assignments.assigned_role |
| `assignment_status` | active, ended | employee_assignments.status |
| `audit_action` | INSERT, UPDATE, DELETE | audit_logs.action |
| `movement_type` | opening_balance, po_receipt, transfer_out, transfer_in, adjustment | stock_movements.movement_type |
| `po_status` | ordered, partially_received, received, cancelled | purchase_orders.status |
| `transfer_status` | requested, approved, rejected, in_transit, completed, cancelled | stock_transfers.status |
| `user_role` | admin, manager, staff | users.role |

## Views

All views use `security_invoker`, so Row-Level Security still applies: each user only sees rows for their own warehouses.

| View | Shows |
|---|---|
| `v_stock_levels` | Current stock per warehouse with item, category, available quantity, low-stock flag, and stock value |
| `v_low_stock` | Items whose available stock is at or below the reorder level, with the shortfall |
| `v_warehouse_dashboard` | One summary row per accessible warehouse: low-stock count, stock value, open POs, active transfers, pending adjustments |
| `v_movement_history` | Ledger entries with warehouse, item, and employee names |

## Stored functions

Each workflow function runs as one transaction: if any step fails, nothing is saved.

| Function | Purpose | Who may run it |
|---|---|---|
| `create_purchase_order(supplier, warehouse, items, expected_at)` | Create a PO with its lines | Manager of that warehouse, admin |
| `receive_purchase_order(po, items)` | Record a full or partial delivery; adds stock through the ledger | Staff/manager of that warehouse, admin |
| `cancel_purchase_order(po)` | Cancel a PO with nothing received | Manager of that warehouse, admin |
| `request_transfer(from, to, items)` | Request stock from another warehouse | Manager of the source or destination, admin |
| `review_transfer(transfer, approve)` | Approve (reserves stock) or reject a transfer | Admin |
| `send_transfer(transfer, items)` | Ship a transfer; removes stock at the source | Staff/manager of the source, admin |
| `receive_transfer(transfer)` | Confirm arrival; adds stock at the destination | Staff/manager of the destination, admin |
| `cancel_transfer(transfer)` | Cancel before sending; releases the reservation | Requester, admin |
| `request_adjustment(warehouse, item, qty_change, reason, notes)` | Record a stock correction for approval | Anyone assigned to that warehouse |
| `review_adjustment(adjustment, approve)` | Approve (changes stock) or reject | Manager of that warehouse (not own requests), admin |
| `admin_create_account(email, password, names, role, warehouse, contact)` | Create a login, profile, and assignment in one step | Admin |
| `admin_set_password(user, password)` | Reset a user's password | Admin |
| `get_movement_report(warehouse, from, to)` | In / out / net per item for a period | Users with access to that warehouse |
| `get_purchase_report(from, to)` | Ordered vs received value per supplier | Admin, manager (own warehouses) |
| `search_items(text)` | Search items by partial name or SKU | Any active user |
| `get_item_availability(item)` | Available quantity in every warehouse | Manager, admin |
| `current_user_role(), is_admin(), current_employee_id(), has_warehouse_access(w), is_warehouse_manager(w)` | Permission helpers used by RLS policies and workflows | Internal |

## Triggers

| Trigger function | On | What it does |
|---|---|---|
| `apply_stock_movement()` | BEFORE INSERT on stock_movements | Locks the stock row (SELECT … FOR UPDATE), rejects changes that would make stock negative, updates warehouse_stock, sets balance_after |
| `guard_stock_quantity()` | BEFORE INSERT/UPDATE on warehouse_stock | Blocks any change to quantity_on_hand that does not come from the ledger |
| `block_ledger_changes()` | BEFORE UPDATE/DELETE/TRUNCATE on stock_movements | Makes the ledger append-only |
| `block_audit_changes()` | BEFORE UPDATE/DELETE/TRUNCATE on audit_logs | Makes the audit trail append-only |
| `audit_row_change()` | AFTER INSERT/UPDATE/DELETE on 12 tables | Writes before/after values and the user to audit_logs |
| `handle_auth_user_created()` | AFTER INSERT on auth.users | Creates the matching public.users row (inactive, staff) |
| `handle_auth_user_email_changed()` | AFTER UPDATE OF email on auth.users | Keeps public.users.email in sync |
| `protect_own_account()` | BEFORE UPDATE on users | Stops admins from changing their own role or active status |
| `stamp_assignment_end()` | BEFORE UPDATE OF status on employee_assignments | Fills ended_at when an assignment ends |
| `set_updated_at()` | BEFORE UPDATE on users, warehouse_stock | Keeps updated_at current |
