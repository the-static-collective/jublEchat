import { useState } from 'react';
import { Sprout, Mail, Lock, ArrowRight } from 'lucide-react';
import { useAuth } from '../lib/auth';

export function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = mode === 'signin' ? await signIn(email, password) : await signUp(email, password);
    setBusy(false);
    if (error) setError(error);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-cyan-500/5 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-violet-500/5 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-4">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-cyan-400 to-violet-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Sprout className="h-7 w-7 text-white" />
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-emerald-400 border-2 border-slate-950" />
          </div>
          <h1 className="text-2xl font-bold text-slate-100">Jubilee Workspace</h1>
          <p className="text-sm text-slate-500 mt-1">Memory substrate for evolving work</p>
        </div>

        <div className="rounded-2xl border border-slate-700/40 bg-slate-900/50 p-6 backdrop-blur-xl">
          <div className="flex gap-1 mb-6 rounded-lg bg-slate-800/40 p-1">
            <button
              onClick={() => { setMode('signin'); setError(null); }}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition ${
                mode === 'signin' ? 'bg-slate-700/60 text-slate-100' : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setMode('signup'); setError(null); }}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition ${
                mode === 'signup' ? 'bg-slate-700/60 text-slate-100' : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-400 mb-1.5 block">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-700/50 bg-slate-950/60 py-2.5 pl-10 pr-4 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-cyan-500/50 transition"
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-400 mb-1.5 block">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full rounded-xl border border-slate-700/50 bg-slate-950/60 py-2.5 pl-10 pr-4 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-cyan-500/50 transition"
                  placeholder="At least 6 characters"
                />
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-500 py-2.5 text-sm font-semibold text-white transition hover:from-cyan-400 hover:to-violet-400 disabled:opacity-50"
            >
              {busy ? 'Please wait...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
              {!busy && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-600 mt-4">
          Every transformation is witnessed, capability-bound, and accountable.
        </p>
      </div>
    </div>
  );
}
