// Stock transfers between warehouses:
// manager requests -> admin approves (stock reserved) -> source sends -> destination receives
import { getTransfers, requestTransfer, reviewTransfer, sendTransfer, receiveTransfer, cancelTransfer } from '../api.js';
import { esc, num, table, badge, dateTime, personName, openForm, showInfo, toast, runAction, actionButton } from '../ui.js';

const ACTIVE = ['requested', 'approved', 'in_transit'];
const FILTERS = [
  { key: 'active', label: 'Active', statuses: ACTIVE },
  { key: 'completed', label: 'Completed', statuses: ['completed'] },
  { key: 'closed', label: 'Rejected / cancelled', statuses: ['rejected', 'cancelled'] },
  { key: 'all', label: 'All', statuses: null },
];
const state = { filter: 'active' };

export async function renderTransfers(el, ctx, actions) {
  const filter = FILTERS.find((f) => f.key === state.filter);
  const transfers = await getTransfers(filter.statuses);
  const myEmp = ctx.employee?.employee_id;

  if (ctx.isAdmin || ctx.managedWarehouses.length) {
    actions.insertAdjacentHTML('afterbegin',
      `<button class="btn btn-sm btn-primary" id="newTr"><i class="bi bi-plus-lg"></i> Request transfer</button>`);
    actions.querySelector('#newTr').onclick = () => openRequestForm(ctx);
  }

  el.innerHTML = `
    <div class="toolbar">
      ${FILTERS.map((f) => `<button class="btn btn-sm ${state.filter === f.key ? 'btn-dark' : 'btn-outline-secondary'}" data-filter="${f.key}">${f.label}</button>`).join('')}
    </div>
    <div class="flow-hint small text-muted mb-3">
      <span>${badge('requested')}</span> <i class="bi bi-arrow-right"></i>
      <span>${badge('approved')} <span class="d-none d-md-inline">(stock reserved)</span></span> <i class="bi bi-arrow-right"></i>
      <span>${badge('in_transit')}</span> <i class="bi bi-arrow-right"></i>
      <span>${badge('completed')}</span>
    </div>
    ${table([
      { label: 'Transfer',  render: (t) => `<span class="fw-semibold">TR-${t.transfer_id}</span>` },
      { label: 'From → To', render: (t) => `${esc(t.from_warehouse?.name)} <i class="bi bi-arrow-right text-muted"></i> ${esc(t.to_warehouse?.name)}` },
      { label: 'Items',     render: (t) => t.transfer_items.map((i) => `<div class="small"><code>${esc(i.items.sku)}</code> × ${num(i.qty_requested)}${t.status === 'in_transit' || t.status === 'completed' ? ` <span class="text-muted">(sent ${num(i.qty_sent)})</span>` : ''}</div>`).join('') },
      { label: 'Requested', render: (t) => `${esc(personName(t.requester))}<div class="small text-muted">${dateTime(t.requested_at)}</div>` },
      { label: 'Status',    render: (t) => badge(t.status) },
      { label: '',          class: 'text-end text-nowrap', render: (t) => buttonsFor(t, ctx, myEmp) },
    ], transfers, 'No transfers here.')}`;

  el.querySelectorAll('[data-filter]').forEach((b) => (b.onclick = () => { state.filter = b.dataset.filter; ctx.refresh(); }));

  el.onclick = async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const t = transfers.find((x) => x.transfer_id === Number(btn.dataset.id));
    const id = t.transfer_id;
    switch (btn.dataset.action) {
      case 'details':
        return showDetails(t);
      case 'approve':
        if (await runAction(btn, () => reviewTransfer(id, true), `TR-${id} approved. Stock is reserved at ${t.from_warehouse?.name}.`)) ctx.refresh();
        return;
      case 'reject':
        if (confirm(`Reject TR-${id}?`) && await runAction(btn, () => reviewTransfer(id, false), `TR-${id} rejected.`)) ctx.refresh();
        return;
      case 'send':
        return openSendForm(ctx, t);
      case 'receive':
        if (confirm(`Confirm that TR-${id} arrived at ${t.to_warehouse?.name}?`) &&
            await runAction(btn, () => receiveTransfer(id), `TR-${id} received. Stock added.`)) ctx.refresh();
        return;
      case 'cancel':
        if (confirm(`Cancel TR-${id}?`) && await runAction(btn, () => cancelTransfer(id), `TR-${id} cancelled.`)) ctx.refresh();
    }
  };
}

