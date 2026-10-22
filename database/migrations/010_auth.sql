-- ============================================
-- 010: Staff logins through Supabase Auth + user management. Idempotent; re-run at go-live after the data reload.
--   * public.users.id = auth.users.id (existing ids are kept, every foreign key already points at them)
--   * passwords live only in auth.users (bcrypt); public.users.password_hash holds a fixed placeholder
--   * auth_upsert_account(): internal, creates/updates the auth.users + auth.identities rows of a public.users row
--   * create_user / update_user / user_delete / user_set_category_permissions: admin-only RPCs (Users screen)
--   * auth_whoami(): the caller's own users row (diagnostics / login check)
--   * self sign-up through the Auth API is refused by the database: accounts are created only by the admin
-- Temporary passwords for existing staff: database/tools/go-live/set-temp-passwords.js, run after this migration;
-- it only touches active users that have no login account yet and writes the passwords outside the repo.
-- ============================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------- public.users.password_hash: never a real hash ----------
-- The column is NOT NULL (old schema) and readable through the API, so it always holds this placeholder.

CREATE OR REPLACE FUNCTION public.user_password_hash_placeholder() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.password_hash := 'managed-by-supabase-auth';
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.user_password_hash_placeholder() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.users ALTER COLUMN password_hash SET DEFAULT 'managed-by-supabase-auth';

DROP TRIGGER IF EXISTS users_password_hash_placeholder ON public.users;
CREATE TRIGGER users_password_hash_placeholder
  BEFORE INSERT OR UPDATE OF password_hash ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.user_password_hash_placeholder();

-- Data fix (also after the go-live reload, which loads with triggers off)
UPDATE public.users SET password_hash = 'managed-by-supabase-auth'
WHERE password_hash IS DISTINCT FROM 'managed-by-supabase-auth';

-- Employee code is optional: the admin can clear it (DB-37). Phone and branch were already nullable.
ALTER TABLE public.users ALTER COLUMN employee_code DROP NOT NULL;

-- Data fix: an address saved by the old form with the domain appended twice (GoTrue rejects it at login)
UPDATE public.users u SET email = 'baraa2@restaurant.com'
WHERE u.email = 'baraa2@restaurant.com@restaurant.com'
  AND NOT EXISTS (SELECT 1 FROM public.users x WHERE lower(x.email) = 'baraa2@restaurant.com');

-- ---------- Block self sign-up ----------
-- GoTrue's /signup (and dashboard "add user") insert into auth.users directly. Staff accounts must have a
-- public.users row with the same id, so only auth_upsert_account() may insert; it sets app.auth_provisioning.

