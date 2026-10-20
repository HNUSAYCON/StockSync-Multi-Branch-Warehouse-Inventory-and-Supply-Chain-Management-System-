-- =====================================================================
-- StockSync | 007: Link demo login accounts to roles and warehouses
--
-- STEP 1 (Supabase dashboard): Authentication -> Users -> Add user ->
--   "Create new user" for each email below (tick "Auto Confirm User").
--   The trigger from 002 creates a matching row in public.users.
-- STEP 2: run this file in the SQL Editor.
-- =====================================================================

-- Roles and activation
update public.users set role = 'admin',   is_active = true where email = 'admin@stocksync.test';
update public.users set role = 'manager', is_active = true where email in ('manager.cebu@stocksync.test', 'manager.mandaue@stocksync.test');
update public.users set role = 'staff',   is_active = true where email in ('staff.cebu@stocksync.test', 'staff.mandaue@stocksync.test');

-- Employee profiles (every account that does work needs one, admins included)
insert into public.employees (user_id, first_name, last_name, contact_no)
select u.user_id, v.first_name, v.last_name, v.contact_no
from (values
  ('admin@stocksync.test',           'Andrea',  'Reyes',     '09170000001'),
  ('manager.cebu@stocksync.test',    'Marco',   'Santos',    '09170000002'),
  ('manager.mandaue@stocksync.test', 'Liza',    'Fernandez', '09170000003'),
  ('staff.cebu@stocksync.test',      'Jomar',   'Dela Cruz', '09170000004'),
  ('staff.mandaue@stocksync.test',   'Kristine','Gomez',     '09170000005')
) as v(email, first_name, last_name, contact_no)
join public.users u on u.email = v.email;

-- Warehouse assignments
insert into public.employee_assignments (employee_id, warehouse_id, assigned_role)
select e.employee_id, w.warehouse_id, v.assigned_role::public.assignment_role
from (values
  ('manager.cebu@stocksync.test',    'Cebu Main Warehouse', 'manager'),
  ('manager.cebu@stocksync.test',    'Tagbilaran Branch',   'manager'),
  ('manager.mandaue@stocksync.test', 'Mandaue Branch',      'manager'),
  ('staff.cebu@stocksync.test',      'Cebu Main Warehouse', 'staff'),
  ('staff.mandaue@stocksync.test',   'Mandaue Branch',      'staff')
) as v(email, warehouse_name, assigned_role)
join public.users      u on u.email = v.email
join public.employees  e on e.user_id = u.user_id
join public.warehouses w on w.name = v.warehouse_name;

-- Check the result
select u.email, u.role, u.is_active, e.first_name, w.name as warehouse, a.assigned_role
from public.users u
left join public.employees e            on e.user_id = u.user_id
left join public.employee_assignments a on a.employee_id = e.employee_id and a.status = 'active'
left join public.warehouses w           on w.warehouse_id = a.warehouse_id
order by u.role, u.email;
