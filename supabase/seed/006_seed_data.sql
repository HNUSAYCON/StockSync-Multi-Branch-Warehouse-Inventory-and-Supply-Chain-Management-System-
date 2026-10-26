-- =====================================================================
-- StockSync | 006: Sample master data and opening stock
-- Safe to edit: change names, add items, etc. Run once after 001-005.
-- =====================================================================

insert into public.warehouses (name, address, contact_no) values
  ('Cebu Main Warehouse',  'M.J. Cuenco Ave., Cebu City',        '0322001001'),
  ('Mandaue Branch',       'A.S. Fortuna St., Mandaue City',     '0322002002'),
  ('Tagbilaran Branch',    'CPG North Ave., Tagbilaran City',    '0384003003');

insert into public.categories (name, description) values
  ('Hardware',          'Tools, fasteners, and fittings'),
  ('Electrical',        'Wires, breakers, outlets, and lighting'),
  ('Plumbing',          'Pipes, valves, and fixtures'),
  ('Paint & Finishing', 'Paints, primers, and sealants');

insert into public.suppliers (name, contact_person, email, contact_no, address) values
  ('Visayan Hardware Trading', 'Ramon Villanueva', 'sales@visayanhw.test',  '09171234567', 'Cebu City'),
  ('Metro Electrical Supply',  'Grace Lim',        'orders@metroelec.test', '09181234567', 'Mandaue City'),
  ('Bohol Builders Depot',     'Arnel Tan',        'contact@boholbd.test',  '09191234567', 'Tagbilaran City');

insert into public.items (category_id, sku, name, unit, unit_cost, reorder_level)
select c.category_id, v.sku, v.name, v.unit, v.unit_cost, v.reorder_level
from (values
  ('Hardware',          'HW-HAM-16',  'Claw Hammer 16oz',              'pc',   285.00, 10),
  ('Hardware',          'HW-SCR-100', 'Wood Screw #8 x 1in (100s)',    'box',  120.00, 20),
  ('Hardware',          'HW-NAIL-2',  'Common Nail 2in',               'kg',    85.00, 50),
  ('Electrical',        'EL-WIRE-35', 'THHN Wire 3.5mm (75m)',         'roll', 2450.00, 5),
  ('Electrical',        'EL-BRK-20',  'Circuit Breaker 20A',           'pc',   395.00, 15),
  ('Electrical',        'EL-LED-9',   'LED Bulb 9W',                   'pc',    95.00, 40),
  ('Plumbing',          'PL-PVC-12',  'PVC Pipe 1/2in x 3m',           'pc',   110.00, 30),
  ('Plumbing',          'PL-VLV-12',  'Gate Valve 1/2in',              'pc',   260.00, 10),
  ('Paint & Finishing', 'PT-LTX-4L',  'Latex Paint White 4L',          'gal',  720.00, 12),
  ('Paint & Finishing', 'PT-PRM-4L',  'Concrete Primer 4L',            'gal',  650.00, 8)
) as v(category_name, sku, name, unit, unit_cost, reorder_level)
join public.categories c on c.name = v.category_name;

-- Opening stock: inserted as ledger movements, so the trigger creates
-- the warehouse_stock rows and every unit has a traceable history.
insert into public.stock_movements (warehouse_id, item_id, movement_type, qty_change)
select w.warehouse_id, i.item_id, 'opening_balance', v.qty
from (values
  ('Cebu Main Warehouse', 'HW-HAM-16',  60), ('Cebu Main Warehouse', 'HW-SCR-100', 150),
  ('Cebu Main Warehouse', 'HW-NAIL-2', 400), ('Cebu Main Warehouse', 'EL-WIRE-35',  25),
  ('Cebu Main Warehouse', 'EL-BRK-20',  80), ('Cebu Main Warehouse', 'EL-LED-9',   300),
  ('Cebu Main Warehouse', 'PL-PVC-12', 200), ('Cebu Main Warehouse', 'PL-VLV-12',   45),
  ('Cebu Main Warehouse', 'PT-LTX-4L',  70), ('Cebu Main Warehouse', 'PT-PRM-4L',   40),
  ('Mandaue Branch',      'HW-HAM-16',  12), ('Mandaue Branch',      'HW-NAIL-2',  120),
  ('Mandaue Branch',      'EL-LED-9',   35), ('Mandaue Branch',      'EL-BRK-20',   10),
  ('Mandaue Branch',      'PL-PVC-12',  60),
  ('Tagbilaran Branch',   'HW-SCR-100', 18), ('Tagbilaran Branch',   'PT-LTX-4L',   20),
  ('Tagbilaran Branch',   'PL-VLV-12',   6), ('Tagbilaran Branch',   'EL-WIRE-35',   4)
) as v(warehouse_name, sku, qty)
join public.warehouses w on w.name = v.warehouse_name
join public.items      i on i.sku  = v.sku;