CREATE OR REPLACE FUNCTION public.auth_block_self_signup() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_setting('app.auth_provisioning', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Sign-up is disabled: staff accounts are created by the administrator from the Users screen'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.auth_block_self_signup() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS auth_users_block_self_signup ON auth.users;
CREATE TRIGGER auth_users_block_self_signup
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.auth_block_self_signup();

-- ---------- Login account of a staff member ----------
-- Creates or updates the auth.users + auth.identities rows for public.users row p_user_id:
-- same id, lower-cased email, bcrypt password, email confirmed, banned while the user is not active.
-- p_password NULL keeps the current password; with no account yet and no password it does nothing (returns false).
-- Deactivating a user also ends their sessions. Only changes rows that differ, so re-running changes nothing.
-- Internal: called by create_user/update_user, the migration sync below and set-temp-passwords.js.
CREATE OR REPLACE FUNCTION public.auth_upsert_account(p_user_id uuid, p_password text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email text;
  v_status user_status;
  v_hash text;
  v_banned timestamptz;
BEGIN
  SELECT lower(btrim(u.email)), COALESCE(u.status, 'active') INTO v_email, v_status
  FROM public.users u WHERE u.id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المستخدم غير موجود' USING ERRCODE = 'P0001';
  END IF;
  IF v_email IS NULL OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'البريد الإلكتروني غير صحيح: %', v_email USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users a WHERE lower(a.email) = v_email AND a.id <> p_user_id) THEN
    RAISE EXCEPTION 'البريد الإلكتروني % مستخدم لحساب دخول آخر', v_email USING ERRCODE = 'P0001';
  END IF;

  IF p_password IS NOT NULL THEN
    IF char_length(p_password) < 6 THEN
      RAISE EXCEPTION 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' USING ERRCODE = 'P0001';
    END IF;
    IF octet_length(p_password) > 72 THEN
      RAISE EXCEPTION 'كلمة المرور طويلة جداً (الحد الأقصى 72 حرفاً)' USING ERRCODE = 'P0001';
    END IF;
    v_hash := extensions.crypt(p_password, extensions.gen_salt('bf', 10));
  END IF;

  -- A fixed far-future date (not 'infinity', which GoTrue can't read) keeps re-runs from changing anything
  v_banned := CASE WHEN v_status = 'active' THEN NULL ELSE '2999-12-31 00:00:00+00'::timestamptz END;

  IF EXISTS (SELECT 1 FROM auth.users a WHERE a.id = p_user_id) THEN
    -- NULL token columns break GoTrue logins, so they are normalised to '' as well
    UPDATE auth.users a SET
      email = v_email,
      encrypted_password = COALESCE(v_hash, a.encrypted_password),
      email_confirmed_at = COALESCE(a.email_confirmed_at, now()),
      banned_until = v_banned,
      confirmation_token = COALESCE(a.confirmation_token, ''),
      recovery_token = COALESCE(a.recovery_token, ''),
      email_change_token_new = COALESCE(a.email_change_token_new, ''),
      email_change = COALESCE(a.email_change, ''),
      email_change_token_current = COALESCE(a.email_change_token_current, ''),
      phone_change = COALESCE(a.phone_change, ''),
      phone_change_token = COALESCE(a.phone_change_token, ''),
      reauthentication_token = COALESCE(a.reauthentication_token, ''),
      updated_at = now()
    WHERE a.id = p_user_id
      AND (a.email IS DISTINCT FROM v_email
        OR v_hash IS NOT NULL
        OR a.banned_until IS DISTINCT FROM v_banned
        OR a.email_confirmed_at IS NULL
        OR a.confirmation_token IS NULL OR a.recovery_token IS NULL
        OR a.email_change_token_new IS NULL OR a.email_change IS NULL
        OR a.email_change_token_current IS NULL OR a.phone_change IS NULL
        OR a.phone_change_token IS NULL OR a.reauthentication_token IS NULL);

    UPDATE auth.identities i SET
      identity_data = i.identity_data
        || jsonb_build_object('sub', p_user_id::text, 'email', v_email, 'email_verified', true),
      updated_at = now()
    WHERE i.user_id = p_user_id AND i.provider = 'email'
      AND (i.identity_data ->> 'email' IS DISTINCT FROM v_email
        OR i.identity_data ->> 'sub' IS DISTINCT FROM p_user_id::text
        OR i.identity_data ->> 'email_verified' IS DISTINCT FROM 'true');
  ELSE
    IF v_hash IS NULL THEN
      RETURN false;
    END IF;
    PERFORM set_config('app.auth_provisioning', 'on', true);
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, banned_until,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token,
      is_sso_user, is_anonymous)
    VALUES (
      '00000000-0000-0000-0000-000000000000', p_user_id, 'authenticated', 'authenticated', v_email, v_hash, now(), v_banned,
      '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb, now(), now(),
      '', '', '', '',
      '', '', '', '',
      false, false);
    PERFORM set_config('app.auth_provisioning', 'off', true);
  END IF;

  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  SELECT p_user_id::text, p_user_id,
         jsonb_build_object('sub', p_user_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
         'email', now(), now()
  WHERE NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = p_user_id AND i.provider = 'email');

  IF v_status <> 'active' THEN
    DELETE FROM auth.sessions s WHERE s.user_id = p_user_id;
    UPDATE auth.refresh_tokens t SET revoked = true
    WHERE t.user_id = p_user_id::text AND t.revoked IS NOT TRUE;
  END IF;

  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.auth_upsert_account(uuid, text) FROM PUBLIC, anon, authenticated;

-- Data fix (go-live): the reload replaces public.users but keeps auth.users. A login account whose users row is
-- gone (staff deleted in the old system after the copy, a test user created here before go-live) is stale:
-- accounts are only ever created for an existing users row (see the sign-up trigger above). It would still get a
-- valid token and keep its email taken, so it is deleted; identities, sessions and MFA rows cascade.
-- Skipped while public.users is empty, so a failed or unfinished reload can't wipe every login.
DO $$
DECLARE
  v_deleted integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users) THEN
    RAISE NOTICE 'public.users is empty: stale login accounts were not checked';
    RETURN;
  END IF;
  -- Refresh tokens hold the user id as text (no foreign key), older ones without a session
  DELETE FROM auth.refresh_tokens t
  USING auth.users a
  WHERE t.user_id = a.id::text
    AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = a.id);
  DELETE FROM auth.users a
  WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = a.id);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted > 0 THEN
    RAISE NOTICE '% stale login account(s) without a users row deleted', v_deleted;
  END IF;
