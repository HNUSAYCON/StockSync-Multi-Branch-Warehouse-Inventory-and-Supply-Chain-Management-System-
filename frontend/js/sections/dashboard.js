// Dashboard: summary tiles, one card per warehouse, low-stock alerts
import { getDashboard, getLowStock } from '../api.js';
import { esc, money, num, table } from '../ui.js';

export async function renderDashboard(el, ctx) {
  const [warehouses, lowStock] = await Promise.all([getDashboard(), getLowStock()]);

  const sum = (key) => warehouses.reduce((total, w) => total + Number(w[key] ?? 0), 0);
  const tiles = [
    { label: 'Warehouses',          value: num(warehouses.length),          icon: 'building',            color: 'primary' },
    { label: 'Stock value',         value: money(sum('stock_value')),       icon: 'cash-stack',          color: 'success' },
    { label: 'Low-stock items',     value: num(sum('low_stock_items')),     icon: 'exclamation-triangle', color: 'danger' },
    { label: 'Open purchase orders',value: num(sum('open_purchase_orders')),icon: 'cart',                color: 'info' },
    { label: 'Active transfers',    value: num(sum('active_transfers')),    icon: 'truck',               color: 'warning' },
    { label: 'Pending adjustments', value: num(sum('pending_adjustments')), icon: 'clipboard-check',     color: 'secondary' },
  ];

  el.innerHTML = `
    <div class="row g-3 mb-4">
      ${tiles.map((t) => `
        <div class="col-6 col-md-4 col-xl-2">
          <div class="stat-tile">
            <div class="stat-icon text-${t.color}"><i class="bi bi-${t.icon}"></i></div>
            <div class="stat-value">${t.value}</div>
            <div class="stat-label">${esc(t.label)}</div>
          </div>
        </div>`).join('')}
    </div>

    <h6 class="section-heading">${ctx.isAdmin ? 'All warehouses' : 'My warehouses'}</h6>
    <div class="row g-3 mb-4">
      ${warehouses.length ? warehouses.map((w) => `
        <div class="col-md-6 col-xl-4">
          <div class="card h-100">
            <div class="card-body">
              <h6 class="card-title mb-3"><i class="bi bi-building me-1 text-primary"></i>${esc(w.warehouse_name)}</h6>
              <div class="row text-center g-2 small">
                <div class="col-4"><div class="fw-semibold ${w.low_stock_items > 0 ? 'text-danger' : ''}">${num(w.low_stock_items)}</div><div class="text-muted">low stock</div></div>
                <div class="col-4"><div class="fw-semibold">${num(w.open_purchase_orders)}</div><div class="text-muted">open POs</div></div>
                <div class="col-4"><div class="fw-semibold">${num(w.active_transfers)}</div><div class="text-muted">transfers</div></div>
              </div>
              <div class="border-top mt-3 pt-2 d-flex justify-content-between small">
                <span class="text-muted">Stock value</span><span class="fw-semibold">${money(w.stock_value)}</span>
              </div>
            </div>
          </div>
        </div>`).join('') : '<div class="col"><div class="empty-state">You are not assigned to any warehouse yet.</div></div>'}
    </div>

    <h6 class="section-heading"><i class="bi bi-exclamation-triangle text-danger me-1"></i>Low-stock alerts</h6>
    ${table([
      { label: 'Warehouse', render: (r) => esc(r.warehouse_name) },
      { label: 'SKU',       render: (r) => `<code>${esc(r.sku)}</code>` },
      { label: 'Item',      render: (r) => esc(r.item_name) },
      { label: 'Available', class: 'text-end', render: (r) => `<span class="text-danger fw-semibold">${num(r.quantity_available)}</span> ${esc(r.unit)}` },
      { label: 'Reorder at',class: 'text-end', render: (r) => num(r.reorder_level) },
      { label: 'Short by',  class: 'text-end', render: (r) => num(r.shortfall) },
    ], lowStock, 'No low-stock items. Everything is above its reorder level.')}`;
}
