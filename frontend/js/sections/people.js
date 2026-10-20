// Admin: login accounts (role / active), employee profiles, warehouse assignments
import { getUsers, getEmployees, setUserRole, addEmployee, updateEmployee, deleteEmployee,
         assignEmployee, endAssignment } from '../api.js';
import { esc, table, badge, dateOnly, isoDate, openForm, toast, runAction } from '../ui.js';

const one = (x) => (Array.isArray(x) ? x[0] : x); // one-to-one embeds may come back as [row]

export async function renderPeople(el, ctx, actions) {
  const [users, employees] = await Promise.all([getUsers(), getEmployees()]);

  actions.insertAdjacentHTML('afterbegin',
    `<button class="btn btn-sm btn-primary" id="addEmp"><i class="bi bi-person-plus"></i> Add employee</button>`);
  actions.querySelector('#addEmp').onclick = () => openEmployeeForm(ctx, users, employees);

  el.innerHTML = `
    <div class="alert alert-info small">
      <i class="bi bi-info-circle me-1"></i>
      <b>Adding a new person:</b> 1) create their login in Supabase → Authentication → Add user,
      2) activate it and set the role below, 3) add an employee profile linked to it,
      4) assign them to a warehouse.
    </div>

    <h6 class="section-heading">Login accounts</h6>
    ${table([
      { label: 'Email',    render: (u) => esc(u.email) },
      { label: 'Role',     render: (u) => badge(u.role) },
      { label: 'Status',   render: (u) => (u.is_active ? badge('active') : '<span class="badge rounded-pill text-bg-danger">inactive</span>') },
      { label: 'Employee', render: (u) => { const e = one(u.employees); return e ? esc(`${e.first_name} ${e.last_name}`) : '<span class="text-muted small">no profile</span>'; } },
      { label: '',         class: 'text-end', render: (u) => (u.user_id === ctx.me.user_id
          ? '<span class="small text-muted">you</span>'
          : `<button class="btn btn-sm btn-light border" data-action="edit-user" data-id="${u.user_id}"><i class="bi bi-pencil"></i> Role / status</button>`) },
    ], users, 'No accounts yet.')}

    <h6 class="section-heading mt-4">Employees &amp; warehouse assignments</h6>
    ${table([
      { label: 'Name',        render: (e) => `<span class="fw-semibold">${esc(e.first_name)} ${esc(e.last_name)}</span><div class="small text-muted">${esc(e.contact_no ?? '')}</div>` },
      { label: 'Login',       render: (e) => esc(one(e.users)?.email ?? '—') },
      { label: 'Hired',       render: (e) => dateOnly(e.hired_at) },
      { label: 'Assignments', render: (e) => assignmentChips(e) },
      { label: '',            class: 'text-end text-nowrap', render: (e) => `
          <button class="btn btn-sm btn-outline-primary" data-action="assign" data-id="${e.employee_id}"><i class="bi bi-building-add"></i> Assign</button>
          <button class="btn btn-sm btn-light border" data-action="edit-emp" data-id="${e.employee_id}"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-outline-danger" data-action="delete-emp" data-id="${e.employee_id}"><i class="bi bi-trash"></i></button>` },
    ], employees, 'No employees yet.')}`;

  el.onclick = async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const emp = employees.find((x) => String(x.employee_id) === id);
    switch (btn.dataset.action) {
      case 'edit-user':
        return openUserForm(ctx, users.find((u) => u.user_id === id));
      case 'edit-emp':
        return openEmployeeForm(ctx, users, employees, emp);
      case 'assign':
        return openAssignForm(ctx, emp);
      case 'end-assignment':
        if (confirm('End this warehouse assignment?') &&
            await runAction(btn, () => endAssignment(Number(id)), 'Assignment ended.')) ctx.refresh();
        return;
      case 'delete-emp':
        if (confirm(`Delete employee ${emp.first_name} ${emp.last_name}?`) &&
            await runAction(btn, () => deleteEmployee(emp.employee_id), 'Employee deleted.')) ctx.refresh();
    }
  };
}

function assignmentChips(e) {
  const active = (e.employee_assignments ?? []).filter((a) => a.status === 'active');
  if (!active.length) return '<span class="small text-muted">not assigned</span>';
  return active.map((a) => `
    <span class="chip">${esc(a.warehouses?.name)} <span class="text-muted">· ${esc(a.assigned_role)}</span>
      <button class="chip-x" data-action="end-assignment" data-id="${a.assignment_id}" title="End assignment">&times;</button>
    </span>`).join(' ');
}

function openUserForm(ctx, u) {
  openForm({
    title: `Account · ${u.email}`,
    fields: [
      { type: 'select', name: 'role', label: 'Role', required: true, value: u.role,
        options: [{ value: 'admin', label: 'Administrator' }, { value: 'manager', label: 'Warehouse Manager' }, { value: 'staff', label: 'Warehouse Staff' }] },
      { type: 'checkbox', name: 'is_active', label: 'Account is active (can log in)', value: u.is_active },
    ],
    onSubmit: async (v) => {
      await setUserRole(u.user_id, v.role, v.is_active);
      toast('Account updated.');
      ctx.refresh();
    },
  });
}

function openEmployeeForm(ctx, users, employees, emp = {}) {
  // logins that don't have an employee profile yet (plus the current one when editing)
  const linked = new Set(employees.map((e) => e.user_id).filter(Boolean));
  const free = users.filter((u) => !linked.has(u.user_id) || u.user_id === emp.user_id);
  openForm({
    title: emp.employee_id ? `Edit ${emp.first_name} ${emp.last_name}` : 'Add employee',
    fields: [
      { type: 'text', name: 'first_name', label: 'First name', required: true, maxlength: 50, value: emp.first_name },
      { type: 'text', name: 'last_name', label: 'Last name', required: true, maxlength: 50, value: emp.last_name },
      { type: 'text', name: 'contact_no', label: 'Contact no.', maxlength: 15, value: emp.contact_no },
      { type: 'date', name: 'hired_at', label: 'Hired on', required: true, value: emp.hired_at ?? isoDate() },
      { type: 'select', name: 'user_id', label: 'Linked login account', value: emp.user_id, placeholder: '— none —',
        options: free.map((u) => ({ value: u.user_id, label: `${u.email} (${u.role})` })),
        help: 'Employees who use the system need a login. Others (e.g. drivers) can have none.' },
    ],
    onSubmit: async (v) => {
      if (emp.employee_id) await updateEmployee(emp.employee_id, v); else await addEmployee(v);
      toast('Employee saved.');
      ctx.refresh();
    },
  });
}

function openAssignForm(ctx, emp) {
  openForm({
    title: `Assign ${emp.first_name} ${emp.last_name}`,
    fields: [
      { type: 'select', name: 'warehouse_id', label: 'Warehouse', required: true, numeric: true,
        options: ctx.warehouses.map((w) => ({ value: w.warehouse_id, label: w.name })) },
      { type: 'select', name: 'assigned_role', label: 'Role in this warehouse', required: true, value: 'staff',
        options: [{ value: 'manager', label: 'Manager' }, { value: 'staff', label: 'Staff' }],
        help: 'Manager permissions also require the login account role to be "manager".' },
    ],
    onSubmit: async (v) => {
      await assignEmployee(emp.employee_id, v.warehouse_id, v.assigned_role);
      toast('Assignment added.');
      ctx.refresh();
    },
  });
}
