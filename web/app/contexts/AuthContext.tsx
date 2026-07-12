'use client';

import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import { ApiClient } from '@/lib/apiClient';
import type { MembershipInfo, EntitlementsSummary } from '@/lib/membershipDisplay';
import { routing, type Locale } from '@/i18n/routing';

interface User {
  id: string;
  email: string;
  created_at?: string;
  display_name?: string | null;
  avatar_url?: string | null;
}

const EMPTY_MEMBERSHIP: MembershipInfo = {
  tier: 'free',
  interval: null,
  status: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: null,
};

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  accountLanguage: Locale | null;
  membership: MembershipInfo;
  entitlements: EntitlementsSummary | null;
  membershipLoading: boolean;
  refreshMembership: () => Promise<void>;
  refreshUser: () => Promise<void>;
  login: (email: string, password: string) => Promise<Locale | undefined>;
  setPreferredLocale: (loc: Locale | null) => void;
  signup: (email: string, password: string, inviteCode?: string) => Promise<void>;
  loginWithGoogle: (idToken: string, opts?: { inviteCode?: string; locale?: string }) => Promise<{ isNew: boolean }>;
  loginWithApple: (idToken: string, opts?: { inviteCode?: string; locale?: string; fullName?: string }) => Promise<{ isNew: boolean }>;
  logout: () => void;
  api: ApiClient;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'gedo_auth_token';
// Client-side cache of the logged-in user's preferred UI language. Survives the
// [locale] layout remount that a language switch triggers, and page reloads, so
// the in-app locale can follow the account setting without a network round-trip.
const PREF_LOCALE_KEY = 'gedo_pref_locale';

function normalizeLocale(lang: unknown): Locale | undefined {
  return typeof lang === 'string' && (routing.locales as readonly string[]).includes(lang)
    ? (lang as Locale)
    : undefined;
}

function readPrefLocale(): Locale | null {
  if (typeof window === 'undefined') return null;
  try {
    return normalizeLocale(localStorage.getItem(PREF_LOCALE_KEY)) ?? null;
  } catch {
    return null;
  }
}

