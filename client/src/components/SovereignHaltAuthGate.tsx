import { Cpu, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState, type FormEvent } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import SovereignHaltDashboard from "@/pages/SovereignHaltDashboard";

type GateState = "checking" | "signed_out" | "sending" | "link_sent" | "unconfigured";

export default function SovereignHaltAuthGate() {
  const [session, setSession] = useState<Session | null>(null);
  const [gateState, setGateState] = useState<GateState>("checking");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const configured = Boolean(isSupabaseConfigured && supabase);

  useEffect(() => {
    if (!configured || !supabase) {
      setGateState("unconfigured");
      return;
    }

    let active = true;
    const client = supabase;
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setGateState(nextSession ? "checking" : "signed_out");
    });

    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      setSession(data.session);
      setGateState(error ? "signed_out" : data.session ? "checking" : "signed_out");
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [configured]);

  const requestLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !email.trim()) return;
    setMessage("");
    setGateState("sending");

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: window.location.origin,
      },
    });

    if (error) {
      setMessage("The sign-in link could not be sent. Check that this email has been provisioned in Supabase Auth.");
      setGateState("signed_out");
      return;
    }
    setGateState("link_sent");
    setMessage("If the account is provisioned, a one-time sign-in link has been sent.");
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    setGateState("signed_out");
  };

  if (session) {
    return (
      <SovereignHaltDashboard
        accessToken={session.access_token}
        userEmail={session.user.email ?? email}
        onSignOut={() => void signOut()}
      />
    );
  }

  return (
    <main className="sh-auth-page">
      <section className="sh-auth-card" aria-labelledby="sh-auth-title">
        <div className="sh-auth-topline"><span><i /> PRIVATE WORKSPACE</span><span>AUTH GATE / 01</span></div>
        <div className="sh-auth-brand">
          <span className="sh-chip-mark"><Cpu size={25} strokeWidth={1.7} /></span>
          <div><strong>SOVEREIGNHALT</strong><small>RUNTIME OBSERVABILITY / CONTROL SURFACE</small></div>
        </div>
        <div className="sh-auth-rule" />
        <div className="sh-auth-copy">
          <span className="sh-auth-kicker"><ShieldCheck size={14} /> AUTHENTICATION REQUIRED</span>
          <h1 id="sh-auth-title">Private agent telemetry.</h1>
          <p>Sign in with a provisioned Supabase account. Workspace data is released only to the server allowlist.</p>
        </div>

        {gateState === "checking" ? (
          <div className="sh-auth-message" role="status"><i /> VERIFYING AUTHENTICATED SESSION</div>
        ) : gateState === "unconfigured" ? (
          <div className="sh-auth-message is-error" role="alert">Private Supabase Auth is not configured for this deployment. No telemetry is shown.</div>
        ) : (
          <form className="sh-auth-form" onSubmit={requestLink}>
            <label htmlFor="sh-auth-email">AUTHORIZED EMAIL</label>
            <div className="sh-auth-input-wrap">
              <Mail size={16} aria-hidden="true" />
              <input
                id="sh-auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                placeholder="name@organization.com"
                required
              />
            </div>
            <button type="submit" disabled={gateState === "sending"}>
              {gateState === "sending" ? "REQUESTING LINK…" : "SEND SECURE SIGN-IN LINK"}
            </button>
            {message && <p className={`sh-auth-message ${gateState === "signed_out" && message.startsWith("The") ? "is-error" : ""}`} role={gateState === "link_sent" ? "status" : "alert"}>{message}</p>}
          </form>
        )}

        <div className="sh-auth-private-note"><LockKeyhole size={13} /> PRIVATE / ALLOWLISTED USERS ONLY</div>
      </section>
    </main>
  );
}
