// =====================================================================
// StockSync | Frontend connection to the Supabase backend
// Use in your HTML pages with:  <script type="module" src="js/api.js"></script>
// or import functions from other modules:  import { login, getStock } from './api.js';
//
// Get these two values from Supabase: Project Settings -> API.
// The ANON key is SAFE to put here (RLS protects the data).
// NEVER put the service_role key in frontend code or on GitHub.
// =====================================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL      = 'https://ulyxltddmhduznvrfkvg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_yQUwv4wY0w-59XXNnm4LnQ_1vqoj3qL';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Every call returns data, or throws an Error with the database's message
// (e.g. "Insufficient stock for item 4 ..."), so you can show it in an alert.
async function run(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
}

// ---------------------------------------------------------------- Auth
export async function login(email, password) {
  await run(supabase.auth.signInWithPassword({ email, password }));
  const me = await getMyProfile();
  if (!me || !me.is_active) {
    await logout();
    throw new Error('Your account is not activated yet. Ask an administrator.');
  }
  return me; // { user_id, email, role, is_active, ... } -> use role to pick the dashboard
}

export async function logout() {
  await supabase.auth.signOut();
}

export async function getMyProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return run(supabase.from('users').select('*').eq('user_id', user.id).maybeSingle());
}

// ---------------------------------------------------------------- Reading data
// RLS automatically limits every query to what the logged-in user may see.
export const getDashboard   = () => run(supabase.from('v_warehouse_dashboard').select('*'));
export const getLowStock    = () => run(supabase.from('v_low_stock').select('*').order('shortfall', { ascending: false }));
export const getWarehouses  = () => run(supabase.from('warehouses').select('*').order('name'));
export const getSuppliers   = () => run(supabase.from('suppliers').select('*').order('name'));
export const getCategories  = () => run(supabase.from('categories').select('*').order('name'));
export const getItems       = () => run(supabase.from('items').select('*, categories(name)').order('name'));
export const searchItems    = (text) => run(supabase.rpc('search_items', { p_query: text }));

export function getStock(warehouseId = null) {
  let q = supabase.from('v_stock_levels').select('*').order('item_name');
  if (warehouseId) q = q.eq('warehouse_id', warehouseId);
  return run(q);
}

export function getMovements(warehouseId = null, limit = 100) {
  let q = supabase.from('v_movement_history').select('*').order('created_at', { ascending: false }).limit(limit);
  if (warehouseId) q = q.eq('warehouse_id', warehouseId);
  return run(q);
}

export function getPurchaseOrders(status = null) {
  let q = supabase.from('purchase_orders')
    .select('*, suppliers(name), warehouses(name), purchase_order_items(*, items(sku, name))')
    .order('ordered_at', { ascending: false });
  if (status) q = q.eq('status', status);
  return run(q);
}

export function getTransfers(status = null) {
  let q = supabase.from('stock_transfers')
    .select('*, from_warehouse:warehouses!from_warehouse_id(name), to_warehouse:warehouses!to_warehouse_id(name), transfer_items(*, items(sku, name))')
    .order('requested_at', { ascending: false });
  if (status) q = q.eq('status', status);
  return run(q);
}

export const getAdjustments = (status = 'pending') =>
  run(supabase.from('stock_adjustments').select('*, items(sku, name), warehouses(name)').eq('status', status));

export const getAuditLogs = (limit = 200) =>
  run(supabase.from('audit_logs').select('*').order('changed_at', { ascending: false }).limit(limit));

// ---------------------------------------------------------------- Workflows (stored functions)
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

// ---------------------------------------------------------------- Reports
export const getMovementReport = (warehouseId, from, to) =>
  run(supabase.rpc('get_movement_report', { p_warehouse_id: warehouseId, p_from: from, p_to: to }));

export const getPurchaseReport = (from, to) =>
  run(supabase.rpc('get_purchase_report', { p_from: from, p_to: to }));

// ---------------------------------------------------------------- Admin: master data (direct table writes, admin-only by RLS)
export const addItem         = (item) => run(supabase.from('items').insert(item).select().single());
export const updateItem      = (id, changes) => run(supabase.from('items').update(changes).eq('item_id', id).select().single());
export const addWarehouse    = (w) => run(supabase.from('warehouses').insert(w).select().single());
export const addSupplier     = (s) => run(supabase.from('suppliers').insert(s).select().single());
export const addCategory     = (c) => run(supabase.from('categories').insert(c).select().single());
export const addEmployee     = (e) => run(supabase.from('employees').insert(e).select().single());
export const setUserRole     = (userId, role, isActive) =>
  run(supabase.from('users').update({ role, is_active: isActive }).eq('user_id', userId).select().single());
export const assignEmployee  = (employeeId, warehouseId, assignedRole) =>
  run(supabase.from('employee_assignments')
    .insert({ employee_id: employeeId, warehouse_id: warehouseId, assigned_role: assignedRole }).select().single());
export const endAssignment   = (assignmentId) =>
  run(supabase.from('employee_assignments').update({ status: 'ended' }).eq('assignment_id', assignmentId));
