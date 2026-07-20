import { useState } from 'react';
import { GitBranch, Check, X, ArrowRight, Brain, Clock, Shield, Fingerprint, FileSignature, ScrollText, Eye, Star, MessageSquare } from 'lucide-react';
import { useTransformations, useArtifacts, useProposals, resolveTransformation, createArtifact, createEdge } from '../lib/hooks';
import { TRANSFORM_KINDS, getTransformKindMeta, getTransformStatusMeta, formatConfidence, formatDate } from '../lib/constants';
import type { Transformation, WITNESS_LABELS } from '../lib/types';
import { WITNESS_LABELS as WL } from '../lib/types';

export function MutationChamber() {
  const { transformations, refetch } = useTransformations();
  const { artifacts, refetch: refetchArtifacts } = useArtifacts();
  const { proposals, refetch: refetchProposals } = useProposals();
  const [filter, setFilter] = useState<'all' | 'proposed' | 'accepted' | 'rejected'>('proposed');
  const [rationaleMap, setRationaleMap] = useState<Record<string, string>>({});
  const [activeRationale, setActiveRationale] = useState<string | null>(null);

  const artifactMap = new Map(artifacts.map((a) => [a.id, a]));
  const proposalMap = new Map(proposals.map((p) => [p.transformation_id, p]));

  const filtered = filter === 'all' ? transformations : transformations.filter((t) => t.status === filter);

  const handleResolve = async (id: string, status: 'accepted' | 'rejected' | 'branched', transformation: Transformation) => {
    const rationale = rationaleMap[id]?.trim() || '';
    if (status === 'accepted' || status === 'branched') {
      const sourceArtifact = artifactMap.get(transformation.artifact_id);
      if (sourceArtifact) {
        const resultArtifact = await createArtifact({
          vm_id: sourceArtifact.vm_id,
          title: status === 'branched' ? `[Branch] ${sourceArtifact.title}` : `[Refined] ${sourceArtifact.title}`,
          content: (transformation.change_description ?? sourceArtifact.content) ?? undefined,
          artifact_type: sourceArtifact.artifact_type,
          origin: `Transformation #${transformation.id.slice(0, 8)}`,
        });
        if (resultArtifact) {
          const outputHash = await hashString(resultArtifact.id + resultArtifact.title + (resultArtifact.content ?? ''));
          await resolveTransformation(id, status, { outputHash, rationale, sourceProposalId: proposalMap.get(id)?.proposal_artifact_id });
          await createEdge({
            source_artifact_id: resultArtifact.id,
            target_artifact_id: sourceArtifact.id,
            edge_type: 'DERIVES_FROM',
          });
        }
      } else {
        await resolveTransformation(id, status, { rationale });
      }
    } else {
      await resolveTransformation(id, status, { rationale });
    }
    setRationaleMap((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setActiveRationale(null);
    refetch();
    refetchArtifacts();
    refetchProposals();
  };

  const counts = {
    proposed: transformations.filter((t) => t.status === 'proposed').length,
    accepted: transformations.filter((t) => t.status === 'accepted').length,
    rejected: transformations.filter((t) => t.status === 'rejected').length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-100">Mutation Chamber</h2>
        <p className="text-sm text-slate-400 mt-1">AI proposes transformations as first-class artifacts. Every change is witnessed, capability-bound, and accountable.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['proposed', 'accepted', 'rejected', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              filter === f
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'bg-slate-800/40 text-slate-400 border border-slate-700/40 hover:bg-slate-800/60'
            }`}
          >
            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            {f !== 'all' && counts[f as keyof typeof counts] !== undefined && (
              <span className="ml-1.5 opacity-60">{counts[f as keyof typeof counts]}</span>
            )}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-12 text-center">
            <Brain className="mx-auto h-8 w-8 text-slate-600 mb-3" />
            <p className="text-sm text-slate-500">No {filter !== 'all' ? filter : ''} transformations. The chamber is quiet.</p>
          </div>
        ) : (
          filtered.map((t) => {
            const kindMeta = getTransformKindMeta(t.transform_kind);
            const statusMeta = getTransformStatusMeta(t.status);
            const sourceArtifact = artifactMap.get(t.artifact_id);
            const resultArtifact = t.result_artifact_id ? artifactMap.get(t.result_artifact_id) : null;
            const proposal = proposalMap.get(t.id);
            const proposalArtifact = proposal ? artifactMap.get(proposal.proposal_artifact_id) : null;
            const generatedFrom = proposal?.generated_from_artifact_id ? artifactMap.get(proposal.generated_from_artifact_id) : null;

            return (
              <div
                key={t.id}
                className="rounded-2xl border border-slate-700/40 bg-slate-900/50 p-5 transition hover:border-slate-600/50"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Proposal #{t.id.slice(0, 6)}</span>
                      <span
                        className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                        style={{ color: kindMeta.color, backgroundColor: kindMeta.color + '20' }}
                      >
                        {kindMeta.label}
                      </span>
                      <span
                        className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                        style={{ color: statusMeta.color, backgroundColor: statusMeta.color + '20' }}
                      >
                        {statusMeta.label}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center gap-2 text-sm">
                      <span className="font-medium text-slate-200">{sourceArtifact?.title ?? 'Unknown artifact'}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-slate-600" />
                      <span className="text-slate-400">{resultArtifact?.title ?? 'New artifact'}</span>
                    </div>

                    {t.change_description && (
                      <p className="mt-2 text-sm text-slate-400">{t.change_description}</p>
                    )}

                    <div className="mt-3 rounded-lg bg-slate-800/40 p-3">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Reason</div>
                      <p className="text-sm text-slate-300">{t.reason}</p>
                    </div>

                    {/* Witness Panel */}
                    <div className="mt-3 rounded-lg border border-slate-700/40 bg-slate-950/40 p-3">
                      <div className="flex items-center gap-1.5 mb-2.5">
                        <Eye className="h-3.5 w-3.5 text-violet-400" />
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-400">Witness Layer</span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                        <WitnessField icon={Brain} label="Actor" value={t.actor_id ?? t.actor} />
                        <WitnessField icon={Shield} label="Capability" value={t.capability ?? '—'} mono />
                        <WitnessField icon={ScrollText} label="Policy" value={t.policy ?? '—'} mono />
                        <WitnessField icon={Clock} label="Witnessed" value={formatDate(t.created_at)} />
                        <WitnessField icon={Fingerprint} label="Input Hash" value={t.input_hash ? t.input_hash.slice(0, 12) + '…' : '—'} mono />
                        <WitnessField icon={Fingerprint} label="Output Hash" value={t.output_hash ? t.output_hash.slice(0, 12) + '…' : 'pending'} mono />
                      </div>
                      {t.witness_note && (
                        <div className="mt-2.5 flex items-start gap-1.5 border-t border-slate-700/30 pt-2.5">
                          <FileSignature className="h-3.5 w-3.5 text-slate-500 mt-0.5 shrink-0" />
                          <span className="text-xs text-slate-400 italic">{t.witness_note}</span>
                        </div>
                      )}
                    </div>

                    {/* Proposal as artifact */}
                    {proposalArtifact && (
                      <div className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
                        <div className="flex items-center gap-1.5 mb-2">
                          <FileSignature className="h-3.5 w-3.5 text-cyan-400" />
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-400">Proposal Artifact (AI Reasoning as Node)</span>
                        </div>
                        <p className="text-sm text-slate-300">{proposalArtifact.content}</p>
                        <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-500">
                          <span>Generated from:</span>
                          <span className="text-slate-400">{generatedFrom?.title ?? 'direct'}</span>
                          <ArrowRight className="h-3 w-3" />
                          <span>Modifies:</span>
                          <span className="text-slate-400">{sourceArtifact?.title ?? '—'}</span>
                        </div>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500">Affected:</span>
                        <span className="font-medium text-slate-300">{t.affected_count} references</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500">Confidence:</span>
                        <div className="flex items-center gap-1.5">
                          <div className="h-1.5 w-16 rounded-full bg-slate-700/50 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${t.confidence * 100}%`, backgroundColor: t.confidence > 0.7 ? '#10b981' : t.confidence > 0.4 ? '#f59e0b' : '#ef4444' }}
                            />
                          </div>
                          <span className="font-medium text-slate-300">{formatConfidence(t.confidence)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {t.status === 'proposed' && (
                  <div className="mt-4 border-t border-slate-700/40 pt-4 space-y-3">
                    {(activeRationale === t.id || rationaleMap[t.id]) && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5">
                          <MessageSquare className="h-3.5 w-3.5 text-cyan-400" />
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-400">Rationale (first-class event)</span>
                        </div>
                        <textarea
                          value={rationaleMap[t.id] ?? ''}
                          onChange={(e) => setRationaleMap((prev) => ({ ...prev, [t.id]: e.target.value }))}
                          onFocus={() => setActiveRationale(t.id)}
                          placeholder="Why was this accepted or rejected? This becomes part of the permanent record..."
                          rows={2}
                          className="w-full rounded-lg border border-slate-700/50 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-cyan-500/40 resize-none"
                        />
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleResolve(t.id, 'accepted', t)}
                        className="flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-4 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/30"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Merge
                      </button>
                      <button
                        onClick={() => handleResolve(t.id, 'branched', t)}
                        className="flex items-center gap-1.5 rounded-lg bg-amber-500/20 px-4 py-2 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/30"
                      >
                        <GitBranch className="h-3.5 w-3.5" />
                        Branch
                      </button>
                      <button
                        onClick={() => handleResolve(t.id, 'rejected', t)}
                        className="flex items-center gap-1.5 rounded-lg bg-red-500/20 px-4 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-500/30"
                      >
                        <X className="h-3.5 w-3.5" />
                        Reject
                      </button>
                      <button
                        onClick={() => setActiveRationale(activeRationale === t.id ? null : t.id)}
                        className="ml-auto flex items-center gap-1 rounded-lg px-3 py-2 text-xs text-slate-400 hover:text-slate-200 transition"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        {rationaleMap[t.id] ? 'Edit rationale' : 'Add rationale'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function WitnessField({ icon: Icon, label, value, mono }: { icon: typeof Brain; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="h-3 w-3 text-slate-600 shrink-0" />
      <span className="text-slate-500">{label}:</span>
      <span className={`font-medium text-slate-300 truncate ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

async function hashString(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
