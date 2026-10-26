// Stock adjustments: staff record damaged / lost / recount changes,
// managers of that warehouse (or an admin) approve or reject them.
import { getAdjustments, requestAdjustment, reviewAdjustment } from '../api.js';
import { esc, num, table, badge, dateTime, personName, openForm, toast, runAction, actionButton } from '../ui.js';

const state = { status: 'pending' };

export async function openAdjustmentForm(ctx, preset = {}, onDone) {
  const items = await ctx.items();
  openForm({
    title: 'Request stock adjustment',
    submitLabel: 'Submit request',
    fields: [
      { type: 'select', name: 'warehouse_id', label: 'Warehouse', required: true, numeric: true, value: preset.warehouse_id,
        options: ctx.myWarehouses.map((w) => ({ value: w.warehouse_id, label: w.name })) },
      { type: 'select', name: 'item_id', label: 'Item', required: true, numeric: true, value: preset.item_id,
        options: items.map((i) => ({ value: i.item_id, label: `${i.sku} · ${i.name}` })) },
      { type: 'number', name: 'qty_change', label: 'Quantity change', required: true, step: 1,
        help: 'Negative removes stock (e.g. -3 for 3 damaged). Positive adds stock (e.g. 2 if a recount found 2 extra).' },
      { type: 'select', name: 'reason', label: 'Reason', required: true, value: 'damaged',
        options: ['damaged', 'lost', 'recount', 'other'].map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) })) },
      { type: 'textarea', name: 'notes', label: 'Notes', maxlength: 500 },
    ],
    onSubmit: async (v) => {
      if (!v.qty_change) throw new Error('The quantity change cannot be zero.');
      const id = await requestAdjustment(v.warehouse_id, v.item_id, v.qty_change, v.reason, v.notes);
      toast(`Adjustment #${id} submitted for manager approval.`);
      onDone?.();
    },
  });
}

export async function renderAdjustments(el, ctx, actions) {
  const rows = await getAdjustments(state.status || null);
  const myEmp = ctx.employee?.employee_id;

  if (ctx.myWarehouses.length) {
    actions.insertAdjacentHTML('afterbegin',
      `<button class="btn btn-sm btn-primary" id="newAdj"><i class="bi bi-plus-lg"></i> New adjustment</button>`);
    actions.querySelector('#newAdj').onclick = () => openAdjustmentForm(ctx, {}, ctx.refresh);
  }

  el.innerHTML = `
    <div class="toolbar">
      ${['pending', 'approved', 'rejected', ''].map((s) => `
        <button class="btn btn-sm ${state.status === s ? 'btn-dark' : 'btn-outline-secondary'}" data-filter="${s}">
          ${s ? s[0].toUpperCase() + s.slice(1) : 'All'}</button>`).join('')}
      ${ctx.role === 'staff' ? '<span class="small text-muted ms-2">Showing your own requests.</span>' : ''}
    </div>
    ${table([
      { label: '#',          render: (r) => r.adjustment_id },
      { label: 'Warehouse',  render: (r) => esc(r.warehouses?.name) },
      { label: 'Item',       render: (r) => `<code>${esc(r.items?.sku)}</code> ${esc(r.items?.name)}` },
      { label: 'Change',     class: 'text-end', render: (r) => `<span class="fw-semibold ${r.qty_change < 0 ? 'text-danger' : 'text-success'}">${r.qty_change > 0 ? '+' : ''}${num(r.qty_change)}</span>` },
      { label: 'Reason',     render: (r) => `${esc(r.reason)}${r.notes ? `<div class="small text-muted">${esc(r.notes)}</div>` : ''}` },
      { label: 'Requested',  render: (r) => `${esc(personName(r.requester))}<div class="small text-muted">${dateTime(r.requested_at)}</div>` },
      { label: 'Status',     render: (r) => `${badge(r.status)}${r.reviewer ? `<div class="small text-muted">by ${esc(personName(r.reviewer))}</div>` : ''}` },
      { label: '',           class: 'text-end text-nowrap', render: (r) => {
          const canReview = r.status === 'pending' && ctx.canManage(r.warehouse_id) && (ctx.isAdmin || r.requested_by !== myEmp);
          return canReview
            ? actionButton('approve', r.adjustment_id, '<i class="bi bi-check-lg"></i> Approve', 'success') + ' ' +
              actionButton('reject', r.adjustment_id, '<i class="bi bi-x-lg"></i> Reject', 'outline-danger')
            : '';
        } },
    ], rows, 'No adjustments here.')}`;

  el.querySelectorAll('[data-filter]').forEach((b) => (b.onclick = () => {
    state.status = b.dataset.filter;
    ctx.refresh();
  }));

  el.onclick = async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const approve = btn.dataset.action === 'approve';
    if (!approve && !confirm(`Reject adjustment #${id}?`)) return;
    const ok = await runAction(btn, () => reviewAdjustment(id, approve),
      approve ? `Adjustment #${id} approved. Stock updated.` : `Adjustment #${id} rejected.`);
    if (ok) ctx.refresh();
  };
}