function buttonsFor(t, ctx, myEmp) {
  const b = [actionButton('details', t.transfer_id, '<i class="bi bi-eye"></i>', 'light border', 'title="Details"')];
  if (t.status === 'requested' && ctx.isAdmin) {
    b.push(actionButton('approve', t.transfer_id, '<i class="bi bi-check-lg"></i> Approve', 'success'));
    b.push(actionButton('reject', t.transfer_id, 'Reject', 'outline-danger'));
  }
  if (t.status === 'approved' && ctx.hasAccess(t.from_warehouse_id)) {
    b.push(actionButton('send', t.transfer_id, '<i class="bi bi-truck"></i> Send', 'primary'));
  }
  if (t.status === 'in_transit' && ctx.hasAccess(t.to_warehouse_id)) {
    b.push(actionButton('receive', t.transfer_id, '<i class="bi bi-box-arrow-in-down"></i> Receive', 'success'));
  }
  if (['requested', 'approved'].includes(t.status) && (ctx.isAdmin || t.requested_by === myEmp)) {
    b.push(actionButton('cancel', t.transfer_id, 'Cancel', 'outline-secondary'));
  }
  return b.join(' ');
}

function showDetails(t) {
  showInfo(`TR-${t.transfer_id} · ${t.from_warehouse?.name} → ${t.to_warehouse?.name}`, `
    <div class="mb-3">${badge(t.status)}</div>
    <dl class="row small mb-3">
      <dt class="col-4">Requested by</dt><dd class="col-8">${esc(personName(t.requester))}, ${dateTime(t.requested_at)}</dd>
      <dt class="col-4">Reviewed by</dt><dd class="col-8">${esc(personName(t.approver))}</dd>
      <dt class="col-4">Completed</dt><dd class="col-8">${dateTime(t.completed_at)}</dd>
    </dl>
    ${table([
      { label: 'Item',      render: (i) => `<code>${esc(i.items.sku)}</code> ${esc(i.items.name)}` },
      { label: 'Requested', class: 'text-end', render: (i) => `${num(i.qty_requested)} ${esc(i.items.unit)}` },
      { label: 'Sent',      class: 'text-end', render: (i) => num(i.qty_sent) },
    ], t.transfer_items)}`);
}

async function openRequestForm(ctx) {
  const items = await ctx.items();
  const all = ctx.warehouses.map((w) => ({ value: w.warehouse_id, label: w.name }));
  openForm({
    title: 'Request stock transfer',
    submitLabel: 'Submit request',
    size: 'lg',
    fields: [
      { type: 'info', html: '<p class="small text-muted mb-0">You must manage either the source or the destination warehouse. An administrator approves the request.</p>' },
      { type: 'select', name: 'from_id', label: 'From (source)', required: true, numeric: true, options: all },
      { type: 'select', name: 'to_id', label: 'To (destination)', required: true, numeric: true, options: all },
      { type: 'items', name: 'items', label: 'Items to transfer',
        options: items.map((i) => ({ value: i.item_id, label: `${i.sku} · ${i.name}` })),
        help: 'Tip: use "Find" on the Stock page to see which warehouses have an item.' },
    ],
    onSubmit: async (v) => {
      if (v.from_id === v.to_id) throw new Error('Source and destination must be different.');
      if (!v.items.length) throw new Error('Add at least one item.');
      const id = await requestTransfer(v.from_id, v.to_id, v.items);
      toast(`TR-${id} requested. Waiting for admin approval.`);
      ctx.refresh();
    },
  });
}

function openSendForm(ctx, t) {
  openForm({
    title: `Send TR-${t.transfer_id} to ${t.to_warehouse?.name}`,
    submitLabel: 'Confirm sent',
    fields: [
      { type: 'info', html: '<p class="small text-muted mb-0">Enter how many units are actually being loaded. You can send less than approved (use 0 to skip an item).</p>' },
      ...t.transfer_items.map((i) => ({
        type: 'number', name: `item_${i.item_id}`, min: 0, max: i.qty_requested, step: 1, value: i.qty_requested, required: true,
        label: `${i.items.sku} · ${i.items.name} (approved: ${i.qty_requested})`,
      })),
    ],
    onSubmit: async (v) => {
      const items = t.transfer_items.map((i) => ({ item_id: i.item_id, qty: v[`item_${i.item_id}`] }));
      await sendTransfer(t.transfer_id, items);
      toast(`TR-${t.transfer_id} is on its way.`);
      ctx.refresh();
    },
  });
}
