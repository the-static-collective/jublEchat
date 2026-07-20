import { useState, useMemo } from 'react';
import { Clock, ArrowDown, X, Search, History, Ban, GitBranch, Layers, Database, Eye, Check } from 'lucide-react';
import { useArtifacts, useTransformations, useEdges, useEvents } from '../lib/hooks';
import { getArtifactTypeMeta, getArtifactStatusMeta, getTransformKindMeta, getTransformStatusMeta, formatDate, formatConfidence } from '../lib/constants';
import type { Transformation, JubileeEvent } from '../lib/types';
import { WITNESS_LABELS } from '../lib/types';

const EVENT_ICONS: Record<string, typeof Clock> = {
  artifact_created: Layers,
  claim_added: Eye,
  transformation_proposed: GitBranch,
  transformation_accepted: Check,
  transformation_rejected: Ban,
  transformation_branched: GitBranch,
  edge_created: Database,
  receipt_issued: Eye,
  vm_created: Layers,
  projection_generated: Eye,
};

const EVENT_COLORS: Record<string, string> = {
  artifact_created: '#06b6d4',
  claim_added: '#8b5cf6',
  transformation_proposed: '#f59e0b',
  transformation_accepted: '#10b981',
  transformation_rejected: '#ef4444',
  transformation_branched: '#8b5cf6',
  edge_created: '#64748b',
  receipt_issued: '#ec4899',
  vm_created: '#3b82f6',
  projection_generated: '#6366f1',
};

