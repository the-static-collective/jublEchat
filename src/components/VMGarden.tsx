import { useState } from 'react';
import { Boxes, ArrowRight, Plus, X, Receipt as ReceiptIcon, Network } from 'lucide-react';
import { useVMs, useReceipts, useArtifacts, createVM, createReceipt } from '../lib/hooks';
import { formatDate } from '../lib/constants';

export function VMGarden() {
  const { vms, refetch: refetchVMs } = useVMs();
  const { receipts, refetch: refetchReceipts } = useReceipts();
  const { artifacts } = useArtifacts();
  const [showCreateVM, setShowCreateVM] = useState(false);
  const [showCreateReceipt, setShowCreateReceipt] = useState(false);

  const vmMap = new Map(vms.map((v) => [v.id, v]));
  const artifactMap = new Map(artifacts.map((a) => [a.id, a]));
  const rootVMs = vms.filter((v) => !v.parent_id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100">VM Garden</h2>
          <p className="text-sm text-slate-400 mt-1">Workspaces are virtual machines with boundaries. They exchange receipts, not full access.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreateReceipt(true)}
            className="flex items-center gap-2 rounded-xl border border-slate-700/50 bg-slate-800/40 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-800/60"
          >
            <ReceiptIcon className="h-4 w-4" />
            Issue Receipt
          </button>
          <button
            onClick={() => setShowCreateVM(true)}
            className="flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-400"
          >
            <Plus className="h-4 w-4" />
            New VM
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Network className="h-4 w-4 text-cyan-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Workspace Hierarchy</h3>
          </div>
          <div className="space-y-2">
            {rootVMs.map((vm) => (
              <VMTreeItem key={vm.id} vm={vm} vms={vms} depth={0} vmMap={vmMap} />
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-3">
            <ReceiptIcon className="h-4 w-4 text-amber-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Receipt Exchange</h3>
          </div>
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
            {receipts.length === 0 ? (
              <div className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-8 text-center">
                <ReceiptIcon className="mx-auto h-6 w-6 text-slate-600 mb-2" />
                <p className="text-sm text-slate-500">No receipts issued yet.</p>
              </div>
            ) : (
              receipts.map((r) => {
                const fromVM = vmMap.get(r.from_vm_id);
                const toVM = vmMap.get(r.to_vm_id);
                const artifact = artifactMap.get(r.artifact_id);
                return (
                  <div key={r.id} className="rounded-xl border border-slate-700/40 bg-slate-900/50 p-4">
                    <div className="flex items-center gap-2 text-sm">
                      <div className="flex items-center gap-1.5">
                        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: fromVM?.color ?? '#64748b' }} />
                        <span className="font-medium text-slate-200">{fromVM?.name ?? '—'}</span>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-slate-600" />
                      <div className="flex items-center gap-1.5">
                        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: toVM?.color ?? '#64748b' }} />
                        <span className="font-medium text-slate-200">{toVM?.name ?? '—'}</span>
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-slate-400 italic">"{r.statement}"</p>
                    {artifact && (
                      <p className="mt-1.5 text-[10px] text-slate-600">Artifact: {artifact.title}</p>
                    )}
                    <p className="mt-1.5 text-[10px] text-slate-600">{formatDate(r.created_at)}</p>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {showCreateVM && (
        <CreateVMModal onCreate={async (data) => { await createVM(data); setShowCreateVM(false); refetchVMs(); }} onClose={() => setShowCreateVM(false)} vms={vms} />
      )}
      {showCreateReceipt && (
        <CreateReceiptModal
          vms={vms}
          artifacts={artifacts}
          onCreate={async (data) => { await createReceipt(data); setShowCreateReceipt(false); refetchReceipts(); }}
          onClose={() => setShowCreateReceipt(false)}
        />
      )}
    </div>
  );
}

function VMTreeItem({ vm, vms, depth, vmMap }: { vm: import('../lib/types').VM; vms: import('../lib/types').VM[]; depth: number; vmMap: Map<string, import('../lib/types').VM> }) {
  const children = vms.filter((v) => v.parent_id === vm.id);
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <div
        className={`flex items-center gap-2 rounded-xl border border-slate-700/40 bg-slate-900/40 p-3 transition hover:bg-slate-800/40 ${depth > 0 ? 'ml-' + depth * 6 : ''}`}
        style={{ marginLeft: depth * 24 }}
      >
        {children.length > 0 && (
          <button onClick={() => setExpanded(!expanded)} className="text-slate-500 hover:text-slate-300">
            <Boxes className="h-4 w-4" />
          </button>
        )}
        <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: vm.color }} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-200">{vm.name}</div>
          {vm.description && (
            <div className="text-xs text-slate-500 truncate">{vm.description}</div>
          )}
        </div>
      </div>
      {expanded && children.length > 0 && (
        <div className="mt-1 space-y-1 border-l border-slate-700/30" style={{ marginLeft: depth * 24 + 16 }}>
          {children.map((child) => (
            <VMTreeItem key={child.id} vm={child} vms={vms} depth={depth + 1} vmMap={vmMap} />
          ))}
        </div>
      )}
    </div>
  );
}

