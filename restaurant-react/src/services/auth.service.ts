import { supabase } from '../lib/supabase'
import { User } from '../types/database.types'

export const authService = {
  // Sign in with email and password
  async signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    return { data, error }
  },

  // Sign out
  async signOut() {
    const { error } = await supabase.auth.signOut()
    return { error }
  },

  // Get current session
  async getSession() {
    const { data, error } = await supabase.auth.getSession()
    return { session: data.session, error }
  },

  // Get current user from Supabase Auth
  async getAuthUser() {
    const { data, error } = await supabase.auth.getUser()
    return { user: data.user, error }
  },

  // Get user profile from database
  async getUserProfile(userId: string): Promise<{ user: User | null; error: Error | null }> {
    const { data, error } = await supabase
      .from('users')
      .select('*, branch:branches(*)')
      .eq('id', userId)
      .single()

    return { user: data as User, error }
  },

  // Update user profile
  async updateProfile(userId: string, updates: Partial<User>) {
    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', userId)
      .select()
      .single()

    return { user: data as User, error }
  },

  // Change password
  async changePassword(newPassword: string) {
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword,
    })
    return { data, error }
  },

  // Reset password request
  async resetPassword(email: string) {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email)
    return { data, error }
  },
}