export function ReplayRoom() {
  const { artifacts } = useArtifacts();
  const { transformations } = useTransformations();
  const { edges } = useEdges();
  const { events } = useEvents();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const artifactMap = useMemo(() => new Map(artifacts.map((a) => [a.id, a])), [artifacts]);
  const selectedArtifact = selectedId ? artifactMap.get(selectedId) : null;

  const lineage = useMemo(() => {
    if (!selectedArtifact) return { chain: [] as Transformation[], discarded: [] as Transformation[] };

    const chain: Transformation[] = [];
    const discarded: Transformation[] = [];

    const allTransforms = [...transformations].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    let currentId: string | null = selectedArtifact.id;
    const visited = new Set<string>();

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const transforms = allTransforms.filter((t) => t.artifact_id === currentId && (t.status === 'accepted' || t.status === 'branched'));
      if (transforms.length > 0) {
        chain.unshift(...transforms);
      }
      const artifact = artifactMap.get(currentId);
      currentId = artifact?.parent_artifact_id ?? null;
    }

    const discardedTransforms = allTransforms.filter((t) => t.status === 'rejected');
    discarded.push(...discardedTransforms);

    return { chain, discarded };
  }, [selectedArtifact, transformations, artifactMap]);

  const artifactEvents = useMemo(() => {
    if (!selectedArtifact) return [] as JubileeEvent[];
    const relatedIds = new Set<string>([selectedArtifact.id]);
    lineage.chain.forEach((t) => {
      relatedIds.add(t.id);
      if (t.result_artifact_id) relatedIds.add(t.result_artifact_id);
    });
    return events.filter((e) => e.entity_id && relatedIds.has(e.entity_id));
  }, [selectedArtifact, events, lineage]);

  const filteredArtifacts = artifacts.filter((a) =>
    !search || a.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-100">Replay Room</h2>
        <p className="text-sm text-slate-400 mt-1">Click any artifact. Ask "Why does this exist?" The event stream is the soil — the graph is the weather map.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find an artifact..."
              className="w-full rounded-xl border border-slate-700/50 bg-slate-900/60 py-2.5 pl-10 pr-4 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-violet-500/50"
            />
          </div>

          <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
            {filteredArtifacts.map((artifact) => {
              const meta = getArtifactTypeMeta(artifact.artifact_type);
              const isSelected = selectedId === artifact.id;
              return (
                <button
                  key={artifact.id}
                  onClick={() => setSelectedId(artifact.id)}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    isSelected
                      ? 'border-violet-500/50 bg-violet-500/10'
                      : 'border-slate-700/40 bg-slate-900/40 hover:border-slate-600/50 hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
                    <span className="text-sm font-medium text-slate-200 truncate">{artifact.title}</span>
                  </div>
                  {artifact.origin && (
                    <p className="mt-1 text-[10px] text-slate-500 truncate">{artifact.origin}</p>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-2">
          {!selectedArtifact ? (
            <div className="flex h-full min-h-[400px] items-center justify-center rounded-2xl border border-slate-700/40 bg-slate-900/30">
              <div className="text-center">
                <History className="mx-auto h-10 w-10 text-slate-600 mb-3" />
                <p className="text-sm text-slate-500">Select an artifact to replay its history.</p>
              </div>
            </div>
          ) : (
            <ReplayTimeline
              artifact={selectedArtifact}
              chain={lineage.chain}
              discarded={lineage.discarded}
              artifactMap={artifactMap}
              edges={edges}
              events={artifactEvents}
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ReplayTimeline({ artifact, chain, discarded, artifactMap, events, onClose }: {
  artifact: import('../lib/types').Artifact;
  chain: Transformation[];
  discarded: Transformation[];
  artifactMap: Map<string, import('../lib/types').Artifact>;
  edges: import('../lib/types').Edge[];
  events: JubileeEvent[];
  onClose: () => void;
}) {
  const meta = getArtifactTypeMeta(artifact.artifact_type);
  const statusMeta = getArtifactStatusMeta(artifact.status);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-700/40 bg-slate-900/50 p-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="h-3 w-3 rounded-full" style={{ backgroundColor: meta.color }} />
              <span className="text-xs font-medium text-slate-400">{meta.label}</span>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ color: statusMeta.color, backgroundColor: statusMeta.color + '20' }}>
                {statusMeta.label}
              </span>
            </div>
            <h3 className="text-xl font-bold text-slate-100">{artifact.title}</h3>
            {artifact.origin && <p className="mt-1 text-xs text-slate-500">{artifact.origin}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-6 rounded-xl bg-slate-800/40 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">First Appearance</div>
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <Clock className="h-4 w-4 text-violet-400" />
            {formatDate(artifact.created_at)}
          </div>
        </div>

        <div className="mb-6">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-3">Key Transformations</div>
          {chain.length === 0 ? (
            <p className="text-sm text-slate-500 italic">This artifact has no recorded transformations. It entered the system as-is.</p>
          ) : (
            <div className="space-y-0">
              {chain.map((t, i) => {
                const kindMeta = getTransformKindMeta(t.transform_kind);
                const sourceArtifact = artifactMap.get(t.artifact_id);
                const resultArtifact = t.result_artifact_id ? artifactMap.get(t.result_artifact_id) : null;
                return (
                  <div key={t.id} className="relative pl-8 pb-6 last:pb-0">
                    <div className="absolute left-2 top-1 h-full w-px bg-slate-700/50 last:hidden" style={{ height: i === chain.length - 1 ? '0' : undefined }} />
                    <div className="absolute left-0 top-1.5 h-4 w-4 rounded-full border-2 border-slate-700 bg-slate-900" style={{ borderColor: kindMeta.color }} />
                    <div className="ml-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-slate-200">{sourceArtifact?.title ?? '—'}</span>
                        <ArrowDown className="h-3 w-3 text-slate-600" />
                        <span className="text-sm text-slate-400">{resultArtifact?.title ?? 'New artifact'}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{t.reason}</p>
                      <div className="mt-1.5 flex items-center gap-3 text-[10px] text-slate-600">
                        <span style={{ color: kindMeta.color }}>{kindMeta.label}</span>
                        <span>{formatConfidence(t.confidence)} confidence</span>
                        <span>{formatDate(t.created_at)}</span>
                        {t.capability && <span className="text-slate-500">cap: {t.capability}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {discarded.length > 0 && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Ban className="h-4 w-4 text-red-400" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-red-400">Discarded Branches</span>
            </div>
            <div className="space-y-2">
              {discarded.map((t) => {
                const sourceArtifact = artifactMap.get(t.artifact_id);
                return (
                  <div key={t.id} className="flex items-start gap-2 text-xs">
                    <GitBranch className="h-3.5 w-3.5 text-red-400/60 mt-0.5 shrink-0" />
                    <div>
                      <span className="text-slate-400">{sourceArtifact?.title ?? '—'}</span>
                      <p className="text-slate-600 mt-0.5">{t.reason}</p>
                      <p className="text-slate-700 mt-0.5">Reason rejected: premature complexity</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Event Stream — the soil */}
      <div className="rounded-2xl border border-slate-700/40 bg-slate-950/60 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Database className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-bold text-slate-200">Event Stream</h3>
          <span className="text-[10px] text-slate-500">the source of truth — the graph is derived from this</span>
        </div>
        {events.length === 0 ? (
          <p className="text-sm text-slate-500 italic">No events recorded for this artifact.</p>
        ) : (
          <div className="space-y-1 max-h-[300px] overflow-y-auto pr-1">
            {events.map((e) => {
              const Icon = EVENT_ICONS[e.event_type] ?? Clock;
              const color = EVENT_COLORS[e.event_type] ?? '#64748b';
              return (
                <div key={e.id} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-slate-800/40 transition">
                  <div className="mt-0.5 shrink-0" style={{ color }}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-slate-300">{e.event_type.replace(/_/g, ' ')}</span>
                      {e.actor_id && <span className="text-[10px] text-slate-500">{e.actor_id}</span>}
                      {e.capability && <span className="text-[10px] text-slate-600 font-mono">{e.capability}</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-slate-600">{formatDate(e.created_at)}</span>
                      {e.witness_strength && (
                        <span className="text-[9px] font-mono" style={{ color: WITNESS_LABELS[e.witness_strength]?.color }}>
                          {WITNESS_LABELS[e.witness_strength]?.stars} {WITNESS_LABELS[e.witness_strength]?.label}
                        </span>
                      )}
                    </div>
                    {e.rationale && (
                      <p className="mt-1 text-xs text-slate-400 italic border-l-2 pl-2" style={{ borderColor: WITNESS_LABELS[e.witness_strength]?.color ?? '#64748b' }}>
                        {e.rationale}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
