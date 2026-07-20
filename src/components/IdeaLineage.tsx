import { useState, useMemo } from 'react';
import { Sprout, ArrowUp, GitBranch, Star, X, Search, Plus, Leaf, Recycle, Moon, Check } from 'lucide-react';
import { useIdeas, useIdeaVersions, useArtifacts, useEvents, createIdea, evolveIdea, updateIdeaLifecycle } from '../lib/hooks';
import { formatDate } from '../lib/constants';
import { WITNESS_LABELS, type Idea, type LifecycleStatus } from '../lib/types';

const LIFECYCLE_META: Record<LifecycleStatus, { label: string; color: string; icon: typeof Leaf }> = {
  active: { label: 'Active', color: '#10b981', icon: Leaf },
  dormant: { label: 'Dormant', color: '#64748b', icon: Moon },
  merged: { label: 'Merged', color: '#8b5cf6', icon: GitBranch },
  abandoned: { label: 'Composted', color: '#f59e0b', icon: Recycle },
};

export function IdeaLineage() {
  const { ideas, refetch: refetchIdeas } = useIdeas();
  const { artifacts } = useArtifacts();
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showCapture, setShowCapture] = useState(false);
  const [evolving, setEvolving] = useState(false);

  const artifactMap = useMemo(() => new Map(artifacts.map((a) => [a.id, a])), [artifacts]);
  const selectedIdea = selectedIdeaId ? ideas.find((i) => i.id === selectedIdeaId) : null;

  const filteredIdeas = ideas.filter((i) =>
    !search || i.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100">Idea Lineage</h2>
          <p className="text-sm text-slate-400 mt-1">Ideas are not documents. They are organisms. This is where you watch them grow.</p>
        </div>
        <button
          onClick={() => setShowCapture(true)}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-500 px-4 py-2 text-sm font-semibold text-white transition hover:from-cyan-400 hover:to-violet-400"
        >
          <Plus className="h-4 w-4" />
          Capture Idea
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find an idea..."
              className="w-full rounded-xl border border-slate-700/50 bg-slate-900/60 py-2.5 pl-10 pr-4 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500/50"
            />
          </div>

          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
            {filteredIdeas.map((idea) => {
              const meta = LIFECYCLE_META[idea.lifecycle_status];
              const Icon = meta.icon;
              const isSelected = selectedIdeaId === idea.id;
              return (
                <button
                  key={idea.id}
                  onClick={() => setSelectedIdeaId(idea.id)}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    isSelected
                      ? 'border-cyan-500/50 bg-cyan-500/10'
                      : 'border-slate-700/40 bg-slate-900/40 hover:border-slate-600/50 hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
                    <span className="text-sm font-medium text-slate-200 truncate">{idea.title}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="text-[10px] flex items-center gap-1" style={{ color: meta.color }}>
                      <Icon className="h-3 w-3" />
                      {meta.label}
                    </span>
                    <span className="text-[10px] text-slate-600">{formatDate(idea.created_at)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-2">
          {!selectedIdea ? (
            <div className="flex h-full min-h-[400px] items-center justify-center rounded-2xl border border-slate-700/40 bg-slate-900/30">
              <div className="text-center">
                <Sprout className="mx-auto h-10 w-10 text-slate-600 mb-3" />
                <p className="text-sm text-slate-500">Select an idea to see its lineage.</p>
                <p className="text-xs text-slate-600 mt-1">The current state, its ancestors, and the branches that didn't make it.</p>
              </div>
            </div>
          ) : (
            <LineageView
              idea={selectedIdea}
              artifacts={artifacts}
              artifactMap={artifactMap}
              onEvolve={() => setEvolving(true)}
              onSetLifecycle={(status) => updateIdeaLifecycle(selectedIdea.id, status).then(refetchIdeas)}
            />
          )}
        </div>
      </div>

      {showCapture && (
        <CaptureModal onClose={() => setShowCapture(false)} onCreated={(id) => { setShowCapture(false); refetchIdeas(); setSelectedIdeaId(id); }} />
      )}

      {evolving && selectedIdea && (
        <EvolveModal
          idea={selectedIdea}
          currentArtifact={selectedIdea.current_version_id ? artifactMap.get(selectedIdea.current_version_id) : null}
          onClose={() => setEvolving(false)}
          onEvolved={() => { setEvolving(false); refetchIdeas(); }}
        />
      )}
    </div>
  );
}

function LineageView({ idea, artifacts, artifactMap, onEvolve, onSetLifecycle }: {
  idea: Idea;
  artifacts: import('../lib/types').Artifact[];
  artifactMap: Map<string, import('../lib/types').Artifact>;
  onEvolve: () => void;
  onSetLifecycle: (status: LifecycleStatus) => void;
}) {
  const { versions } = useIdeaVersions(idea.id);
  const { events } = useEvents(idea.id);
  const meta = LIFECYCLE_META[idea.lifecycle_status];

  const lineageVersions = useMemo(() => {
    return versions
      .map((v) => ({ ...v, artifact: artifactMap.get(v.artifact_id) }))
      .filter((v) => v.artifact)
      .sort((a, b) => b.version_number - a.version_number);
  }, [versions, artifactMap]);

  const rationaleEvents = events.filter((e) => e.rationale);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-700/40 bg-slate-900/50 p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="h-3 w-3 rounded-full" style={{ backgroundColor: meta.color }} />
              <span className="text-xs font-medium" style={{ color: meta.color }}>{meta.label}</span>
            </div>
            <h3 className="text-xl font-bold text-slate-100">{idea.title}</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onEvolve}
              className="flex items-center gap-1.5 rounded-lg bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-500/30"
            >
              <ArrowUp className="h-3.5 w-3.5" />
              Evolve
            </button>
          </div>
        </div>

        {/* Current version */}
        {lineageVersions[0] && (
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 mb-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-cyan-400 mb-2">Current — v{lineageVersions[0].version_number}</div>
            <p className="text-sm text-slate-200">{lineageVersions[0].artifact?.content || lineageVersions[0].artifact?.title}</p>
            <div className="mt-2 text-[10px] text-slate-500">{formatDate(lineageVersions[0].artifact?.created_at ?? '')}</div>
          </div>
        )}

        {/* Ancestry */}
        {lineageVersions.length > 1 && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-3">Ancestry</div>
            <div className="space-y-0">
              {lineageVersions.slice(1).map((v, i) => (
                <div key={v.id} className="relative pl-6 pb-4 last:pb-0">
                  <div className="absolute left-2 top-0 bottom-0 w-px bg-slate-700/50" style={{ height: i === lineageVersions.length - 2 ? '0' : undefined }} />
                  <div className="absolute left-0 top-1 h-4 w-4 rounded-full border-2 border-slate-700 bg-slate-900" />
                  <div className="ml-2">
                    <div className="text-xs text-slate-500 mb-0.5">v{v.version_number}</div>
                    <p className="text-sm text-slate-400">{v.artifact?.content || v.artifact?.title}</p>
                    <div className="text-[10px] text-slate-600 mt-0.5">{formatDate(v.artifact?.created_at ?? '')}</div>
                  </div>
                  <div className="ml-2 mt-1 flex items-center gap-1 text-[10px] text-slate-600">
                    <ArrowUp className="h-3 w-3" />
                    evolved from
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Rationale events */}
        {rationaleEvents.length > 0 && (
          <div className="mt-4 rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-violet-400 mb-2">Decision Rationale</div>
            <div className="space-y-2">
              {rationaleEvents.map((e) => (
                <div key={e.id} className="border-l-2 pl-3" style={{ borderColor: WITNESS_LABELS[e.witness_strength]?.color ?? '#64748b' }}>
                  <p className="text-sm text-slate-300 italic">{e.rationale}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-slate-500">{e.event_type.replace(/_/g, ' ')}</span>
                    <span className="text-[9px] font-mono" style={{ color: WITNESS_LABELS[e.witness_strength]?.color }}>
                      {WITNESS_LABELS[e.witness_strength]?.stars}
                    </span>
                    <span className="text-[10px] text-slate-600">{formatDate(e.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Lifecycle controls */}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-700/40 pt-4">
          <span className="text-[10px] text-slate-500 self-center mr-2">Lifecycle:</span>
          {(['active', 'dormant', 'merged', 'abandoned'] as LifecycleStatus[]).map((s) => {
            const m = LIFECYCLE_META[s];
            const Icon = m.icon;
            const isCurrent = idea.lifecycle_status === s;
            return (
              <button
                key={s}
                onClick={() => onSetLifecycle(s)}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-medium transition ${
                  isCurrent ? 'border' : 'border border-transparent hover:bg-slate-800/40'
                }`}
                style={isCurrent ? { color: m.color, borderColor: m.color + '40', backgroundColor: m.color + '10' } : { color: '#94a3b8' }}
              >
                <Icon className="h-3 w-3" />
                {m.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CaptureModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    const { idea } = await createIdea({ title: title.trim(), content: content.trim(), vm_id: 'a0000000-0000-0000-0000-000000000001' });
    setBusy(false);
    if (idea) onCreated(idea.id);
  };

  return (
    <Modal onClose={onClose} title="Capture as Idea">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs font-medium text-slate-400 mb-1.5 block">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            placeholder="Name this idea..."
            className="w-full rounded-xl border border-slate-700/50 bg-slate-950/60 py-2.5 px-4 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-cyan-500/50"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-400 mb-1.5 block">Core</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What is the essence of this idea?"
            rows={4}
            className="w-full rounded-xl border border-slate-700/50 bg-slate-950/60 py-2.5 px-4 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-cyan-500/50 resize-none"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !title.trim()}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-500 py-2.5 text-sm font-semibold text-white transition hover:from-cyan-400 hover:to-violet-400 disabled:opacity-50"
        >
          <Sprout className="h-4 w-4" />
          {busy ? 'Planting...' : 'Seed Idea'}
        </button>
      </form>
    </Modal>
  );
}

function EvolveModal({ idea, currentArtifact, onClose, onEvolved }: {
  idea: Idea;
  currentArtifact: import('../lib/types').Artifact | null | undefined;
  onClose: () => void;
  onEvolved: () => void;
}) {
  const [content, setContent] = useState('');
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || !rationale.trim() || !currentArtifact) return;
    setBusy(true);
    await evolveIdea({
      idea_id: idea.id,
      current_artifact_id: currentArtifact.id,
      new_content: content.trim(),
      rationale: rationale.trim(),
      vm_id: currentArtifact.vm_id,
    });
    setBusy(false);
    onEvolved();
  };

  return (
    <Modal onClose={onClose} title={`Evolve: ${idea.title}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {currentArtifact && (
          <div className="rounded-lg bg-slate-800/40 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Current</div>
            <p className="text-sm text-slate-400">{currentArtifact.content || currentArtifact.title}</p>
          </div>
        )}
        <div>
          <label className="text-xs font-medium text-slate-400 mb-1.5 block">New Version</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            autoFocus
            placeholder="How has this idea evolved?"
            rows={4}
            className="w-full rounded-xl border border-slate-700/50 bg-slate-950/60 py-2.5 px-4 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-cyan-500/50 resize-none"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-400 mb-1.5 block">Rationale</label>
          <textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="Why does this new version exist? What changed in your understanding?"
            rows={2}
            className="w-full rounded-xl border border-slate-700/50 bg-slate-950/60 py-2.5 px-4 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-cyan-500/50 resize-none"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !content.trim() || !rationale.trim()}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-500 py-2.5 text-sm font-semibold text-white transition hover:from-cyan-400 hover:to-violet-400 disabled:opacity-50"
        >
          <ArrowUp className="h-4 w-4" />
          {busy ? 'Evolving...' : 'Create New Version'}
        </button>
      </form>
    </Modal>
  );
}

function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-slate-700/50 bg-slate-900/90 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-100">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