function CreateVMModal({ vms, onCreate, onClose }: {
  vms: import('../lib/types').VM[];
  onCreate: (data: { name: string; description: string; color: string; parent_id?: string }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [parentId, setParentId] = useState<string | undefined>(undefined);

  const colors = ['#06b6d4', '#f59e0b', '#8b5cf6', '#ec4899', '#10b981', '#3b82f6', '#ef4444', '#6366f1'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-slate-700/50 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-100">New Virtual Machine</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Research VM" autoFocus
              className="w-full rounded-xl border border-slate-700/50 bg-slate-800/50 px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500/50" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this workspace for?"
              className="w-full rounded-xl border border-slate-700/50 bg-slate-800/50 px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500/50" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">Parent VM <span className="text-slate-600">(optional)</span></label>
            <select value={parentId} onChange={(e) => setParentId(e.target.value)}
              className="w-full rounded-xl border border-slate-700/50 bg-slate-800/50 px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-500/50">
              <option value="">No parent (root)</option>
              {vms.map((vm) => <option key={vm.id} value={vm.id}>{vm.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">Color</label>
            <div className="flex flex-wrap gap-2">
              {colors.map((c) => (
                <button key={c} onClick={() => setColor(c)}
                  className={`h-8 w-8 rounded-lg transition ${color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900' : ''}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          <button onClick={() => { if (name.trim()) onCreate({ name: name.trim(), description: description.trim(), color, parent_id: parentId || undefined }); }}
            disabled={!name.trim()}
            className="w-full rounded-xl bg-cyan-500 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed">
            Create VM

          </button>
        </div>
      </div>
    </div>
  );
}

function CreateReceiptModal({ vms, artifacts, onCreate, onClose }: {
  vms: import('../lib/types').VM[];
  artifacts: import('../lib/types').Artifact[];
  onCreate: (data: { from_vm_id: string; to_vm_id: string; artifact_id: string; statement: string }) => void;
  onClose: () => void;
}) {
  const [fromVmId, setFromVmId] = useState('');
  const [toVmId, setToVmId] = useState('');
  const [artifactId, setArtifactId] = useState('');
  const [statement, setStatement] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-slate-700/50 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-100">Issue Receipt</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-400 mb-1.5 block">From VM</label>
              <select value={fromVmId} onChange={(e) => setFromVmId(e.target.value)}
                className="w-full rounded-xl border border-slate-700/50 bg-slate-800/50 px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-500/50">
                <option value="">Select...</option>
                {vms.map((vm) => <option key={vm.id} value={vm.id}>{vm.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 mb-1.5 block">To VM</label>
              <select value={toVmId} onChange={(e) => setToVmId(e.target.value)}
                className="w-full rounded-xl border border-slate-700/50 bg-slate-800/50 px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-500/50">
                <option value="">Select...</option>
                {vms.map((vm) => <option key={vm.id} value={vm.id}>{vm.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">Artifact</label>
            <select value={artifactId} onChange={(e) => setArtifactId(e.target.value)}
              className="w-full rounded-xl border border-slate-700/50 bg-slate-800/50 px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-500/50">
              <option value="">Select...</option>
              {artifacts.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">Statement</label>
            <textarea value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="e.g. I derived this insight from Music VM without reading its full provenance graph." rows={3}
              className="w-full rounded-xl border border-slate-700/50 bg-slate-800/50 px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500/50 resize-none" />
          </div>
          <button onClick={() => { if (fromVmId && toVmId && artifactId && statement.trim()) onCreate({ from_vm_id: fromVmId, to_vm_id: toVmId, artifact_id: artifactId, statement: statement.trim() }); }}
            disabled={!fromVmId || !toVmId || !artifactId || !statement.trim()}
            className="w-full rounded-xl bg-amber-500 py-2.5 text-sm font-semibold text-white shadow-lg shadow-amber-500/20 transition hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed">
            Issue Receipt
          </button>
        </div>
      </div>
    </div>
  );
}
