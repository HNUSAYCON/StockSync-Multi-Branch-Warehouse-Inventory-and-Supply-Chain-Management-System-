-- =====================================================================
-- StockSync | Automated test scenarios
-- Run in the Supabase SQL Editor AFTER 001-007 (needs the demo accounts).
-- All test changes are UNDONE at the end, so your data is not changed.
-- The result grid shows a SUMMARY row, then PASS/FAIL for each test.
-- =====================================================================

create temp table if not exists results (
  test text, passed boolean, detail text, at timestamptz default clock_timestamp());
grant insert, select on results to authenticated;

-- "Log in" as a demo user: same thing Supabase does for each API request
create or replace function pg_temp.login(p_email text) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select user_id from public.users where email = p_email),
                      'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create or replace function pg_temp.check(p_test text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into pg_temp.results values (p_test, coalesce(p_ok, false), p_detail);
$$;

-- Runs p_sql and PASSES only if it fails with an error containing p_expected
create or replace function pg_temp.expect_error(p_test text, p_sql text, p_expected text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    insert into pg_temp.results values (p_test, sqlerrm ilike '%' || p_expected || '%', sqlerrm);
    return;
  end;
  insert into pg_temp.results values (p_test, false, 'Expected an error, but it succeeded');
end $$;

create or replace function pg_temp.run_tests()
returns table (result text, test text, detail text)
language plpgsql as $$
#variable_conflict use_column
declare
  v_json    jsonb;
  v_cebu    integer := (select warehouse_id from public.warehouses where name = 'Cebu Main Warehouse');
  v_mandaue integer := (select warehouse_id from public.warehouses where name = 'Mandaue Branch');
  v_led     integer := (select item_id from public.items where sku = 'EL-LED-9');
  v_hammer  integer := (select item_id from public.items where sku = 'HW-HAM-16');
  v_sup     integer := (select min(supplier_id) from public.suppliers);
  v_po      integer;
  v_tr      integer;
  v_adj     integer;
  v_n       integer;
  v_status  text;
begin
 begin  -- inner block: everything in here is undone at the end
  -- ---------- 1. Data isolation (RLS) ----------
  perform pg_temp.login('staff.cebu@stocksync.test');
  select count(distinct warehouse_id) into v_n from public.warehouse_stock;
  perform pg_temp.check('RLS: Cebu staff sees stock of 1 warehouse only', v_n = 1, v_n || ' warehouse(s) visible');
  select count(*) into v_n from public.audit_logs;
  perform pg_temp.check('RLS: staff cannot read audit logs', v_n = 0, v_n || ' rows visible');
  select count(*) into v_n from public.users;
  perform pg_temp.check('RLS: staff sees only their own user row', v_n = 1, v_n || ' rows visible');

  perform pg_temp.login('admin@stocksync.test');
  select count(distinct warehouse_id) into v_n from public.warehouse_stock;
  perform pg_temp.check('RLS: admin sees all warehouses', v_n = 3, v_n || ' warehouse(s) visible');

  -- ---------- 2. Privileges: no direct stock edits ----------
  perform pg_temp.login('staff.cebu@stocksync.test');
  perform pg_temp.expect_error('GRANTS: staff cannot insert into the ledger directly',
    format('insert into public.stock_movements (warehouse_id, item_id, movement_type, qty_change) values (%s, %s, ''opening_balance'', 999)', v_cebu, v_led),
    'permission denied');
  perform pg_temp.expect_error('GRANTS: staff cannot edit stock quantities',
    format('update public.warehouse_stock set quantity_on_hand = 9999 where warehouse_id = %s', v_cebu),
    'permission denied');
  perform pg_temp.expect_error('GRANTS: staff cannot create items',
    'insert into public.items (category_id, sku, name) values (1, ''X-1'', ''Fake'')',
    'row-level security');

  -- ---------- 3. Purchase orders ----------
  perform pg_temp.login('manager.mandaue@stocksync.test');
  perform pg_temp.expect_error('PO: manager cannot order for another warehouse',
    format('select public.create_purchase_order(%s, %s, ''[{"item_id": %s, "qty": 10}]'')', v_sup, v_cebu, v_hammer),
    'Only a manager of this warehouse');
  v_po := public.create_purchase_order(v_sup, v_mandaue, format('[{"item_id": %s, "qty": 40}]', v_hammer)::jsonb);
  perform pg_temp.check('PO: manager creates PO for own warehouse', v_po is not null, 'po_id ' || v_po);

  perform pg_temp.login('staff.mandaue@stocksync.test');
  v_status := public.receive_purchase_order(v_po, format('[{"item_id": %s, "qty": 15}]', v_hammer)::jsonb);
  perform pg_temp.check('PO: partial receiving sets partially_received', v_status = 'partially_received', v_status);
  perform pg_temp.expect_error('PO: cannot receive more than ordered',
    format('select public.receive_purchase_order(%s, ''[{"item_id": %s, "qty": 26}]'')', v_po, v_hammer),
    'exceed');
  v_status := public.receive_purchase_order(v_po, format('[{"item_id": %s, "qty": 25}]', v_hammer)::jsonb);
  perform pg_temp.check('PO: receiving the rest sets received', v_status = 'received', v_status);
  select quantity_on_hand into v_n from public.warehouse_stock where warehouse_id = v_mandaue and item_id = v_hammer;
  perform pg_temp.check('PO: stock increased 12 -> 52 via ledger trigger', v_n = 52, 'on hand = ' || v_n);

  -- ---------- 4. Transfers + reservations ----------
  perform pg_temp.login('manager.mandaue@stocksync.test');
  v_tr := public.request_transfer(v_cebu, v_mandaue, format('[{"item_id": %s, "qty": 50}]', v_led)::jsonb);
  perform pg_temp.expect_error('TRANSFER: manager cannot approve (admin only)',
    format('select public.review_transfer(%s, true)', v_tr), 'Only an administrator');

  perform pg_temp.login('admin@stocksync.test');
  v_status := public.review_transfer(v_tr, true);
  select quantity_reserved into v_n from public.warehouse_stock where warehouse_id = v_cebu and item_id = v_led;
  perform pg_temp.check('TRANSFER: approval reserves 50 at source', v_status = 'approved' and v_n = 50, 'reserved = ' || v_n);

  -- staff tries to write off 260 of 300; only 250 are free (50 reserved)
  perform pg_temp.login('staff.cebu@stocksync.test');
  v_adj := public.request_adjustment(v_cebu, v_led, -260, 'damaged', 'test: too large');
  perform pg_temp.login('staff.cebu@stocksync.test');
  perform pg_temp.expect_error('ADJUSTMENT: staff cannot approve adjustments',
    format('select public.review_adjustment(%s, true)', v_adj), 'Only a manager');
  perform pg_temp.login('manager.cebu@stocksync.test');
  perform pg_temp.expect_error('NEGATIVE STOCK: cannot remove reserved stock',
    format('select public.review_adjustment(%s, true)', v_adj), 'Insufficient stock');
  select status::text into v_status from public.stock_adjustments where adjustment_id = v_adj;
  perform pg_temp.check('ROLLBACK: failed approval leaves adjustment pending', v_status = 'pending', v_status);

  perform pg_temp.login('manager.mandaue@stocksync.test');
  perform pg_temp.expect_error('TRANSFER: destination cannot send it',
    format('select public.send_transfer(%s)', v_tr), 'Only staff of the source');
  perform pg_temp.login('staff.cebu@stocksync.test');
  perform public.send_transfer(v_tr);
  select quantity_on_hand, quantity_reserved into v_n, v_adj
  from public.warehouse_stock where warehouse_id = v_cebu and item_id = v_led;
  perform pg_temp.check('TRANSFER: sending removes 50 and releases reservation',
    v_n = 250 and v_adj = 0, format('on hand %s, reserved %s', v_n, v_adj));

  perform pg_temp.login('staff.mandaue@stocksync.test');
  perform public.receive_transfer(v_tr);
  select quantity_on_hand into v_n from public.warehouse_stock where warehouse_id = v_mandaue and item_id = v_led;
  perform pg_temp.check('TRANSFER: receiving adds stock 35 -> 85', v_n = 85, 'on hand = ' || v_n);

  -- ---------- 5. Separation of duties ----------
  perform pg_temp.login('manager.cebu@stocksync.test');
  v_adj := public.request_adjustment(v_cebu, v_hammer, -2, 'damaged');
  perform pg_temp.expect_error('ADJUSTMENT: manager cannot approve own request',
    format('select public.review_adjustment(%s, true)', v_adj), 'your own');
  perform pg_temp.login('admin@stocksync.test');
  v_status := public.review_adjustment(v_adj, true);
  perform pg_temp.check('ADJUSTMENT: admin approves, stock 60 -> 58',
    v_status = 'approved' and (select quantity_on_hand from public.warehouse_stock where warehouse_id = v_cebu and item_id = v_hammer) = 58,
    v_status);

  -- ---------- 6. Staff only see their own ledger entries ----------
  perform pg_temp.login('staff.cebu@stocksync.test');
  select count(*) into v_n from public.stock_movements where performed_by is distinct from public.current_employee_id();
  perform pg_temp.check('RLS: staff sees only their own movements', v_n = 0, v_n || ' foreign rows visible');
  perform pg_temp.expect_error('AVAILABILITY: staff cannot check other branches',
    format('select * from public.get_item_availability(%s)', v_led), 'Only managers');

  -- ---------- 7. Tamper protection (even for the database owner) ----------
  reset role;
  perform pg_temp.expect_error('TAMPER: direct stock update blocked by trigger',
    format('update public.warehouse_stock set quantity_on_hand = 1 where warehouse_id = %s and item_id = %s', v_cebu, v_led),
    'can only change by inserting into stock_movements');
  perform pg_temp.expect_error('TAMPER: ledger rows cannot be deleted',
    'delete from public.stock_movements', 'append-only');
  perform pg_temp.expect_error('TAMPER: audit logs cannot be edited',
    'update public.audit_logs set action = ''DELETE''', 'append-only');

  -- ---------- 8. Referential integrity ----------
  perform pg_temp.expect_error('FK: deleting a warehouse that has stock is refused',
    format('delete from public.warehouses where warehouse_id = %s', v_cebu), 'foreign key');
  perform pg_temp.expect_error('FK: deleting a category that has items is refused',
    'delete from public.categories where name = ''Hardware''', 'foreign key');

  -- ---------- 9. Ledger always matches stock ----------
  select count(*) into v_n
  from public.warehouse_stock ws
  where ws.quantity_on_hand <> (select coalesce(sum(m.qty_change), 0) from public.stock_movements m
                                where m.warehouse_id = ws.warehouse_id and m.item_id = ws.item_id);
  perform pg_temp.check('LEDGER: every stock balance equals the sum of its movements', v_n = 0, v_n || ' mismatches');

  -- ---------- 10. Audit trail recorded the workflow ----------
  select count(*) into v_n from public.audit_logs
  where table_name = 'stock_transfers' and record_id = v_tr::text;
  perform pg_temp.check('AUDIT: transfer lifecycle logged by trigger', v_n >= 4, v_n || ' log rows');

  -- Keep the results in a variable, then raise an error on purpose:
  -- that undoes every change the tests made (and the role switches).
  select jsonb_agg(jsonb_build_object(
           'result', case when r.passed then 'PASS' else 'FAIL' end,
           'test', r.test, 'detail', r.detail) order by r.at)
    into v_json
  from pg_temp.results r;
  raise exception using errcode = 'SS999', message = 'undo test data';
 exception
  when sqlstate 'SS999' then
    null;  -- expected: test data rolled back
  when others then
    v_json := jsonb_build_array(jsonb_build_object(
      'result', 'FAIL', 'test', 'Test run stopped by an unexpected error', 'detail', sqlerrm));
 end;

  return query
    select (select count(*) from jsonb_array_elements(v_json) e where e ->> 'result' = 'PASS')
           || ' / ' || jsonb_array_length(v_json) || ' passed',
           'SUMMARY'::text, null::text;
  return query
    select x.result, x.test, x.detail
    from jsonb_to_recordset(v_json) as x(result text, test text, detail text);
end $$;

select * from pg_temp.run_tests();
