// =====================================================================
// StockSync | Reusable UI helpers (Bootstrap 5)
// Tables, badges, formatting, toasts, and pop-up forms used by every page.
// =====================================================================

// Escape text before putting it into HTML (prevents HTML/script injection)
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ------------------------------------------------------------------ Formatting
export const money    = (n) => '₱' + Number(n ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const num      = (n) => Number(n ?? 0).toLocaleString('en-PH');
export const dateTime = (d) => (d ? new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const dateOnly = (d) => (d ? new Date(d + (String(d).length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-PH', { dateStyle: 'medium' }) : '—');
export const personName = (p) => (p ? `${p.first_name} ${p.last_name}` : '—');

// yyyy-mm-dd in the user's local time (for <input type="date">)
export function isoDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const BADGE_COLORS = {
  // purchase orders
  ordered: 'primary', partially_received: 'warning', received: 'success', cancelled: 'secondary',
  // transfers
  requested: 'warning', approved: 'info', rejected: 'danger', in_transit: 'primary', completed: 'success',
  // adjustments / assignments
  pending: 'warning', active: 'success', ended: 'secondary',
  // roles
  admin: 'dark', manager: 'primary', staff: 'info',
  // movements
  opening_balance: 'secondary', po_receipt: 'success', transfer_in: 'success', transfer_out: 'danger', adjustment: 'warning',
  // audit
  INSERT: 'success', UPDATE: 'warning', DELETE: 'danger',
};
export const badge = (value) =>
  `<span class="badge rounded-pill text-bg-${BADGE_COLORS[value] ?? 'secondary'}">${esc(String(value).replace(/_/g, ' '))}</span>`;

// ------------------------------------------------------------------ Errors
// Turns raw database errors into plain sentences (keeps the original too)
export function friendlyError(message) {
  const msg = String(message ?? 'Something went wrong.');
  if (msg.includes('violates foreign key constraint')) {
    return 'This record is still used by other records, so it cannot be deleted (protected by ON DELETE RESTRICT).';
  }
  if (msg.includes('duplicate key value')) {
    return 'That value already exists. It must be unique.';
  }
  if (msg.includes('row-level security')) {
    return 'You do not have permission to do that.';
  }
  if (msg.includes('Failed to fetch')) {
    return 'Cannot reach the server. Check your internet connection and the URL in config.js.';
  }
  return msg;
}

// ------------------------------------------------------------------ Toasts
export function toast(message, type = 'success') {
  let box = document.getElementById('toast-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast-box';
    box.className = 'toast-container position-fixed bottom-0 end-0 p-3';
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = `toast align-items-center text-bg-${type} border-0`;
  el.role = 'alert';
  el.innerHTML = `<div class="d-flex"><div class="toast-body">${esc(message)}</div>
    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
  box.appendChild(el);
  const t = new bootstrap.Toast(el, { delay: type === 'danger' ? 7000 : 3500 });
  el.addEventListener('hidden.bs.toast', () => el.remove());
  t.show();
}

// Runs an action from a button: disables it while working, shows a toast on error
export async function runAction(button, action, successMessage) {
  if (button) button.disabled = true;
  try {
    const result = await action();
    if (successMessage) toast(typeof successMessage === 'function' ? successMessage(result) : successMessage);
    return true;
  } catch (err) {
    toast(friendlyError(err.message), 'danger');
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}

// ------------------------------------------------------------------ Tables
// columns: [{ label, render: (row) => html, class? }]
export function table(columns, rows, emptyText = 'Nothing to show.') {
  if (!rows.length) {
    return `<div class="empty-state">${esc(emptyText)}</div>`;
  }
  return `<div class="table-responsive card-table"><table class="table table-hover align-middle mb-0">
    <thead><tr>${columns.map((c) => `<th class="${c.class ?? ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td class="${c.class ?? ''}">${c.render(r)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

export const actionButton = (action, id, label, style = 'outline-primary', extra = '') =>
  `<button class="btn btn-sm btn-${style}" data-action="${action}" data-id="${esc(id)}" ${extra}>${label}</button>`;

export const spinner = () =>
  '<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>';

// ------------------------------------------------------------------ Pop-up forms
// openForm({ title, fields, submitLabel, onSubmit(values), size })
// Field types: text, email, number, date, textarea, select, checkbox, items, info
//   select:  options: [{ value, label }], numeric: true -> returns a Number
//   items:   options: [{ value: item_id, label }], withCost: true -> adds a unit cost column
//            returns [{ item_id, qty, unit_cost? }]
//   info:    html: '...' (read-only content)
// If onSubmit throws, the error is shown inside the form and it stays open.
export function openForm({ title, fields = [], submitLabel = 'Save', onSubmit, size = '' }) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="modal fade" tabindex="-1">
      <div class="modal-dialog modal-dialog-scrollable ${size ? 'modal-' + size : ''}">
        <form class="modal-content" novalidate>
          <div class="modal-header">
            <h5 class="modal-title">${esc(title)}</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            ${fields.map(fieldHtml).join('')}
            <div class="alert alert-danger d-none mt-3 mb-0" data-error></div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-light" data-bs-dismiss="modal">${submitLabel ? 'Cancel' : 'Close'}</button>
            ${submitLabel ? `<button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>` : ''}
          </div>
        </form>
      </div>
    </div>`;
  const el = wrapper.firstElementChild;
  document.body.appendChild(el);
  const form = el.querySelector('form');
  const modal = new bootstrap.Modal(el);

  // item-line widgets: add / remove rows
  el.querySelectorAll('[data-items]').forEach((box) => {
    const field = fields.find((f) => f.name === box.dataset.items);
    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-add-line]')) {
        box.querySelector('[data-lines]').insertAdjacentHTML('beforeend', itemLineHtml(field));
      }
      const remove = e.target.closest('[data-remove-line]');
      if (remove && box.querySelectorAll('[data-line]').length > 1) remove.closest('[data-line]').remove();
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!submitLabel) return;
    const errorBox = el.querySelector('[data-error]');
    errorBox.classList.add('d-none');
    if (!form.checkValidity()) {
      form.classList.add('was-validated');
      return;
    }
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
      await onSubmit(collectValues(form, fields));
      modal.hide();
    } catch (err) {
      errorBox.textContent = friendlyError(err.message);
      errorBox.classList.remove('d-none');
    } finally {
      button.disabled = false;
    }
  });

  el.addEventListener('hidden.bs.modal', () => el.remove());
  modal.show();
  return el;
}

export const showInfo = (title, html, size = 'lg') =>
  openForm({ title, fields: [{ type: 'info', html }], submitLabel: null, size });

function optionList(options, selected, placeholder) {
  return (placeholder !== undefined ? `<option value="">${esc(placeholder)}</option>` : '') +
    options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(selected ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
}

function fieldHtml(f) {
  const req = f.required ? 'required' : '';
  const label = f.label ? `<label class="form-label">${esc(f.label)}${f.required ? ' <span class="text-danger">*</span>' : ''}</label>` : '';
  const help = f.help ? `<div class="form-text">${esc(f.help)}</div>` : '';
  const attrs = ['min', 'max', 'step', 'maxlength'].filter((a) => f[a] !== undefined).map((a) => `${a}="${esc(f[a])}"`).join(' ');

  switch (f.type) {
    case 'info':
      return `<div class="mb-3">${f.html}</div>`;
    case 'textarea':
      return `<div class="mb-3">${label}<textarea class="form-control" name="${f.name}" rows="3" ${req} ${attrs}>${esc(f.value)}</textarea>${help}</div>`;
    case 'select':
      return `<div class="mb-3">${label}<select class="form-select" name="${f.name}" ${req} ${f.disabled ? 'disabled' : ''}>
        ${optionList(f.options, f.value, f.placeholder ?? (f.required ? 'Choose…' : '—'))}</select>${help}</div>`;
    case 'checkbox':
      return `<div class="form-check mb-3"><input class="form-check-input" type="checkbox" name="${f.name}" id="cb-${f.name}" ${f.value ? 'checked' : ''}>
        <label class="form-check-label" for="cb-${f.name}">${esc(f.label)}</label>${help}</div>`;
    case 'items':
      return `<div class="mb-3" data-items="${f.name}">${label}
        <div data-lines>${(f.value?.length ? f.value : [{}]).map((v) => itemLineHtml(f, v)).join('')}</div>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-add-line><i class="bi bi-plus-lg"></i> Add item</button>${help}</div>`;
    default:
      return `<div class="mb-3">${label}<input class="form-control" type="${f.type ?? 'text'}" name="${f.name}"
        value="${esc(f.value)}" ${req} ${attrs} ${f.disabled ? 'disabled' : ''}>${help}</div>`;
  }
}

function itemLineHtml(f, v = {}) {
  return `<div class="row g-2 mb-2 align-items-center" data-line>
    <div class="col"><select class="form-select form-select-sm" data-item required>
      ${optionList(f.options, v.item_id, 'Choose item…')}</select></div>
    <div class="col-3"><input class="form-control form-control-sm" type="number" min="1" step="1" placeholder="Qty" data-qty required value="${esc(v.qty)}"></div>
    ${f.withCost ? `<div class="col-3"><input class="form-control form-control-sm" type="number" min="0" step="0.01" placeholder="Unit cost" data-cost value="${esc(v.unit_cost)}"></div>` : ''}
    <div class="col-auto"><button type="button" class="btn btn-sm btn-light" data-remove-line title="Remove"><i class="bi bi-x-lg"></i></button></div>
  </div>`;
}

function collectValues(form, fields) {
  const values = {};
  for (const f of fields) {
    if (!f.name) continue;
    if (f.type === 'items') {
      values[f.name] = [...form.querySelectorAll(`[data-items="${f.name}"] [data-line]`)].map((line) => {
        const row = { item_id: Number(line.querySelector('[data-item]').value), qty: Number(line.querySelector('[data-qty]').value) };
        const cost = line.querySelector('[data-cost]')?.value;
        if (cost) row.unit_cost = Number(cost);
        return row;
      }).filter((r) => r.item_id && r.qty > 0);
      continue;
    }
    const input = form.elements[f.name];
    if (!input) continue;
    if (f.type === 'checkbox') values[f.name] = input.checked;
    else if (input.value === '') values[f.name] = null;
    else if (f.type === 'number' || f.numeric) values[f.name] = Number(input.value);
    else values[f.name] = input.value.trim();
  }
  return values;
}
