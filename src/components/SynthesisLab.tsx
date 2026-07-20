import { useState, useMemo } from 'react';
import { GitMerge, Check, X, Sprout, ArrowRight, Beaker } from 'lucide-react';
import { useIdeas, useArtifacts, synthesizeIdeas } from '../lib/hooks';
import { formatDate } from '../lib/constants';
import { WITNESS_LABELS, type Idea } from '../lib/types';

export function SynthesisLab() {
  const { ideas, refetch: refetchIdeas } = useIdeas();
  const { artifacts } = useArtifacts();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showSynth, setShowSynth] = useState(false);

  const artifactMap = useMemo(() => new Map(artifacts.map((a) => [a.id, a])), [artifacts]);

  const activeIdeas = ideas.filter((i) => i.lifecycle_status === 'active' || i.lifecycle_status === 'dormant');

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedIdeas = ideas.filter((i) => selectedIds.has(i.id));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100">Synthesis Lab</h2>
          <p className="text-sm text-slate-400 mt-1">Cross-pollinate ideas. The synthesis is itself a new organism — inheriting lineage from its parents.</p>
        </div>
        {selectedIds.size >= 2 && (
          <button
            onClick={() => setShowSynth(true)}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white transition hover:from-violet-400 hover:to-fuchsia-400"
          >
            <GitMerge className="h-4 w-4" />
            Synthesize ({selectedIds.size})
          </button>
        )}
      </div>

      {selectedIds.size > 0 && selectedIds.size < 2 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          Select at least 2 ideas to synthesize. Cross-pollination requires multiple parents.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {activeIdeas.map((idea) => {
          const isSelected = selectedIds.has(idea.id);
          const currentArtifact = idea.current_version_id ? artifactMap.get(idea.current_version_id) : null;
          return (
            <button
              key={idea.id}
              onClick={() => toggleSelect(idea.id)}
              className={`rounded-2xl border p-4 text-left transition ${
                isSelected
                  ? 'border-violet-500/50 bg-violet-500/10'
                  : 'border-slate-700/40 bg-slate-900/40 hover:border-slate-600/50 hover:bg-slate-800/40'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="text-sm font-semibold text-slate-200">{idea.title}</h3>
                <div className={`flex h-5 w-5 items-center justify-center rounded-md border transition shrink-0 ${
                  isSelected ? 'border-violet-500 bg-violet-500/20' : 'border-slate-600'
                }`}>
                  {isSelected && <Check className="h-3.5 w-3.5 text-violet-300" />}
                </div>
              </div>
              {currentArtifact && (
                <p className="text-xs text-slate-400 line-clamp-2">{currentArtifact.content || currentArtifact.title}</p>
              )}
              <div className="mt-2 text-[10px] text-slate-600">{formatDate(idea.created_at)}</div>
            </button>
          );
        })}
      </div>

      {showSynth && selectedIdeas.length >= 2 && (
        <SynthesisModal
          ideas={selectedIdeas}
          artifactMap={artifactMap}
          onClose={() => setShowSynth(false)}
          onSynthesized={() => { setShowSynth(false); setSelectedIds(new Set()); refetchIdeas(); }}
        />
      )}
    </div>
  );
}

function SynthesisModal({ ideas, artifactMap, onClose, onSynthesized }: {
  ideas: Idea[];
  artifactMap: Map<string, import('../lib/types').Artifact>;
  onClose: () => void;
  onSynthesized: () => void;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);

  const inheritedTraits = ideas.map((idea) => {
    const artifact = idea.current_version_id ? artifactMap.get(idea.current_version_id) : null;
    return {
      title: idea.title,
      content: artifact?.content ?? artifact?.title ?? '',
    };
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim() || !rationale.trim()) return;
    setBusy(true);
    await synthesizeIdeas({
      source_idea_ids: ideas.map((i) => i.id),
      source_artifact_ids: ideas.map((i) => i.current_version_id).filter(Boolean) as string[],
      title: title.trim(),
      content: content.trim(),
      rationale: rationale.trim(),
      vm_id: 'a0000000-0000-0000-0000-000000000001',
    });
    setBusy(false);
    onSynthesized();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-slate-700/50 bg-slate-900/90 p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Beaker className="h-5 w-5 text-violet-400" />
            <h3 className="text-lg font-bold text-slate-100">Synthesis Proposal</h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Inherited traits */}
        <div className="mb-4 rounded-xl border border-slate-700/40 bg-slate-950/40 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-3">Inherited from parents</div>
          <div className="space-y-3">
            {inheritedTraits.map((trait, i) => (
              <div key={i} className="flex items-start gap-2">
                <Sprout className="h-3.5 w-3.5 text-cyan-400 mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs font-medium text-slate-300">{trait.title}</div>
                  <div className="text-xs text-slate-500">{trait.content}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">Synthesis Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              placeholder="Name the new branch..."
              className="w-full rounded-xl border border-slate-700/50 bg-slate-950/60 py-2.5 px-4 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-violet-500/50"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">New Branch</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="What new organism emerges from this cross-pollination?"
              rows={4}
              className="w-full rounded-xl border border-slate-700/50 bg-slate-950/60 py-2.5 px-4 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-violet-500/50 resize-none"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">Rationale</label>
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Why does this synthesis exist? What does each parent contribute?"
              rows={2}
              className="w-full rounded-xl border border-slate-700/50 bg-slate-950/60 py-2.5 px-4 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-violet-500/50 resize-none"
            />
          </div>
          <button
            type="submit"
            disabled={busy || !title.trim() || !content.trim() || !rationale.trim()}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 py-2.5 text-sm font-semibold text-white transition hover:from-violet-400 hover:to-fuchsia-400 disabled:opacity-50"
          >
            <GitMerge className="h-4 w-4" />
            {busy ? 'Synthesizing...' : 'Create Branch'}
          </button>
        </form>
      </div>
    </div>
  );
}
