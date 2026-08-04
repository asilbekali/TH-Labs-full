import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import Page from "../components/Page";
import { MarkDivider } from "../components/brand/LogoMark";
import { rise, stagger } from "../lib/motion";
import { useAuth } from "../lib/auth";
import { useWallet } from "../lib/wallet";
import { updateAccount } from "../lib/auth-api";

export default function Account() {
  const { user, accessToken, logout, updateUser } = useAuth();
  const { balance, planInfo } = useWallet();

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  if (!user) {
    return (
      <Page>
        <div className="card mx-auto max-w-md p-8 text-center">
          <h1 className="text-2xl font-bold text-primary">You're signed out</h1>
          <p className="mt-2 text-sm text-secondary">
            Sign in from the top bar to view and manage your account.
          </p>
          <Link
            to="/"
            className="btn-primary focusable mt-6 inline-flex px-5 py-2.5 text-sm"
          >
            Back to dashboard
          </Link>
        </div>
      </Page>
    );
  }

  const dirty = name !== user.name || email !== user.email;
  const initials = (() => {
    const src = user.name?.trim() || user.email;
    const parts = src.split(/\s+/).filter(Boolean);
    return (
      parts.length >= 2 ? parts[0][0] + parts[1][0] : src.slice(0, 2)
    ).toUpperCase();
  })();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !accessToken) return;
    setSaving(true);
    setMsg(null);
    try {
      await updateAccount(user.id, { name, email });
      updateUser({ name, email });
      setMsg({ ok: true, text: "Profile updated." });
    } catch (err) {
      updateUser({ name, email });
      setMsg({
        ok: false,
        text: err instanceof Error ? err.message : "Saved locally only.",
      });
    } finally {
      setSaving(false);
    }
  }

  const memberSince = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
      })
    : null;

  return (
    <Page className="space-y-8">
      <div>
        <SectionKicker>Account</SectionKicker>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-primary sm:text-4xl">
          Your account
        </h1>
      </div>

      <motion.div
        variants={stagger}
        initial="hidden"
        animate="show"
        className="grid gap-6 lg:grid-cols-[1.5fr_1fr]"
      >
        {/* Profile */}
        <motion.div variants={rise} className="card p-6">
          <div className="flex items-center gap-4">
            <span
              className="grid h-14 w-14 shrink-0 place-items-center rounded-full text-lg font-bold text-white shadow-md"
              style={{ background: "var(--grad-brand)" }}
            >
              {initials}
            </span>
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold text-primary">
                {user.name || "TH-Labs user"}
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex rounded-full border border-subtle bg-sunken px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand">
                  {user.role.toLowerCase()}
                </span>
                {memberSince && (
                  <span className="text-xs text-muted">
                    Member since {memberSince}
                  </span>
                )}
              </div>
            </div>
          </div>

          <form
            onSubmit={save}
            className="mt-6 space-y-4 border-t border-subtle pt-6"
          >
            <Field
              label="Full name"
              value={name}
              onChange={setName}
              type="text"
              autoComplete="name"
            />
            <Field
              label="Email"
              value={email}
              onChange={setEmail}
              type="email"
              autoComplete="email"
            />

            {msg && (
              <p
                className={`rounded-lg border px-3 py-2 text-sm ${msg.ok ? "border-success/30 bg-success/10 text-success" : "border-warn/30 bg-warn/10 text-warn"}`}
              >
                {msg.text}
              </p>
            )}

            <button
              type="submit"
              disabled={!dirty || saving}
              className="btn-primary focusable px-5 py-2.5 text-sm disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </form>
        </motion.div>

        {/* Side column */}
        <div className="space-y-6">
          <motion.div
            variants={rise}
            className="relative overflow-hidden rounded-[var(--radius-card)] p-6 text-white shadow-[var(--shadow-lg)]"
          >
            <div
              className="absolute inset-0 -z-10"
              style={{ background: "var(--grad-brand)" }}
            />
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-white/85">
              Balance
            </div>
            <div className="mt-3 text-4xl font-bold">{balance}</div>
            <div className="mt-1 text-sm text-white/85">
              credits · {planInfo.name} plan
            </div>
            <Link
              to="/plans"
              className="focusable mt-5 inline-flex rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-[rgb(24_22_41)] hover:bg-white/90"
            >
              Manage plan &amp; credits
            </Link>
          </motion.div>

          <motion.div variants={rise} className="card p-6">
            <div className="text-sm font-semibold text-primary">Session</div>
            <p className="mt-1 text-sm text-muted">Sign out of this device.</p>
            <button
              onClick={async () => {
                setLoggingOut(true);
                try {
                  await logout();
                } finally {
                  setLoggingOut(false);
                }
              }}
              disabled={loggingOut}
              className="btn-ghost focusable mt-4 inline-flex items-center gap-2 px-5 py-2.5 text-sm disabled:opacity-60"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
              {loggingOut ? "Signing out…" : "Sign out"}
            </button>
          </motion.div>
        </div>
      </motion.div>
    </Page>
  );
}

function SectionKicker({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand">
      <MarkDivider className="h-3 w-8 text-muted" />
      {children}
    </span>
  );
}

function Field({
  label,
  value,
  onChange,
  type,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="focusable w-full rounded-xl border border-subtle bg-sunken px-3.5 py-2.5 text-sm text-primary placeholder:text-muted outline-none focus:border-brand/60"
      />
    </label>
  );
}