END $$;

-- Data sync (go-live): users whose email or status changed in the old system get their login account updated.
-- Accounts are never created here (that needs a password: set-temp-passwords.js / the Users screen).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT u.id, u.email FROM public.users u
           WHERE EXISTS (SELECT 1 FROM auth.users a WHERE a.id = u.id) LOOP
    BEGIN
      PERFORM public.auth_upsert_account(r.id, NULL);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'login account of user % (%) not synced: %', r.id, r.email, SQLERRM;
    END;
  END LOOP;
END $$;

-- ---------- Shared checks for create_user / update_user ----------
-- Raises an Arabic P0001 error for the first problem; returns the role name. p_user_id is NULL when creating.
CREATE OR REPLACE FUNCTION public.user_check_profile(
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_employee_code text,
  p_role_id uuid,
  p_branch_id uuid
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
BEGIN
  IF p_email IS NULL OR p_email = '' THEN
    RAISE EXCEPTION 'يرجى إدخال البريد الإلكتروني' USING ERRCODE = 'P0001';
  END IF;
  IF char_length(p_email) > 255 OR p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'البريد الإلكتروني غير صحيح: %', p_email USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users u WHERE lower(u.email) = lower(p_email) AND u.id IS DISTINCT FROM p_user_id)
     OR EXISTS (SELECT 1 FROM auth.users a WHERE lower(a.email) = lower(p_email) AND a.id IS DISTINCT FROM p_user_id) THEN
    RAISE EXCEPTION 'البريد الإلكتروني % مستخدم لمستخدم آخر', p_email USING ERRCODE = 'P0001';
  END IF;
  IF p_full_name IS NULL OR p_full_name = '' THEN
    RAISE EXCEPTION 'يرجى إدخال الاسم' USING ERRCODE = 'P0001';
  END IF;
  IF p_employee_code IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.users u WHERE u.employee_code = p_employee_code AND u.id IS DISTINCT FROM p_user_id) THEN
    RAISE EXCEPTION 'كود الموظف % مستخدم لموظف آخر', p_employee_code USING ERRCODE = 'P0001';
  END IF;

  SELECT r.name INTO v_role FROM public.roles r WHERE r.id = p_role_id;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'يرجى اختيار الدور الوظيفي' USING ERRCODE = 'P0001';
  END IF;
  -- Same rule as the Users screen: only the admin and the purchase manager work without a branch
  IF p_branch_id IS NULL AND v_role NOT IN ('admin', 'purchase_manager') THEN
    RAISE EXCEPTION 'يرجى اختيار الفرع لهذا الدور الوظيفي' USING ERRCODE = 'P0001';
  END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p_branch_id) THEN
    RAISE EXCEPTION 'الفرع غير موجود' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_role;
END $$;

