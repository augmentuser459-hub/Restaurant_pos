import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { supabase, AUTH_STORAGE_KEY } from '../lib/supabase'
import { authService, authErrorMessage } from '../services/auth.service'
import { User } from '../types/database.types'

interface AuthContextType {
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  isAuthenticated: boolean
  /** Why the app ended or couldn't restore the session (inactive account, connection problem...). */
  authMessage: string | null
  clearAuthMessage: () => void
  /** Re-reads the signed-in user's profile (e.g. after the admin edited their own account). */
  refreshProfile: () => Promise<void>
  /** True after the user pressed "logout": the next person to sign in starts on their own home page. */
  signedOutByUser: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// Cached user object written by older builds (it held password hashes and was trusted blindly). Removed on load.
const LEGACY_USER_STORAGE_KEY = 'restaurant_user'

// Re-check the profile (status, role, branch) at most this often when the tab regains focus
const PROFILE_RECHECK_MS = 60_000

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [authMessage, setAuthMessage] = useState<string | null>(null)
  const [signedOutByUser, setSignedOutByUser] = useState(false)

  const userRef = useRef<User | null>(null)
  // Every profile load takes a number; only the latest one may change state (sign-out cancels the rest)
  const loadSeq = useRef(0)
  const lastCheckAt = useRef(0)
  // signIn() checks the profile itself; the SIGNED_IN event it causes is ignored meanwhile
  const signingIn = useRef(false)
  // A sign-out still talking to the server: a new sign-in waits for it, or it would remove the new session
  const pendingSignOut = useRef<Promise<void> | null>(null)

  const applyUser = useCallback((next: User | null) => {
    userRef.current = next
    setUser(next)
  }, [])

  // Ends the local session (used when the account may not use the app, or on logout)
  const endSession = useCallback(async (message: string | null) => {
    loadSeq.current++
    applyUser(null)
    setAuthMessage(message)
    const run = (async () => {
      let failed = false
      try {
        failed = !!(await supabase.auth.signOut({ scope: 'local' })).error
      } catch {
        failed = true
      }
      if (failed) {
        // supabase-js keeps the stored session when the server can't be reached; drop it anyway
        try {
          localStorage.removeItem(AUTH_STORAGE_KEY)
        } catch {
          // storage unavailable: nothing persisted to clear
        }
      }
    })()
    pendingSignOut.current = run
    try {
      await run
    } finally {
      if (pendingSignOut.current === run) pendingSignOut.current = null
    }
  }, [applyUser])

  // Loads the profile for userId. `silent`: a background re-check that keeps the current user on network errors.
  const loadProfile = useCallback(async (userId: string, silent: boolean) => {
    const seq = ++loadSeq.current
    const result = await authService.loadProfile(userId)
    if (seq !== loadSeq.current) return
    lastCheckAt.current = Date.now()

    if (result.status === 'ok') {
      setSignedOutByUser(false)
      applyUser(result.user)
    } else if (result.status === 'denied') {
      await endSession(result.message)
    } else if (!silent || !userRef.current) {
      // Couldn't load (offline / server error): keep the stored session so a reload can restore it
      applyUser(null)
      setAuthMessage(result.message)
    }
    setLoading(false)
  }, [applyUser, endSession])

  const handleAuthEvent = useCallback(async (event: AuthChangeEvent, session: Session | null) => {
    if (signingIn.current && event === 'SIGNED_IN') return

    if (!session) {
      // A late notice from an earlier sign-out, after someone already signed in again: ignore it
      if (event === 'SIGNED_OUT') {
        const { data } = await supabase.auth.getSession()
        if (data.session) return
      }
      // Signed out from outside this screen (another tab, or the session was revoked/expired):
      // our own sign-outs clear the user before Supabase reports it
      if (userRef.current) setAuthMessage('انتهت الجلسة، سجّل الدخول مرة أخرى')
      loadSeq.current++
      applyUser(null)
      setLoading(false)
      return
    }

    if (event === 'INITIAL_SESSION') {
      // A session restored from storage: confirm it with the Auth server before trusting its user id
      const seq = loadSeq.current
      const { data, error } = await supabase.auth.getUser()
      if (seq !== loadSeq.current) return
      if (error || !data.user) {
        if (error && (error.name === 'AuthRetryableFetchError' || error.status === 0)) {
          applyUser(null)
          setAuthMessage('تعذر الاتصال بالخادم، تحقق من الاتصال بالإنترنت ثم أعد تحميل الصفحة')
          setLoading(false)
        } else {
          await endSession('انتهت الجلسة، سجّل الدخول مرة أخرى')
          setLoading(false)
        }
        return
      }
      await loadProfile(data.user.id, false)
      return
    }

    // SIGNED_IN (also sent when the tab is reopened), TOKEN_REFRESHED, USER_UPDATED: re-check the profile
    // so a deactivated user, or a role/branch change, takes effect without logging out
    const sameUser = userRef.current?.id === session.user.id
    if (sameUser && Date.now() - lastCheckAt.current < PROFILE_RECHECK_MS && event !== 'USER_UPDATED') return
    await loadProfile(session.user.id, sameUser)
  }, [applyUser, endSession, loadProfile])

  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_USER_STORAGE_KEY)
    } catch {
      // storage unavailable
    }

    // Supabase emits INITIAL_SESSION right after subscribing, then every sign-in/refresh/sign-out (all tabs).
    // The callback must not await Supabase calls (it runs inside the auth lock), so the work is deferred.
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setTimeout(() => {
        void handleAuthEvent(event, session)
      }, 0)
    })
    return () => data.subscription.unsubscribe()
  }, [handleAuthEvent])

  const signIn = async (email: string, password: string) => {
    signingIn.current = true
    setAuthMessage(null)
    try {
      if (pendingSignOut.current) await pendingSignOut.current
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      if (error || !data.user) {
        return { error: new Error(authErrorMessage(error)) }
      }

      const seq = ++loadSeq.current
      const result = await authService.loadProfile(data.user.id)
      if (result.status === 'ok') {
        if (seq === loadSeq.current) {
          lastCheckAt.current = Date.now()
          setSignedOutByUser(false)
          applyUser(result.user)
          setLoading(false)
        }
        return { error: null }
      }

      // Valid password but the account may not use the app (inactive / no staff profile) or the profile
      // couldn't be loaded: don't stay half signed in
      await endSession(null)
      return { error: new Error(result.message) }
    } catch (error) {
      return { error: new Error(authErrorMessage(error)) }
    } finally {
      signingIn.current = false
    }
  }

  const signOut = async () => {
    // Set together with clearing the user (same render), so the login redirect doesn't remember this page
    setSignedOutByUser(true)
    await endSession(null)
  }

  const refreshProfile = useCallback(async () => {
    const current = userRef.current
    if (current) await loadProfile(current.id, true)
  }, [loadProfile])

  const clearAuthMessage = useCallback(() => setAuthMessage(null), [])

  const value = {
    user,
    loading,
    signIn,
    signOut,
    isAuthenticated: !!user,
    authMessage,
    clearAuthMessage,
    refreshProfile,
    signedOutByUser,
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
