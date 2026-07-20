import { useState } from 'react';
import { Sparkles, Plus, Search, X } from 'lucide-react';
import { GraphCanvas } from './GraphCanvas';
import { useArtifacts, useEdges, useVMs, buildGraphNodes, buildGraphEdges, createArtifact, createClaim } from '../lib/hooks';
import { ARTIFACT_TYPES, getArtifactTypeMeta, getArtifactStatusMeta, formatDate } from '../lib/constants';
import type { ArtifactType } from '../lib/types';

export function SeedGarden() {
  const { vms } = useVMs();
  const [selectedVM, setSelectedVM] = useState<string>('');
  const { artifacts, refetch: refetchArtifacts } = useArtifacts(selectedVM || undefined);
  const { edges, refetch: refetchEdges } = useEdges();
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');

  const vmMap = new Map(vms.map((v) => [v.id, v]));
  const selectedArtifact = artifacts.find((a) => a.id === selectedArtifactId) ?? null;

  const filteredArtifacts = artifacts.filter((a) =>
    !search || a.title.toLowerCase().includes(search.toLowerCase()) || a.content?.toLowerCase().includes(search.toLowerCase())
  );

  const graphNodes = buildGraphNodes(filteredArtifacts);
  const graphEdges = buildGraphEdges(edges).filter(
    (e) => graphNodes.some((n) => n.id === e.source) && graphNodes.some((n) => n.id === e.target)
  );

  const handleCreate = async (data: { vm_id: string; title: string; content: string; artifact_type: ArtifactType; origin: string; claim: string }) => {
    const artifact = await createArtifact({
      vm_id: data.vm_id,
      title: data.title,
      content: data.content || undefined,
      artifact_type: data.artifact_type,
      origin: data.origin || undefined,
    });
    if (artifact && data.claim) {
      await createClaim({ artifact_id: artifact.id, text: data.claim });
    }
    setShowCreate(false);
    refetchArtifacts();
    refetchEdges();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100">Seed Garden</h2>
          <p className="text-sm text-slate-400 mt-1">Capture anything. Each artifact enters a living graph with full lineage.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-400 hover:shadow-cyan-400/30"
        >
          <Plus className="h-4 w-4" />
          New Artifact
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search artifacts..."
            className="w-full rounded-xl border border-slate-700/50 bg-slate-900/60 py-2.5 pl-10 pr-4 text-sm text-slate-200 placeholder-slate-500 outline-none transition focus:border-cyan-500/50"
          />
        </div>
        <select
          value={selectedVM}
          onChange={(e) => setSelectedVM(e.target.value)}
          className="rounded-xl border border-slate-700/50 bg-slate-900/60 px-4 py-2.5 text-sm text-slate-200 outline-none transition focus:border-cyan-500/50"
        >
          <option value="">All Workspaces</option>
          {vms.map((vm) => (
            <option key={vm.id} value={vm.id}>{vm.name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <GraphCanvas
            nodes={graphNodes}
            edges={graphEdges}
            selectedId={selectedArtifactId}
            onSelectNode={setSelectedArtifactId}
            height={520}
          />
        </div>

        <div className="lg:col-span-2 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {filteredArtifacts.length} Artifact{filteredArtifacts.length !== 1 ? 's' : ''}
          </h3>
          <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
            {filteredArtifacts.map((artifact) => {
              const meta = getArtifactTypeMeta(artifact.artifact_type);
              const statusMeta = getArtifactStatusMeta(artifact.status);
              const vm = vmMap.get(artifact.vm_id);
              const isSelected = selectedArtifactId === artifact.id;
              return (
                <button
                  key={artifact.id}
                  onClick={() => setSelectedArtifactId(artifact.id)}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    isSelected
                      ? 'border-cyan-500/50 bg-cyan-500/10'
                      : 'border-slate-700/40 bg-slate-900/40 hover:border-slate-600/50 hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
                      <span className="text-sm font-medium text-slate-200">{artifact.title}</span>
                    </div>
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ color: statusMeta.color, backgroundColor: statusMeta.color + '20' }}>
                      {statusMeta.label}
                    </span>
                  </div>
                  {artifact.content && (
                    <p className="mt-1.5 text-xs text-slate-500 line-clamp-2">{artifact.content}</p>
                  )}
                  <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-500">
                    <span>{meta.label}</span>
                    {vm && (
                      <>
                        <span>·</span>
                        <span style={{ color: vm.color }}>{vm.name}</span>
                      </>
                    )}
                    <span>·</span>
                    <span>{formatDate(artifact.created_at)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {selectedArtifact && (
        <ArtifactDetail artifact={selectedArtifact} vmName={vmMap.get(selectedArtifact.vm_id)?.name ?? ''} vmColor={vmMap.get(selectedArtifact.vm_id)?.color ?? ''} onClose={() => setSelectedArtifactId(null)} />
      )}

      {showCreate && (
        <CreateArtifactModal vms={vms} onCreate={handleCreate} onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}

function ArtifactDetail({ artifact, vmName, vmColor, onClose }: { artifact: import('../lib/types').Artifact; vmName: string; vmColor: string; onClose: () => void }) {
  const meta = getArtifactTypeMeta(artifact.artifact_type);
  const statusMeta = getArtifactStatusMeta(artifact.status);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-slate-700/50 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-3 w-3 rounded-full" style={{ backgroundColor: meta.color }} />
              <span className="text-xs font-medium text-slate-400">{meta.label}</span>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ color: statusMeta.color, backgroundColor: statusMeta.color + '20' }}>
                {statusMeta.label}
              </span>
            </div>
            <h3 className="text-xl font-bold text-slate-100">{artifact.title}</h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        {artifact.content && (
          <p className="mt-4 text-sm leading-relaxed text-slate-300">{artifact.content}</p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg bg-slate-800/40 p-3">
            <div className="text-slate-500 mb-1">Origin</div>
            <div className="text-slate-300">{artifact.origin ?? '—'}</div>
          </div>
          <div className="rounded-lg bg-slate-800/40 p-3">
            <div className="text-slate-500 mb-1">Workspace</div>
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: vmColor }} />
              <span className="text-slate-300">{vmName}</span>
            </div>
          </div>
          <div className="rounded-lg bg-slate-800/40 p-3">
            <div className="text-slate-500 mb-1">Created</div>
            <div className="text-slate-300">{formatDate(artifact.created_at)}</div>
          </div>
          <div className="rounded-lg bg-slate-800/40 p-3">
            <div className="text-slate-500 mb-1">Parent</div>
            <div className="text-slate-300">{artifact.parent_artifact_id ? 'Has parent' : 'Root artifact'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateArtifactModal({ vms, onCreate, onClose }: {
  vms: import('../lib/types').VM[];
  onCreate: (data: { vm_id: string; title: string; content: string; artifact_type: ArtifactType; origin: string; claim: string }) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [artifactType, setArtifactType] = useState<ArtifactType>('thought');
  const [origin, setOrigin] = useState('');
  const [claim, setClaim] = useState('');
  const [vmId, setVmId] = useState(vms[0]?.id ?? '');

  const handleSubmit = () => {
    if (!title.trim() || !vmId) return;
    onCreate({ vm_id: vmId, title: title.trim(), content: content.trim(), artifact_type: artifactType, origin: origin.trim(), claim: claim.trim() });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-2xl border border-slate-700/50 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-cyan-400" />
            <h3 className="text-lg font-bold text-slate-100">New Artifact</h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Give it a name..."
              autoFocus
              className="w-full rounded-xl border border-slate-700/50 bg-slate-800/50 px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500/50"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-400 mb-1.5 block">Type</label>
              <select
                value={artifactType}
                onChange={(e) => setArtifactType(e.target.value as ArtifactType)}
                className="w-full rounded-xl border border-slate-700/50 bg-slate-800/50 px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-500/50"
              >
                {ARTIFACT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 mb-1.5 block">Workspace</label>
              <select
                value={vmId}
                onChange={(e) => setVmId(e.target.value)}
                className="w-full rounded-xl border border-slate-700/50 bg-slate-800/50 px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-500/50"
              >
                {vms.map((vm) => (
                  <option key={vm.id} value={vm.id}>{vm.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="What is this artifact about?"
              rows={3}
              className="w-full rounded-xl border border-slate-700/50 bg-slate-800/50 px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500/50 resize-none"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">Origin <span className="text-slate-600">(optional)</span></label>
            <input
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              placeholder="Where did this come from?"
              className="w-full rounded-xl border border-slate-700/50 bg-slate-800/50 px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500/50"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">Claim <span className="text-slate-600">(optional)</span></label>
            <input
              value={claim}
              onChange={(e) => setClaim(e.target.value)}
              placeholder="What does this artifact assert?"
              className="w-full rounded-xl border border-slate-700/50 bg-slate-800/50 px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500/50"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={!title.trim()}
            className="w-full rounded-xl bg-cyan-500 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Plant Seed
          </button>
        </div>
      </div>
    </div>
  );
}
