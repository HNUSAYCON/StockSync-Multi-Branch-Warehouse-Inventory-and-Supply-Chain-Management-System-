-- =====================================================================
-- StockSync | Demo helper: make a purchase order "overdue"
-- The website does not allow a past expected date when creating a PO,
-- so for the demo we move the date back here in the SQL Editor.
-- =====================================================================

-- 1. See the open purchase orders and their expected dates
select po_id, warehouse_id, status, expected_at
from public.purchase_orders
where status in ('ordered', 'partially_received')
order by po_id;

-- 2. Make one of them 5 days late (change 1 to the PO number you want)
update public.purchase_orders
set expected_at = current_date - 5
where po_id = 1;

-- 3. Refresh the website: the PO shows a red "overdue · 5 days late" label,
--    the dashboard lists it, and the Purchase orders menu shows a red number.

-- Undo after the demo (sets it back to one week from today)
-- update public.purchase_orders set expected_at = current_date + 7 where po_id = 1;
