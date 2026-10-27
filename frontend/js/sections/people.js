// Admin: login accounts (role / active), employee profiles, warehouse assignments
import { getUsers, getEmployees, setUserRole, addEmployee, updateEmployee, deleteEmployee,
         assignEmployee, endAssignment, createAccount, setPassword } from '../api.js';
import { esc, table, badge, dateOnly, isoDate, openForm, toast, runAction } from '../ui.js';

const one = (x) => (Array.isArray(x) ? x[0] : x); // one-to-one embeds may come back as [row]

export async function renderPeople(el, ctx, actions) {
  const [users, employees] = await Promise.all([getUsers(), getEmployees()]);

  actions.insertAdjacentHTML('afterbegin', `
    <button class="btn btn-sm btn-light border" id="addEmp" title="Employee without a login, e.g. a driver"><i class="bi bi-person"></i> Add employee only</button>
    <button class="btn btn-sm btn-primary" id="newAcct"><i class="bi bi-person-plus"></i> Create account</button>`);
  actions.querySelector('#addEmp').onclick = () => openEmployeeForm(ctx, users, employees);
  actions.querySelector('#newAcct').onclick = () => openCreateAccountForm(ctx);

  el.innerHTML = `

    <h6 class="section-heading">Login accounts</h6>
    ${table([
      { label: 'Email',    render: (u) => esc(u.email) },
      { label: 'Role',     render: (u) => badge(u.role) },
      { label: 'Status',   render: (u) => (u.is_active ? badge('active') : '<span class="badge rounded-pill text-bg-danger">inactive</span>') },
      { label: 'Employee', render: (u) => { const e = one(u.employees); return e ? esc(`${e.first_name} ${e.last_name}`) : '<span class="text-muted small">no profile</span>'; } },
      { label: '',         class: 'text-end', render: (u) => (u.user_id === ctx.me.user_id
          ? '<span class="small text-muted">you</span>'
          : `<button class="btn btn-sm btn-light border" data-action="edit-user" data-id="${u.user_id}"><i class="bi bi-pencil"></i> Role / status</button>
             <button class="btn btn-sm btn-light border" data-action="reset-pw" data-id="${u.user_id}"><i class="bi bi-key"></i> Reset password</button>`) },
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
      case 'reset-pw':
        return openResetPasswordForm(users.find((u) => u.user_id === id));
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

// One form creates everything: login, role, employee profile, warehouse assignment
function openCreateAccountForm(ctx) {
  openForm({
    title: 'Create account',
    submitLabel: 'Create account',
    fields: [
      { type: 'text', name: 'first_name', label: 'First name', required: true, maxlength: 50 },
      { type: 'text', name: 'last_name', label: 'Last name', required: true, maxlength: 50 },
      { type: 'email', name: 'email', label: 'Email (used to log in)', required: true, maxlength: 100 },
      { type: 'text', name: 'password', label: 'Temporary password', required: true, maxlength: 72,
        help: 'At least 8 characters. Give it to the person so they can log in.' },
      { type: 'select', name: 'role', label: 'Role', required: true, value: 'staff',
        options: [{ value: 'staff', label: 'Warehouse Staff' }, { value: 'manager', label: 'Warehouse Manager' }, { value: 'admin', label: 'Administrator' }] },
      { type: 'select', name: 'warehouse_id', label: 'Warehouse', numeric: true, placeholder: '— none (administrators) —',
        options: ctx.warehouses.map((w) => ({ value: w.warehouse_id, label: w.name })),
        help: 'Required for managers and staff. You can add more warehouses later with Assign.' },
      { type: 'text', name: 'contact_no', label: 'Contact no.', maxlength: 15 },
    ],
    onSubmit: async (v) => {
      if (v.password.length < 8) throw new Error('The password must be at least 8 characters.');
      if (v.role !== 'admin' && !v.warehouse_id) throw new Error('Choose a warehouse for managers and staff.');
      await createAccount({ ...v, warehouse_id: v.role === 'admin' ? null : v.warehouse_id });
      toast(`Account created for ${v.first_name}. They can log in with ${v.email.trim().toLowerCase()}.`);
      ctx.refresh();
    },
  });
}

function openResetPasswordForm(u) {
  openForm({
    title: `Reset password · ${u.email}`,
    submitLabel: 'Reset password',
    fields: [
      { type: 'text', name: 'password', label: 'New password', required: true, maxlength: 72,
        help: 'At least 8 characters. Tell the person their new password.' },
    ],
    onSubmit: async (v) => {
      if (v.password.length < 8) throw new Error('The password must be at least 8 characters.');
      await setPassword(u.user_id, v.password);
      toast(`Password reset for ${u.email}.`);
    },
  });
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
