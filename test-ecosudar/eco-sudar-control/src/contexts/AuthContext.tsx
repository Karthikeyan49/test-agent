import React, { createContext, useContext, useState, useEffect } from "react";
import { apiFetch, BASE_URL } from "@/lib/api/client";

const SESSION_DURATION = 24 * 60 * 60 * 1000;
const STORAGE_KEY = "eco_admin_auth";

export type AuthRole = "admin" | "dealer";

interface AuthContextType {
  isAuthenticated: boolean;
  loading: boolean;
  adminEmail: string;
  userName: string;
  role: AuthRole | null;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

interface LoginResponse {
  success: boolean;
  data: {
    token: string;
    refresh_token: string;
    user: {
      email: string;
      name?: string;
      user_type: string;
    };
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [role, setRole] = useState<AuthRole | null>(null);
  const [loading, setLoading] = useState(true); // true until session is resolved

  const clearAuth = () => {
    setIsAuthenticated(false);
    setAdminEmail("");
    setUserName("");
    setRole(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  const applySession = (data: Record<string, string>) => {
    setIsAuthenticated(true);
    setAdminEmail(data.email || "");
    setUserName(data.name || "");
    setRole((data.role as AuthRole) || "admin");
  };

  // Attempt to renew session using the stored refresh token
  const tryRestore = async (stored: Record<string, string>) => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Client-Type": "web" },
        body: JSON.stringify({ refresh_token: stored.refresh_token }),
      });
      if (!res.ok) throw new Error("refresh failed");
      const json = await res.json();
      if (!json.success || !json.data?.token) throw new Error("bad response");

      const updated = {
        ...stored,
        token: json.data.token,
        refresh_token: json.data.refresh_token,
        expires_at: String(Date.now() + SESSION_DURATION),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      applySession(updated);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  // Restore session on page load
  useEffect(() => {
    const init = async () => {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { setLoading(false); return; }

      try {
        const data = JSON.parse(raw);
        if (data.token && data.expires_at && Date.now() < Number(data.expires_at)) {
          applySession(data);
        } else if (data.refresh_token) {
          await tryRestore(data);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }

      setLoading(false);
    };

    init();
  }, []);

  // Listen for 401 responses dispatched by apiFetch (refresh also failed)
  useEffect(() => {
    const handler = () => clearAuth();
    window.addEventListener("eco:auth-expired", handler);
    return () => window.removeEventListener("eco:auth-expired", handler);
  }, []);

  const login = async (email: string, password: string): Promise<boolean> => {
    try {
      // Accept either an email or a phone number as the identifier (dealers often use phone).
      const identifier = email.trim();
      const credentials = identifier.includes("@")
        ? { email: identifier, password }
        : { phone: identifier, password };
      const response = await apiFetch<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify(credentials),
      });

      const type = response?.data?.user?.user_type?.toLowerCase();
      if (response?.success && (type === "admin" || type === "dealer")) {
        const session = {
          email: response.data.user.email,
          name: response.data.user.name || "",
          role: type as AuthRole,
          token: response.data.token,
          refresh_token: response.data.refresh_token,
          expires_at: Date.now() + SESSION_DURATION,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
        applySession({ ...session, expires_at: String(session.expires_at) });
        return true;
      }
      return false;
    } catch (error) {
      console.error("Login Error:", error);
      return false;
    }
  };

  const logout = () => {
    apiFetch("/auth/logout", { method: "POST" }).catch(() => {});
    clearAuth();
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, loading, adminEmail, userName, role, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
