-- =====================================================================
-- StockSync | Migration 008: Admin account management
-- Lets an administrator create login accounts and reset passwords from
-- the website, without ever putting Supabase's secret service_role key
-- in frontend code.
--
-- How it stays safe:
--   * The functions run inside the database as SECURITY DEFINER (owner's
--     rights), so the browser never holds any secret key.
--   * The FIRST thing each function does is check is_admin(). Managers,
--     staff, and logged-out visitors get "Access denied".
--   * Passwords are hashed with bcrypt (pgcrypto) before being stored,
--     the same format Supabase Auth itself uses.
--
-- Note: these functions write to Supabase's own auth.users and
-- auth.identities tables, matching what the Supabase dashboard does
-- when you click "Add user".
-- =====================================================================

-- ---------------------------------------------------------------------
-- Create a complete account in ONE transaction:
--   login (auth.users + auth.identities) -> role + active (public.users)
--   -> employee profile -> warehouse assignment (if a warehouse is given)
-- If any step fails, nothing is created. Returns the new user_id.
-- ---------------------------------------------------------------------
create or replace function public.admin_create_account(
  p_email        text,
  p_password     text,
  p_first_name   text,
  p_last_name    text,
  p_role         public.user_role,
  p_warehouse_id integer default null,
  p_contact_no   text    default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_email   text := lower(trim(p_email));
  v_user_id uuid := gen_random_uuid();
begin
  if not is_admin() then
    raise exception 'Access denied: only administrators can create accounts.' using errcode = '42501';
  end if;

  -- ---------- validate input
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address (for example name@hnu.edu.ph).';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'The password must be at least 8 characters.';
  end if;
  if coalesce(trim(p_first_name), '') = '' or coalesce(trim(p_last_name), '') = '' then
    raise exception 'First and last name are required.';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'An account with the email % already exists.', v_email;
  end if;
  if p_role is null then
    raise exception 'Choose a role.';
  end if;
  if p_role <> 'admin' and p_warehouse_id is null then
    raise exception 'Managers and staff must be assigned to a warehouse.';
  end if;
  if p_warehouse_id is not null and not exists (select 1 from warehouses where warehouse_id = p_warehouse_id) then
    raise exception 'Warehouse % does not exist.', p_warehouse_id;
  end if;

  -- ---------- 1. the login (same columns the Supabase dashboard fills in)
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    -- these must be empty text, not NULL, or Supabase Auth cannot read the row
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values (
    '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
    v_email, extensions.crypt(p_password, extensions.gen_salt('bf', 10)), now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    jsonb_build_object('email_verified', true), now(), now(),
    '', '', '', '');

  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  values (
    v_user_id::text, v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    'email', now(), now());

  -- ---------- 2. role + activate (the row was created by trg_auth_user_created)
  update users set role = p_role, is_active = true where user_id = v_user_id;

  -- ---------- 3. employee profile
  insert into employees (user_id, first_name, last_name, contact_no)
  values (v_user_id, trim(p_first_name), trim(p_last_name), nullif(trim(p_contact_no), ''));

  -- ---------- 4. warehouse assignment (managers -> manager, staff -> staff)
  if p_role <> 'admin' and p_warehouse_id is not null then
    insert into employee_assignments (employee_id, warehouse_id, assigned_role)
    select e.employee_id, p_warehouse_id, p_role::text::assignment_role
    from employees e where e.user_id = v_user_id;
  end if;

  return v_user_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Reset someone's password (e.g. they forgot it). Admin only.
-- ---------------------------------------------------------------------
create or replace function public.admin_set_password(p_user_id uuid, p_password text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Access denied: only administrators can reset passwords.' using errcode = '42501';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'The password must be at least 8 characters.';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = p_user_id;
  if not found then
    raise exception 'That account does not exist.';
  end if;
end;
$$;

-- Only logged-in users may call these (and the functions reject non-admins)
revoke execute on function public.admin_create_account(text, text, text, text, public.user_role, integer, text) from public, anon;
revoke execute on function public.admin_set_password(uuid, text) from public, anon;
grant  execute on function public.admin_create_account(text, text, text, text, public.user_role, integer, text) to authenticated;
grant  execute on function public.admin_set_password(uuid, text) to authenticated;
