import { useState, type FormEvent } from "react";
import type { HubSession } from "@nest/shared";
import { Button, Field } from "../components/ui";
import type { Auth } from "../app/contexts";

export function Login({ onAuth }: { onAuth: (auth: Auth) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: data.get("id"),
          password: data.get("password"),
        }),
      });
      const json = (await response.json()) as
        | HubSession
        | { message?: string | string[] };
      if (!response.ok || !("user" in json)) {
        const rawMessage = "message" in json ? json.message : undefined;
        const message = Array.isArray(rawMessage)
          ? rawMessage.join(". ")
          : rawMessage;
        throw new Error(message || "Sign in failed");
      }
      if (!["admin", "superuser"].includes(json.user.role)) {
        await fetch("/api/auth/logout", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        throw new Error("This console is only available to administrators.");
      }
      onAuth({ user: json.user });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid min-h-screen bg-stone-50 lg:grid-cols-[1.08fr_.92fr]">
      <section className="relative hidden overflow-hidden bg-emerald-950 p-16 text-white lg:flex lg:flex-col lg:justify-center">
        <div className="absolute -right-28 -top-28 size-96 rounded-full border border-lime-200/10" />
        <div className="absolute -bottom-48 left-20 size-[34rem] rounded-full border border-lime-200/10" />
        <div className="relative max-w-xl">
          <div className="grid size-14 place-items-center rounded-2xl bg-lime-200 font-serif text-3xl text-emerald-950">
            N
          </div>
          <p className="mt-12 text-xs font-bold uppercase tracking-[.2em] text-lime-200">
            Nest Hub operations
          </p>
          <h1 className="mt-4 font-serif text-6xl leading-[1.03] tracking-tight">
            Guard the quality of shared knowledge.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-emerald-100/65">
            Review releases, manage access, and keep every published version
            trustworthy.
          </p>
        </div>
      </section>
      <section className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm">
          <p className="text-xs font-bold uppercase tracking-[.18em] text-emerald-700">
            Secure administration
          </p>
          <h2 className="mt-3 font-serif text-4xl">Administrator sign in</h2>
          <p className="mt-2 text-sm text-stone-500">
            Use your Nest Hub administrator credentials.
          </p>
          <div className="mt-8 space-y-4">
            <Field label="Account ID">
              <input
                name="id"
                className="input"
                autoComplete="username"
                required
                autoFocus
              />
            </Field>
            <Field label="Password">
              <input
                name="password"
                className="input"
                type="password"
                autoComplete="current-password"
                required
              />
            </Field>
          </div>
          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <Button className="mt-6 w-full justify-center py-3" disabled={busy}>
            {busy ? "Signing in…" : "Enter operations console"}
          </Button>
        </form>
      </section>
    </div>
  );
}
