import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";
import type { AuthUser } from "@secure-viewer/shared";
import { api, setApiToken } from "../lib/api";

const TOKEN_KEY = "secure-viewer-token";

type AuthContextValue = {
  token: string | null;
  user: AuthUser | null;
  setSession: (token: string, user: AuthUser) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    setApiToken(token);
  }, [token]);

  useEffect(() => {
    if (!token) {
      setUser(null);
      return;
    }

    void refreshUserInternal(token, setUser, () => {
      localStorage.removeItem(TOKEN_KEY);
      setToken(null);
    });
  }, [token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      setSession(nextToken, nextUser) {
        localStorage.setItem(TOKEN_KEY, nextToken);
        setToken(nextToken);
        setUser(nextUser);
      },
      logout() {
        if (token) {
          void api.post("/api/auth/logout").catch(() => undefined);
        }
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
        setApiToken(null);
      },
      async refreshUser() {
        if (!token) {
          return;
        }
        await refreshUserInternal(token, setUser, () => {
          localStorage.removeItem(TOKEN_KEY);
          setToken(null);
        });
      },
    }),
    [token, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

async function refreshUserInternal(
  token: string,
  setUser: (user: AuthUser | null) => void,
  onInvalid: () => void,
) {
  try {
    setApiToken(token);
    const response = await api.get<{ user: AuthUser }>("/api/auth/me");
    setUser(response.data.user);
  } catch {
    onInvalid();
    setUser(null);
  }
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
