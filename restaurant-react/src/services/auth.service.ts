import { supabase } from '../lib/supabase'
import { fixArabicEncoding } from '../lib/utils'
import { toUserMessage } from '../lib/errors'
import { User } from '../types/database.types'

// Columns of the signed-in user's profile. Listed explicitly: never password_hash, never users(*).
// The shape (role/branch embedded as objects, plus role_id/branch_id) is what the rest of the app reads.
const PROFILE_COLUMNS = `
  id, username, email, full_name, full_name_ar, phone, employee_code, role_id, branch_id, status,
  last_login, created_at, updated_at,
  role:roles(id, name, name_ar),
  branch:branches(id, code, name, name_ar, status, is_main_warehouse)
`

export type ProfileResult =
  | { status: 'ok'; user: User }
  // The account must not be used: the session is ended and the message shown on the login page
  | { status: 'denied'; message: string }
  // Network/server problem: keep the session, the profile can be loaded again later
  | { status: 'error'; message: string }

interface AuthErrorLike {
  code?: string
  status?: number
  message?: string
  name?: string
}

/** Arabic message for a Supabase Auth (GoTrue) error. */
export function authErrorMessage(error: unknown, fallback = 'حدث خطأ أثناء تسجيل الدخول، حاول مرة أخرى'): string {
  const e = (error ?? {}) as AuthErrorLike
  switch (e.code) {
    case 'invalid_credentials':
      return 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
    case 'user_banned':
      return 'هذا الحساب غير نشط، تواصل مع مدير النظام'
    case 'email_not_confirmed':
      return 'هذا الحساب غير مفعل بعد، تواصل مع مدير النظام'
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'محاولات كثيرة، انتظر قليلاً ثم حاول مرة أخرى'
    case 'weak_password':
      return 'كلمة المرور ضعيفة، اختر كلمة مرور أقوى (6 أحرف على الأقل)'
    case 'same_password':
      return 'كلمة المرور الجديدة يجب أن تختلف عن الحالية'
    case 'reauthentication_needed':
    case 'session_not_found':
    case 'session_expired':
      return 'انتهت الجلسة، سجّل الدخول مرة أخرى'
  }
  if (e.status === 429) return 'محاولات كثيرة، انتظر قليلاً ثم حاول مرة أخرى'
  if (e.name === 'AuthRetryableFetchError' || e.status === 0) return 'تعذر الاتصال بالخادم، تحقق من الاتصال بالإنترنت'
  return toUserMessage(error, fallback)
}

export const authService = {
  /**
   * Loads the profile of an authenticated user (users.id = auth.users.id) and checks it may use the app.
   */
  async loadProfile(userId: string): Promise<ProfileResult> {
    const { data, error } = await supabase
      .from('users')
      .select(PROFILE_COLUMNS)
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      return { status: 'error', message: toUserMessage(error, 'تعذر تحميل بيانات المستخدم، حاول مرة أخرى') }
    }
    if (!data) {
      return { status: 'denied', message: 'لا يوجد ملف موظف مرتبط بهذا الحساب، تواصل مع مدير النظام' }
    }

    const profile = data as unknown as User & {
      role: { id: string; name: string; name_ar: string } | null
      branch: { name_ar: string } | null
    }
    if (profile.status !== 'active') {
      return { status: 'denied', message: 'هذا الحساب غير نشط، تواصل مع مدير النظام' }
    }
    if (!profile.role) {
      return { status: 'denied', message: 'لم يتم تحديد دور وظيفي لهذا الحساب، تواصل مع مدير النظام' }
    }

    // Fix Arabic encoding issues from old data
    if (profile.full_name_ar) profile.full_name_ar = fixArabicEncoding(profile.full_name_ar)
    if (profile.role.name_ar) profile.role.name_ar = fixArabicEncoding(profile.role.name_ar)
    if (profile.branch?.name_ar) profile.branch.name_ar = fixArabicEncoding(profile.branch.name_ar)

    return { status: 'ok', user: profile as User }
  },

  /**
   * Changes the signed-in user's own password after checking the current one.
   * Returns an Arabic error message, or null on success.
   */
  async changeOwnPassword(email: string, currentPassword: string, newPassword: string): Promise<string | null> {
    // Re-checking the current password stops someone at an unattended, signed-in screen from taking the account
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password: currentPassword,
    })
    if (verifyError) {
      return verifyError.code === 'invalid_credentials'
        ? 'كلمة المرور الحالية غير صحيحة'
        : authErrorMessage(verifyError, 'تعذر تغيير كلمة المرور، حاول مرة أخرى')
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) return authErrorMessage(error, 'تعذر تغيير كلمة المرور، حاول مرة أخرى')
    return null
  },
}
