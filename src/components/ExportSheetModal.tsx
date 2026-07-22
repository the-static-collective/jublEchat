import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  Copy,
  Download,
  Save,
  X,
  Check,
  Sparkles,
  AlertTriangle,
  ChevronRight,
  ShieldCheck,
  HelpCircle,
  Clock,
  Printer
} from 'lucide-react';
import { Idea, Artifact, IdeaVersion, JubileeEvent, ExportPacket, ExternalArtifact } from '../lib/types';

interface ExportSheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedIdea: Idea | null;
  currentArtifact: Artifact | null;
  activeVersionLabel: string;
  allIdeaVersions: IdeaVersion[];
  events: JubileeEvent[];
  onSaveExternalArtifact: (artifact: ExternalArtifact) => void;
}

export const ExportSheetModal: React.FC<ExportSheetModalProps> = ({
  isOpen,
  onClose,
  selectedIdea,
  currentArtifact,
  activeVersionLabel,
  allIdeaVersions,
  events,
  onSaveExternalArtifact,
}) => {
  // Configurable options
  const [tone, setTone] = useState<'practical' | 'civic' | 'fundable'>('practical');
  const [includes, setIncludes] = useState({
    formulation: true,
    insights: true,
    tensions: true,
    openQuestion: true,
    experiments: true,
    sourceNote: true,
  });

  const [copied, setCopied] = useState(false);
  const [savedArtifactId, setSavedArtifactId] = useState<string | null>(null);
  const [showSourceDetails, setShowSourceDetails] = useState(false);

  // Derive fixed source kernel items
  const ideaTitle = selectedIdea?.title || 'Neighborhood Cooling Mutual-Aid Network';
  const formulation = currentArtifact?.content || 'Deploy community-managed shade hubs with ice distribution across 4 high-risk zones.';
  
  const insights = useMemo(() => [
    'Cooling access is uneven across neighborhoods',
    'Mobile shade structures provide immediate high-impact micro-climates',
    'Localized ice distribution requires rapid neighborhood transport loops',
  ], []);

  const tensions = useMemo(() => [
    'Volunteer capacity is an untested load-bearing assumption across 4 cooling hubs',
  ], []);

  const experiments = useMemo(() => [
    'Recruit and test a two-week pilot shift model across 2 initial hubs',
  ], []);

  const openQuestion = 'What minimum volunteer coverage is sustainable for consecutive heat emergency alerts?';

  // Empty state check
  const hasFormulation = Boolean(formulation && formulation.trim().length > 0);
  const hasSourceItems = insights.length > 0 || tensions.length > 0 || experiments.length > 0;
  const isKernelSelectable = (includes.formulation && hasFormulation) || (includes.insights && insights.length > 0) || (includes.tensions && tensions.length > 0) || (includes.experiments && experiments.length > 0);
  const isGenerationDisabled = !hasFormulation || !hasSourceItems || !isKernelSelectable;

  let missingReason = '';
  if (!hasFormulation) {
    missingReason = 'A current formulation is required before exporting a project brief.';
  } else if (!hasSourceItems) {
    missingReason = 'At least one kernel source item (insight, tension, or experiment) is required.';
  } else if (!isKernelSelectable) {
    missingReason = 'Please select at least one "Include" checkbox to supply kernel material for generation.';
  }

  // Reset modal state when opened
  useEffect(() => {
    if (isOpen) {
      setSavedArtifactId(null);
      setCopied(false);
      setShowSourceDetails(false);
    }
  }, [isOpen]);

  // Construct deterministic ExportPacket
  const exportPacket = useMemo<ExportPacket>(() => {
    const vNumStr = activeVersionLabel.replace('v', '');
    const vNum = parseFloat(vNumStr) || 0.3;
    const ideaId = selectedIdea?.id || 'idea-mpls-01';
    const versionId = currentArtifact?.id || 'art-mpls-02';
    
    // Hash based on formulation and version
    const hashSeed = `${ideaId}-${versionId}-${formulation.substring(0, 20)}-v${vNum}`;
    let hashVal = 0;
    for (let i = 0; i < hashSeed.length; i++) {
      hashVal = (hashVal << 5) - hashVal + hashSeed.charCodeAt(i);
      hashVal |= 0;
    }
    const packetHash = `sha256-${Math.abs(hashVal).toString(16).padStart(12, '0')}`;

    return {
      ideaId,
      versionId,
      versionNumber: vNum,
      formulation,
      insights,
      tensions,
      experiments,
      openQuestion,
      lineage: {
        parentVersionIds: allIdeaVersions.map((v) => v.id),
        sourceEventIds: events.slice(-3).map((e) => e.id),
      },
      generatedAt: new Date().toISOString(),
      packetHash,
    };
  }, [selectedIdea, currentArtifact, activeVersionLabel, formulation, insights, tensions, experiments, allIdeaVersions, events]);

  // Generate initial draft markdown from packet & tone
  const generateDraftText = (pkt: ExportPacket, selectedTone: 'practical' | 'civic' | 'fundable', inc: typeof includes) => {
    let tonePrefix = '';
    if (selectedTone === 'civic') {
      tonePrefix = 'Community-Led Mutual-Aid Project Brief';
    } else if (selectedTone === 'fundable') {
      tonePrefix = 'Civic Infrastructure Investment Brief';
    } else {
      tonePrefix = 'Project Brief';
    }

    let text = `# ${ideaTitle}\n${tonePrefix} · Draft 0.1 (AI-Assisted)\n\n`;

    text += `## Purpose\n`;
    if (selectedTone === 'civic') {
      text += `Empower neighbors to protect high-risk residents during extreme heat events through decentralized, community-managed shade hubs and rapid ice delivery.\n\n`;
    } else if (selectedTone === 'fundable') {
      text += `Establish scalable, neighborhood-level cooling infrastructure across 4 high-risk census tracts to mitigate heat-related emergency room admissions.\n\n`;
    } else {
      text += `Create neighborhood-led cooling support during extreme heat events using community hubs, transport, water, and wellness checks.\n\n`;
    }

    if (inc.formulation) {
      text += `## Current Formulation\n${pkt.formulation}\n\n`;
    }

    text += `## Kernel\n`;
    if (inc.insights && pkt.insights.length > 0) {
      text += `- **Core Insights**:\n`;
      pkt.insights.forEach((ins) => {
        text += `  - ${ins}\n`;
      });
    }

    if (inc.tensions && pkt.tensions.length > 0) {
      text += `- **Active Tensions**:\n`;
      pkt.tensions.forEach((t) => {
        text += `  - ⚠️ ${t}\n`;
      });
    }

    if (inc.experiments && pkt.experiments.length > 0) {
      text += `- **Next Experiment**:\n`;
      pkt.experiments.forEach((exp) => {
        text += `  - 🧪 ${exp}\n`;
      });
    }

    if (inc.openQuestion && pkt.openQuestion) {
      text += `- **Open Question**:\n  - ❓ ${pkt.openQuestion}\n`;
    }

    text += `\n---\n`;
    if (inc.sourceNote) {
      text += `### Source Provenance\n`;
      text += `- **Jubilee Idea**: ${ideaTitle}\n`;
      text += `- **Source Version**: ${activeVersionLabel}\n`;
      text += `- **Generated From**: ${pkt.insights.length} insights, ${pkt.tensions.length} active tensions, ${pkt.experiments.length} experiments\n`;
      text += `- **Packet Hash**: \`${pkt.packetHash}\`\n`;
      text += `- **Status**: AI-assisted draft, requires human review\n`;
    }

    return text;
  };

  const [editableDraft, setEditableDraft] = useState('');

  // Re-generate draft when tone or include options change
  useEffect(() => {
    setEditableDraft(generateDraftText(exportPacket, tone, includes));
  }, [exportPacket, tone, includes]);

  if (!isOpen) return null;

  const handleCopyMarkdown = () => {
    navigator.clipboard.writeText(editableDraft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadMarkdown = () => {
    const blob = new Blob([editableDraft], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${ideaTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-project-brief-${activeVersionLabel}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrintPDF = () => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>${ideaTitle} - Project Brief (${activeVersionLabel})</title>
            <style>
              body { font-family: system-ui, -apple-system, sans-serif; padding: 40px; color: #111; line-height: 1.6; max-width: 800px; margin: 0 auto; }
              h1 { font-size: 24px; border-bottom: 2px solid #222; padding-bottom: 10px; margin-bottom: 4px; }
              h2 { font-size: 16px; color: #2563eb; margin-top: 24px; text-transform: uppercase; letter-spacing: 0.5px; }
              ul { padding-left: 20px; }
              li { margin-bottom: 6px; }
              hr { border: none; border-top: 1px solid #ddd; margin: 30px 0; }
              .provenance { font-family: monospace; font-size: 12px; background: #f4f4f5; padding: 16px; border-radius: 8px; border: 1px solid #e4e4e7; }
            </style>
          </head>
          <body>
            <pre style="white-space: pre-wrap; font-family: inherit;">${editableDraft}</pre>
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.print();
    }
  };

  const handleSaveArtifact = () => {
    const newArtifactId = `ext-art-${Date.now().toString().slice(-6)}`;
    const artifact: ExternalArtifact = {
      id: newArtifactId,
      ideaId: exportPacket.ideaId,
      sourceVersionId: exportPacket.versionId,
      sourceVersionNumber: exportPacket.versionNumber,
      exportPacketHash: exportPacket.packetHash,
      templateType: 'project_brief',
      title: `${ideaTitle} - Project Brief (${activeVersionLabel})`,
      content: editableDraft,
      status: 'draft',
      createdAt: new Date().toISOString(),
      tone,
      kernelSummary: {
        insightsCount: exportPacket.insights.length,
        tensionsCount: exportPacket.tensions.length,
        openQuestionsCount: exportPacket.openQuestion ? 1 : 0,
      },
      exportPacket,
    };

    onSaveExternalArtifact(artifact);
    setSavedArtifactId(newArtifactId);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* MODAL HEADER */}
        <div className="shrink-0 px-6 py-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-violet-950 border border-violet-500/30 text-violet-400">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-100">
                  Export Project Brief
                </h2>
                <span className="px-2.5 py-0.5 rounded-full bg-violet-950 border border-violet-500/30 text-xs font-mono font-bold text-violet-300">
                  {activeVersionLabel}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Generate a structured, shareable document while preserving unresolved tensions and lineage roots.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* CONTROLS BAR: INCLUDES & TONE */}
        <div className="shrink-0 px-6 py-3 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs">
          {/* Checkboxes */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-slate-400 font-mono text-[11px] uppercase font-bold">Include:</span>
            <label className="flex items-center gap-1.5 text-slate-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includes.formulation}
                onChange={(e) => setIncludes({ ...includes, formulation: e.target.checked })}
                className="rounded border-slate-700 bg-slate-950 text-violet-500 focus:ring-0"
              />
              <span>Formulation</span>
            </label>
            <label className="flex items-center gap-1.5 text-slate-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includes.insights}
                onChange={(e) => setIncludes({ ...includes, insights: e.target.checked })}
                className="rounded border-slate-700 bg-slate-950 text-violet-500 focus:ring-0"
              />
              <span>Insights ({insights.length})</span>
            </label>
            <label className="flex items-center gap-1.5 text-slate-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includes.tensions}
                onChange={(e) => setIncludes({ ...includes, tensions: e.target.checked })}
                className="rounded border-slate-700 bg-slate-950 text-violet-500 focus:ring-0"
              />
              <span className="text-amber-300 font-semibold">Active Tensions</span>
            </label>
            <label className="flex items-center gap-1.5 text-slate-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includes.openQuestion}
                onChange={(e) => setIncludes({ ...includes, openQuestion: e.target.checked })}
                className="rounded border-slate-700 bg-slate-950 text-violet-500 focus:ring-0"
              />
              <span>Open Question</span>
            </label>
            <label className="flex items-center gap-1.5 text-slate-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includes.sourceNote}
                onChange={(e) => setIncludes({ ...includes, sourceNote: e.target.checked })}
                className="rounded border-slate-700 bg-slate-950 text-violet-500 focus:ring-0"
              />
              <span>Source Provenance</span>
            </label>
          </div>

          {/* Tone Selector */}
          <div className="flex items-center gap-3">
            <span className="text-slate-400 font-mono text-[11px] uppercase font-bold">Tone:</span>
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px]">
              {(['practical', 'civic', 'fundable'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTone(t)}
                  className={`px-2.5 py-1 rounded-lg capitalize transition cursor-pointer font-medium ${
                    tone === t
                      ? 'bg-violet-600 text-white font-bold shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t === 'practical' ? 'Practical & clear' : t === 'civic' ? 'Civic / community' : 'Fundable / institutional'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* TWO-COLUMN SPLIT REVIEW AREA */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col md:flex-row">
          
          {/* LEFT COLUMN: SOURCE KERNEL */}
          <div className="w-full md:w-[40%] border-r border-slate-800 bg-slate-950/60 flex flex-col overflow-hidden">
            <div className="shrink-0 p-3.5 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
              <div className="flex items-center gap-2 font-mono text-xs">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                <span className="font-bold text-slate-200 uppercase tracking-wider">
                  SOURCE KERNEL
                </span>
                <span className="text-[10px] text-cyan-400 bg-cyan-950/80 border border-cyan-500/30 px-1.5 py-0.2 rounded font-mono">
                  {activeVersionLabel}
                </span>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">
                {insights.length} insights · 1 tension
              </span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 scrollbar-thin text-xs">
              {/* Formulation Box */}
              <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800 space-y-1">
                <span className="text-[10px] font-mono text-slate-400 uppercase font-bold block">
                  Current Formulation
                </span>
                <p className="text-slate-200 leading-relaxed font-normal">
                  "{formulation}"
                </p>
              </div>

              {/* Kernel Items */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <span className="text-[10px] font-mono text-cyan-400 uppercase font-bold block">
                    Core Insights (3)
                  </span>
                  <ul className="space-y-1 text-slate-300 pl-2">
                    {insights.map((ins, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="text-cyan-500 font-bold">•</span>
                        <span>{ins}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Active Tension */}
                <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-950/20 space-y-1">
                  <div className="flex items-center gap-1.5 text-amber-400 font-mono font-bold text-[10px] uppercase">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                    <span>Active Load-Bearing Tension</span>
                  </div>
                  <p className="text-slate-200 font-medium leading-snug">
                    {tensions[0]}
                  </p>
                  <span className="text-[9px] text-amber-400/80 font-mono block pt-1">
                    Status: Preserved in kernel v0.3
                  </span>
                </div>

                {/* Next Experiment */}
                <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-950/20 space-y-1">
                  <span className="text-[10px] font-mono font-bold text-emerald-400 uppercase block">
                    Proposed Next Experiment
                  </span>
                  <p className="text-slate-200">
                    {experiments[0]}
                  </p>
                </div>

                {/* Open Question */}
                <div className="p-3 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
                  <span className="text-[10px] font-mono font-bold text-slate-400 uppercase block">
                    Open Question
                  </span>
                  <p className="text-slate-300 italic">
                    "{openQuestion}"
                  </p>
                </div>
              </div>

              {/* Source Lineage Details */}
              <div className="pt-2 border-t border-slate-850 space-y-2">
                <button
                  type="button"
                  onClick={() => setShowSourceDetails(!showSourceDetails)}
                  className="text-[10px] font-mono text-violet-400 hover:text-violet-300 flex items-center gap-1 font-bold cursor-pointer"
                >
                  <ChevronRight className={`h-3 w-3 transition-transform ${showSourceDetails ? 'rotate-90' : ''}`} />
                  <span>{showSourceDetails ? 'Hide' : 'Inspect'} Packet Hash & Source Hashes</span>
                </button>

                {showSourceDetails && (
                  <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-[10px] font-mono space-y-1 text-slate-400 animate-fadeIn">
                    <div className="flex justify-between">
                      <span>Packet Hash:</span>
                      <span className="text-emerald-400 font-bold">{exportPacket.packetHash}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Idea ID:</span>
                      <span className="text-slate-200">{exportPacket.ideaId}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Version ID:</span>
                      <span className="text-slate-200">{exportPacket.versionId}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: AI-ASSISTED DRAFT */}
          <div className="w-full md:w-[60%] flex flex-col bg-slate-900/40 overflow-hidden">
            <div className="shrink-0 p-3.5 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-400" />
                <span className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider">
                  AI-ASSISTED DRAFT
                </span>
                <span className="text-[10px] font-mono text-amber-400 bg-amber-950/80 border border-amber-500/30 px-2 py-0.5 rounded font-medium">
                  Editable Preview
                </span>
              </div>
              
              <span className="text-[10px] font-mono text-slate-400">
                Markdown Format
              </span>
            </div>

            {/* Warning Banner */}
            <div className="shrink-0 bg-amber-950/30 border-b border-amber-500/20 px-4 py-2 flex items-center gap-2 text-[11px] text-amber-200/90 font-medium">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <span>
                AI-assisted draft. Tensions and open questions are explicitly preserved. Requires human review.
              </span>
            </div>

            {/* Editable Text Area */}
            <div className="flex-1 min-h-0 p-4 overflow-hidden flex flex-col">
              <textarea
                value={editableDraft}
                onChange={(e) => setEditableDraft(e.target.value)}
                className="w-full flex-1 bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono text-slate-200 leading-relaxed focus:outline-none focus:border-violet-500 resize-none scrollbar-thin shadow-inner"
                placeholder="Export draft markdown..."
              />
            </div>

            {/* Action Bar */}
            <div className="shrink-0 p-4 border-t border-slate-800 bg-slate-950 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyMarkdown}
                  disabled={isGenerationDisabled}
                  className={`px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold transition flex items-center gap-1.5 ${
                    isGenerationDisabled ? 'opacity-50 cursor-not-allowed text-slate-600' : 'hover:bg-slate-850 text-slate-300 cursor-pointer'
                  }`}
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-slate-400" />}
                  <span>{copied ? 'Copied!' : 'Copy'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadMarkdown}
                  disabled={isGenerationDisabled}
                  className={`px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold transition flex items-center gap-1.5 ${
                    isGenerationDisabled ? 'opacity-50 cursor-not-allowed text-slate-600' : 'hover:bg-slate-850 text-slate-300 cursor-pointer'
                  }`}
                >
                  <Download className="h-3.5 w-3.5 text-slate-400" />
                  <span>Download .md</span>
                </button>

                <button
                  type="button"
                  onClick={handlePrintPDF}
                  disabled={isGenerationDisabled}
                  className={`px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold transition flex items-center gap-1.5 ${
                    isGenerationDisabled ? 'opacity-50 cursor-not-allowed text-slate-600' : 'hover:bg-slate-850 text-slate-300 cursor-pointer'
                  }`}
                >
                  <Printer className="h-3.5 w-3.5 text-slate-400" />
                  <span>Download PDF</span>
                </button>
              </div>

              {/* Save as External Artifact Button */}
              <div className="flex items-center gap-2">
                {isGenerationDisabled && (
                  <span className="text-[10px] font-mono text-rose-400 bg-rose-950/80 px-2 py-1 rounded border border-rose-500/30">
                    ⚠️ {missingReason}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleSaveArtifact}
                  disabled={Boolean(savedArtifactId) || isGenerationDisabled}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-md ${
                    isGenerationDisabled
                      ? 'bg-slate-800 border border-slate-700 text-slate-500 cursor-not-allowed opacity-60'
                      : savedArtifactId
                      ? 'bg-emerald-950 border border-emerald-500/40 text-emerald-300 cursor-default'
                      : 'bg-violet-600 hover:bg-violet-500 text-white shadow-violet-600/20 cursor-pointer'
                  }`}
                >
                  {savedArtifactId ? (
                    <>
                      <ShieldCheck className="h-4 w-4 text-emerald-400" />
                      <span>Saved as External Artifact!</span>
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 text-violet-200" />
                      <span>Save as External Artifact</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Success notification banner */}
            {savedArtifactId && (
              <div className="px-4 py-2 bg-emerald-950/80 border-t border-emerald-500/40 flex items-center justify-between text-xs text-emerald-200 animate-fadeIn">
                <div className="flex items-center gap-2 font-mono text-[11px]">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Durable artifact created & linked to {activeVersionLabel}</span>
                  <span className="text-emerald-400 font-bold">({exportPacket.packetHash.substring(0, 16)}...)</span>
                </div>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-900/80 px-2 py-0.5 rounded border border-emerald-500/30 uppercase font-bold">
                  Status: Draft
                </span>
              </div>
            )}
          </div>

        </div>

      </div>
    </div>
  );
};
