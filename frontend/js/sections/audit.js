// Admin: audit trail written automatically by the database trigger
import { getAuditLogs } from '../api.js';
import { esc, table, badge, dateTime, showInfo } from '../ui.js';

const TABLES = ['users', 'employees', 'employee_assignments', 'warehouses', 'categories', 'suppliers', 'items',
  'purchase_orders', 'purchase_order_items', 'stock_transfers', 'transfer_items', 'stock_adjustments'];
const state = { table: '' };

export async function renderAudit(el, ctx) {
  const logs = await getAuditLogs(state.table || null);

  el.innerHTML = `
    <div class="toolbar">
      <select class="form-select form-select-sm" id="tableFilter" style="max-width: 240px">
        <option value="">All tables</option>
        ${TABLES.map((t) => `<option ${t === state.table ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <span class="small text-muted">Latest 200 changes. Written by a database trigger; cannot be edited or deleted.</span>
    </div>
    ${table([
      { label: 'When',    render: (l) => `<span class="text-nowrap">${dateTime(l.changed_at)}</span>` },
      { label: 'Table',   render: (l) => `<code>${esc(l.table_name)}</code>` },
      { label: 'Record',  render: (l) => esc(l.record_id) },
      { label: 'Action',  render: (l) => badge(l.action) },
      { label: 'Changes', render: (l) => esc(summary(l)) },
      { label: 'By',      render: (l) => esc(l.users?.email ?? 'System / SQL editor') },
      { label: '',        class: 'text-end', render: (l) => `<button class="btn btn-sm btn-light border" data-action="view" data-id="${l.log_id}"><i class="bi bi-eye"></i></button>` },
    ], logs, 'No audit entries.')}`;

  el.querySelector('#tableFilter').onchange = (e) => { state.table = e.target.value; ctx.refresh(); };

  el.onclick = (e) => {
    const btn = e.target.closest('[data-action="view"]');
    if (!btn) return;
    const l = logs.find((x) => String(x.log_id) === btn.dataset.id);
    showInfo(`${l.action} on ${l.table_name} #${l.record_id}`, `
      <div class="row g-3">
        <div class="col-md-6"><div class="small fw-semibold mb-1">Before</div><pre class="json">${esc(JSON.stringify(l.old_values, null, 2) ?? '—')}</pre></div>
        <div class="col-md-6"><div class="small fw-semibold mb-1">After</div><pre class="json">${esc(JSON.stringify(l.new_values, null, 2) ?? '—')}</pre></div>
      </div>`, 'xl');
  };
}

// For updates, list which columns changed
function summary(l) {
  if (l.action !== 'UPDATE') return l.action === 'INSERT' ? 'created' : 'deleted';
  const changed = Object.keys(l.new_values ?? {}).filter((k) =>
    k !== 'updated_at' && JSON.stringify(l.new_values[k]) !== JSON.stringify(l.old_values?.[k]));
  return changed.length ? changed.join(', ') : '—';
}