function parseMembership(data: Partial<MembershipInfo>): MembershipInfo {
  return {
    tier: data.tier === 'pro' || data.tier === 'ultra' ? data.tier : 'free',
    interval:
      data.interval === 'monthly' || data.interval === 'yearly'
        ? data.interval
        : null,
    status: typeof data.status === 'string' ? data.status : null,
    currentPeriodEnd:
      typeof data.currentPeriodEnd === 'number' ? data.currentPeriodEnd : null,
    cancelAtPeriodEnd:
      typeof data.cancelAtPeriodEnd === 'boolean' ? data.cancelAtPeriodEnd : null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [membership, setMembership] = useState<MembershipInfo>(EMPTY_MEMBERSHIP);
  const [entitlements, setEntitlements] = useState<EntitlementsSummary | null>(null);
  const [membershipLoading, setMembershipLoading] = useState(false);
  const [accountLanguage, setAccountLanguageState] = useState<Locale | null>(null);

  // Set/clear the preferred UI language: updates React state and the localStorage
  // cache in one place. The app shell reads accountLanguage to keep the in-app
  // [locale] aligned with the account setting.
  const setPreferredLocale = useCallback((loc: Locale | null) => {
    setAccountLanguageState(loc);
    try {
      if (loc) localStorage.setItem(PREF_LOCALE_KEY, loc);
      else localStorage.removeItem(PREF_LOCALE_KEY);
    } catch { /* ignore */ }
  }, []);

  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;
  const userEmailRef = useRef<string | undefined>(undefined);
  userEmailRef.current = user?.email;

  const api = useMemo(
    () => new ApiClient({ getToken: () => tokenRef.current }),
    [],
  );

  const refreshMembership = useCallback(async () => {
    const currentToken = tokenRef.current;
    if (!currentToken) {
      setMembership(EMPTY_MEMBERSHIP);
      setEntitlements(null);
      return;
    }
    setMembershipLoading(true);
    try {
      const [billingRes, entRes] = await Promise.allSettled([
        api.getBillingStatus(),
        api.getEntitlements(),
      ]);

      if (billingRes.status === 'fulfilled') {
        setMembership(parseMembership(billingRes.value));
      } else {
        const email = userEmailRef.current?.trim();
        if (email) {
          try {
            const res = await fetch(
              `/api/stripe/billing-status?email=${encodeURIComponent(email)}`,
              { headers: { Authorization: `Bearer ${currentToken}` } },
            );
            if (res.ok) {
              setMembership(parseMembership((await res.json()) as Partial<MembershipInfo>));
            } else {
              setMembership(EMPTY_MEMBERSHIP);
            }
          } catch {
            setMembership(EMPTY_MEMBERSHIP);
          }
        } else {
          setMembership(EMPTY_MEMBERSHIP);
        }
      }

      if (entRes.status === 'fulfilled') {
        setEntitlements(entRes.value);
      } else {
        setEntitlements(null);
      }
    } catch {
      setMembership(EMPTY_MEMBERSHIP);
      setEntitlements(null);
    } finally {
      setMembershipLoading(false);
    }
  }, [api]);

  const refreshMembershipRef = useRef(refreshMembership);
  refreshMembershipRef.current = refreshMembership;
  const membershipInflightRef = useRef(false);

  const runRefreshMembership = useCallback(async () => {
    if (membershipInflightRef.current) return;
    membershipInflightRef.current = true;
    try {
      await refreshMembershipRef.current();
    } finally {
      membershipInflightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (token) {
      void runRefreshMembership();
    } else {
      setMembership(EMPTY_MEMBERSHIP);
      setEntitlements(null);
    }
  }, [token, user?.email, runRefreshMembership]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && tokenRef.current && userEmailRef.current) {
        void runRefreshMembership();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    const pref = readPrefLocale();
    if (pref) setAccountLanguageState(pref);
    const savedToken = localStorage.getItem(TOKEN_KEY);
    if (savedToken) {
      setToken(savedToken);
      const client = new ApiClient({ getToken: () => savedToken });
      client
        .me()
        .then(async (userData) => {
          setUser(userData);
          // Seed the account language from the server only when this browser has
          // no cached preference yet (e.g. first load, or signed in elsewhere).
          if (!pref) {
            try {
              const s = await client.getSettings();
              const loc = normalizeLocale(s?.language);
              if (loc) setPreferredLocale(loc);
            } catch { /* ignore */ }
          }
        })
        .catch(() => {
          localStorage.removeItem(TOKEN_KEY);
          setToken(null);
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else {
      setIsLoading(false);
    }
  }, [setPreferredLocale]);

  const refreshUser = useCallback(async () => {
    try {
      const saved = localStorage.getItem(TOKEN_KEY);
      if (!saved) return;
      const client = new ApiClient({ getToken: () => saved });
      const u = await client.me();
      setUser(u);
    } catch { /* ignore */ }
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<Locale | undefined> => {
    const client = new ApiClient();
    const result = await client.login(email, password);
    setToken(result.token);
    setUser(result.user);
    localStorage.setItem(TOKEN_KEY, result.token);
    try {
      const authed = new ApiClient({ getToken: () => result.token });
      const s = await authed.getSettings();
      const loc = normalizeLocale(s?.language);
      if (loc) setPreferredLocale(loc);
      return loc;
    } catch {
      return undefined;
    }
  }, [setPreferredLocale]);

  const signup = useCallback(async (email: string, password: string, inviteCode?: string) => {
    const client = new ApiClient();
    const result = await client.signup(email, password, inviteCode);
    setToken(result.token);
    setUser(result.user);
    localStorage.setItem(TOKEN_KEY, result.token);
  }, []);

  // Social login shares the password-login session wiring; the ID token is
  // verified server-side. A brand-new account adopts the locale it signed up in;
  // a returning account keeps (and applies) whatever language it already stored.
  const applySocialSession = useCallback(
    async (result: { token: string; user: User; is_new?: boolean }, locale?: string): Promise<{ isNew: boolean }> => {
      setToken(result.token);
      setUser(result.user);
      localStorage.setItem(TOKEN_KEY, result.token);
      const authed = new ApiClient({ getToken: () => result.token });
      if (result.is_new) {
        const loc = normalizeLocale(locale);
        if (loc) {
          setPreferredLocale(loc);
          try { await authed.updateSettings({ language: loc }); } catch { /* best-effort */ }
        }
      } else {
        try {
          const s = await authed.getSettings();
          const loc = normalizeLocale(s?.language);
          if (loc) setPreferredLocale(loc);
        } catch { /* ignore */ }
      }
      return { isNew: !!result.is_new };
    },
    [setPreferredLocale],
  );

  const loginWithGoogle = useCallback(
    async (idToken: string, opts?: { inviteCode?: string; locale?: string }) => {
      const result = await new ApiClient().loginWithGoogle(idToken, opts);
      return applySocialSession(result, opts?.locale);
    },
    [applySocialSession],
  );

  const loginWithApple = useCallback(
    async (idToken: string, opts?: { inviteCode?: string; locale?: string; fullName?: string }) => {
      const result = await new ApiClient().loginWithApple(idToken, opts);
      return applySocialSession(result, opts?.locale);
    },
    [applySocialSession],
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setMembership(EMPTY_MEMBERSHIP);
    setEntitlements(null);
    localStorage.removeItem(TOKEN_KEY);
    setPreferredLocale(null);
  }, [setPreferredLocale]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated: !!user && !!token,
        accountLanguage,
        membership,
        entitlements,
        membershipLoading,
        refreshMembership,
        refreshUser,
        login,
        setPreferredLocale,
        signup,
        loginWithGoogle,
        loginWithApple,
        logout,
        api,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
