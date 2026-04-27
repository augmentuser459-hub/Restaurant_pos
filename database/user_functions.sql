-- ============================================
-- User Management Functions
-- Run this in Supabase SQL Editor
-- ============================================

-- Function to create a user with hashed password
CREATE OR REPLACE FUNCTION create_user(
  p_username VARCHAR,
  p_email VARCHAR,
  p_password VARCHAR,
  p_full_name VARCHAR,
  p_full_name_ar VARCHAR,
  p_employee_code VARCHAR,
  p_phone VARCHAR,
  p_role_id UUID,
  p_branch_id UUID,
  p_status user_status
)
RETURNS TABLE(id UUID) AS $$
DECLARE
  v_user_id UUID;
  v_password_hash VARCHAR;
BEGIN
  -- Generate a simple hash (in production, use proper password hashing)
  -- For now, we'll use crypt from pgcrypto extension
  v_password_hash := crypt(p_password, gen_salt('bf'));
  
  -- Insert the user
  INSERT INTO users (
    username,
    email,
    password_hash,
    full_name,
    full_name_ar,
    employee_code,
    phone,
    role_id,
    branch_id,
    status
  ) VALUES (
    p_username,
    p_email,
    v_password_hash,
    p_full_name,
    p_full_name_ar,
    COALESCE(p_employee_code, 'EMP-' || EXTRACT(EPOCH FROM NOW())::TEXT),
    p_phone,
    p_role_id,
    p_branch_id,
    COALESCE(p_status, 'active'::user_status)
  )
  RETURNING users.id INTO v_user_id;
  
  RETURN QUERY SELECT v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update a user with optional password change
CREATE OR REPLACE FUNCTION update_user(
  p_user_id UUID,
  p_email VARCHAR,
  p_password VARCHAR,
  p_full_name VARCHAR,
  p_full_name_ar VARCHAR,
  p_employee_code VARCHAR,
  p_phone VARCHAR,
  p_role_id UUID,
  p_branch_id UUID,
  p_status user_status
)
RETURNS TABLE(id UUID) AS $$
DECLARE
  v_password_hash VARCHAR;
BEGIN
  -- If password is provided, hash it
  IF p_password IS NOT NULL AND p_password != '' THEN
    v_password_hash := crypt(p_password, gen_salt('bf'));
  END IF;
  
  -- Update the user
  UPDATE users SET
    email = COALESCE(p_email, email),
    password_hash = COALESCE(v_password_hash, password_hash),
    full_name = COALESCE(p_full_name, full_name),
    full_name_ar = COALESCE(p_full_name_ar, full_name_ar),
    employee_code = COALESCE(p_employee_code, employee_code),
    phone = COALESCE(p_phone, phone),
    role_id = COALESCE(p_role_id, role_id),
    branch_id = CASE WHEN p_branch_id IS NOT NULL THEN p_branch_id ELSE branch_id END,
    status = COALESCE(p_status, status),
    updated_at = NOW()
  WHERE users.id = p_user_id;
  
  RETURN QUERY SELECT p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable pgcrypto extension for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Test the functions (optional)
-- SELECT * FROM create_user('testuser', 'test@example.com', 'password123', 'Test User', 'مستخدم تجريبي', 'EMP001', '1234567890', (SELECT id FROM roles LIMIT 1), NULL, 'active');
