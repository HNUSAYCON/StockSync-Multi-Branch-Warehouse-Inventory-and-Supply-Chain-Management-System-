// Reports: inventory valuation, stock movement summary, purchase summary.
// All numbers come from database views/functions, filtered by RLS.
import { getDashboard, getMovementReport, getPurchaseReport } from '../api.js';
import { esc, num, money, table, isoDate, toast, friendlyError } from '../ui.js';

export async function renderReports(el, ctx) {
  const firstOfMonth = isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const today = isoDate();
  const valuation = await getDashboard();
  const totalValue = valuation.reduce((t, w) => t + Number(w.stock_value), 0);

  el.innerHTML = `
    <div class="card mb-4"><div class="card-body">
      <h6 class="card-title"><i class="bi bi-cash-stack me-1 text-success"></i>Inventory valuation</h6>
      ${table([
        { label: 'Warehouse',   render: (w) => esc(w.warehouse_name) },
        { label: 'Low-stock items', class: 'text-end', render: (w) => num(w.low_stock_items) },
        { label: 'Stock value', class: 'text-end', render: (w) => money(w.stock_value) },
      ], valuation, 'No warehouses.')}
      <div class="text-end fw-semibold mt-2">Total: ${money(totalValue)}</div>
    </div></div>

    <div class="card mb-4"><div class="card-body">
      <h6 class="card-title"><i class="bi bi-arrow-left-right me-1 text-primary"></i>Stock movement summary</h6>
      <form class="row g-2 align-items-end mb-3" id="movForm">
        <div class="col-sm-4"><label class="form-label small">Warehouse</label>
          <select class="form-select form-select-sm" name="wh" required>
            ${ctx.myWarehouses.map((w) => `<option value="${w.warehouse_id}">${esc(w.name)}</option>`).join('')}
          </select></div>
        <div class="col-sm-3"><label class="form-label small">From</label><input class="form-control form-control-sm" type="date" name="from" value="${firstOfMonth}" required></div>
        <div class="col-sm-3"><label class="form-label small">To</label><input class="form-control form-control-sm" type="date" name="to" value="${today}" required></div>
        <div class="col-sm-2"><button class="btn btn-sm btn-primary w-100">Run</button></div>
      </form>
      <div id="movResult"></div>
    </div></div>

    <div class="card"><div class="card-body">
      <h6 class="card-title"><i class="bi bi-cart me-1 text-info"></i>Purchase summary by supplier</h6>
      <form class="row g-2 align-items-end mb-3" id="purForm">
        <div class="col-sm-4"><label class="form-label small">From</label><input class="form-control form-control-sm" type="date" name="from" value="${firstOfMonth}" required></div>
        <div class="col-sm-4"><label class="form-label small">To</label><input class="form-control form-control-sm" type="date" name="to" value="${today}" required></div>
        <div class="col-sm-4"><button class="btn btn-sm btn-primary w-100">Run</button></div>
      </form>
      <div id="purResult"></div>
    </div></div>`;

  el.querySelector('#movForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    try {
      const rows = await getMovementReport(Number(f.wh.value), f.from.value, f.to.value);
      el.querySelector('#movResult').innerHTML = table([
        { label: 'SKU',       render: (r) => `<code>${esc(r.sku)}</code>` },
        { label: 'Item',      render: (r) => esc(r.item_name) },
        { label: 'In',        class: 'text-end text-success', render: (r) => num(r.qty_in) },
        { label: 'Out',       class: 'text-end text-danger',  render: (r) => num(r.qty_out) },
        { label: 'Net',       class: 'text-end fw-semibold',  render: (r) => num(r.net_change) },
        { label: 'Movements', class: 'text-end', render: (r) => num(r.movement_count) },
      ], rows, 'No movements in this period.');
    } catch (err) { toast(friendlyError(err.message), 'danger'); }
  };

  el.querySelector('#purForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    try {
      const rows = await getPurchaseReport(f.from.value, f.to.value);
      el.querySelector('#purResult').innerHTML = table([
        { label: 'Supplier',       render: (r) => esc(r.supplier_name) },
        { label: 'Orders',         class: 'text-end', render: (r) => num(r.po_count) },
        { label: 'Ordered value',  class: 'text-end', render: (r) => money(r.ordered_value) },
        { label: 'Received value', class: 'text-end', render: (r) => money(r.received_value) },
      ], rows, 'No purchase orders in this period.');
    } catch (err) { toast(friendlyError(err.message), 'danger'); }
  };

  // run both reports once with the default dates
  el.querySelector('#movForm').requestSubmit();
  el.querySelector('#purForm').requestSubmit();
}
