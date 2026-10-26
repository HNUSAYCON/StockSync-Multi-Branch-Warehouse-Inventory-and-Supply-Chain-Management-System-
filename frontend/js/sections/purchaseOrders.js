// Purchase orders: managers create them, staff/managers receive deliveries
// (partial or full), managers cancel ones with nothing received yet.
import { getPurchaseOrders, createPurchaseOrder, receivePurchaseOrder, cancelPurchaseOrder } from '../api.js';
import { esc, num, money, table, badge, dateTime, dateOnly, personName, isoDate,
         openForm, showInfo, toast, runAction, actionButton } from '../ui.js';

const OPEN = ['ordered', 'partially_received'];
const FILTERS = [
  { key: 'open', label: 'Open', statuses: OPEN },
  { key: 'received', label: 'Received', statuses: ['received'] },
  { key: 'cancelled', label: 'Cancelled', statuses: ['cancelled'] },
  { key: 'all', label: 'All', statuses: null },
];
const state = { filter: 'open' };

export async function renderPurchaseOrders(el, ctx, actions) {
  const filter = FILTERS.find((f) => f.key === state.filter);
  const orders = await getPurchaseOrders(filter.statuses);

  if (ctx.managedWarehouses.length) {
    actions.insertAdjacentHTML('afterbegin',
      `<button class="btn btn-sm btn-primary" id="newPo"><i class="bi bi-plus-lg"></i> New purchase order</button>`);
    actions.querySelector('#newPo').onclick = () => openNewPoForm(ctx);
  }

  el.innerHTML = `
    <div class="toolbar">
      ${FILTERS.map((f) => `<button class="btn btn-sm ${state.filter === f.key ? 'btn-dark' : 'btn-outline-secondary'}" data-filter="${f.key}">${f.label}</button>`).join('')}
    </div>
    ${table([
      { label: 'PO #',      render: (o) => `<span class="fw-semibold">PO-${o.po_id}</span>` },
      { label: 'Supplier',  render: (o) => esc(o.suppliers?.name) },
      { label: 'Warehouse', render: (o) => esc(o.warehouses?.name) },
      { label: 'Items',     render: (o) => progress(o.purchase_order_items) },
      { label: 'Value',     class: 'text-end', render: (o) => money(poValue(o)) },
      { label: 'Ordered',   render: (o) => `${dateTime(o.ordered_at)}<div class="small text-muted">by ${esc(personName(o.creator))}</div>` },
      { label: 'Expected',  render: (o) => dateOnly(o.expected_at) },
      { label: 'Status',    render: (o) => badge(o.status) },
      { label: '',          class: 'text-end text-nowrap', render: (o) =>
          actionButton('details', o.po_id, '<i class="bi bi-eye"></i>', 'light border', 'title="Details"') + ' ' +
          (OPEN.includes(o.status) && ctx.hasAccess(o.warehouse_id)
            ? actionButton('receive', o.po_id, '<i class="bi bi-box-arrow-in-down"></i> Receive', 'success') + ' ' : '') +
          (o.status === 'ordered' && ctx.canManage(o.warehouse_id)
            ? actionButton('cancel', o.po_id, 'Cancel', 'outline-danger') : '') },
    ], orders, 'No purchase orders here.')}`;

  el.querySelectorAll('[data-filter]').forEach((b) => (b.onclick = () => { state.filter = b.dataset.filter; ctx.refresh(); }));

  el.onclick = async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const po = orders.find((o) => o.po_id === Number(btn.dataset.id));
    if (btn.dataset.action === 'details') showPoDetails(po);
    if (btn.dataset.action === 'receive') openReceiveForm(ctx, po);
    if (btn.dataset.action === 'cancel' && confirm(`Cancel PO-${po.po_id}? This cannot be undone.`)) {
      if (await runAction(btn, () => cancelPurchaseOrder(po.po_id), `PO-${po.po_id} cancelled.`)) ctx.refresh();
    }
  };
}

const poValue = (o) => o.purchase_order_items.reduce((t, l) => t + l.qty_ordered * l.unit_cost, 0);

