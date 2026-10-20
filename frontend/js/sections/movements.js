// Stock movement history (the ledger). Managers see their warehouses;
// staff see only movements they performed themselves (enforced by RLS).
import { getMovements } from '../api.js';
import { esc, num, table, badge, dateTime } from '../ui.js';

const state = { warehouseId: '' };

export async function renderMovements(el, ctx) {
  const rows = await getMovements(state.warehouseId ? Number(state.warehouseId) : null);

  el.innerHTML = `
    <div class="toolbar">
      <select class="form-select form-select-sm" id="whFilter" style="max-width: 240px">
        <option value="">${ctx.isAdmin ? 'All warehouses' : 'All my warehouses'}</option>
        ${ctx.myWarehouses.map((w) => `<option value="${w.warehouse_id}" ${String(w.warehouse_id) === state.warehouseId ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}
      </select>
      <span class="small text-muted">${ctx.role === 'staff' ? 'Showing transactions you performed.' : 'Latest 300 movements.'} Ledger entries can never be edited or deleted.</span>
    </div>
    ${table([
      { label: 'When',      render: (m) => `<span class="text-nowrap">${dateTime(m.created_at)}</span>` },
      { label: 'Warehouse', render: (m) => esc(m.warehouse_name) },
      { label: 'Item',      render: (m) => `<code>${esc(m.sku)}</code> ${esc(m.item_name)}` },
      { label: 'Type',      render: (m) => badge(m.movement_type) },
      { label: 'Change',    class: 'text-end', render: (m) => `<span class="fw-semibold ${m.qty_change < 0 ? 'text-danger' : 'text-success'}">${m.qty_change > 0 ? '+' : ''}${num(m.qty_change)}</span>` },
      { label: 'Balance',   class: 'text-end', render: (m) => num(m.balance_after) },
      { label: 'Reference', render: (m) => reference(m) },
      { label: 'By',        render: (m) => esc(m.performed_by_name ?? 'System') },
    ], rows, 'No movements recorded yet.')}`;

  el.querySelector('#whFilter').onchange = (e) => { state.warehouseId = e.target.value; ctx.refresh(); };
}

function reference(m) {
  if (m.po_id) return `PO-${m.po_id}`;
  if (m.transfer_id) return `TR-${m.transfer_id}`;
  if (m.adjustment_id) return `ADJ-${m.adjustment_id}`;
  return '<span class="text-muted">Opening balance</span>';
}
