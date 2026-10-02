"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TreePalmIcon, CircleNotchIcon, EyeIcon, EyeSlashIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { api, ApiError } from "@/lib/api";
import { BUTTON_PRIMARY, FIELD, LABEL } from "@/lib/ui";

function LoginForm() {
  const router = useRouter();
  const expired = useSearchParams().has("expired");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(username, password);
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? "That username and password don't match. Check them and try again."
          : "Couldn't reach the server. Check that the backend is running."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-12">
      <div className="anim-pop w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-fg elev-1">
            <TreePalmIcon weight="fill" className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-fg">Sign in to Look</h1>
            <p className="mt-1 text-sm text-fg-muted">
              {expired ? "Your session expired. Sign in again." : "Tasks, schedule and food, in one place."}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl bg-surface p-6 elev-3" noValidate>
          <label className={`block ${LABEL}`}>
            Username
            <input
              autoFocus
              required
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              aria-invalid={!!error}
              className={`mt-1.5 h-11 w-full ${FIELD}`}
            />
          </label>
          <label className={`block ${LABEL}`}>
            Password
            <span className="relative mt-1.5 block">
              <input
                required
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? "login-error" : undefined}
                className={`h-11 w-full pr-11 ${FIELD}`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-fg-faint hover:bg-surface-2 hover:text-fg"
              >
                {showPassword ? (
                  <EyeSlashIcon className="h-4 w-4" aria-hidden />
                ) : (
                  <EyeIcon className="h-4 w-4" aria-hidden />
                )}
              </button>
            </span>
          </label>

          {error && (
            <p id="login-error" role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              <WarningCircleIcon weight="fill" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !username || !password}
            className={`h-11 w-full ${BUTTON_PRIMARY}`}
          >
            {busy && <CircleNotchIcon className="h-4 w-4 animate-spin" aria-hidden />}
            {busy ? "Signing in" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
