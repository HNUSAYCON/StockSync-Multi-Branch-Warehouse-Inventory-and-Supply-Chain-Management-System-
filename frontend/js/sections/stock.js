// Stock levels per warehouse, with search, low-stock filter,
// "Adjust" (request an adjustment) and "Find" (which branch has it?)
import { getStock, getItemAvailability } from '../api.js';
import { esc, money, num, table, showInfo, toast, friendlyError } from '../ui.js';
import { openAdjustmentForm } from './adjustments.js';

// remembered while the page is open
const state = { warehouseId: '', search: '', lowOnly: false };

export async function renderStock(el, ctx) {
  const rows = await getStock(state.warehouseId ? Number(state.warehouseId) : null);
  const canFind = ctx.isAdmin || ctx.role === 'manager';

  el.innerHTML = `
    <div class="toolbar">
      <select class="form-select form-select-sm" id="whFilter" style="max-width: 240px">
        <option value="">${ctx.isAdmin ? 'All warehouses' : 'All my warehouses'}</option>
        ${ctx.myWarehouses.map((w) => `<option value="${w.warehouse_id}" ${String(w.warehouse_id) === state.warehouseId ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}
      </select>
      <input class="form-control form-control-sm" id="search" placeholder="Search SKU, item, or category…" value="${esc(state.search)}" style="max-width: 280px">
      <div class="form-check ms-1">
        <input class="form-check-input" type="checkbox" id="lowOnly" ${state.lowOnly ? 'checked' : ''}>
        <label class="form-check-label small" for="lowOnly">Low stock only</label>
      </div>
    </div>
    <div id="stockTable"></div>`;

  const drawTable = () => {
    const q = state.search.toLowerCase();
    const filtered = rows.filter((r) =>
      (!state.lowOnly || r.is_low_stock) &&
      (!q || [r.sku, r.item_name, r.category_name].some((v) => String(v).toLowerCase().includes(q))));

    el.querySelector('#stockTable').innerHTML = table([
      { label: 'Warehouse', render: (r) => esc(r.warehouse_name) },
      { label: 'SKU',       render: (r) => `<code>${esc(r.sku)}</code>` },
      { label: 'Item',      render: (r) => `${esc(r.item_name)}<div class="small text-muted">${esc(r.category_name)}</div>` },
      { label: 'On hand',   class: 'text-end', render: (r) => num(r.quantity_on_hand) },
      { label: 'Reserved',  class: 'text-end', render: (r) => (r.quantity_reserved ? `<span class="text-info">${num(r.quantity_reserved)}</span>` : '0') },
      { label: 'Available', class: 'text-end', render: (r) => `<span class="fw-semibold">${num(r.quantity_available)}</span> <span class="small text-muted">${esc(r.unit)}</span>` },
      { label: 'Reorder at',class: 'text-end', render: (r) => num(r.reorder_level) },
      { label: 'Status',    render: (r) => (r.is_low_stock ? '<span class="badge rounded-pill text-bg-danger">Low</span>' : '<span class="badge rounded-pill text-bg-light border">OK</span>') },
      { label: 'Value',     class: 'text-end', render: (r) => money(r.stock_value) },
      { label: '',          class: 'text-end text-nowrap', render: (r) => `
          <button class="btn btn-sm btn-outline-secondary" data-action="adjust" data-wh="${r.warehouse_id}" data-item="${r.item_id}" title="Request an adjustment"><i class="bi bi-pencil-square"></i> Adjust</button>
          ${canFind ? `<button class="btn btn-sm btn-outline-primary" data-action="find" data-item="${r.item_id}" data-name="${esc(r.item_name)}" title="Which warehouses have this?"><i class="bi bi-search"></i> Find</button>` : ''}` },
    ], filtered, rows.length ? 'No items match your filters.' : 'No stock records yet.');
  };
  drawTable();

  el.querySelector('#whFilter').onchange = (e) => { state.warehouseId = e.target.value; ctx.refresh(); };
  el.querySelector('#search').oninput = (e) => { state.search = e.target.value; drawTable(); };
  el.querySelector('#lowOnly').onchange = (e) => { state.lowOnly = e.target.checked; drawTable(); };

  el.onclick = async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'adjust') {
      openAdjustmentForm(ctx, { warehouse_id: Number(btn.dataset.wh), item_id: Number(btn.dataset.item) });
    }
    if (btn.dataset.action === 'find') {
      try {
        const where = await getItemAvailability(Number(btn.dataset.item));
        showInfo(`Where is "${btn.dataset.name}" available?`, table([
          { label: 'Warehouse', render: (r) => esc(r.warehouse_name) },
          { label: 'Available', class: 'text-end', render: (r) => num(r.quantity_available) },
        ], where, 'No warehouse has this item available right now.') +
        '<p class="small text-muted mt-3 mb-0">Need some? Request a transfer from one of these warehouses.</p>', '');
      } catch (err) {
        toast(friendlyError(err.message), 'danger');
      }
    }
  };
}