REVOKE ALL ON FUNCTION public.user_check_profile(uuid, text, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ---------- POS category permissions of a cashier / chef ----------
-- Replaces the user's permission set with p_category_ids (unknown ids are ignored; empty = no restriction).
-- Internal; returns the number of categories now assigned.
CREATE OR REPLACE FUNCTION public.user_replace_categories(
  p_user_id uuid,
  p_kind text,
  p_category_ids uuid[],
  p_by uuid
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ids uuid[] := COALESCE(p_category_ids, '{}');
  v_count integer;
BEGIN
  IF p_kind = 'cashier' THEN
    DELETE FROM public.cashier_category_permissions p
    WHERE p.user_id = p_user_id AND NOT (p.category_id = ANY (v_ids));
    INSERT INTO public.cashier_category_permissions (user_id, category_id, created_by)
    SELECT p_user_id, c.id, p_by FROM public.categories c WHERE c.id = ANY (v_ids)
    ON CONFLICT (user_id, category_id) DO NOTHING;
    SELECT count(*) INTO v_count FROM public.cashier_category_permissions p WHERE p.user_id = p_user_id;
  ELSIF p_kind = 'chef' THEN
    DELETE FROM public.chef_category_permissions p
    WHERE p.user_id = p_user_id AND NOT (p.category_id = ANY (v_ids));
    INSERT INTO public.chef_category_permissions (user_id, category_id, created_by)
    SELECT p_user_id, c.id, p_by FROM public.categories c WHERE c.id = ANY (v_ids)
    ON CONFLICT (user_id, category_id) DO NOTHING;
    SELECT count(*) INTO v_count FROM public.chef_category_permissions p WHERE p.user_id = p_user_id;
  ELSE
    RAISE EXCEPTION 'نوع الصلاحيات غير معروف: %', p_kind USING ERRCODE = 'P0001';
  END IF;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.user_replace_categories(uuid, text, uuid[], uuid) FROM PUBLIC, anon, authenticated;

-- ---------- create_user (admin) ----------
-- The old 10-argument versions had no permission check and were callable by anon.
DROP FUNCTION IF EXISTS public.create_user(varchar, varchar, varchar, varchar, varchar, varchar, varchar, uuid, uuid, user_status);

-- Creates the staff member and their login account in one transaction.
-- Blank employee code / phone are stored as NULL. p_cashier_category_ids: POS categories of a cashier (NULL = none).
CREATE OR REPLACE FUNCTION public.create_user(
  p_username varchar,
  p_email varchar,
  p_password varchar,
  p_full_name varchar,
  p_full_name_ar varchar,
  p_employee_code varchar,
  p_phone varchar,
  p_role_id uuid,
  p_branch_id uuid,
  p_status user_status,
  p_cashier_category_ids uuid[] DEFAULT NULL
) RETURNS TABLE(id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_caller uuid := public.app_require_role('admin');
  v_username text := btrim(COALESCE(p_username, ''));
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_full_name text := btrim(COALESCE(p_full_name, ''));
  v_code text := NULLIF(btrim(COALESCE(p_employee_code, '')), '');
  v_id uuid;
BEGIN
  IF v_username = '' THEN
    RAISE EXCEPTION 'يرجى إدخال اسم المستخدم' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users u WHERE lower(u.username) = lower(v_username)) THEN
    RAISE EXCEPTION 'اسم المستخدم "%" مستخدم بالفعل', v_username USING ERRCODE = 'P0001';
  END IF;
  IF p_password IS NULL OR p_password = '' THEN
    RAISE EXCEPTION 'يرجى إدخال كلمة المرور' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.user_check_profile(NULL, v_email, v_full_name, v_code, p_role_id, p_branch_id);

  INSERT INTO public.users (
    username, email, password_hash, full_name, full_name_ar, employee_code, phone,
    role_id, branch_id, status, created_by)
  VALUES (
    v_username, v_email, 'managed-by-supabase-auth', v_full_name, NULLIF(btrim(p_full_name_ar), ''), v_code,
    NULLIF(btrim(p_phone), ''), p_role_id, p_branch_id, COALESCE(p_status, 'active'::user_status), v_caller)
  RETURNING users.id INTO v_id;

  PERFORM public.auth_upsert_account(v_id, p_password);

  IF p_cashier_category_ids IS NOT NULL THEN
    PERFORM public.user_replace_categories(v_id, 'cashier', p_cashier_category_ids, v_caller);
  END IF;

  RETURN QUERY SELECT v_id;
END $$;

REVOKE ALL ON FUNCTION public.create_user(varchar, varchar, varchar, varchar, varchar, varchar, varchar, uuid, uuid, user_status, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_user(varchar, varchar, varchar, varchar, varchar, varchar, varchar, uuid, uuid, user_status, uuid[]) TO authenticated;

-- ---------- update_user (admin) ----------
DROP FUNCTION IF EXISTS public.update_user(uuid, varchar, varchar, varchar, varchar, varchar, varchar, uuid, uuid, user_status);

-- Saves the Users-screen form. NULL/blank email, names, role, status or password keep the current value;
-- employee code, phone and branch are always set to what is passed, so NULL/blank CLEARS them (DB-37).
-- Email/password/status changes are applied to the login account in the same transaction.
-- p_cashier_category_ids: NULL leaves the cashier's POS categories as they are, an array replaces them.
CREATE OR REPLACE FUNCTION public.update_user(
  p_user_id uuid,
  p_email varchar,
  p_password varchar,
  p_full_name varchar,
  p_full_name_ar varchar,
  p_employee_code varchar,
  p_phone varchar,
  p_role_id uuid,
  p_branch_id uuid,
  p_status user_status,
  p_cashier_category_ids uuid[] DEFAULT NULL
) RETURNS TABLE(id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_caller uuid := public.app_require_role('admin');
  v_old public.users%ROWTYPE;
  v_email text;
  v_full_name text;
  v_full_name_ar text;
  v_code text := NULLIF(btrim(COALESCE(p_employee_code, '')), '');
  v_phone text := NULLIF(btrim(COALESCE(p_phone, '')), '');
  v_password text := NULLIF(p_password, '');
  v_role_id uuid;
  v_status user_status;
  v_role text;
BEGIN
  SELECT * INTO v_old FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المستخدم غير موجود' USING ERRCODE = 'P0001';
  END IF;

  v_email := COALESCE(NULLIF(lower(btrim(p_email)), ''), v_old.email);
  v_full_name := COALESCE(NULLIF(btrim(p_full_name), ''), v_old.full_name);
  v_full_name_ar := COALESCE(NULLIF(btrim(p_full_name_ar), ''), v_old.full_name_ar);
  v_role_id := COALESCE(p_role_id, v_old.role_id);
  v_status := COALESCE(p_status, v_old.status, 'active'::user_status);

  v_role := public.user_check_profile(p_user_id, v_email, v_full_name, v_code, v_role_id, p_branch_id);

  -- The signed-in admin can't lock themselves out
  IF p_user_id = v_caller AND v_status <> 'active' THEN
    RAISE EXCEPTION 'لا يمكنك تعطيل حسابك الخاص' USING ERRCODE = 'P0001';
  END IF;
  IF p_user_id = v_caller AND v_role <> 'admin' THEN
    RAISE EXCEPTION 'لا يمكنك إزالة صلاحية مدير النظام عن حسابك' USING ERRCODE = 'P0001';
  END IF;
  IF v_password IS NULL AND v_status = 'active'
     AND NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id = p_user_id) THEN
    RAISE EXCEPTION 'هذا المستخدم ليس له حساب دخول بعد، أدخل كلمة مرور له' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.users u SET
    email = v_email,
    full_name = v_full_name,
    full_name_ar = v_full_name_ar,
    employee_code = v_code,
    phone = v_phone,
    role_id = v_role_id,
    branch_id = p_branch_id,
    status = v_status,
    updated_at = now()
  WHERE u.id = p_user_id;

  PERFORM public.auth_upsert_account(p_user_id, v_password);

  IF p_cashier_category_ids IS NOT NULL THEN
    PERFORM public.user_replace_categories(p_user_id, 'cashier', p_cashier_category_ids, v_caller);
  END IF;

  RETURN QUERY SELECT p_user_id;
END $$;

REVOKE ALL ON FUNCTION public.update_user(uuid, varchar, varchar, varchar, varchar, varchar, varchar, uuid, uuid, user_status, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_user(uuid, varchar, varchar, varchar, varchar, varchar, varchar, uuid, uuid, user_status, uuid[]) TO authenticated;

-- ---------- user_delete (admin) ----------
-- Deletes a staff member and their login account. Users with recorded work (orders, transfers...) can't be
-- deleted, only deactivated, so history keeps pointing at them.
CREATE OR REPLACE FUNCTION public.user_delete(p_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := public.app_require_role('admin');
BEGIN
  IF p_user_id = v_caller THEN
    RAISE EXCEPTION 'لا يمكنك حذف حسابك الخاص' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المستخدم غير موجود' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    DELETE FROM public.users u WHERE u.id = p_user_id;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'لا يمكن حذف هذا المستخدم لوجود عمليات مسجلة باسمه، يمكنك تعطيله بدلاً من ذلك'
      USING ERRCODE = 'P0001';
  END;
  DELETE FROM auth.users a WHERE a.id = p_user_id;
END $$;

REVOKE ALL ON FUNCTION public.user_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_delete(uuid) TO authenticated;

-- ---------- user_set_category_permissions (admin) ----------
-- p_kind 'cashier' (POS categories the cashier sees) or 'chef' (categories the kitchen screen shows).
CREATE OR REPLACE FUNCTION public.user_set_category_permissions(p_user_id uuid, p_kind text, p_category_ids uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := public.app_require_role('admin');
BEGIN
  PERFORM 1 FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المستخدم غير موجود' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.user_replace_categories(p_user_id, p_kind, p_category_ids, v_caller);
END $$;

REVOKE ALL ON FUNCTION public.user_set_category_permissions(uuid, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_set_category_permissions(uuid, text, uuid[]) TO authenticated;

-- ---------- auth_whoami ----------
-- The signed-in caller's own users row (any status), as resolved from auth.uid().
CREATE OR REPLACE FUNCTION public.auth_whoami()
RETURNS TABLE(user_id uuid, email text, full_name text, role text, branch_id uuid, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.email::text, COALESCE(u.full_name_ar, u.full_name)::text, r.name::text, u.branch_id, u.status::text
  FROM public.users u JOIN public.roles r ON r.id = u.role_id
  WHERE u.id = auth.uid()
$$;

REVOKE ALL ON FUNCTION public.auth_whoami() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_whoami() TO authenticated;

-- ---------- Table privileges ----------
-- Users, roles and POS category permissions change only through the functions above.
-- Logged-in users keep SELECT (pages embed user names); row-level policies come with 090_security_rls.sql.
-- Nothing reads these tables before login, so anon gets no access to them at all.
REVOKE ALL ON public.users, public.roles, public.cashier_category_permissions, public.chef_category_permissions
  FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.users, public.roles, public.cashier_category_permissions, public.chef_category_permissions
  FROM authenticated;
GRANT SELECT ON public.users, public.roles, public.cashier_category_permissions, public.chef_category_permissions
  TO authenticated;

-- The old SECURITY DEFINER readers of those permission tables (add_*_category_permissions.sql) are executable by
-- anon, which would expose the same user -> category mapping without logging in. Logged-in users keep them.
-- Like every SECURITY DEFINER function they get a fixed search_path (both bodies only use public tables).
DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public.cashier_has_category_access(uuid, uuid)', 'public.get_chef_categories(uuid)'] LOOP
    IF to_regprocedure(v_fn) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn);
      EXECUTE format('ALTER FUNCTION %s SET search_path = public', v_fn);
    END IF;
  END LOOP;
END $$;
