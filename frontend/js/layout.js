// =====================================================================
// StockSync | Page layout shared by admin.html, manager.html, staff.html
// 1. Checks that someone is logged in with the right role (else redirects)
// 2. Loads who they are and which warehouses they are assigned to (ctx)
// 3. Draws the top bar + side menu and shows the chosen section
// =====================================================================
import { getMyProfile, getMyEmployee, getWarehouses, getItems, getSuppliers, logout } from './api.js';
import { esc, badge, spinner, friendlyError, personName } from './ui.js';

export async function initPage({ allowedRoles, title, sections }) {
  const app = document.getElementById('app');
  app.innerHTML = spinner();

  let me;
  try {
    me = await getMyProfile();
  } catch (err) {
    app.innerHTML = `<div class="container py-5"><div class="alert alert-danger">${esc(friendlyError(err.message))}</div></div>`;
    return;
  }
  if (!me || !me.is_active) { location.replace('index.html'); return; }
  if (!allowedRoles.includes(me.role)) { location.replace(`${me.role}.html`); return; }

  const [employee, warehouses] = await Promise.all([getMyEmployee(me.user_id), getWarehouses()]);
  const assignments = (employee?.employee_assignments ?? []).filter((a) => a.status === 'active');
  const isAdmin = me.role === 'admin';

  // ctx = everything a section needs to know about the logged-in person
  const ctx = {
    me,
    employee,
    isAdmin,
    role: me.role,
    warehouses, // every warehouse (names for dropdowns)
    myWarehouses: isAdmin
      ? warehouses.map((w) => ({ warehouse_id: w.warehouse_id, name: w.name, assigned_role: 'admin' }))
      : assignments.map((a) => ({ warehouse_id: a.warehouse_id, name: a.warehouses?.name, assigned_role: a.assigned_role })),
    hasAccess(warehouseId) {
      return isAdmin || assignments.some((a) => a.warehouse_id === warehouseId);
    },
    canManage(warehouseId) {
      return isAdmin || (me.role === 'manager' &&
        assignments.some((a) => a.warehouse_id === warehouseId && a.assigned_role === 'manager'));
    },
    get managedWarehouses() {
      return this.myWarehouses.filter((w) => this.canManage(w.warehouse_id));
    },
    // cached lookups for dropdowns
    _cache: {},
    async items()     { return (this._cache.items     ??= await getItems()); },
    async suppliers() { return (this._cache.suppliers ??= await getSuppliers()); },
    clearCache() { this._cache = {}; },
    refresh: () => show(current),
  };

  // ---------- page frame
  app.innerHTML = `
    <nav class="navbar navbar-dark topbar sticky-top">
      <div class="container-fluid">
        <button class="btn btn-link text-white d-lg-none p-0 me-2" data-bs-toggle="offcanvas" data-bs-target="#sidebar">
          <i class="bi bi-list fs-3"></i></button>
        <span class="navbar-brand fw-semibold"><i class="bi bi-boxes me-2"></i>StockSync
          <span class="brand-sub d-none d-sm-inline">· ${esc(title)}</span></span>
        <div class="d-flex align-items-center gap-3 ms-auto">
          <span class="text-white-50 small d-none d-md-inline">${esc(employee ? personName(employee) : me.email)}</span>
          ${badge(me.role)}
          <button class="btn btn-sm btn-outline-light" id="logoutBtn"><i class="bi bi-box-arrow-right"></i> Log out</button>
        </div>
      </div>
    </nav>
    <div class="layout">
      <aside class="offcanvas-lg offcanvas-start sidebar" id="sidebar">
        <div class="offcanvas-header d-lg-none">
          <h5 class="offcanvas-title">Menu</h5>
          <button class="btn-close" data-bs-dismiss="offcanvas" data-bs-target="#sidebar"></button>
        </div>
        <div class="offcanvas-body p-0 d-block">
          <nav class="nav flex-column p-2" id="menu">
            ${sections.map((s) => `<a class="nav-link" href="#${s.id}" data-section="${s.id}">
              <i class="bi bi-${s.icon} me-2"></i>${esc(s.label)}</a>`).join('')}
          </nav>
          ${!isAdmin ? `<div class="assignments px-3 pb-3">
            <div class="small text-uppercase text-muted fw-semibold mb-1">My warehouses</div>
            ${ctx.myWarehouses.length
              ? ctx.myWarehouses.map((w) => `<div class="small">${esc(w.name)} <span class="text-muted">(${esc(w.assigned_role)})</span></div>`).join('')
              : '<div class="small text-danger">Not assigned to any warehouse yet.</div>'}
          </div>` : ''}
        </div>
      </aside>
      <main class="content">
        <div class="d-flex align-items-center justify-content-between mb-3 gap-2 flex-wrap">
          <h4 class="mb-0" id="sectionTitle"></h4>
          <div class="d-flex gap-2" id="sectionActions"></div>
        </div>
        <div id="sectionBody"></div>
      </main>
    </div>`;

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await logout();
    location.replace('index.html');
  });

  let current = null;

  async function show(sectionId) {
    const section = sections.find((s) => s.id === sectionId) ?? sections[0];
    current = section.id;
    document.querySelectorAll('#menu .nav-link').forEach((a) =>
      a.classList.toggle('active', a.dataset.section === section.id));
    document.getElementById('sectionTitle').textContent = section.label;

    const actions = document.getElementById('sectionActions');
    actions.innerHTML = `<button class="btn btn-sm btn-light border" id="refreshBtn" title="Refresh">
      <i class="bi bi-arrow-clockwise"></i></button>`;
    actions.querySelector('#refreshBtn').onclick = () => { ctx.clearCache(); show(current); };

    const body = document.getElementById('sectionBody');
    body.innerHTML = spinner();
    try {
      // sections may add their own buttons (e.g. "New purchase order") into `actions`
      await section.render(body, ctx, actions);
    } catch (err) {
      body.innerHTML = `<div class="alert alert-danger">${esc(friendlyError(err.message))}</div>`;
    }
    bootstrap.Offcanvas.getInstance(document.getElementById('sidebar'))?.hide();
  }

  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  show(location.hash.slice(1));
}
