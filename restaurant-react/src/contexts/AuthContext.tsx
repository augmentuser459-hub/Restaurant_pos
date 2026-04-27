import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { User } from '../types/database.types'
import { fixArabicEncoding } from '../lib/utils'

interface AuthContextType {
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  isAuthenticated: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// Storage key for persisting user session
const USER_STORAGE_KEY = 'restaurant_user'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // Load user from localStorage on mount
  useEffect(() => {
    const storedUser = localStorage.getItem(USER_STORAGE_KEY)
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser)
        // Fix Arabic encoding for cached user data
        if (parsedUser.full_name_ar) {
          parsedUser.full_name_ar = fixArabicEncoding(parsedUser.full_name_ar)
        }
        if (parsedUser.role && typeof parsedUser.role === 'object' && parsedUser.role.name_ar) {
          parsedUser.role.name_ar = fixArabicEncoding(parsedUser.role.name_ar)
        }
        if (parsedUser.branch && typeof parsedUser.branch === 'object' && parsedUser.branch.name_ar) {
          parsedUser.branch.name_ar = fixArabicEncoding(parsedUser.branch.name_ar)
        }
        setUser(parsedUser)
      } catch {
        localStorage.removeItem(USER_STORAGE_KEY)
      }
    }
    setLoading(false)
  }, [])

  // Sign in using Supabase Auth + database users table (with fallback to custom auth)
  const signIn = async (email: string, password: string) => {
    try {
      // Try custom database authentication first (for existing users with password = "1234")
      if (password === '1234') {
        const { data: dbUsers, error: dbError } = await supabase
          .from('users')
          .select('*, branch:branches(*), role:roles(*)')
          .ilike('email', email)
          .eq('status', 'active')

        if (!dbError && dbUsers && dbUsers.length > 0) {
          const dbUser = dbUsers[0]

          // Fix Arabic encoding issues from database
          if (dbUser.full_name_ar) {
            dbUser.full_name_ar = fixArabicEncoding(dbUser.full_name_ar)
          }
          if (dbUser.role && typeof dbUser.role === 'object' && dbUser.role.name_ar) {
            dbUser.role.name_ar = fixArabicEncoding(dbUser.role.name_ar)
          }
          if (dbUser.branch && typeof dbUser.branch === 'object' && dbUser.branch.name_ar) {
            dbUser.branch.name_ar = fixArabicEncoding(dbUser.branch.name_ar)
          }

          // Set user and persist to localStorage
          setUser(dbUser as User)
          localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(dbUser))

          return { error: null }
        }
      }

      // If custom auth fails, try Supabase Auth (for new users)
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      })

      if (authError) {
        return { error: new Error('البريد الإلكتروني أو كلمة المرور غير صحيحة') }
      }

      if (!authData.user) {
        return { error: new Error('فشل تسجيل الدخول') }
      }

      // Now query users table by auth user id
      const { data: users, error } = await supabase
        .from('users')
        .select('*, branch:branches(*), role:roles(*)')
        .eq('id', authData.user.id)
        .eq('status', 'active')

      if (error) {
        return { error: new Error('خطأ في الاتصال بقاعدة البيانات') }
      }

      if (!users || users.length === 0) {
        return { error: new Error('المستخدم غير مسجل') }
      }

      const dbUser = users[0]

      // Fix Arabic encoding issues from database
      if (dbUser.full_name_ar) {
        dbUser.full_name_ar = fixArabicEncoding(dbUser.full_name_ar)
      }
      if (dbUser.role && typeof dbUser.role === 'object' && dbUser.role.name_ar) {
        dbUser.role.name_ar = fixArabicEncoding(dbUser.role.name_ar)
      }
      if (dbUser.branch && typeof dbUser.branch === 'object' && dbUser.branch.name_ar) {
        dbUser.branch.name_ar = fixArabicEncoding(dbUser.branch.name_ar)
      }

      // Set user and persist to localStorage
      setUser(dbUser as User)
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(dbUser))

      return { error: null }
    } catch (error) {
      return { error: error as Error }
    }
  }

  const signOut = async () => {
    // Sign out from Supabase Auth
    await supabase.auth.signOut()
    setUser(null)
    localStorage.removeItem(USER_STORAGE_KEY)
  }

  const value = {
    user,
    loading,
    signIn,
    signOut,
    isAuthenticated: !!user,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
