// Admin: warehouses (branches)
import { addWarehouse, updateWarehouse, deleteWarehouse, getWarehouses } from '../api.js';
import { esc, table, dateOnly, openForm, toast, runAction } from '../ui.js';

export async function renderWarehouses(el, ctx, actions) {
  const rows = await getWarehouses();

  actions.insertAdjacentHTML('afterbegin',
    `<button class="btn btn-sm btn-primary" id="addWh"><i class="bi bi-plus-lg"></i> Add warehouse</button>`);
  actions.querySelector('#addWh').onclick = () => openWarehouseForm(ctx);

  el.innerHTML = table([
    { label: 'Name',       render: (w) => `<span class="fw-semibold">${esc(w.name)}</span>` },
    { label: 'Address',    render: (w) => esc(w.address) },
    { label: 'Contact no.',render: (w) => esc(w.contact_no ?? '') },
    { label: 'Created',    render: (w) => dateOnly(w.created_at) },
    { label: '',           class: 'text-end text-nowrap', render: (w) => `
        <button class="btn btn-sm btn-light border" data-action="edit" data-id="${w.warehouse_id}"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${w.warehouse_id}"><i class="bi bi-trash"></i></button>` },
  ], rows, 'No warehouses yet.') +
  '<p class="small text-muted mt-3">A warehouse that still has stock, orders, or transfers cannot be deleted. The database refuses it (ON DELETE RESTRICT).</p>';

  el.onclick = async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const w = rows.find((r) => r.warehouse_id === Number(btn.dataset.id));
    if (btn.dataset.action === 'edit') openWarehouseForm(ctx, w);
    if (btn.dataset.action === 'delete' && confirm(`Delete warehouse "${w.name}"?`)) {
      if (await runAction(btn, () => deleteWarehouse(w.warehouse_id), `"${w.name}" deleted.`)) location.reload();
    }
  };
}

function openWarehouseForm(ctx, w = {}) {
  openForm({
    title: w.warehouse_id ? `Edit ${w.name}` : 'Add warehouse',
    fields: [
      { type: 'text', name: 'name', label: 'Name', required: true, maxlength: 100, value: w.name },
      { type: 'text', name: 'address', label: 'Address', required: true, maxlength: 255, value: w.address },
      { type: 'text', name: 'contact_no', label: 'Contact no.', maxlength: 15, value: w.contact_no },
    ],
    onSubmit: async (v) => {
      if (w.warehouse_id) await updateWarehouse(w.warehouse_id, v); else await addWarehouse(v);
      toast(`Warehouse "${v.name}" saved.`);
      // reload so every dropdown on the page picks up the change
      setTimeout(() => location.reload(), 600);
    },
  });
}
