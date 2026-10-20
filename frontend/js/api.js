// =====================================================================
// StockSync | Data layer: every call to the Supabase backend lives here.
// Pages never talk to Supabase directly; they call these functions.
//
// Reading:  supabase.from('table').select(...)  -> RLS filters the rows
// Writing:  supabase.rpc('function_name', {...}) -> stored function runs
//           as ONE transaction and checks permissions inside the database
// =====================================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Every call returns data, or throws an Error with the database's message
// (e.g. "Insufficient stock for item 4 ..."), so pages can show it.
async function run(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
}

// ------------------------------------------------------------------ Auth
export async function login(email, password) {
  await run(supabase.auth.signInWithPassword({ email, password }));
  const me = await getMyProfile();
  if (!me || !me.is_active) {
    await logout();
    throw new Error('Your account is not activated yet. Ask an administrator.');
  }
  return me; // { user_id, email, role, is_active, ... }
}

export async function logout() {
  await supabase.auth.signOut();
}

export async function getMyProfile() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  return run(supabase.from('users').select('*').eq('user_id', session.user.id).maybeSingle());
}

// My employee profile + my active warehouse assignments
export async function getMyEmployee(userId) {
  return run(supabase.from('employees')
    .select('*, employee_assignments(assignment_id, warehouse_id, assigned_role, status, warehouses(name))')
    .eq('user_id', userId)
    .maybeSingle());
}

// ------------------------------------------------------------------ Reading data
export const getDashboard  = () => run(supabase.from('v_warehouse_dashboard').select('*').order('warehouse_name'));
export const getLowStock   = () => run(supabase.from('v_low_stock').select('*').order('shortfall', { ascending: false }));
export const getWarehouses = () => run(supabase.from('warehouses').select('*').order('name'));
export const getSuppliers  = () => run(supabase.from('suppliers').select('*').order('name'));
export const getCategories = () => run(supabase.from('categories').select('*').order('name'));
export const getItems      = () => run(supabase.from('items').select('*, categories(name)').order('name'));
export const searchItems   = (text) => run(supabase.rpc('search_items', { p_query: text }));

export function getStock(warehouseId = null) {
  let q = supabase.from('v_stock_levels').select('*').order('warehouse_name').order('item_name');
  if (warehouseId) q = q.eq('warehouse_id', warehouseId);
  return run(q);
}

export function getMovements(warehouseId = null, limit = 300) {
  let q = supabase.from('v_movement_history').select('*').order('movement_id', { ascending: false }).limit(limit);
  if (warehouseId) q = q.eq('warehouse_id', warehouseId);
  return run(q);
}

// statuses: null = all, or an array like ['ordered', 'partially_received']
export function getPurchaseOrders(statuses = null) {
  let q = supabase.from('purchase_orders')
    .select(`*, suppliers(name), warehouses(name),
             creator:employees!created_by(first_name, last_name),
             purchase_order_items(*, items(sku, name, unit))`)
    .order('po_id', { ascending: false });
  if (statuses) q = q.in('status', statuses);
  return run(q);
}

export function getTransfers(statuses = null) {
  let q = supabase.from('stock_transfers')
    .select(`*, from_warehouse:warehouses!from_warehouse_id(name),
             to_warehouse:warehouses!to_warehouse_id(name),
             requester:employees!requested_by(first_name, last_name),
             approver:employees!approved_by(first_name, last_name),
             transfer_items(*, items(sku, name, unit))`)
    .order('transfer_id', { ascending: false });
  if (statuses) q = q.in('status', statuses);
  return run(q);
}

export function getAdjustments(status = null) {
  let q = supabase.from('stock_adjustments')
    .select(`*, items(sku, name, unit), warehouses(name),
             requester:employees!requested_by(first_name, last_name),
             reviewer:employees!reviewed_by(first_name, last_name)`)
    .order('adjustment_id', { ascending: false });
  if (status) q = q.eq('status', status);
  return run(q);
}

export function getAuditLogs(tableName = null, limit = 200) {
  let q = supabase.from('audit_logs').select('*, users(email)')
    .order('log_id', { ascending: false }).limit(limit);
  if (tableName) q = q.eq('table_name', tableName);
  return run(q);
}

export const getUsers = () =>
  run(supabase.from('users').select('*, employees(employee_id, first_name, last_name)').order('email'));

export const getEmployees = () =>
  run(supabase.from('employees')
    .select('*, users(email), employee_assignments(assignment_id, warehouse_id, assigned_role, status, warehouses(name))')
    .order('last_name'));

// ------------------------------------------------------------------ Workflows (stored functions)
// items = [{ item_id: 3, qty: 50 }, ...]

