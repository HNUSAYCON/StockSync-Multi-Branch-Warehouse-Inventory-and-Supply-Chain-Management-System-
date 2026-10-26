-- =====================================================================
-- StockSync | 007: Link demo login accounts to roles and warehouses
--
-- STEP 1 (Supabase dashboard): Authentication -> Users -> Add user ->
--   "Create new user" for each email below (tick "Auto Confirm User").
--   Demo password used by the team: StockSync123!
--   The trigger from 002 creates a matching row in public.users.
-- STEP 2: run this file in the SQL Editor.
-- =====================================================================

-- Roles and activation
update public.users set role = 'admin',   is_active = true where email = 'saycon.karl_christian@hnu.edu.ph';
update public.users set role = 'manager', is_active = true where email in ('buniao.geokkee_rod@hnu.edu.ph', 'deiparine.luke_maverick@hnu.edu.ph');
update public.users set role = 'staff',   is_active = true where email in ('staff.cebu@stocksync.test', 'staff.mandaue@stocksync.test');

-- Employee profiles (every account that does work needs one, admins included)
insert into public.employees (user_id, first_name, last_name, contact_no)
select u.user_id, v.first_name, v.last_name, v.contact_no
from (values
  ('saycon.karl_christian@hnu.edu.ph',   'Karl Christian', 'Saycon',    null),
  ('buniao.geokkee_rod@hnu.edu.ph',      'Geokkee Rod',    'Buniao',    null),
  ('deiparine.luke_maverick@hnu.edu.ph', 'Luke Maverick',  'Deiparine', null),
  ('staff.cebu@stocksync.test',          'Staff',          '1',         null),
  ('staff.mandaue@stocksync.test',       'Staff',          '2',         null)
) as v(email, first_name, last_name, contact_no)
join public.users u on u.email = v.email;

-- Warehouse assignments
insert into public.employee_assignments (employee_id, warehouse_id, assigned_role)
select e.employee_id, w.warehouse_id, v.assigned_role::public.assignment_role
from (values
  ('buniao.geokkee_rod@hnu.edu.ph',      'Cebu Main Warehouse', 'manager'),
  ('buniao.geokkee_rod@hnu.edu.ph',      'Tagbilaran Branch',   'manager'),
  ('deiparine.luke_maverick@hnu.edu.ph', 'Mandaue Branch',      'manager'),
  ('staff.cebu@stocksync.test',          'Cebu Main Warehouse', 'staff'),
  ('staff.mandaue@stocksync.test',       'Mandaue Branch',      'staff')
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