function progress(lines) {
  const ordered = lines.reduce((t, l) => t + l.qty_ordered, 0);
  const received = lines.reduce((t, l) => t + l.qty_received, 0);
  const pct = ordered ? Math.round((received / ordered) * 100) : 0;
  return `<div class="small">${lines.length} item${lines.length === 1 ? '' : 's'} · ${num(received)}/${num(ordered)} received</div>
    <div class="progress mt-1" style="height: 4px; width: 120px"><div class="progress-bar bg-success" style="width: ${pct}%"></div></div>`;
}

function showPoDetails(po) {
  showInfo(`PO-${po.po_id} · ${po.suppliers?.name}`, `
    <div class="mb-3">${badge(po.status)} <span class="ms-2 text-muted small">${esc(po.warehouses?.name)} · ordered ${dateTime(po.ordered_at)} · expected ${dateOnly(po.expected_at)}</span></div>
    ${table([
      { label: 'Item',     render: (l) => `<code>${esc(l.items.sku)}</code> ${esc(l.items.name)}` },
      { label: 'Ordered',  class: 'text-end', render: (l) => `${num(l.qty_ordered)} ${esc(l.items.unit)}` },
      { label: 'Received', class: 'text-end', render: (l) => num(l.qty_received) },
      { label: 'Unit cost',class: 'text-end', render: (l) => money(l.unit_cost) },
      { label: 'Line total',class: 'text-end', render: (l) => money(l.qty_ordered * l.unit_cost) },
    ], po.purchase_order_items)}
    <div class="text-end fw-semibold mt-2">Total: ${money(poValue(po))}</div>`);
}

async function openNewPoForm(ctx) {
  const [items, suppliers] = await Promise.all([ctx.items(), ctx.suppliers()]);
  openForm({
    title: 'New purchase order',
    submitLabel: 'Create order',
    size: 'lg',
    fields: [
      { type: 'select', name: 'supplier_id', label: 'Supplier', required: true, numeric: true,
        options: suppliers.map((s) => ({ value: s.supplier_id, label: s.name })) },
      { type: 'select', name: 'warehouse_id', label: 'Deliver to', required: true, numeric: true,
        value: ctx.managedWarehouses.length === 1 ? ctx.managedWarehouses[0].warehouse_id : undefined,
        options: ctx.managedWarehouses.map((w) => ({ value: w.warehouse_id, label: w.name })) },
      { type: 'date', name: 'expected_at', label: 'Expected delivery', min: isoDate() },
      { type: 'items', name: 'items', label: 'Items to order', withCost: true,
        options: items.map((i) => ({ value: i.item_id, label: `${i.sku} · ${i.name} (₱${i.unit_cost})` })),
        help: 'Leave unit cost blank to use the catalog price.' },
    ],
    onSubmit: async (v) => {
      if (!v.items.length) throw new Error('Add at least one item.');
      const id = await createPurchaseOrder(v.supplier_id, v.warehouse_id, v.items, v.expected_at);
      toast(`PO-${id} created.`);
      ctx.refresh();
    },
  });
}

function openReceiveForm(ctx, po) {
  const lines = po.purchase_order_items.filter((l) => l.qty_received < l.qty_ordered);
  openForm({
    title: `Receive delivery · PO-${po.po_id}`,
    submitLabel: 'Confirm received',
    fields: [
      { type: 'info', html: `<p class="small text-muted mb-0">Enter how many of each item actually arrived. Use 0 for items that didn't come yet (partial delivery).</p>` },
      ...lines.map((l) => ({
        type: 'number', name: `item_${l.item_id}`, min: 0, max: l.qty_ordered - l.qty_received, step: 1,
        value: l.qty_ordered - l.qty_received, required: true,
        label: `${l.items.sku} · ${l.items.name} (still expected: ${l.qty_ordered - l.qty_received})`,
      })),
    ],
    onSubmit: async (v) => {
      const items = lines.map((l) => ({ item_id: l.item_id, qty: v[`item_${l.item_id}`] })).filter((i) => i.qty > 0);
      if (!items.length) throw new Error('Enter at least one quantity greater than 0.');
      const status = await receivePurchaseOrder(po.po_id, items);
      toast(`Delivery recorded. PO-${po.po_id} is now ${status.replace('_', ' ')}.`);
      ctx.refresh();
    },
  });
}