export const createPurchaseOrder = (supplierId, warehouseId, items, expectedAt = null) =>
  run(supabase.rpc('create_purchase_order', {
    p_supplier_id: supplierId, p_warehouse_id: warehouseId, p_items: items, p_expected_at: expectedAt }));

export const receivePurchaseOrder = (poId, items) =>
  run(supabase.rpc('receive_purchase_order', { p_po_id: poId, p_items: items }));

export const cancelPurchaseOrder = (poId) =>
  run(supabase.rpc('cancel_purchase_order', { p_po_id: poId }));

export const requestTransfer = (fromId, toId, items) =>
  run(supabase.rpc('request_transfer', { p_from_warehouse_id: fromId, p_to_warehouse_id: toId, p_items: items }));

export const reviewTransfer = (transferId, approve) =>
  run(supabase.rpc('review_transfer', { p_transfer_id: transferId, p_approve: approve }));

// items optional: send less than requested, e.g. [{ item_id: 3, qty: 40 }]
export const sendTransfer = (transferId, items = null) =>
  run(supabase.rpc('send_transfer', { p_transfer_id: transferId, p_items: items }));

export const receiveTransfer = (transferId) =>
  run(supabase.rpc('receive_transfer', { p_transfer_id: transferId }));

export const cancelTransfer = (transferId) =>
  run(supabase.rpc('cancel_transfer', { p_transfer_id: transferId }));

// reason: 'damaged' | 'lost' | 'recount' | 'other'; qtyChange: -3 removes 3, +2 adds 2
export const requestAdjustment = (warehouseId, itemId, qtyChange, reason, notes = null) =>
  run(supabase.rpc('request_adjustment', {
    p_warehouse_id: warehouseId, p_item_id: itemId, p_qty_change: qtyChange, p_reason: reason, p_notes: notes }));

export const reviewAdjustment = (adjustmentId, approve) =>
  run(supabase.rpc('review_adjustment', { p_adjustment_id: adjustmentId, p_approve: approve }));

export const getItemAvailability = (itemId) =>
  run(supabase.rpc('get_item_availability', { p_item_id: itemId }));

// ------------------------------------------------------------------ Reports
export const getMovementReport = (warehouseId, from, to) =>
  run(supabase.rpc('get_movement_report', { p_warehouse_id: warehouseId, p_from: from, p_to: to }));

export const getPurchaseReport = (from, to) =>
  run(supabase.rpc('get_purchase_report', { p_from: from, p_to: to }));

// ------------------------------------------------------------------ Admin: master data
// Direct table writes. RLS only allows these for admins.
const insertRow = (table, row) => run(supabase.from(table).insert(row).select().single());
const updateRow = (table, key, id, changes) => run(supabase.from(table).update(changes).eq(key, id).select().single());
const deleteRow = (table, key, id) => run(supabase.from(table).delete().eq(key, id));

export const addItem         = (row)          => insertRow('items', row);
export const updateItem      = (id, changes)  => updateRow('items', 'item_id', id, changes);
export const deleteItem      = (id)           => deleteRow('items', 'item_id', id);
export const addCategory     = (row)          => insertRow('categories', row);
export const updateCategory  = (id, changes)  => updateRow('categories', 'category_id', id, changes);
export const deleteCategory  = (id)           => deleteRow('categories', 'category_id', id);
export const addSupplier     = (row)          => insertRow('suppliers', row);
export const updateSupplier  = (id, changes)  => updateRow('suppliers', 'supplier_id', id, changes);
export const deleteSupplier  = (id)           => deleteRow('suppliers', 'supplier_id', id);
export const addWarehouse    = (row)          => insertRow('warehouses', row);
export const updateWarehouse = (id, changes)  => updateRow('warehouses', 'warehouse_id', id, changes);
export const deleteWarehouse = (id)           => deleteRow('warehouses', 'warehouse_id', id);
export const addEmployee     = (row)          => insertRow('employees', row);
export const updateEmployee  = (id, changes)  => updateRow('employees', 'employee_id', id, changes);
export const deleteEmployee  = (id)           => deleteRow('employees', 'employee_id', id);

export const setUserRole = (userId, role, isActive) =>
  updateRow('users', 'user_id', userId, { role, is_active: isActive });

export const assignEmployee = (employeeId, warehouseId, assignedRole) =>
  insertRow('employee_assignments', { employee_id: employeeId, warehouse_id: warehouseId, assigned_role: assignedRole });

export const endAssignment = (assignmentId) =>
  run(supabase.from('employee_assignments').update({ status: 'ended' }).eq('assignment_id', assignmentId));
