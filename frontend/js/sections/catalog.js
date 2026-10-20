// Admin: item catalog, categories, and suppliers (add / edit / delete)
import { getItems, getCategories, getSuppliers, addItem, updateItem, deleteItem,
         addCategory, updateCategory, deleteCategory, addSupplier, updateSupplier, deleteSupplier } from '../api.js';
import { esc, num, money, table, openForm, toast, runAction } from '../ui.js';

const state = { tab: 'items' };
const TABS = [
  { key: 'items', label: 'Items', icon: 'box-seam' },
  { key: 'categories', label: 'Categories', icon: 'tags' },
  { key: 'suppliers', label: 'Suppliers', icon: 'truck' },
];

const editButtons = (id) => `
  <button class="btn btn-sm btn-light border" data-action="edit" data-id="${id}"><i class="bi bi-pencil"></i></button>
  <button class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${id}"><i class="bi bi-trash"></i></button>`;

export async function renderCatalog(el, ctx, actions) {
  const config = await CONFIG[state.tab](ctx);

  actions.insertAdjacentHTML('afterbegin',
    `<button class="btn btn-sm btn-primary" id="addBtn"><i class="bi bi-plus-lg"></i> Add ${config.noun}</button>`);
  actions.querySelector('#addBtn').onclick = () => config.form();

  el.innerHTML = `
    <ul class="nav nav-tabs mb-3">
      ${TABS.map((t) => `<li class="nav-item"><a class="nav-link ${state.tab === t.key ? 'active' : ''}" href="#" data-tab="${t.key}">
        <i class="bi bi-${t.icon} me-1"></i>${t.label}</a></li>`).join('')}
    </ul>
    ${config.html}`;

  el.querySelectorAll('[data-tab]').forEach((a) => (a.onclick = (e) => {
    e.preventDefault();
    state.tab = a.dataset.tab;
    ctx.refresh();
  }));

  el.onclick = async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const row = config.rows.find((r) => String(r[config.key]) === btn.dataset.id);
    if (btn.dataset.action === 'edit') config.form(row);
    if (btn.dataset.action === 'delete' && confirm(`Delete "${row.name}"?`)) {
      if (await runAction(btn, () => config.remove(row[config.key]), `"${row.name}" deleted.`)) {
        ctx.clearCache();
        ctx.refresh();
      }
    }
  };
}

// one config per tab: rows, table, form, delete
const CONFIG = {
  async items(ctx) {
    const [rows, categories] = await Promise.all([getItems(), getCategories()]);
    const form = (item = {}) => openForm({
      title: item.item_id ? `Edit ${item.name}` : 'Add item',
      fields: [
        { type: 'text', name: 'sku', label: 'SKU', required: true, maxlength: 30, value: item.sku, help: 'Unique code, e.g. HW-HAM-16' },
        { type: 'text', name: 'name', label: 'Name', required: true, maxlength: 100, value: item.name },
        { type: 'select', name: 'category_id', label: 'Category', required: true, numeric: true, value: item.category_id,
          options: categories.map((c) => ({ value: c.category_id, label: c.name })) },
        { type: 'text', name: 'unit', label: 'Unit', required: true, maxlength: 20, value: item.unit ?? 'pc', help: 'pc, box, kg, roll, gal…' },
        { type: 'number', name: 'unit_cost', label: 'Unit cost (₱)', required: true, min: 0, step: 0.01, value: item.unit_cost ?? 0 },
        { type: 'number', name: 'reorder_level', label: 'Reorder level', required: true, min: 0, step: 1, value: item.reorder_level ?? 0,
          help: 'A low-stock alert appears when available stock drops to this number.' },
      ],
      onSubmit: async (v) => {
        if (item.item_id) await updateItem(item.item_id, v); else await addItem(v);
        toast(`Item "${v.name}" saved.`);
        ctx.clearCache();
        ctx.refresh();
      },
    });
    return {
      noun: 'item', key: 'item_id', rows, form, remove: deleteItem,
      html: table([
        { label: 'SKU',      render: (r) => `<code>${esc(r.sku)}</code>` },
        { label: 'Name',     render: (r) => esc(r.name) },
        { label: 'Category', render: (r) => esc(r.categories?.name) },
        { label: 'Unit',     render: (r) => esc(r.unit) },
        { label: 'Unit cost',class: 'text-end', render: (r) => money(r.unit_cost) },
        { label: 'Reorder at',class: 'text-end', render: (r) => num(r.reorder_level) },
        { label: '',         class: 'text-end text-nowrap', render: (r) => editButtons(r.item_id) },
      ], rows, 'No items yet.'),
    };
  },

  async categories(ctx) {
    const rows = await getCategories();
    const form = (c = {}) => openForm({
      title: c.category_id ? `Edit ${c.name}` : 'Add category',
      fields: [
        { type: 'text', name: 'name', label: 'Name', required: true, maxlength: 50, value: c.name },
        { type: 'textarea', name: 'description', label: 'Description', value: c.description },
      ],
      onSubmit: async (v) => {
        if (c.category_id) await updateCategory(c.category_id, v); else await addCategory(v);
        toast(`Category "${v.name}" saved.`);
        ctx.refresh();
      },
    });
    return {
      noun: 'category', key: 'category_id', rows, form, remove: deleteCategory,
      html: table([
        { label: 'Name',        render: (r) => esc(r.name) },
        { label: 'Description', render: (r) => esc(r.description ?? '') },
        { label: '',            class: 'text-end text-nowrap', render: (r) => editButtons(r.category_id) },
      ], rows, 'No categories yet.'),
    };
  },

  async suppliers(ctx) {
    const rows = await getSuppliers();
    const form = (s = {}) => openForm({
      title: s.supplier_id ? `Edit ${s.name}` : 'Add supplier',
      fields: [
        { type: 'text', name: 'name', label: 'Company name', required: true, maxlength: 100, value: s.name },
        { type: 'text', name: 'contact_person', label: 'Contact person', maxlength: 100, value: s.contact_person },
        { type: 'email', name: 'email', label: 'Email', maxlength: 100, value: s.email },
        { type: 'text', name: 'contact_no', label: 'Contact no.', maxlength: 15, value: s.contact_no },
        { type: 'text', name: 'address', label: 'Address', maxlength: 255, value: s.address },
      ],
      onSubmit: async (v) => {
        if (s.supplier_id) await updateSupplier(s.supplier_id, v); else await addSupplier(v);
        toast(`Supplier "${v.name}" saved.`);
        ctx.clearCache();
        ctx.refresh();
      },
    });
    return {
      noun: 'supplier', key: 'supplier_id', rows, form, remove: deleteSupplier,
      html: table([
        { label: 'Name',    render: (r) => esc(r.name) },
        { label: 'Contact', render: (r) => `${esc(r.contact_person ?? '')}<div class="small text-muted">${esc(r.email ?? '')} ${esc(r.contact_no ?? '')}</div>` },
        { label: 'Address', render: (r) => esc(r.address ?? '') },
        { label: '',        class: 'text-end text-nowrap', render: (r) => editButtons(r.supplier_id) },
      ], rows, 'No suppliers yet.'),
    };
  },
};
