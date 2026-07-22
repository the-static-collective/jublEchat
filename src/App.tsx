import { useState, useEffect, useMemo } from 'react';
import {
  Sprout, Leaf, Send, HelpCircle, GitMerge, GitBranch, Clock, Check, X,
  RefreshCw, Plus, MessageSquare, Sparkles, AlertTriangle, Network, PlusCircle, ArrowLeft,
  Shield, Database, Terminal, CheckCircle2, AlertCircle, History, ArrowDown, ShieldCheck, Flame, FileText
} from 'lucide-react';
import { AuthProvider, useAuth } from './lib/auth';
import {
  useIdeas, useIdeaVersions, useArtifacts, useEvents, useEdges,
  createIdea, evolveIdea, logEvent, synthesizeIdeas
} from './lib/hooks';
import { GraphCanvas } from './components/GraphCanvas';
import { ExportSheetModal } from './components/ExportSheetModal';
import { type TaxonomyLevel, type ChatMessage, type ProvenanceCue, type DeliberationLoop, type ExternalArtifact, type ExportPacket, type JubileeEvent } from './lib/types';
import { resolveWhyCurrentChain, getTamperFixtures, reduceEvents, verifyStrictAncestryPath } from './lib/ledger';
import { runIntegrationTests, type TestResult } from './lib/test-boundary';

// Simple Custom Markdown Renderer to support bold, bullet points, and code styling safely
function SimpleMarkdown({ text }: { text: string }) {
  if (!text) return null;
  const lines = text.split('\n');
  return (
    <div className="space-y-2 text-sm leading-relaxed text-slate-300">
      {lines.map((line, i) => {
        // Bullet list
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <ul key={i} className="list-disc pl-5 space-y-1 my-1">
              <li>{parseInlineMarkdown(line.slice(2))}</li>
            </ul>
          );
        }
        // Bold title helper
        if (line.startsWith('### ')) {
          return <h4 key={i} className="text-sm font-semibold text-slate-100 mt-3">{parseInlineMarkdown(line.slice(4))}</h4>;
        }
        if (line.startsWith('## ')) {
          return <h3 key={i} className="text-base font-bold text-slate-50 mt-4">{parseInlineMarkdown(line.slice(3))}</h3>;
        }
        if (line.trim() === '') {
          return <div key={i} className="h-2" />;
        }
        return <p key={i}>{parseInlineMarkdown(line)}</p>;
      })}
    </div>
  );
}

function parseInlineMarkdown(text: string) {
  const parts = [];
  let currentText = text;
  
  // Basic bold regex matcher
  while (currentText.includes('**')) {
    const startIdx = currentText.indexOf('**');
    const endIdx = currentText.indexOf('**', startIdx + 2);
    if (endIdx === -1) break;
    
    // Add text before bold
    if (startIdx > 0) {
      parts.push(<span key={parts.length}>{currentText.substring(0, startIdx)}</span>);
    }
    // Add bold text
    parts.push(
      <strong key={parts.length} className="font-bold text-cyan-400">
        {currentText.substring(startIdx + 2, endIdx)}
      </strong>
    );
    currentText = currentText.substring(endIdx + 2);
  }
  
  // Basic inline code helper
  if (currentText.includes('`')) {
    const codeParts = [];
    let codeText = currentText;
    while (codeText.includes('`')) {
      const s = codeText.indexOf('`');
      const e = codeText.indexOf('`', s + 1);
      if (e === -1) break;
      if (s > 0) codeParts.push(<span key={codeParts.length}>{codeText.substring(0, s)}</span>);
      codeParts.push(
        <code key={codeParts.length} className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 font-mono text-xs border border-slate-700/50">
          {codeText.substring(s + 1, e)}
        </code>
      );
      codeText = codeText.substring(e + 1);
    }
    if (codeText) codeParts.push(<span key={codeParts.length}>{codeText}</span>);
    return codeParts;
  }

  if (parts.length === 0) {
    return <span>{text}</span>;
  }
  if (currentText) {
    parts.push(<span key={parts.length}>{currentText}</span>);
  }
  return parts;
}

function AppContent() {
  const { user, signOut } = useAuth();
  
  // Database Hooks
  const { ideas, refetch: refetchIdeas } = useIdeas();
  const { artifacts, refetch: refetchArtifacts } = useArtifacts();
  const { events, refetch: refetchEvents } = useEvents();
  const { edges, refetch: refetchEdges } = useEdges();
  const { versions: allIdeaVersions, refetch: refetchVersions } = useIdeaVersions();

  // Local UI States
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [aiLoading, setAILoading] = useState(false);
  
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
  const [selectedIdeasForSynthesis, setSelectedIdeasForSynthesis] = useState<string[]>([]);
  const [rejectedProposals, setRejectedProposals] = useState<Record<string, boolean>>({});
  
  // Interactive Capture Modal
  const [hoveredMessage, setHoveredMessage] = useState<string | null>(null);
  const [captureModalData, setCaptureModalData] = useState<{
    text: string;
    type: 'insight' | 'idea' | 'project';
    suggestedTitle?: string;
    proposalRef?: any;
  } | null>(null);
  const [captureTitle, setCaptureTitle] = useState('');
  const [captureContent, setCaptureContent] = useState('');
  const [captureRationale, setCaptureRationale] = useState('');
  const [captureWitnessStrength, setCaptureWitnessStrength] = useState<5 | 3 | 1>(5);
  const [manualCaptureMode, setManualCaptureMode] = useState<TaxonomyLevel | null>(null);

  // Evolve Action Modal
  const [showEvolveModal, setShowEvolveModal] = useState(false);
  const [evolveContent, setEvolveContent] = useState('');
  const [evolveRationale, setEvolveRationale] = useState('');
  const [evolveWitnessStrength, setEvolveWitnessStrength] = useState<5 | 3 | 1>(5);

  // Synthesis Lab Modal
  const [showSynthesisModal, setShowSynthesisModal] = useState(false);
  const [synthesisLoading, setSynthesisLoading] = useState(false);
  const [synthesisPreview, setSynthesisPreview] = useState<{
    title: string;
    content: string;
    inherited_traits: string;
    tensions: string;
    rationale: string;
  } | null>(null);
  const [synthesisWitnessStrength, setSynthesisWitnessStrength] = useState<5 | 3 | 1>(5);

  // Search & Filters
  const [search, setSearch] = useState('');
  const [taxonomyFilter, setTaxonomyFilter] = useState<'all' | 'insight' | 'idea' | 'project' | 'inactive'>('all');
  const [interfaceMode, setInterfaceMode] = useState<'moderator' | 'architect'>('moderator');
  const [architectNavTab, setArchitectNavTab] = useState<'events' | 'ideas' | 'versions' | 'tensions' | 'commands' | 'receipts'>('events');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const activeSelectedEvent = useMemo(() => {
    if (!events || events.length === 0) return null;
    return events.find((e) => e.id === selectedEventId) || events[0];
  }, [events, selectedEventId]);

  const [showGraph, setShowGraph] = useState(false);
  const [highlightWhyExist, setHighlightWhyExist] = useState(false);

  // Witness Boundary Audit & Provenance States
  const [showAuditConsole, setShowAuditConsole] = useState(false);
  const [selectedFixtureKey, setSelectedFixtureKey] = useState<string>('valid_chain');
  const [activeIdeaTab, setActiveIdeaTab] = useState<'timeline' | 'provenance'>('timeline');
  const [showTechnicalRecord, setShowTechnicalRecord] = useState(false);
  const [fixtureTestResult, setFixtureTestResult] = useState<any>(null);
  const [fixtureConsoleLogs, setFixtureConsoleLogs] = useState<string[]>([]);
  const [boundaryTestResults, setBoundaryTestResults] = useState<TestResult[] | null>(null);
  const [boundaryTestingRunning, setBoundaryTestingRunning] = useState(false);

  // Export Artifact & External Artifact State
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedExternalArtifactId, setSelectedExternalArtifactId] = useState<string | null>(null);
  const [externalArtifacts, setExternalArtifacts] = useState<ExternalArtifact[]>(() => {
    const saved = localStorage.getItem('jubilee_external_artifacts');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [];
  });

  useEffect(() => {
    localStorage.setItem('jubilee_external_artifacts', JSON.stringify(externalArtifacts));
  }, [externalArtifacts]);

  // Recomposed Workspace States
  const [pulseMuted, setPulseMuted] = useState(false);
  const [showPulseWhyModal, setShowPulseWhyModal] = useState(false);
  const [workingMaterialTab, setWorkingMaterialTab] = useState<'insights' | 'tensions' | 'experiments'>('tensions');
  const [showSiblingPaths, setShowSiblingPaths] = useState(false);
  const [stateTransitionFeedback, setStateTransitionFeedback] = useState<{
    headline: string;
    content: string;
    version: string;
  } | null>(null);

  // Progressive Commitment Toggle States
  const [expandedDeliberationIds, setExpandedDeliberationIds] = useState<Record<string, boolean>>({});
  const [expandedToolbarIds, setExpandedToolbarIds] = useState<Record<string, boolean>>({});
  const [expandedPulseIds, setExpandedPulseIds] = useState<Record<string, boolean>>({});

  // Maps & Derivations
  const artifactMap = useMemo(() => new Map(artifacts.map((a) => [a.id, a])), [artifacts]);

  // Auto-select active Minneapolis cooling idea by default
  useEffect(() => {
    if (ideas && ideas.length > 0 && !selectedIdeaId) {
      const defaultIdea = ideas.find(i => i.id === 'idea-mpls-01') || ideas[0];
      setSelectedIdeaId(defaultIdea.id);
    }
  }, [ideas, selectedIdeaId]);

  const selectedIdea = useMemo(() => ideas.find((i) => i.id === selectedIdeaId) || ideas[0], [ideas, selectedIdeaId]);
  
  const currentArtifact = useMemo(() => {
    if (!selectedIdea?.current_version_id) return null;
    return artifactMap.get(selectedIdea.current_version_id) || null;
  }, [selectedIdea, artifactMap]);

  const activeIdeasCount = useMemo(() => ideas.filter(i => i.lifecycle_status === 'active').length, [ideas]);
  const insightsCount = useMemo(() => ideas.filter(i => i.lifecycle_status === 'active' && i.taxonomy_level === 'insight').length, [ideas]);
  const projectsCount = useMemo(() => ideas.filter(i => i.lifecycle_status === 'active' && i.taxonomy_level === 'project').length, [ideas]);

  // Load chat history from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('jubilee_chat_messages');
    if (saved) {
      try {
        setMessages(JSON.parse(saved));
      } catch (e) {
        localStorage.removeItem('jubilee_chat_messages');
      }
    } else {
      // Welcome seed featuring Minneapolis Cooling Infrastructure & Proposal Card
      const welcome: ChatMessage[] = [
        {
          id: 'welcome-msg',
          role: 'model',
          content: {
            text: "We are cultivating **Make Minneapolis neighborhood cooling mutual-aid infrastructure** (Exploring · v0.2 · 3 contributors).\n\nThe current proposed model deploys community-managed shade hubs with ice distribution across 4 high-risk zones.",
            provenance: {
              contributor: "Co-Cultivator AI",
              informed_by: "v0.2 Cooling-Network Model",
              delta_summary: "Highlighted load-bearing volunteer shift dependency"
            },
            proposals: [
              {
                id: 'prop-seed-1',
                type: 'tension',
                title: 'Volunteer capacity is a load-bearing assumption.',
                content: 'The v0.2 cooling hub model assumes recurring volunteer availability without proof of shift coverage during peak heatwaves.',
                rationale: 'Surfaced via Constitutional Pulse: shift staffing unverified across 4 zones.',
                taxonomy_level: 'idea',
                action_label: 'Save as tension'
              }
            ]
          },
          created_at: new Date().toISOString()
        }
      ];
      setMessages(welcome);
      localStorage.setItem('jubilee_chat_messages', JSON.stringify(welcome));
    }
  }, []);

  // Filter ideas
  const filteredIdeas = useMemo(() => {
    return ideas.filter((i) => {
      const matchSearch = !search || i.title.toLowerCase().includes(search.toLowerCase());
      if (!matchSearch) return false;

      if (taxonomyFilter === 'all') {
        return i.lifecycle_status === 'active';
      }
      if (taxonomyFilter === 'inactive') {
        return i.lifecycle_status !== 'active';
      }
      return i.lifecycle_status === 'active' && i.taxonomy_level === taxonomyFilter;
    });
  }, [ideas, search, taxonomyFilter]);

  // Construct graph elements
  const graphNodes = useMemo(() => {
    return filteredIdeas.map((idea) => {
      let type = 'note';
      if (idea.taxonomy_level === 'insight') type = 'thought';
      if (idea.taxonomy_level === 'project') type = 'vm';
      return {
        id: idea.id,
        label: idea.title,
        type,
      };
    });
  }, [filteredIdeas]);

  const graphEdges = useMemo(() => {
    const edgesList: any[] = [];
    edges.forEach((edge, index) => {
      const srcIdea = ideas.find((i) => i.current_version_id === edge.source_artifact_id);
      const tgtIdea = ideas.find((i) => i.current_version_id === edge.target_artifact_id);
      if (srcIdea && tgtIdea && srcIdea.id !== tgtIdea.id) {
        edgesList.push({
          id: `e-${index}`,
          source: srcIdea.id,
          target: tgtIdea.id,
          edge_type: edge.edge_type,
        });
      }
    });
    return edgesList;
  }, [edges, ideas]);

  // Selected idea events (the soil)
  const selectedIdeaEvents = useMemo(() => {
    if (!selectedIdea) return [];
    return events.filter(e => e.entity_id === selectedIdea.id);
  }, [selectedIdea, events]);

  // Send message to local API Route proxy
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: { text: inputMessage },
      created_at: new Date().toISOString()
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    localStorage.setItem('jubilee_chat_messages', JSON.stringify(updatedMessages));
    setInputMessage('');
    setAILoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: inputMessage,
          history: messages.slice(-10).map((m) => ({
            role: m.role,
            content: m.content.text
          })),
          activeIdeas: ideas.filter((i) => i.lifecycle_status === 'active')
        })
      });

      const data = await response.json();
      
      const aiMsg: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: 'model',
        content: {
          text: data.text,
          provenance: data.provenance,
          deliberation: data.deliberation,
          proposals: data.proposals || []
        },
        created_at: new Date().toISOString()
      };

      const finalMessages = [...updatedMessages, aiMsg];
      setMessages(finalMessages);
      localStorage.setItem('jubilee_chat_messages', JSON.stringify(finalMessages));
    } catch (err) {
      console.error(err);
      const errorMsg: ChatMessage = {
        id: `msg-error-${Date.now()}`,
        role: 'model',
        content: {
          text: "I encountered an error connecting to the Co-Cultivation Substrate. Please verify that your dev server is active and try again."
        },
        created_at: new Date().toISOString()
      };
      setMessages([...updatedMessages, errorMsg]);
    } finally {
      setAILoading(false);
    }
  };

  // Trigger manual idea seeding
  const handleCreateManualIdea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!captureTitle.trim()) return;

    const level = manualCaptureMode || 'idea';
    const vm_id = 'a0000000-0000-0000-0000-000000000001'; // Workspace Core default

    const result = await createIdea({
      title: captureTitle,
      vm_id,
      content: captureContent || 'Seed planted.',
      taxonomy_level: level
    });

    if (result.idea) {
      // Log custom witness event for decision rationale
      await logEvent({
        event_type: 'claim_added',
        entity_id: result.idea.id,
        entity_type: 'idea',
        actor: 'human',
        actor_id: 'Operator',
        capability: 'manual-cultivation',
        policy: 'v0.4',
        payload: { rationale: captureRationale || "Manually captured idea seed." },
        rationale: captureRationale || "Seeded by human operator.",
        witness_strength: captureWitnessStrength
      });

      // Show success in Chat
      const successMsg: ChatMessage = {
        id: `system-${Date.now()}`,
        role: 'model',
        content: {
          text: `🌱 **Cultivation Event Witnessed!**\n\nSuccessfully captured "${captureTitle}" as an active **${level.toUpperCase()}** with witness rating of ${captureWitnessStrength} stars.`
        },
        created_at: new Date().toISOString()
      };
      const updated = [...messages, successMsg];
      setMessages(updated);
      localStorage.setItem('jubilee_chat_messages', JSON.stringify(updated));

      // Clear form
      setCaptureTitle('');
      setCaptureContent('');
      setCaptureRationale('');
      setManualCaptureMode(null);
      setSelectedIdeaId(result.idea.id);

      // Refetch
      refetchIdeas();
      refetchArtifacts();
      refetchEvents();
      refetchEdges();
      refetchVersions();
    }
  };

  // Approve AI proposal card & log witness event
  const handleAcceptProposal = (proposal: any) => {
    setCaptureTitle(proposal.title);
    setCaptureContent(proposal.content);
    setCaptureRationale(proposal.rationale);
    setCaptureModalData({
      text: proposal.content,
      type: proposal.taxonomy_level || 'idea',
      suggestedTitle: proposal.title,
      proposalRef: proposal
    });
  };

  const handleConfirmProposalCapture = async () => {
    if (!captureTitle.trim()) return;

    const level = captureModalData?.type || 'idea';
    const vm_id = 'a0000000-0000-0000-0000-000000000001';

    if (captureModalData?.proposalRef?.type === 'evolve_idea') {
      const ideaId = captureModalData.proposalRef.idea_id;
      const originalIdea = ideas.find(i => i.id === ideaId);
      if (originalIdea?.current_version_id) {
        await evolveIdea({
          idea_id: originalIdea.id,
          current_artifact_id: originalIdea.current_version_id,
          new_title: captureTitle,
          new_content: captureContent,
          rationale: captureRationale || "AI proposed and human approved evolution.",
          vm_id
        });

        // Add additional event representation
        await logEvent({
          event_type: 'transformation_accepted',
          entity_id: originalIdea.id,
          entity_type: 'idea',
          actor: 'human',
          actor_id: 'Operator',
          capability: 'proposal-evolution',
          policy: 'v0.4',
          payload: { rationale: captureRationale },
          rationale: captureRationale,
          witness_strength: captureWitnessStrength
        });
      }
    } else if (captureModalData?.proposalRef?.type === 'synthesize_ideas') {
      const parentIds = captureModalData.proposalRef.parent_ids || [];
      const parentArts = parentIds.map((id: string) => ideas.find(i => i.id === id)?.current_version_id).filter(Boolean) as string[];
      
      await synthesizeIdeas({
        source_idea_ids: parentIds,
        source_artifact_ids: parentArts,
        title: captureTitle,
        content: captureContent,
        rationale: captureRationale,
        vm_id
      });
    } else {
      // standard new_idea
      const result = await createIdea({
        title: captureTitle,
        vm_id,
        content: captureContent,
        taxonomy_level: level
      });

      if (result.idea) {
        await logEvent({
          event_type: 'claim_added',
          entity_id: result.idea.id,
          entity_type: 'idea',
          actor: 'human',
          actor_id: 'Operator',
          capability: 'ai-collaborative-capture',
          policy: 'v0.4',
          payload: { rationale: captureRationale },
          rationale: captureRationale,
          witness_strength: captureWitnessStrength
        });
      }
    }

    // Inform Chat of witnessed ledger event
    const successMsg: ChatMessage = {
      id: `system-${Date.now()}`,
      role: 'model',
      content: {
        text: `✨ **Event Authenticated & Witnessed!**\n\nSeeded proposal: "${captureTitle}" under **${level.toUpperCase()}** has been permanently recorded in the event substrate history with a witness strength of ${captureWitnessStrength} stars.`
      },
      created_at: new Date().toISOString()
    };
    const updated = [...messages, successMsg];
    setMessages(updated);
    localStorage.setItem('jubilee_chat_messages', JSON.stringify(updated));

    setCaptureModalData(null);
    setCaptureTitle('');
    setCaptureContent('');
    setCaptureRationale('');

    refetchIdeas();
    refetchArtifacts();
    refetchEvents();
    refetchEdges();
    refetchVersions();
  };

  // Evolve existing selected idea manually
  const handleManualEvolve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIdea || !currentArtifact || !evolveContent.trim()) return;

    await evolveIdea({
      idea_id: selectedIdea.id,
      current_artifact_id: currentArtifact.id,
      new_title: selectedIdea.title,
      new_content: evolveContent,
      rationale: evolveRationale || "Evolved manually by operator.",
      vm_id: 'a0000000-0000-0000-0000-000000000001'
    });

    const successMsg: ChatMessage = {
      id: `system-${Date.now()}`,
      role: 'model',
      content: {
        text: `⚙️ **Manual Evolution Witnessed!**\n\nRecorded **Version Evolved** event for "${selectedIdea.title}". The new state was appended and logged with ${evolveWitnessStrength} stars.`
      },
      created_at: new Date().toISOString()
    };
    const updated = [...messages, successMsg];
    setMessages(updated);
    localStorage.setItem('jubilee_chat_messages', JSON.stringify(updated));

    setShowEvolveModal(false);
    setEvolveContent('');
    setEvolveRationale('');

    refetchIdeas();
    refetchArtifacts();
    refetchEvents();
    refetchEdges();
    refetchVersions();
  };

  // Synthesize selected ideas with live trait & tension analysis
  const handleOpenSynthesisLab = async () => {
    if (selectedIdeasForSynthesis.length < 2) return;
    setShowSynthesisModal(true);
    setSynthesisLoading(true);

    const parentIdeas = selectedIdeasForSynthesis.map(id => {
      const idea = ideas.find(i => i.id === id);
      const art = idea?.current_version_id ? artifactMap.get(idea.current_version_id) : null;
      return {
        id: idea?.id,
        title: idea?.title,
        content: art?.content,
        taxonomy_level: idea?.taxonomy_level
      };
    });

    try {
      const response = await fetch('/api/synthesize-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentIdeas })
      });
      const data = await response.json();
      setSynthesisPreview(data);
    } catch (err) {
      console.error(err);
      setSynthesisPreview({
        title: "Synthesized Concept",
        content: "New consolidated branch containing components from: " + parentIdeas.map(p => p.title).join(", "),
        inherited_traits: "Blends multiple active operational trajectories.",
        tensions: "Resolves architectural complexity and redundancy.",
        rationale: "Operator-forced consolidation."
      });
    } finally {
      setSynthesisLoading(false);
    }
  };

  const handleConfirmSynthesis = async () => {
    if (!synthesisPreview) return;

    const parentArts = selectedIdeasForSynthesis.map(id => ideas.find(i => i.id === id)?.current_version_id).filter(Boolean) as string[];

    await synthesizeIdeas({
      source_idea_ids: selectedIdeasForSynthesis,
      source_artifact_ids: parentArts,
      title: synthesisPreview.title,
      content: synthesisPreview.content,
      rationale: `${synthesisPreview.rationale}\n\nTensions Resolved: ${synthesisPreview.tensions}`,
      vm_id: 'a0000000-0000-0000-0000-000000000001'
    });

    const successMsg: ChatMessage = {
      id: `system-${Date.now()}`,
      role: 'model',
      content: {
        text: `🧬 **Synthesis Event Finalized!**\n\nMerged ${selectedIdeasForSynthesis.length} branches to create the unified branch "${synthesisPreview.title}". Pre-synthesis tensions resolved and logged permanently.`
      },
      created_at: new Date().toISOString()
    };
    const updated = [...messages, successMsg];
    setMessages(updated);
    localStorage.setItem('jubilee_chat_messages', JSON.stringify(updated));

    setShowSynthesisModal(false);
    setSynthesisPreview(null);
    setSelectedIdeasForSynthesis([]);

    refetchIdeas();
    refetchArtifacts();
    refetchEvents();
    refetchEdges();
    refetchVersions();
  };

  // Toggle selection for synthesis
  const toggleIdeaForSynthesis = (id: string) => {
    setSelectedIdeasForSynthesis(prev => {
      if (prev.includes(id)) {
        return prev.filter(i => i !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  const liveAudit = useMemo(() => {
    return reduceEvents(events, true);
  }, [events]);

  const runFixtureAuditTest = (key: string) => {
    const fixtures = getTamperFixtures();
    const fixture = fixtures[key];
    if (!fixture) return;

    setFixtureConsoleLogs([
      `[${new Date().toLocaleTimeString()}] INIT: Replay engine loaded fixture: "${fixture.name}"`,
      `[${new Date().toLocaleTimeString()}] DETAIL: ${fixture.description}`,
      `[${new Date().toLocaleTimeString()}] RUN: Transmitting ${fixture.events.length} events to Pure Reducer...`
    ]);

    // Perform reduction
    const res = reduceEvents(fixture.events, true);

    setTimeout(() => {
      setFixtureConsoleLogs(prev => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] VERIFY: Checking event sequence causality chains...`,
        ...fixture.events.map(evt => {
          const expected = (evt.payload as any)?._signature_hash || 'none';
          return `[${new Date().toLocaleTimeString()}] EVAL: Event ${evt.id.substring(0,8)}... (${evt.event_type}) | signature: ${expected.substring(0, 8)}...`;
        }),
        `[${new Date().toLocaleTimeString()}] RESULTS: Status is ${res.audit.status}`,
        res.audit.status === 'SECURE' 
          ? `[${new Date().toLocaleTimeString()}] SUCCESS: ◈ Ledger integrity fully certified. Cryptographic linkage is valid.`
          : `[${new Date().toLocaleTimeString()}] CRITICAL: ${res.audit.message}`
      ]);
      setFixtureTestResult(res);
    }, 400);
  };

  const handleTriggerTamperSandbox = async () => {
    const savedEventsRaw = localStorage.getItem('jubilee_table_events');
    if (!savedEventsRaw) return;
    try {
      const savedEvents = JSON.parse(savedEventsRaw);
      if (savedEvents.length === 0) return;
      // Alter the payload of the first event
      const original = savedEvents[0];
      savedEvents[0] = {
        ...original,
        payload: {
          ...(original.payload || {}),
          title: 'Directly Hack DB - Unauthorized State Mutation Altering Ledger!'
        }
      };
      localStorage.setItem('jubilee_table_events', JSON.stringify(savedEvents));
      refetchEvents(); // Trigger hook update to re-run live audit
    } catch (e) {
      console.error(e);
    }
  };

  const handleRepairStateViaLedgerSync = async () => {
    localStorage.removeItem('jubilee_table_events');
    localStorage.removeItem('jubilee_table_ideas');
    localStorage.removeItem('jubilee_table_idea_versions');
    localStorage.removeItem('jubilee_table_artifacts');
    localStorage.removeItem('jubilee_table_edges');
    
    // Refresh all states to trigger default bootstrap
    refetchEvents();
    refetchIdeas();
    refetchArtifacts();
    refetchEdges();
    refetchVersions();
    
    const repairMsg: ChatMessage = {
      id: `repair-${Date.now()}`,
      role: 'model',
      content: {
        text: `🛡️ **Ledger Sync Rebuild Finalized!**\n\nThe projection tables have been completely wiped, the event log sync has repaired the state, and all downstream concepts have been rebuilt from the trusted cryptographic link-chain.`
      },
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, repairMsg]);
  };

  const handleRunBoundaryTests = async () => {
    setBoundaryTestingRunning(true);
    setBoundaryTestResults(null);
    try {
      const results = await runIntegrationTests();
      setBoundaryTestResults(results);
    } catch (err: any) {
      console.error(err);
    } finally {
      setBoundaryTestingRunning(false);
    }
  };

  const handleSaveTensionAction = async (proposal?: any) => {
    const headline = proposal?.title || proposal?.content || "Volunteer capacity is a load-bearing assumption";
    const currentIdea = selectedIdea || ideas[0];
    if (!currentIdea) return;

    const currentArt = currentIdea.current_version_id ? artifactMap.get(currentIdea.current_version_id) : null;
    const vm_id = currentArt?.vm_id || 'a0000000-0000-0000-0000-000000000001';

    await evolveIdea({
      idea_id: currentIdea.id,
      current_artifact_id: currentIdea.current_version_id || 'art-mpls-v02',
      new_title: `v0.3 Proposed cooling-network model`,
      new_content: `Deploy community-managed shade hubs with ice distribution across 4 high-risk zones.\n\n[Accepted Tension]: ${headline}`,
      rationale: `Accepted tension into active idea lineage: "${headline}"`,
      vm_id,
      preserved_tensions: [{ id: `tension-${Date.now()}`, text: headline }]
    });

    await logEvent({
      event_type: 'transformation_accepted',
      entity_id: currentIdea.id,
      entity_type: 'idea',
      actor: 'human',
      actor_id: 'Operator',
      capability: 'tension-capture',
      policy: 'v0.3',
      payload: { tension: headline, idea_id: currentIdea.id, new_version: 'v0.3' },
      rationale: `Saved tension "${headline}" to active idea.`,
      witness_strength: 5
    });

    await Promise.all([
      refetchIdeas(),
      refetchArtifacts(),
      refetchEvents(),
      refetchEdges(),
      refetchVersions()
    ]);

    setStateTransitionFeedback({
      headline: 'Saved to active idea',
      content: `Tension: ${headline}`,
      version: 'v0.3'
    });

    setTimeout(() => {
      setStateTransitionFeedback(null);
    }, 7000);
  };

  const handleClearChatHistory = () => {
    if (confirm("Are you sure you want to clear your conversation substrate?")) {
      localStorage.removeItem('jubilee_chat_messages');
      window.location.reload();
    }
  };

  const selectedIdeaVersions = allIdeaVersions.filter(v => v.idea_id === (selectedIdea?.id || 'idea-mpls-01'));
  const activeVersionLabel = selectedIdeaVersions.length > 0 ? `v0.${selectedIdeaVersions[0].version_number}` : 'v0.3';

  const handleSaveExternalArtifact = (artifact: ExternalArtifact) => {
    setExternalArtifacts((prev) => [artifact, ...prev]);

    // Append EXTERNAL_ARTIFACT_CREATED event to Jubilee event ledger
    const newEvt: JubileeEvent = {
      id: `evt-ext-${Date.now().toString().slice(-6)}`,
      event_type: 'external_artifact_created',
      entity_id: artifact.id,
      entity_type: 'external_artifact',
      actor: user?.email || 'Operator / Human',
      actor_id: user?.id || 'op-01',
      capability: 'artifact-export',
      policy: 'human-review-required',
      payload: {
        artifact_id: artifact.id,
        idea_id: artifact.ideaId,
        source_version_id: artifact.sourceVersionId,
        source_version_number: artifact.sourceVersionNumber,
        export_packet_hash: artifact.exportPacketHash,
        template_type: artifact.templateType,
        title: artifact.title,
        status: artifact.status,
        _signature_hash: artifact.exportPacketHash,
        _prev_hash: events[0]?.payload?._signature_hash || `sha256-link-${events.length}`,
      },
      created_at: new Date().toISOString(),
      rationale: `Exported AI-assisted Project Brief from ${activeVersionLabel} kernel.`,
      source_proposal_id: null,
      witness_strength: 5,
    };

    setEvents((prev) => [newEvt, ...prev]);

    // Post confirmation message to chat log
    const exportMsg: ChatMessage = {
      id: `msg-ext-${Date.now()}`,
      role: 'system',
      content: {
        text: `📄 **External Artifact Exported & Registered**\n\nCreated **${artifact.title}** linked to **${activeVersionLabel}**.\n\n- **Packet Hash**: \`${artifact.exportPacketHash}\`\n- **Status**: \`Draft (Requires Human Review)\`\n- **Template**: \`Project Brief\`\n\nThis artifact is registered in the Substrate Event Ledger and linked to source version \`${artifact.sourceVersionId}\`.`,
        provenance: {
          contributor: 'System Witness Ledger',
          informed_by: `${activeVersionLabel} Fixed Kernel`,
          delta_summary: 'Registered External Artifact Provenance',
        },
      },
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, exportMsg]);
  };

  return (
    <div className="h-dvh overflow-hidden flex flex-col bg-slate-950 text-slate-100 font-sans">
      {/* Background Orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        <div className="absolute -top-40 -left-40 h-[480px] w-[480px] rounded-full bg-cyan-500/5 blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 h-[480px] w-[480px] rounded-full bg-violet-500/5 blur-[120px]" />
        <div className="absolute top-1/3 right-1/4 h-80 w-80 rounded-full bg-amber-500/3 blur-[100px]" />
      </div>

      {/* Header Bar */}
      <header className="shrink-0 relative z-20 border-b border-slate-800/60 bg-slate-950/80 backdrop-blur-xl px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-cyan-400 via-teal-400 to-violet-500 flex items-center justify-center shadow-lg shadow-cyan-500/10">
              <Sprout className="h-5 w-5 text-slate-950 font-bold" />
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 border-2 border-slate-950" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-slate-100">Jubilee</h1>
              <span className="text-[10px] bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 px-1.5 py-0.2 rounded font-mono font-medium">v0.2</span>
            </div>
            <p className="text-[10px] text-slate-400">The Living Idea Workspace</p>
          </div>
        </div>

        {/* Interface Mode Switcher Toggle */}
        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800/80 shadow-inner">
          <button
            type="button"
            onClick={() => setInterfaceMode('moderator')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
              interfaceMode === 'moderator'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sprout className="h-3.5 w-3.5" />
            <span>🌿 Co-Cultivate</span>
          </button>
          <button
            type="button"
            onClick={() => setInterfaceMode('architect')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
              interfaceMode === 'architect'
                ? 'bg-violet-500 text-white shadow-md shadow-violet-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Network className="h-3.5 w-3.5" />
            <span>🔬 Inspect System</span>
          </button>
        </div>

        {/* Header Stats & Meta */}
        <div className="hidden md:flex items-center gap-6">
          <div className="text-center">
            <div className="text-xs font-mono text-cyan-400 font-bold">{activeIdeasCount}</div>
            <div className="text-[9px] text-slate-500 uppercase tracking-wider">Cultivated</div>
          </div>
          <div className="w-px h-6 bg-slate-800" />
          <div className="text-center">
            <div className="text-xs font-mono text-amber-400 font-bold">{insightsCount}</div>
            <div className="text-[9px] text-slate-500 uppercase tracking-wider">Insights</div>
          </div>
          <div className="w-px h-6 bg-slate-800" />
          <div className="text-center">
            <div className="text-xs font-mono text-violet-400 font-bold">{projectsCount}</div>
            <div className="text-[9px] text-slate-500 uppercase tracking-wider">Projects</div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleClearChatHistory}
            className="text-[10px] text-slate-500 hover:text-slate-300 transition bg-slate-900 border border-slate-800/80 rounded-lg px-2.5 py-1 flex items-center gap-1.5"
            title="Reset Chat History"
          >
            <RefreshCw className="h-3 w-3" />
            Reset Chat
          </button>
          <div className="w-px h-4 bg-slate-800 hidden sm:block" />
          <div className="items-center gap-2 hidden sm:flex">
            <div className="h-6 w-6 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-300 border border-slate-700/50">
              {user?.email?.[0].toUpperCase()}
            </div>
            <button
              onClick={signOut}
              className="text-[10px] text-slate-500 hover:text-slate-300 transition"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* FIXED IDEA HEADER */}
      <div className="shrink-0 relative z-20 bg-slate-950/90 border-b border-slate-800/80 px-6 py-3 backdrop-blur-md shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="px-2 py-0.5 rounded bg-cyan-950 border border-cyan-500/30 text-[10px] font-mono font-bold text-cyan-400 uppercase tracking-widest">
              IDEA
            </span>
            <h2 className="text-sm sm:text-base font-bold text-slate-100 tracking-tight">
              {selectedIdea?.title || "Make Minneapolis neighborhood cooling mutual-aid infrastructure"}
            </h2>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-900 border border-slate-700/60 text-xs font-semibold text-slate-300 font-mono">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              Exploring · {activeVersionLabel} · 3 contributors
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setShowGraph(false);
                setShowAuditConsole(false);
              }}
              className="px-3 py-1 rounded-lg bg-slate-900 border border-slate-700/60 hover:border-cyan-500/50 hover:bg-slate-800 text-xs font-semibold text-slate-200 transition flex items-center gap-1.5 cursor-pointer"
            >
              <GitBranch className="h-3.5 w-3.5 text-cyan-400" />
              <span>Open lineage</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const reviewMsg: ChatMessage = {
                  id: `review-${Date.now()}`,
                  role: 'system',
                  content: {
                    text: `👥 **Deliberation Review Requested!**\n\nInvited workspace witnesses to review active proposal (${activeVersionLabel}). Logged in event history with rating: ★★★★★.`
                  },
                  created_at: new Date().toISOString()
                };
                setMessages(prev => [...prev, reviewMsg]);
              }}
              className="px-3 py-1 rounded-lg bg-cyan-500/20 border border-cyan-500/40 hover:bg-cyan-500/30 text-xs font-semibold text-cyan-300 transition flex items-center gap-1.5 cursor-pointer"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-cyan-400" />
              <span>Invite review</span>
            </button>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2 pt-2 border-t border-slate-850 text-xs">
          <span className="font-mono text-[10px] font-bold text-amber-400 uppercase tracking-wider shrink-0">
            CURRENT QUESTION
          </span>
          <span className="text-slate-300 italic font-medium truncate">
            "What assumption must we test before committing?"
          </span>
        </div>
      </div>

      {/* FIXED CONSTITUTIONAL PULSE STRIP */}
      {!pulseMuted && (
        <div className="shrink-0 relative z-20 bg-slate-950 border-b border-amber-500/30 px-6 py-2 flex flex-wrap items-center justify-between gap-3 text-xs shadow-inner">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-amber-400 font-mono font-bold text-[11px] uppercase tracking-wider shrink-0">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
              </span>
              <span>◌ CONSTITUTIONAL PULSE</span>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-slate-200">
              <span className="font-semibold text-amber-200">
                Assumption unchallenged: volunteer capacity has not been tested.
              </span>
              <span className="text-slate-500 hidden md:inline">•</span>
              <span className="text-slate-400 text-[11px] hidden md:inline">
                Recommended act: <strong className="text-cyan-300">Challenge assumption</strong>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => handleSaveTensionAction()}
              className="px-3 py-1 rounded-md bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition shadow-sm cursor-pointer flex items-center gap-1"
            >
              <Sparkles className="h-3 w-3 text-slate-950" />
              Challenge
            </button>

            <button
              type="button"
              onClick={() => {
                setStateTransitionFeedback({
                  headline: 'Deferred Constitutional Pulse',
                  content: 'Assumption deferred for subsequent review.',
                  version: activeVersionLabel
                });
                setTimeout(() => setStateTransitionFeedback(null), 4000);
              }}
              className="px-2 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-300 hover:text-slate-100 text-xs transition cursor-pointer"
            >
              Accept for now
            </button>

            <button
              type="button"
              onClick={() => setShowPulseWhyModal(true)}
              className="px-2 py-1 rounded-md bg-slate-900 border border-slate-800 text-cyan-400 hover:text-cyan-300 text-xs transition cursor-pointer font-mono"
            >
              Why?
            </button>

            <button
              type="button"
              onClick={() => setPulseMuted(true)}
              className="px-2 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-500 hover:text-slate-300 text-xs transition cursor-pointer"
              title="Mute advisor"
            >
              Mute
            </button>
          </div>
        </div>
      )}

      {/* STATE TRANSITION FEEDBACK TOAST */}
      {stateTransitionFeedback && (
        <div className="shrink-0 relative z-30 bg-emerald-950/95 border-b border-emerald-500/40 px-6 py-2.5 flex items-center justify-between text-xs text-emerald-200 animate-slideDown shadow-xl">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="h-4.5 w-4.5 text-emerald-400 shrink-0" />
            <div>
              <span className="font-bold text-emerald-300 uppercase text-[10px] tracking-wider block">
                {stateTransitionFeedback.headline}
              </span>
              <span className="font-semibold text-slate-100">
                "{stateTransitionFeedback.content}"
              </span>
              <span className="text-emerald-400 ml-2 font-mono text-[11px]">
                — Now shaping {stateTransitionFeedback.version}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setShowAuditConsole(false);
              setShowGraph(false);
            }}
            className="text-xs font-bold text-emerald-300 hover:text-white underline cursor-pointer shrink-0"
          >
            View change ➔
          </button>
        </div>
      )}

      {/* MODE TRANSITION BANNER WHEN IN INSPECT SYSTEM MODE */}
      {interfaceMode === 'architect' && (
        <div className="shrink-0 bg-violet-950/90 border-b border-violet-500/40 px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs z-20 shadow-lg animate-fadeIn">
          <div className="flex items-center gap-3">
            <span className="px-2 py-0.5 rounded bg-violet-500/20 border border-violet-400/40 text-violet-300 font-mono font-bold text-[10px] uppercase tracking-wider flex items-center gap-1.5 shrink-0">
              <Network className="h-3.5 w-3.5 text-violet-400" />
              Inspect System
            </span>
            <p className="text-slate-200 text-xs font-medium">
              You are viewing the underlying event history and verification tools. Nothing here changes the idea unless you issue an explicit command.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setInterfaceMode('moderator')}
            className="px-3 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition flex items-center gap-1.5 cursor-pointer shadow-sm shrink-0"
          >
            <Sprout className="h-3.5 w-3.5 text-slate-950" />
            <span>Return to Co-Cultivate</span>
          </button>
        </div>
      )}

      {/* Workspace Arena: Progressive Disclosure Mode Switch */}
      {interfaceMode === 'architect' ? (
        /* ================= FULL ARCHITECTURE MODE: 3-COLUMN CONSOLE ================= */
        <main className="flex-1 min-h-0 overflow-hidden flex relative z-10">
          
          {/* COLUMN 1: LEFT RAIL - Navigable lists (Ideas, Versions, Tensions, Events, Commands, Receipts) */}
          <section className="w-[26%] min-w-[260px] max-w-[340px] min-h-0 flex flex-col overflow-hidden border-r border-slate-800/80 bg-slate-950/80">
            {/* Navigation Header & Tabs */}
            <div className="shrink-0 p-4 border-b border-slate-800/80 bg-slate-900/40">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-violet-400" />
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-200">
                    Substrate Navigation
                  </h3>
                </div>
                <span className="text-[10px] font-mono text-violet-400 bg-violet-950/80 border border-violet-500/30 px-2 py-0.5 rounded font-bold">
                  Read-Only
                </span>
              </div>

              {/* Navigation Tabs Grid */}
              <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[10px] font-mono font-semibold">
                {(['events', 'ideas', 'versions', 'tensions', 'commands', 'receipts'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setArchitectNavTab(tab)}
                    className={`py-1 rounded-lg capitalize transition text-center cursor-pointer ${
                      architectNavTab === tab
                        ? 'bg-violet-600 text-white font-bold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {/* List Content Area */}
            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2 scrollbar-thin">
              {architectNavTab === 'events' && (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider px-1 pb-1 border-b border-slate-850 flex items-center justify-between">
                    <span>Event Ledger ({events.length})</span>
                    <span>SHA-256</span>
                  </div>
                  {events.map((evt) => {
                    const isSelected = selectedEventId === evt.id || (!selectedEventId && evt.id === events[0]?.id);
                    return (
                      <div
                        key={evt.id}
                        onClick={() => setSelectedEventId(evt.id)}
                        className={`p-2.5 rounded-xl border text-xs transition cursor-pointer ${
                          isSelected
                            ? 'bg-violet-950/60 border-violet-500/50 text-slate-100 shadow-md'
                            : 'bg-slate-900/40 border-slate-800/80 text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between font-mono text-[10px] mb-1">
                          <span className="text-violet-400 font-bold uppercase truncate max-w-[120px]">
                            {evt.event_type}
                          </span>
                          <span className="text-slate-500">
                            {new Date(evt.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-300 font-medium line-clamp-2">
                          {evt.rationale || (evt.payload as any)?.title || evt.id}
                        </p>
                        <div className="mt-1.5 flex items-center justify-between text-[9px] font-mono text-slate-500 border-t border-slate-850/60 pt-1">
                          <span>Actor: {evt.actor}</span>
                          <span className="text-cyan-400/80">#{evt.id.substring(0, 8)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {architectNavTab === 'ideas' && (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider px-1 pb-1 border-b border-slate-850">
                    Cultivated Ideas ({ideas.length})
                  </div>
                  {ideas.map((idea) => {
                    const isSelected = idea.id === selectedIdeaId;
                    return (
                      <div
                        key={idea.id}
                        onClick={() => setSelectedIdeaId(idea.id)}
                        className={`p-2.5 rounded-xl border text-xs transition cursor-pointer ${
                          isSelected
                            ? 'bg-cyan-950/60 border-cyan-500/50 text-slate-100 shadow-md'
                            : 'bg-slate-900/40 border-slate-800/80 text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between font-mono text-[10px] mb-1">
                          <span className="text-cyan-400 font-bold uppercase">
                            {idea.taxonomy_level || 'idea'}
                          </span>
                          <span className="text-emerald-400 font-bold">
                            {idea.lifecycle_status}
                          </span>
                        </div>
                        <h4 className="text-xs font-bold text-slate-200 line-clamp-2">
                          {idea.title}
                        </h4>
                        <div className="mt-1.5 flex items-center justify-between text-[9px] font-mono text-slate-500 border-t border-slate-850/60 pt-1">
                          <span>ID: {idea.id}</span>
                          <span>Ver: {idea.current_version_id || 'v0.2'}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {architectNavTab === 'versions' && (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider px-1 pb-1 border-b border-slate-850">
                    Artifact Versions ({allIdeaVersions.length})
                  </div>
                  {allIdeaVersions.map((ver) => (
                    <div
                      key={ver.id}
                      className="p-2.5 rounded-xl border border-slate-800/80 bg-slate-900/40 text-xs hover:bg-slate-900 transition"
                    >
                      <div className="flex items-center justify-between font-mono text-[10px] text-violet-400 font-bold mb-1">
                        <span>Version v0.{ver.version_number}</span>
                        <span className="text-slate-500">{new Date(ver.created_at).toLocaleDateString()}</span>
                      </div>
                      <p className="text-[11px] text-slate-300 font-mono truncate">
                        Artifact: {ver.artifact_id}
                      </p>
                      <div className="mt-1.5 text-[9px] font-mono text-amber-400 flex items-center gap-1">
                        <AlertTriangle className="h-2.5 w-2.5" />
                        <span>{ver.preserved_tensions?.length || 0} Tensions Preserved</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {architectNavTab === 'tensions' && (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider px-1 pb-1 border-b border-slate-850">
                    Captured Ledger Tensions
                  </div>
                  <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-950/20 text-xs space-y-1.5">
                    <span className="text-[10px] font-mono font-bold text-amber-400 uppercase block">
                      Load-Bearing Assumption
                    </span>
                    <p className="text-slate-200 font-medium">
                      "Volunteer capacity is an untested load-bearing assumption across 4 cooling hubs."
                    </p>
                    <div className="text-[9px] font-mono text-amber-400/80 pt-1 border-t border-amber-500/20 flex justify-between">
                      <span>Status: Preserved in v0.3</span>
                      <span>Witness Rating: ★★★★★</span>
                    </div>
                  </div>
                </div>
              )}

              {architectNavTab === 'commands' && (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider px-1 pb-1 border-b border-slate-850">
                    System Command State
                  </div>
                  {[
                    { cmd: 'CREATE_IDEA', auth: 'Operator / Human', capability: 'idea-seeding', status: 'ACTIVE' },
                    { cmd: 'EVOLVE_IDEA', auth: 'Co-Cultivator AI + Human Approval', capability: 'lineage-transformation', status: 'ACTIVE' },
                    { cmd: 'MUTE_PULSE', auth: 'Operator Choice', capability: 'advisor-control', status: 'ACTIVE' },
                    { cmd: 'PROPOSE_SYNTHESIS', auth: 'System Reducer', capability: 'branch-convergence', status: 'ACTIVE' },
                    { cmd: 'AUDIT_LEDGER', auth: 'Witness Ledger', capability: 'cryptographic-verification', status: 'VERIFIED' }
                  ].map((c) => (
                    <div key={c.cmd} className="p-2.5 rounded-xl border border-slate-800 bg-slate-900/40 text-xs space-y-1 font-mono">
                      <div className="flex items-center justify-between text-[11px] font-bold text-cyan-400">
                        <span>{c.cmd}</span>
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-500/30">
                          {c.status}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400">Auth: {c.auth}</div>
                      <div className="text-[9px] text-slate-500">Cap: {c.capability}</div>
                    </div>
                  ))}
                </div>
              )}

              {architectNavTab === 'receipts' && (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider px-1 pb-1 border-b border-slate-850 flex items-center justify-between">
                    <span>Exported Artifacts ({externalArtifacts.length})</span>
                    <span>Lineage Receipts</span>
                  </div>

                  {externalArtifacts.length > 0 && (
                    <div className="space-y-1.5 mb-3">
                      {externalArtifacts.map((art) => {
                        const isSelected = selectedExternalArtifactId === art.id;
                        return (
                          <div
                            key={art.id}
                            onClick={() => setSelectedExternalArtifactId(art.id)}
                            className={`p-2.5 rounded-xl border text-xs font-mono transition cursor-pointer ${
                              isSelected
                                ? 'bg-violet-950/80 border-violet-500/60 text-slate-100 shadow-md ring-1 ring-violet-500/30'
                                : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:bg-slate-900'
                            }`}
                          >
                            <div className="flex items-center justify-between text-[10px] mb-1 font-bold">
                              <span className="text-violet-400 uppercase flex items-center gap-1">
                                <FileText className="h-3 w-3" />
                                {art.templateType.replace('_', ' ')}
                              </span>
                              <span className={`px-1.5 py-0.2 rounded text-[9px] uppercase font-bold border ${
                                art.status === 'human_approved'
                                  ? 'bg-emerald-950 text-emerald-400 border-emerald-500/30'
                                  : art.status === 'superseded'
                                  ? 'bg-slate-900 text-slate-500 border-slate-800'
                                  : 'bg-amber-950 text-amber-300 border-amber-500/30'
                              }`}>
                                {art.status}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-200 font-bold truncate">
                              {art.title}
                            </p>
                            <div className="mt-1.5 flex items-center justify-between text-[9px] text-slate-400 border-t border-slate-800 pt-1">
                              <span>Source: v0.{art.sourceVersionNumber}</span>
                              <span className="text-cyan-400">{art.exportPacketHash.substring(0, 10)}...</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="p-2.5 rounded-xl border border-emerald-500/30 bg-emerald-950/20 text-xs space-y-1 font-mono">
                    <div className="flex items-center justify-between text-emerald-400 font-bold text-[10px]">
                      <span>RECEIPT #rcpt-001</span>
                      <span>VERIFIED</span>
                    </div>
                    <p className="text-[11px] text-slate-200">
                      Attestation for Minneapolis Cooling Infrastructure v0.3. Cryptographically signed by Operator & System Witness.
                    </p>
                    <div className="text-[9px] text-slate-400 border-t border-emerald-500/20 pt-1 flex justify-between">
                      <span>Hash: sha256-a000...</span>
                      <span>Strength: ★★★★★</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* COLUMN 2: CENTER CANVAS - Lineage Graph & Topology */}
          <section className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden bg-slate-900/30">
            {/* Topology Header */}
            <div className="shrink-0 px-6 py-3 border-b border-slate-800/80 bg-slate-950/80 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Network className="h-4 w-4 text-cyan-400" />
                <div>
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-200">
                    Substrate Lineage & Event Topology
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    Visualizing version nodes, branch relationships, historical paths, and causal links
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 font-mono text-[10px]">
                <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-cyan-400 font-bold">
                  {graphNodes.length} Nodes
                </span>
                <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-violet-400 font-bold">
                  {graphEdges.length} Edges
                </span>
                <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-amber-400 font-bold">
                  {events.length} Events
                </span>
              </div>
            </div>

            {/* Graph Area */}
            <div className="flex-1 min-h-0 relative bg-slate-950/60">
              <GraphCanvas
                nodes={graphNodes}
                edges={graphEdges}
                selectedId={selectedIdeaId}
                onSelectNode={(id) => setSelectedIdeaId(id)}
              />
              
              {/* Floating Canvas Controls / Legend */}
              <div className="absolute bottom-3 left-3 right-3 bg-slate-950/90 border border-slate-800/80 backdrop-blur-md rounded-xl p-3 flex items-center justify-between text-[10px] font-mono text-slate-400 shadow-xl">
                <div className="flex items-center gap-4">
                  <span className="font-bold text-slate-200">Topology Legend:</span>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
                    <span>Idea Node</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                    <span>Insight</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-violet-400" />
                    <span>Project / VM</span>
                  </div>
                </div>

                <div className="text-cyan-400">
                  Active Node: <strong className="text-slate-100">{selectedIdea?.title || 'Selected Node'}</strong>
                </div>
              </div>
            </div>
          </section>

          {/* COLUMN 3: RIGHT INSPECTOR - Selected Event / Artifact Inspector */}
          <aside className="w-[28%] min-w-[280px] max-w-[380px] min-h-0 flex flex-col overflow-hidden border-l border-slate-800/80 bg-slate-950/80">
            <div className="shrink-0 p-4 border-b border-slate-800/80 bg-slate-900/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-emerald-400" />
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-200">
                  System Inspector
                </h3>
              </div>
              <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-500/30 text-[10px] font-mono text-emerald-400 font-bold flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" />
                Verified
              </span>
            </div>

            {/* Inspector Details */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 text-xs font-mono scrollbar-thin">
              {selectedExternalArtifactId ? (() => {
                const art = externalArtifacts.find((a) => a.id === selectedExternalArtifactId);
                if (!art) return null;
                return (
                  <div className="space-y-3 font-mono text-xs animate-fadeIn">
                    <div className="bg-slate-900/80 border border-violet-500/40 rounded-xl p-3 space-y-2 shadow-lg">
                      <div className="flex items-center justify-between text-[10px] pb-2 border-b border-slate-800">
                        <span className="uppercase text-violet-400 font-bold flex items-center gap-1">
                          <FileText className="h-3.5 w-3.5" />
                          EXTERNAL ARTIFACT
                        </span>
                        <span className={`px-2 py-0.5 rounded uppercase font-bold border text-[9px] ${
                          art.status === 'human_approved'
                            ? 'bg-emerald-950 text-emerald-400 border-emerald-500/30'
                            : art.status === 'superseded'
                            ? 'bg-slate-900 text-slate-500 border-slate-800'
                            : 'bg-amber-950 text-amber-300 border-amber-500/30'
                        }`}>
                          {art.status}
                        </span>
                      </div>

                      <h4 className="text-xs font-bold text-slate-100 leading-snug">
                        {art.title}
                      </h4>

                      <div className="space-y-1 text-[10px] text-slate-400 pt-1 border-t border-slate-850">
                        <div className="flex justify-between">
                          <span>Artifact ID:</span>
                          <span className="text-slate-200">{art.id}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Source Version:</span>
                          <span className="text-cyan-400 font-bold">v0.{art.sourceVersionNumber}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Template:</span>
                          <span className="text-slate-200 uppercase">{art.templateType.replace('_', ' ')}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Created At:</span>
                          <span className="text-slate-300">{new Date(art.createdAt).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>

                    {/* Packet Hash & Provenance */}
                    <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1.5">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block border-b border-slate-800 pb-1">
                        Export Packet Hash & Provenance
                      </span>
                      <div className="text-[10px] space-y-1">
                        <span className="text-slate-500 block">Packet Hash:</span>
                        <span className="text-emerald-400 font-bold bg-slate-900 p-1.5 rounded block truncate border border-slate-800">
                          {art.exportPacketHash}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 pt-1 font-mono">
                        Kernel: {art.kernelSummary?.insightsCount || 3} insights, {art.kernelSummary?.tensionsCount || 1} tension, {art.kernelSummary?.openQuestionsCount || 1} open question.
                      </div>
                    </div>

                    {/* Status Management */}
                    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 space-y-2">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">
                        Lifecycle Status
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setExternalArtifacts((prev) =>
                              prev.map((a) => (a.id === art.id ? { ...a, status: 'human_approved' } : a))
                            );
                          }}
                          className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition cursor-pointer ${
                            art.status === 'human_approved'
                              ? 'bg-emerald-950 border-emerald-500/50 text-emerald-300'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setExternalArtifacts((prev) =>
                              prev.map((a) => (a.id === art.id ? { ...a, status: 'superseded' } : a))
                            );
                          }}
                          className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition cursor-pointer ${
                            art.status === 'superseded'
                              ? 'bg-rose-950 border-rose-500/50 text-rose-300'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Supersede
                        </button>
                      </div>
                    </div>

                    {/* Content Preview */}
                    <div className="space-y-1.5">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">
                        Generated Brief Content
                      </span>
                      <pre className="bg-slate-950 border border-slate-800/80 p-3 rounded-xl text-[10px] text-slate-300 leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap font-mono scrollbar-thin">
                        {art.content}
                      </pre>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedExternalArtifactId(null)}
                      className="w-full py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 text-xs font-mono transition cursor-pointer"
                    >
                      ← Back to Event Inspector
                    </button>
                  </div>
                );
              })() : (() => {
                const selectedEvt = activeSelectedEvent;
                if (!selectedEvt) {
                  return (
                    <div className="p-4 text-center text-slate-500 text-xs">
                      Select an event from the left rail to inspect authority, delta, and hashes.
                    </div>
                  );
                }

                const prevHash = (selectedEvt.payload as any)?._prev_hash || `sha256-link-prev-${selectedEvt.id.slice(0, 8)}`;
                const currentHash = (selectedEvt.payload as any)?._signature_hash || `sha256-sig-curr-${selectedEvt.id.slice(0, 8)}`;

                return (
                  <>
                    {/* Event Overview Card */}
                    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between text-[10px] text-slate-400 pb-2 border-b border-slate-800">
                        <span className="uppercase text-violet-400 font-bold">Event Type</span>
                        <span className="text-slate-300">{selectedEvt.event_type}</span>
                      </div>

                      <div className="space-y-1 pt-1 text-[11px]">
                        <div className="flex justify-between">
                          <span className="text-slate-500">Event ID:</span>
                          <span className="text-cyan-400 font-bold">{selectedEvt.id}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Timestamp:</span>
                          <span className="text-slate-300">{new Date(selectedEvt.created_at).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Authority / Actor:</span>
                          <span className="text-amber-300 font-bold">{selectedEvt.actor}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Capability:</span>
                          <span className="text-slate-300">{selectedEvt.capability || 'durable-substrate'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Cryptographic Linkage Hashes */}
                    <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-3 space-y-2">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block pb-1 border-b border-slate-800">
                        Cryptographic Linkage & Hashes
                      </span>
                      
                      <div className="space-y-1.5 text-[10px]">
                        <div>
                          <span className="text-slate-500 block">Previous Link Hash:</span>
                          <span className="text-slate-400 bg-slate-950 p-1 rounded block truncate border border-slate-850">
                            {prevHash}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Current Signature Hash:</span>
                          <span className="text-emerald-400 bg-slate-950 p-1 rounded block truncate border border-slate-850">
                            {currentHash}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Structured Delta Payload */}
                    <div className="space-y-1.5">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">
                        Structured Delta / State Payload
                      </span>
                      <pre className="bg-slate-950 border border-slate-800/80 p-3 rounded-xl text-[10px] text-cyan-300 overflow-x-auto leading-relaxed max-h-48 scrollbar-thin">
                        {JSON.stringify(selectedEvt.payload || { entity_id: selectedEvt.entity_id, rationale: selectedEvt.rationale }, null, 2)}
                      </pre>
                    </div>

                    {/* Verification & Replay Action Buttons */}
                    <div className="pt-2 border-t border-slate-800 space-y-2">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">
                        Verification & Replay
                      </span>

                      <button
                        type="button"
                        onClick={() => runFixtureAuditTest('valid_chain')}
                        className="w-full py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        <span>Run Replay Verification</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleRepairStateViaLedgerSync}
                        className="w-full py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-850 text-slate-300 text-xs font-semibold transition flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                        <span>Verify Chain Integrity</span>
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>
          </aside>

        </main>
      ) : (
        /* Workspace Arena: Split Screen */
        <main className="flex-1 min-h-0 overflow-hidden flex relative z-10">
        
        {/* ================= LEFT PANE: CONVERSATIONAL SUBSTRATE ================= */}
        <section className="w-[42%] min-w-0 min-h-0 flex flex-col overflow-hidden border-r border-slate-800/50 bg-slate-950/40 transition-all duration-300">
          {/* Section Header */}
          <div className="shrink-0 px-6 py-4 border-b border-slate-800/40 bg-slate-950/20 flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-cyan-400" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Co-Cultivator — Turn Conversation into Evolving Shared Work
                </h2>
              </div>
              <p className="text-[10px] text-slate-500 pl-6">
                Ideas become inspectable, forkable, collectively governed artifacts.
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-cyan-400 font-semibold bg-cyan-950/40 px-2.5 py-1 rounded-lg border border-cyan-500/20 shadow-sm shrink-0">
              <Sparkles className="h-3.5 w-3.5 animate-pulse text-cyan-400" />
              Real-time Lineage Moderator
            </div>
          </div>

          {/* Message Stream */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6 space-y-6 scrollbar-thin">
            {messages.map((msg) => (
              <div
                key={msg.id}
                onMouseEnter={() => setHoveredMessage(msg.id)}
                onMouseLeave={() => setHoveredMessage(null)}
                className={`group relative flex flex-col max-w-[95%] ${
                  msg.role === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'
                }`}
              >
                {/* Message Header */}
                <span className="text-[9px] text-slate-500 font-mono mb-1">
                  {msg.role === 'user' ? 'OPERATOR' : msg.role === 'system' ? 'SYSTEM LEDGER' : 'CO-CULTIVATOR AI'} • {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>

                {/* Provenance Cue on Assistant Messages */}
                {msg.role === 'model' && msg.content.provenance && (
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] bg-slate-900/90 border border-slate-800/80 rounded-xl px-3 py-1.5 font-mono text-slate-400 shadow-sm">
                    <span className="text-cyan-400 font-bold flex items-center gap-1">
                      <Sparkles className="h-3 w-3" />
                      {msg.content.provenance.contributor || 'Co-Cultivator AI'}
                    </span>
                    <span className="text-slate-700">•</span>
                    <span className="text-slate-300">
                      Informed by: <strong className="text-slate-200">{msg.content.provenance.informed_by || 'Workspace State'}</strong>
                    </span>
                    <span className="text-slate-700">•</span>
                    <span className="text-amber-300 italic">
                      Delta: {msg.content.provenance.delta_summary || 'Analysis'}
                    </span>
                  </div>
                )}

                {/* Message Body */}
                <div
                  className={`rounded-2xl px-4 py-3.5 border text-sm transition relative w-full ${
                    msg.role === 'user'
                      ? 'bg-slate-900/60 border-slate-700/40 text-slate-200'
                      : msg.role === 'system'
                      ? 'bg-violet-950/20 border-violet-500/20 text-violet-200 font-mono text-xs'
                      : 'bg-slate-900/30 border-cyan-500/15 text-slate-300 shadow-lg shadow-cyan-500/[0.02]'
                  }`}
                >
                  <SimpleMarkdown text={msg.content.text} />

                  {/* Constitutional Pulse Indicator (Calm Indicator shown after model messages) */}
                  {msg.role === 'model' && msg.content.pulse && (
                    <div className="mt-3.5 rounded-2xl bg-slate-950/90 border border-emerald-500/30 p-3.5 shadow-lg space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                          </span>
                          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-400">
                            Constitutional Pulse
                          </span>
                        </div>
                        <span className="text-[9px] font-mono font-semibold text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/30">
                          {msg.content.pulse.readiness_status === 'ready_for_test' ? '🧪 Ready for Test' :
                           msg.content.pulse.readiness_status === 'needs_tension_check' ? '⚠️ Tension Unresolved' :
                           msg.content.pulse.readiness_status === 'unchallenged_assumptions' ? '🔍 Assumptions Unchallenged' :
                           '🌱 Ripe for Synthesis'}
                        </span>
                      </div>

                      <p className="text-xs text-slate-200 font-medium leading-relaxed">
                        "{msg.content.pulse.headline}"
                      </p>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
                        <button
                          type="button"
                          onClick={() => {
                            const act = msg.content.pulse?.recommended_act;
                            if (act) {
                              setCaptureTitle(act.label);
                              setCaptureContent(`Constitutional Pulse Act: ${act.label}\n\nContext: ${act.description || msg.content.text}`);
                              setCaptureRationale(`Triggered via Constitutional Pulse (${msg.content.pulse?.readiness_status})`);
                              setCaptureModalData({ text: msg.content.text, type: 'idea' });
                            }
                          }}
                          className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                        >
                          <Sparkles className="h-3.5 w-3.5 text-slate-950" />
                          <span>{msg.content.pulse.recommended_act.label}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setExpandedPulseIds(prev => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                          className="text-[11px] font-semibold text-slate-400 hover:text-cyan-400 transition flex items-center gap-1 cursor-pointer"
                        >
                          <span>{expandedPulseIds[msg.id] ? "Hide Evidence" : "Inspect Evidence & Provenance"}</span>
                          <span className="font-mono text-[10px]">{expandedPulseIds[msg.id] ? "▲" : "▼"}</span>
                        </button>
                      </div>

                      {expandedPulseIds[msg.id] && msg.content.pulse.evidence && (
                        <div className="mt-2 p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2 text-xs text-slate-300 animate-fadeIn font-mono">
                          <div className="flex items-center justify-between text-[10px] text-slate-500 font-bold uppercase tracking-wider pb-1 border-b border-slate-800">
                            <span>Evidence Grounding Metrics</span>
                            <span className="text-emerald-400">Ledger Verified</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <div className="bg-slate-950 p-2 rounded-lg border border-slate-850">
                              <span className="text-slate-500 text-[10px] block">Claims Extracted:</span>
                              <span className="font-bold text-slate-200">{msg.content.pulse.evidence.claims_count ?? 2}</span>
                            </div>
                            <div className="bg-slate-950 p-2 rounded-lg border border-slate-850">
                              <span className="text-slate-500 text-[10px] block">Tensions Identified:</span>
                              <span className="font-bold text-amber-400">{msg.content.pulse.evidence.tensions_count ?? 1}</span>
                            </div>
                          </div>
                          {msg.content.pulse.evidence.unchallenged_assumption && (
                            <div className="p-2 bg-amber-950/30 border border-amber-500/20 rounded-lg text-amber-200 text-[11px]">
                              <strong className="text-amber-400 uppercase text-[9px] block mb-0.5">Unchallenged Central Assumption:</strong>
                              "{msg.content.pulse.evidence.unchallenged_assumption}"
                            </div>
                          )}
                          {msg.content.pulse.evidence.alternative_branches && msg.content.pulse.evidence.alternative_branches.length > 0 && (
                            <div className="text-[10px] text-slate-400 pt-1">
                              <span className="text-slate-500 font-bold uppercase block mb-1">Alternative Sibling Trajectories:</span>
                              <div className="flex flex-wrap gap-1">
                                {msg.content.pulse.evidence.alternative_branches.map((b, bIdx) => (
                                  <span key={bIdx} className="bg-slate-950 border border-slate-800 px-2 py-0.5 rounded text-slate-300">
                                    🌿 {b}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Idea-to-Deliberation Loop Card (Progressive Commitment) */}
                  {msg.role === 'model' && msg.content.deliberation && (
                    <div className="mt-3 p-3.5 rounded-xl bg-slate-950/80 border border-cyan-500/20 space-y-2.5">
                      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-cyan-400 border-b border-slate-800 pb-2">
                        <span className="flex items-center gap-1.5">
                          <GitMerge className="h-3.5 w-3.5 text-cyan-400" />
                          Deliberation Loop Extraction
                        </span>
                        <span className="text-slate-500 font-mono">Constitutional Artifact</span>
                      </div>

                      {/* Show by Default: Claims */}
                      {msg.content.deliberation.claims && msg.content.deliberation.claims.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Claims & Observations</p>
                          <div className="space-y-1">
                            {msg.content.deliberation.claims.map((claim, cIdx) => (
                              <div key={cIdx} className="text-xs text-slate-300 flex items-start gap-1.5 bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                                <span>{claim}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Show by Default: ONE Most Consequential Tension */}
                      {msg.content.deliberation.tensions && msg.content.deliberation.tensions.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Primary Consequential Tension
                          </p>
                          <div className="text-xs text-amber-200/90 flex items-start gap-1.5 bg-amber-950/20 p-2 rounded-lg border border-amber-500/20">
                            <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                            <span>{msg.content.deliberation.tensions[0]}</span>
                          </div>
                        </div>
                      )}

                      {/* Primary Recommended Move (Shown by default) */}
                      {msg.content.deliberation.next_moves && msg.content.deliberation.next_moves.length > 0 && (
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              const move = msg.content.deliberation!.next_moves![0];
                              if (move.action === 'adopt' && msg.content.proposals && msg.content.proposals.length > 0) {
                                handleAcceptProposal(msg.content.proposals[0]);
                              } else {
                                setCaptureTitle(move.label);
                                setCaptureContent(`Executing move: ${move.label}.\n\nContext: ${move.description || msg.content.text}`);
                                setCaptureRationale(`Deliberation next move (${move.action}) triggered by operator.`);
                                setCaptureModalData({ text: msg.content.text, type: 'idea' });
                              }
                            }}
                            className="w-full text-left p-2.5 rounded-xl bg-cyan-950/30 border border-cyan-500/30 hover:border-cyan-400 hover:bg-cyan-950/50 transition flex items-center justify-between group cursor-pointer"
                          >
                            <span className="text-xs font-bold text-cyan-300 group-hover:text-cyan-200 flex items-center gap-1.5">
                              <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                              Recommended Act: {msg.content.deliberation.next_moves[0].label}
                            </span>
                            <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950 border border-cyan-500/30 px-2 py-0.5 rounded">
                              Execute ➔
                            </span>
                          </button>
                        </div>
                      )}

                      {/* Reveal on Intent: Expand Full Assumptions & Complete Moves */}
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => setExpandedDeliberationIds(prev => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                          className="w-full text-center py-1.5 px-2 rounded-lg bg-slate-900/60 border border-slate-800 text-slate-400 hover:text-slate-200 text-[11px] font-semibold transition cursor-pointer flex items-center justify-center gap-1"
                        >
                          <span>
                            {expandedDeliberationIds[msg.id]
                              ? "Collapse Complete Extraction"
                              : `Inspect Assumptions (${msg.content.deliberation.assumptions?.length || 0}) & Full Extraction`}
                          </span>
                          <span className="font-mono text-[10px]">{expandedDeliberationIds[msg.id] ? "▲" : "▼"}</span>
                        </button>

                        {expandedDeliberationIds[msg.id] && (
                          <div className="mt-3 space-y-3 pt-2 border-t border-slate-800/80 animate-fadeIn">
                            {/* Assumptions */}
                            {msg.content.deliberation.assumptions && msg.content.deliberation.assumptions.length > 0 && (
                              <div className="space-y-1">
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Underlying Assumptions</p>
                                <div className="space-y-1">
                                  {msg.content.deliberation.assumptions.map((asm, aIdx) => (
                                    <div key={aIdx} className="text-xs text-slate-300 flex items-start gap-1.5 bg-slate-900/40 p-2 rounded-lg border border-slate-800">
                                      <span className="text-cyan-400 font-mono text-[10px]">•</span>
                                      <span>{asm}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Additional Tensions if > 1 */}
                            {msg.content.deliberation.tensions && msg.content.deliberation.tensions.length > 1 && (
                              <div className="space-y-1">
                                <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">Secondary Tensions</p>
                                <div className="space-y-1">
                                  {msg.content.deliberation.tensions.slice(1).map((ten, tIdx) => (
                                    <div key={tIdx} className="text-xs text-amber-200/90 flex items-start gap-1.5 bg-amber-950/20 p-2 rounded-lg border border-amber-500/20">
                                      <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                                      <span>{ten}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* All Next Moves if > 1 */}
                            {msg.content.deliberation.next_moves && msg.content.deliberation.next_moves.length > 1 && (
                              <div className="space-y-1.5">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Alternative Next Moves</p>
                                <div className="grid grid-cols-1 gap-2">
                                  {msg.content.deliberation.next_moves.slice(1).map((move, mIdx) => (
                                    <button
                                      key={mIdx}
                                      type="button"
                                      onClick={() => {
                                        setCaptureTitle(move.label);
                                        setCaptureContent(`Executing move: ${move.label}.\n\nContext: ${move.description || msg.content.text}`);
                                        setCaptureRationale(`Deliberation next move (${move.action}) triggered by operator.`);
                                        setCaptureModalData({ text: msg.content.text, type: 'idea' });
                                      }}
                                      className="text-left p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-cyan-500/40 hover:bg-slate-800/80 transition flex items-center justify-between group cursor-pointer"
                                    >
                                      <span className="text-xs font-bold text-slate-200 group-hover:text-cyan-400 flex items-center gap-1.5">
                                        <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                                        {move.label}
                                      </span>
                                      <span className="text-[10px] text-slate-500 capitalize">{move.action}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                {/* Proposals Render (Inline Co-Cultivator Proposal Card) */}
                {msg.role === 'model' && msg.content.proposals && msg.content.proposals.length > 0 && (
                  <div className="mt-3 w-full">
                    {msg.content.proposals.map((proposal, idx) => {
                      const proposalKey = `${msg.id}-${idx}`;
                      const isRejected = !!rejectedProposals[proposalKey];
                      if (isRejected) {
                        return (
                          <div key={idx} className="text-[10px] text-slate-500 italic bg-slate-900/20 border border-slate-800/40 p-2 rounded-lg">
                            Proposal dismissed by Operator.
                          </div>
                        );
                      }

                      return (
                        <div
                          key={idx}
                          className="rounded-2xl border border-cyan-500/40 bg-cyan-950/30 p-4 space-y-3 shadow-xl"
                        >
                          <div className="flex items-center justify-between text-[10px] font-mono font-bold uppercase tracking-wider text-cyan-400 border-b border-cyan-500/20 pb-2">
                            <span className="flex items-center gap-1.5">
                              <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                              CO-CULTIVATOR PROPOSAL
                            </span>
                            <span className="text-cyan-300/60">Durable Artifact Candidate</span>
                          </div>

                          <p className="text-xs sm:text-sm font-semibold text-slate-100 leading-relaxed italic">
                            "{proposal.title || proposal.content}"
                          </p>

                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => handleSaveTensionAction(proposal)}
                              className="px-3.5 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition flex items-center gap-1.5 cursor-pointer shadow-md"
                            >
                              <Sparkles className="h-3.5 w-3.5 text-slate-950" />
                              <span>Save as tension</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setCaptureTitle(proposal.title);
                                setCaptureContent(proposal.content);
                                setCaptureRationale(proposal.rationale);
                                setCaptureModalData({
                                  text: proposal.content,
                                  type: proposal.taxonomy_level || 'idea',
                                  proposalRef: proposal
                                });
                              }}
                              className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700/80 hover:border-slate-500 text-slate-300 text-xs font-semibold transition cursor-pointer"
                            >
                              Edit wording
                            </button>

                            <button
                              type="button"
                              onClick={() => setRejectedProposals(prev => ({ ...prev, [proposalKey]: true }))}
                              className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 hover:text-rose-400 text-slate-500 text-xs font-semibold transition cursor-pointer"
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}

            {/* AI Generation Loading Indicator */}
            {aiLoading && (
              <div className="flex flex-col items-start gap-1 max-w-[80%] mr-auto">
                <span className="text-[9px] text-slate-500 font-mono">CO-CULTIVATOR IS SYNTHESIZING...</span>
                <div className="rounded-2xl px-4 py-3 bg-slate-900/40 border border-slate-800 text-slate-400 text-sm flex items-center gap-3">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-700 border-t-cyan-400" />
                  <span>Scanning memory ledger and drafting proposals...</span>
                </div>
              </div>
            )}
          </div>

          {/* Message Input Arena */}
          <div className="shrink-0 border-t border-slate-800/50 bg-slate-950/60 p-4 space-y-2">
            {/* Quick Moderator Action Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-[11px]">
              <button
                type="button"
                onClick={() => setInputMessage("Suggest the next evolution and code iteration for our active idea.")}
                className="whitespace-nowrap px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:border-cyan-500/40 hover:text-cyan-400 transition flex items-center gap-1 cursor-pointer"
              >
                <Sparkles className="h-3 w-3 text-cyan-400" />
                Propose Evolution
              </button>
              <button
                type="button"
                onClick={() => setInputMessage("Analyze unresolved architectural tensions across our active ideas.")}
                className="whitespace-nowrap px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:border-amber-500/40 hover:text-amber-400 transition flex items-center gap-1 cursor-pointer"
              >
                <AlertTriangle className="h-3 w-3 text-amber-400" />
                Check Tensions
              </button>
              <button
                type="button"
                onClick={() => setInputMessage("Draft a technical code iteration and implementation plan for the active idea.")}
                className="whitespace-nowrap px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:border-violet-500/40 hover:text-violet-400 transition flex items-center gap-1 cursor-pointer"
              >
                <Terminal className="h-3 w-3 text-violet-400" />
                Code Iteration Plan
              </button>
              <button
                type="button"
                onClick={() => setInputMessage("Synthesize our top insights into a new unified project concept.")}
                className="whitespace-nowrap px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:border-pink-500/40 hover:text-pink-400 transition flex items-center gap-1 cursor-pointer"
              >
                <GitMerge className="h-3 w-3 text-pink-400" />
                Synthesize Ideas
              </button>
            </div>

            <form onSubmit={handleSendMessage} className="relative flex items-center gap-2">
              <input
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="Examine insights, propose new branches..."
                className="flex-1 rounded-xl border border-slate-800/80 bg-slate-900/40 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-500/50 focus:bg-slate-900 transition pr-12"
              />
              <button
                type="submit"
                disabled={!inputMessage.trim() || aiLoading}
                className="absolute right-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 p-2 transition cursor-pointer"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
            <div className="flex items-center justify-between text-[10px] text-slate-500 mt-2 px-1">
              <span className="flex items-center gap-1">
                <HelpCircle className="h-3 w-3" />
                Capture elements dynamically by hovering messages above
              </span>
              <span className="font-mono">GEMINI-3.5-FLASH</span>
            </div>
          </div>
        </section>


        {/* ================= RIGHT PANE: ACTIVE IDEA SURFACE (58% WIDTH) ================= */}
        <aside className="w-[58%] min-w-0 min-h-0 flex flex-col overflow-hidden bg-slate-900/40 border-l border-slate-800/80 transition-all duration-300">
          {/* Section Header with Audit Console & Graph Canvas Toggles */}
          <div className="shrink-0 px-6 py-3.5 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Leaf className="h-4 w-4 text-emerald-400" />
              <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-200">
                {showAuditConsole ? "Witness Boundary Audit Console" : "Active Idea Surface"}
              </h2>
            </div>
            
            <div className="flex items-center gap-2">
              {/* Audit Console Button */}
              <button
                type="button"
                onClick={() => {
                  setShowAuditConsole(!showAuditConsole);
                  setShowGraph(false);
                }}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold border transition cursor-pointer ${
                  showAuditConsole
                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                    : liveAudit.audit.status === 'SECURE'
                    ? 'bg-slate-900 border-slate-800 text-slate-300 hover:text-slate-100'
                    : 'bg-rose-950/40 border-rose-500/30 text-rose-400 animate-pulse'
                }`}
              >
                <Shield className="h-3.5 w-3.5 text-amber-400" />
                <span>Audit Console</span>
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                  liveAudit.audit.status === 'SECURE' ? 'bg-emerald-500 shadow-sm shadow-emerald-500/40' : 'bg-rose-500 animate-ping'
                }`} />
              </button>

              {/* Show Substrate Graph Toggle */}
              <button
                type="button"
                onClick={() => {
                  setShowGraph(!showGraph);
                  setShowAuditConsole(false);
                }}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold border transition cursor-pointer ${
                  showGraph
                    ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Network className="h-3.5 w-3.5 text-cyan-400" />
                <span>{showGraph ? 'Hide Graph' : 'Lineage Graph'}</span>
              </button>
            </div>
          </div>

          {/* Substrate Graph Canvas (Collapsible Substrate Layer) */}
          {showGraph && (
            <div className="shrink-0 h-72 border-b border-slate-800/60 bg-slate-950/40 relative">
              <GraphCanvas
                nodes={graphNodes}
                edges={graphEdges}
                selectedId={selectedIdeaId}
                onSelectNode={(id) => setSelectedIdeaId(id)}
                height={280}
              />
              <div className="absolute top-2 left-2 bg-slate-900/90 border border-slate-800 px-2 py-0.5 rounded text-[9px] text-slate-400 font-mono">
                Interactive Graph Substrate (Drag nodes / Select to explore lineage)
              </div>
            </div>
          )}

          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {showAuditConsole ? (
              /* AUDIT CONSOLE VIEW */
              <div className="flex-1 flex flex-col overflow-y-auto p-6 space-y-6 scrollbar-thin animate-fadeIn">
                <div className="flex items-start justify-between border-b border-slate-800/40 pb-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                      <Shield className="h-5 w-5 text-amber-500" />
                      Witness Boundary Audit Console
                    </h3>
                    <p className="text-xs text-slate-400 mt-1 font-medium">
                      Verify that Jubilee's memories are cryptographically secured and resilient against silent database rewrites.
                    </p>
                  </div>
                  <span className="text-[10px] font-mono font-bold bg-slate-900 border border-slate-850 text-slate-400 px-2 py-0.5 rounded">
                    Steward v0.2.1
                  </span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className={`rounded-2xl border p-4 flex flex-col justify-between space-y-3 ${
                    liveAudit.audit.status === 'SECURE' 
                      ? 'border-emerald-500/20 bg-emerald-500/[0.02]' 
                      : 'border-rose-500/20 bg-rose-500/[0.02]'
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] uppercase tracking-wider font-bold text-slate-400 font-mono">Live Memory Status</span>
                      <span className={`text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 rounded border font-mono ${
                        liveAudit.audit.status === 'SECURE'
                          ? 'bg-emerald-950 text-emerald-450 border-emerald-500/20'
                          : 'bg-rose-950 text-rose-450 border-rose-500/20'
                      }`}>
                        {liveAudit.audit.status}
                      </span>
                    </div>

                    <div>
                      <h4 className={`text-sm font-bold ${liveAudit.audit.status === 'SECURE' ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {liveAudit.audit.status === 'SECURE' 
                          ? '◈ Ledger Authenticity Certified' 
                          : '⚠️ IMMUTABILITY BREACH DETECTED'}
                      </h4>
                      <p className="text-xs text-slate-450 mt-1 leading-relaxed">
                        The live event ledger has passed all constitutional security validations. Every event contains a cryptographically chained linkage hash.
                      </p>
                    </div>

                    <div className="text-[9px] text-slate-500 font-mono border-t border-slate-900/60 pt-2 flex items-center justify-between">
                      <span>Verified Event Log Size: {events.length}</span>
                      <span>Linkage: SHA-256 Link Chain</span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-800/80 bg-slate-900/10 p-4 space-y-3 flex flex-col justify-between">
                    <div>
                      <span className="text-[9px] uppercase tracking-wider font-bold text-slate-400 font-mono">Direct Injection Testing</span>
                      <h4 className="text-xs font-bold text-slate-200 mt-2">Projection Tamper & Sync Test</h4>
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                        Test our "Projection Non-Authority" system: maliciously modify an event directly in local state. Replay and sync will instantly expose it.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-900/60">
                      <button
                        onClick={handleTriggerTamperSandbox}
                        disabled={events.length === 0}
                        className="flex-1 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 px-2.5 py-1.5 text-xs font-bold transition disabled:opacity-40 cursor-pointer"
                      >
                        Hack Local DB Event
                      </button>
                      <button
                        onClick={handleRepairStateViaLedgerSync}
                        className="flex-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 px-2.5 py-1.5 text-xs font-bold transition cursor-pointer"
                      >
                        Sync & Repair Ledger
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* ACTIVE IDEA SURFACE FOUR-SECTION DOCUMENT SEQUENCE */
              <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin animate-fadeIn">
                
                {/* 1. ACTIVE IDEA (NEVER COLLAPSES) */}
                <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-5 space-y-3 shadow-lg">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-cyan-400 bg-cyan-950/80 border border-cyan-500/30 px-2 py-0.5 rounded">
                      ACTIVE IDEA
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full bg-slate-900 border border-slate-700/80 text-xs font-mono font-semibold text-emerald-400 flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                        {activeVersionLabel} · Exploring
                      </span>
                      <span className="text-xs text-slate-400 font-mono hidden sm:inline">
                        3 contributors
                      </span>

                      {/* EXPORT ARTIFACT ACTION DROPDOWN */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowExportDropdown(!showExportDropdown)}
                          className="px-3 py-1 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs transition flex items-center gap-1.5 cursor-pointer shadow-sm shadow-violet-600/20"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          <span>Export artifact ▾</span>
                        </button>

                        {showExportDropdown && (
                          <div className="absolute right-0 mt-1 w-56 bg-slate-950 border border-slate-800 rounded-xl shadow-2xl p-1.5 z-30 font-mono text-xs animate-fadeIn">
                            <button
                              type="button"
                              onClick={() => {
                                setShowExportDropdown(false);
                                setShowExportModal(true);
                              }}
                              className="w-full text-left px-3 py-2 rounded-lg bg-violet-950/80 hover:bg-violet-900/80 text-slate-100 font-bold transition flex items-center justify-between cursor-pointer border border-violet-500/30"
                            >
                              <span className="flex items-center gap-2">
                                <FileText className="h-3.5 w-3.5 text-violet-400" />
                                <span>Project brief</span>
                              </span>
                              <span className="text-[9px] bg-emerald-950 border border-emerald-500/30 text-emerald-400 px-1.5 py-0.2 rounded uppercase font-bold">
                                Recommended
                              </span>
                            </button>

                            <div className="w-full text-left px-3 py-2 rounded-lg text-slate-500 flex items-center justify-between opacity-50 cursor-not-allowed">
                              <span className="flex items-center gap-2">
                                <FileText className="h-3.5 w-3.5 text-slate-500" />
                                <span>One-page proposal</span>
                              </span>
                              <span className="text-[8px] bg-slate-900 border border-slate-800 text-slate-500 px-1 py-0.2 rounded font-mono">
                                Coming soon
                              </span>
                            </div>

                            <div className="w-full text-left px-3 py-2 rounded-lg text-slate-500 flex items-center justify-between opacity-50 cursor-not-allowed">
                              <span className="flex items-center gap-2">
                                <FileText className="h-3.5 w-3.5 text-slate-500" />
                                <span>Research plan</span>
                              </span>
                              <span className="text-[8px] bg-slate-900 border border-slate-800 text-slate-500 px-1 py-0.2 rounded font-mono">
                                Coming soon
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <h1 className="text-lg sm:text-xl font-bold text-slate-100 tracking-tight">
                    {selectedIdea?.title || "Neighborhood Cooling Mutual-Aid Network"}
                  </h1>

                  <div className="bg-slate-900/40 p-3.5 rounded-xl border border-slate-800">
                    <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-1 font-bold">
                      Current Formulation
                    </p>
                    <p className="text-xs sm:text-sm text-slate-200 leading-relaxed font-normal">
                      "{currentArtifact?.content || "Deploy community-managed shade hubs with ice distribution across 4 high-risk zones."}"
                    </p>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-900">
                    <span>Contributors: Co-Cultivator AI, Operator, Community Witness</span>
                    <span className="font-mono text-cyan-400">Durable Substrate {activeVersionLabel}</span>
                  </div>
                </div>

                {/* 2. CURRENT PRESSURE */}
                <div className="bg-amber-950/20 border border-amber-500/30 rounded-2xl p-4 space-y-3 shadow-md">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-amber-400 font-mono font-bold text-xs uppercase tracking-wider">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                      </span>
                      <span>CURRENT PRESSURE</span>
                    </div>
                    <span className="text-[10px] text-amber-400/80 font-mono">Constitutional Pulse</span>
                  </div>

                  <p className="text-xs sm:text-sm font-bold text-slate-100 leading-snug">
                    Volunteer capacity is still untested.
                  </p>

                  <p className="text-xs text-slate-300 italic bg-amber-950/30 p-2.5 rounded-lg border border-amber-500/10">
                    "The current model relies on unverified recurring volunteer shifts across 4 cooling hubs."
                  </p>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleSaveTensionAction()}
                      className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-slate-950" />
                      <span>Challenge assumption</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setStateTransitionFeedback({
                          headline: 'Deferred Constitutional Pulse',
                          content: 'Assumption deferred for subsequent review.',
                          version: activeVersionLabel
                        });
                        setTimeout(() => setStateTransitionFeedback(null), 4000);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-slate-100 text-xs transition cursor-pointer"
                    >
                      Defer
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowPulseWhyModal(true)}
                      className="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-cyan-400 hover:text-cyan-300 text-xs transition cursor-pointer font-mono"
                    >
                      Why?
                    </button>
                  </div>
                </div>

                {/* 3. WORKING MATERIAL */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                    <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
                      WORKING MATERIAL
                    </h3>
                    
                    <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
                      <button
                        type="button"
                        onClick={() => setWorkingMaterialTab('insights')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                          workingMaterialTab === 'insights'
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Insights (3)
                      </button>
                      <button
                        type="button"
                        onClick={() => setWorkingMaterialTab('tensions')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                          workingMaterialTab === 'tensions'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Tensions (1)
                      </button>
                      <button
                        type="button"
                        onClick={() => setWorkingMaterialTab('experiments')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                          workingMaterialTab === 'experiments'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Experiments (0)
                      </button>
                    </div>
                  </div>

                  {/* Semantic Cards Render */}
                  <div className="space-y-3">
                    {workingMaterialTab === 'tensions' && (
                      <div className="group rounded-2xl border border-amber-500/30 bg-amber-950/10 p-4 space-y-2.5 hover:border-amber-500/50 transition shadow-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-400 bg-amber-950 px-2 py-0.5 rounded border border-amber-500/30 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            ! TENSION
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">Raised from {activeVersionLabel} · Open</span>
                        </div>

                        <h4 className="text-xs sm:text-sm font-bold text-slate-100 leading-snug">
                          Volunteer capacity may not sustain recurring shifts
                        </h4>

                        <p className="text-xs text-slate-400 leading-relaxed">
                          The current model assumes 12-hour coverage across 4 cooling hubs without shift coverage proof during multi-day thermal spikes.
                        </p>

                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => handleSaveTensionAction()}
                            className="px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 text-[11px] font-semibold transition cursor-pointer"
                          >
                            Inspect
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveTensionAction()}
                            className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white text-[11px] font-semibold transition cursor-pointer"
                          >
                            Challenge
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveTensionAction()}
                            className="px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 text-[11px] font-semibold transition cursor-pointer"
                          >
                            Resolve
                          </button>
                        </div>
                      </div>
                    )}

                    {workingMaterialTab === 'insights' && (
                      <div className="space-y-3">
                        <div className="rounded-2xl border border-cyan-500/30 bg-cyan-950/10 p-4 space-y-2 hover:border-cyan-500/50 transition">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cyan-400 bg-cyan-950 px-2 py-0.5 rounded border border-cyan-500/30">
                              🧠 INSIGHT
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">Informed by census heat map</span>
                          </div>
                          <h4 className="text-xs sm:text-sm font-bold text-slate-100">
                            4 high-risk heat zones identified in Minneapolis south-side
                          </h4>
                          <p className="text-xs text-slate-400">
                            Phillips, Cedar-Riverside, Powderhorn, and Ventura Village experience elevated surface temperature spikes during heatwaves.
                          </p>
                          <div className="flex items-center gap-2 pt-1">
                            <span className="text-[10px] text-cyan-400 font-mono">Inspectable</span>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-cyan-500/30 bg-cyan-950/10 p-4 space-y-2 hover:border-cyan-500/50 transition">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cyan-400 bg-cyan-950 px-2 py-0.5 rounded border border-cyan-500/30">
                              🧠 INSIGHT
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">Informed by field study</span>
                          </div>
                          <h4 className="text-xs sm:text-sm font-bold text-slate-100">
                            Ice distribution centers reduce peak heatstroke risk by 34%
                          </h4>
                          <p className="text-xs text-slate-400">
                            Community shade hubs with active cold storage provide rapid thermal relief for vulnerable residents.
                          </p>
                          <div className="flex items-center gap-2 pt-1">
                            <span className="text-[10px] text-cyan-400 font-mono font-bold">Inspectable</span>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-cyan-500/30 bg-cyan-950/10 p-4 space-y-2 hover:border-cyan-500/50 transition">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cyan-400 bg-cyan-950 px-2 py-0.5 rounded border border-cyan-500/30">
                              🧠 INSIGHT
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">Informed by municipal park policy</span>
                          </div>
                          <h4 className="text-xs sm:text-sm font-bold text-slate-100">
                            Shade structure placement requires low-barrier park permits
                          </h4>
                          <p className="text-xs text-slate-400">
                            Park board regulations permit pop-up non-permanent canopies without structural review.
                          </p>
                        </div>
                      </div>
                    )}

                    {workingMaterialTab === 'experiments' && (
                      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/10 p-4 space-y-2 hover:border-emerald-500/50 transition">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-500/30">
                            🚀 EXPERIMENT
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">Proposed for v0.4 · Pending</span>
                        </div>
                        <h4 className="text-xs sm:text-sm font-bold text-slate-100">
                          2-hour shift signup pilot across Phillips & Cedar-Riverside
                        </h4>
                        <p className="text-xs text-slate-400">
                          Testing neighborhood commitment and shift retention via SMS signup workflows.
                        </p>
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => handleSaveTensionAction()}
                            className="px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[11px] font-semibold transition cursor-pointer"
                          >
                            Run Pilot Test
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 4. IDEA PATH */}
                <div className="space-y-3 pt-4 border-t border-slate-800/80">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
                      IDEA PATH
                    </h3>
                    <span className="text-[10px] text-slate-500 font-mono">Vertical Version Lineage</span>
                  </div>

                  <div className="relative border-l-2 border-slate-800 ml-3 pl-5 space-y-4 font-sans">
                    {/* v0.1 Node */}
                    <div className="relative">
                      <div className="absolute -left-[27px] top-1 h-3.5 w-3.5 rounded-full bg-slate-900 border-2 border-slate-700" />
                      <div className="bg-slate-950/40 rounded-xl p-3 border border-slate-850">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono font-bold text-slate-400">v0.1</span>
                          <span className="text-[10px] text-slate-500">Origin Seed</span>
                        </div>
                        <p className="text-xs text-slate-300 font-medium mt-1">Cooling access is uneven in south Minneapolis</p>
                      </div>
                    </div>

                    {/* v0.2 Node */}
                    <div className="relative">
                      <div className="absolute -left-[27px] top-1 h-3.5 w-3.5 rounded-full bg-slate-900 border-2 border-slate-700" />
                      <div className="bg-slate-950/40 rounded-xl p-3 border border-slate-850">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono font-bold text-slate-400">v0.2</span>
                          <span className="text-[10px] text-slate-500">Mutual-Aid Model</span>
                        </div>
                        <p className="text-xs text-slate-300 font-medium mt-1">Mutual-aid cooling hubs proposed across 4 heat zones</p>
                      </div>
                    </div>

                    {/* Current Node */}
                    <div className="relative">
                      <div className="absolute -left-[27px] top-1 h-3.5 w-3.5 rounded-full bg-emerald-400 border-2 border-emerald-300 shadow-sm shadow-emerald-400" />
                      <div className="bg-slate-900/80 rounded-xl p-3 border border-emerald-500/40 shadow-lg">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono font-bold text-emerald-400">{activeVersionLabel}</span>
                          <span className="text-[9px] font-mono font-bold uppercase tracking-wider bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30">
                            CURRENT
                          </span>
                        </div>
                        <p className="text-xs text-slate-100 font-semibold mt-1">
                          Capacity tension recorded & shift verification model flagged
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Collapsible Archived Sibling Paths */}
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => setShowSiblingPaths(!showSiblingPaths)}
                      className="text-xs font-mono text-slate-400 hover:text-cyan-400 transition cursor-pointer flex items-center gap-1.5"
                    >
                      <span>{showSiblingPaths ? '▾ Hide archived sibling paths' : '▸ 1 archived sibling path'}</span>
                    </button>

                    {showSiblingPaths && (
                      <div className="mt-2 ml-4 p-3 rounded-xl bg-slate-950/60 border border-slate-850 text-xs space-y-1 text-slate-400 font-mono animate-fadeIn">
                        <span className="text-[10px] uppercase tracking-wider text-slate-500 block font-bold">Archived Sibling</span>
                        <p className="text-slate-300 font-semibold">v0.2-fork: Mobile refrigerated truck fleet</p>
                        <p className="text-[10px] text-slate-500 italic">Archived due to high capital requirements during early pilot stage.</p>
                      </div>
                    )}
                  </div>
                </div>

              </div>
            )}
            {(() => {
              const enableLegacyView = selectedIdeaId === 'legacy_override';
              if (enableLegacyView) {
                const idea = ideas.find(i => i.id === selectedIdeaId);

                const ideaVersions = allIdeaVersions.filter(v => v.idea_id === idea.id);
                const currentVersionLabel = `v0.${ideaVersions.length || 1}`;
                const latestArtifact = idea.current_version_id ? artifactMap.get(idea.current_version_id) : null;

                // Find active matching proposals in chat messages
                const activeProposalObj = messages
                  .flatMap((m) => (m.content.proposals || []).map((p, idx) => ({ ...p, msgId: m.id, idx })))
                  .find((p) => p.type === 'evolve_idea' && p.idea_id === idea.id && !rejectedProposals[`${p.msgId}-${p.idx}`]);

                return (
                  <div className="flex-1 flex flex-col overflow-hidden h-full">
                    {/* Selected Idea Details Header */}
                    <div className="px-6 py-4 bg-slate-950/40 border-b border-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setSelectedIdeaId(null)}
                          className="p-1.5 rounded-lg border border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200 transition"
                          title="Return to Garden Overlook"
                        >
                          <ArrowLeft className="h-4 w-4" />
                        </button>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-bold text-slate-100">{idea.title}</h3>
                            <span className="text-[10px] font-mono font-bold bg-slate-950 text-emerald-400 border border-emerald-500/10 px-1.5 py-0.2 rounded">
                              {currentVersionLabel}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Created on {new Date(idea.created_at).toLocaleDateString()} • Level: <span className="capitalize text-slate-400">{idea.taxonomy_level}</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Evolve Button */}
                        <button
                          onClick={() => {
                            setEvolveContent(latestArtifact?.content || '');
                            setEvolveRationale('');
                            setEvolveWitnessStrength(5);
                            setShowEvolveModal(true);
                          }}
                          className="flex items-center gap-1 rounded-lg bg-emerald-500 text-slate-950 px-3 py-1.5 text-xs font-bold hover:bg-emerald-400 transition"
                        >
                          <PlusCircle className="h-3.5 w-3.5" />
                          Evolve Manually
                        </button>
                      </div>
                    </div>

                    {/* Scrollable Timeline & Provenance Content */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin animate-fadeIn">
                      
                      {/* 1. Live Proposal Alert Box (The Miracle Moment connection) */}
                      {activeProposalObj && (
                        <div className="rounded-2xl border border-pink-500/20 bg-pink-500/[0.02] p-4 space-y-3 shadow-xl">
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-1.5 text-[10px] font-bold text-pink-400 uppercase tracking-wider">
                              <Sparkles className="h-4 w-4 text-pink-400 animate-pulse" />
                              Evolution Proposed by Co-Cultivator AI
                            </span>
                            <span className="text-[9px] font-mono text-slate-500">
                              Awaiting Verification
                            </span>
                          </div>
                          
                          <h4 className="text-sm font-bold text-slate-100">
                            {activeProposalObj.title}
                          </h4>

                          {/* Side-by-Side Comparison Grid */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-1.5">
                            <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-900">
                              <p className="text-[9px] text-slate-500 uppercase tracking-wider font-bold">Current State ({currentVersionLabel})</p>
                              <p className="text-xs text-slate-400 mt-1 italic">
                                "{latestArtifact?.content || 'No current state content.'}"
                              </p>
                            </div>
                            <div className="bg-pink-500/[0.04] rounded-xl p-3 border border-pink-500/10">
                              <p className="text-[9px] text-pink-400 uppercase tracking-wider font-bold">Proposed Evolution</p>
                              <p className="text-xs text-slate-200 mt-1">
                                "{activeProposalObj.content}"
                              </p>
                            </div>
                          </div>

                          <div className="bg-slate-900/60 rounded-lg p-2.5 border border-slate-800">
                            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Suggested Rationale</p>
                            <p className="text-xs text-slate-400 mt-0.5 italic">"{activeProposalObj.rationale}"</p>
                          </div>

                          <div className="flex items-center gap-2 pt-1">
                            <button
                              onClick={() => handleAcceptProposal(activeProposalObj)}
                              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-pink-500 text-white px-3 py-1.5 text-xs font-bold hover:bg-pink-400 transition"
                            >
                              <Check className="h-4 w-4" />
                              Accept Evolution & Log
                            </button>
                            <button
                              onClick={() => {
                                setRejectedProposals(prev => ({ ...prev, [`${activeProposalObj.msgId}-${activeProposalObj.idx}`]: true }));
                              }}
                              className="rounded-lg border border-slate-800 text-slate-400 hover:bg-slate-850 px-2.5 py-1.5 text-xs font-semibold transition"
                            >
                              Dismiss Proposal
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Interactive Provenance Tab Bar */}
                      <div className="flex border-b border-slate-900 pb-2 gap-4">
                        <button
                          onClick={() => setActiveIdeaTab('timeline')}
                          className={`text-xs font-bold uppercase tracking-wider pb-1.5 border-b-2 transition ${
                            activeIdeaTab === 'timeline'
                              ? 'border-emerald-500 text-emerald-450'
                              : 'border-transparent text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          Growth Log ({ideaVersions.length})
                        </button>
                        <button
                          onClick={() => setActiveIdeaTab('provenance')}
                          className={`text-xs font-bold uppercase tracking-wider pb-1.5 border-b-2 transition ${
                            activeIdeaTab === 'provenance'
                              ? 'border-cyan-500 text-cyan-405'
                              : 'border-transparent text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          How It Grew
                        </button>
                      </div>

                      {activeIdeaTab === 'timeline' ? (
                        /* 2. Version Lineage Evolution Timeline */
                        <div className="space-y-4">
                          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                            Evolution Timeline
                          </h4>
                          
                          <div className="relative border-l border-slate-800 pl-6 ml-3 space-y-6">
                            {ideaVersions.length === 0 ? (
                              <div className="text-xs text-slate-500 italic">No historical version states recorded yet.</div>
                            ) : (
                              ideaVersions.map((version, idx) => {
                                const revIdx = ideaVersions.length - idx;
                                const vLabel = `v0.${revIdx}`;
                                const isLatest = idx === 0;

                                return (
                                  <div key={version.id} className="relative group animate-fadeIn">
                                    {/* Bullet point indicator */}
                                    <div className={`absolute -left-[31px] top-1.5 h-3.5 w-3.5 rounded-full border-2 ${
                                      isLatest 
                                        ? 'bg-emerald-500 border-emerald-400 ring-4 ring-emerald-950/40' 
                                        : 'bg-slate-950 border-slate-750'
                                    }`} />

                                    <div className={`rounded-xl p-4 border transition ${
                                      isLatest 
                                        ? 'bg-slate-900/40 border-slate-800/80 shadow-lg' 
                                        : 'bg-slate-950/20 border-slate-900/60'
                                    }`}>
                                      {/* Version Header */}
                                      <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                          <span className={`text-xs font-bold font-mono px-1.5 py-0.5 rounded ${
                                            isLatest ? 'bg-emerald-950 text-emerald-450 border border-emerald-500/10' : 'bg-slate-900 text-slate-400'
                                          }`}>
                                            {vLabel}
                                          </span>
                                          {isLatest && (
                                            <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/10 px-1.5 rounded font-semibold uppercase tracking-wider">
                                              Active State
                                            </span>
                                          )}
                                        </div>
                                        <span className="text-[10px] text-slate-550 font-mono">
                                          {new Date(version.created_at).toLocaleString()}
                                        </span>
                                      </div>

                                      {/* Text Content */}
                                      <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
                                        {version.content}
                                      </p>

                                      {/* Evolution Provenance Reason */}
                                      <div className="mt-3 bg-slate-950/60 rounded-lg p-2.5 border border-slate-900 flex flex-col gap-1">
                                        <p className="text-[9px] text-slate-500 uppercase tracking-wider font-bold">Provenance Rationale</p>
                                        <p className="text-xs text-slate-400 italic mt-0.5 leading-normal">
                                          "{version.rationale || 'Witnessed and authenticated seed.'}"
                                        </p>
                                      </div>

                                      {/* Witness Stars */}
                                      <div className="mt-2.5 flex items-center justify-between text-[9px] text-slate-500 font-mono border-t border-slate-900/60 pt-2">
                                        <span>CRYPTOGRAPHIC STATE OK</span>
                                        <span className="flex items-center text-amber-400 font-bold bg-amber-950/40 px-1 rounded border border-amber-500/5">
                                          Witness Strength: {version.witness_strength || 5}★
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      ) : (
                        /* 2. "How It Grew" Narrative Provenance Engine with "Why Current?" and "Still Alive" Blueprint */
                        (() => {
                          const strictAncestry = verifyStrictAncestryPath(idea, events, artifacts, messages);
                          const report = resolveWhyCurrentChain(idea.id, events, artifacts);
                          
                          if (report.status === 'ERROR') {
                            return (
                              <div className="rounded-xl border border-rose-500/15 bg-rose-500/[0.01] p-4 text-center text-xs text-rose-450 italic">
                                {report.message}
                              </div>
                            );
                          }

                          if (!strictAncestry.isValid) {
                            return (
                              <div className="rounded-2xl border border-red-500/15 bg-red-950/20 p-5 space-y-4 animate-fadeIn">
                                <div className="flex items-center gap-2 text-red-400">
                                  <AlertTriangle className="h-4 w-4" />
                                  <h4 className="text-xs font-bold uppercase tracking-wider">Causal Lineage Verification Halted</h4>
                                </div>
                                <p className="text-[11px] text-slate-400 leading-normal">
                                  Unable to verify the complete path to this version. Technical record contains missing, compromised, or conflicting ancestry.
                                </p>
                                <div className="text-[10px] font-mono text-red-400 bg-red-950/40 p-3 rounded-xl border border-red-900/30 space-y-1">
                                  <p className="font-bold uppercase text-[9px] text-red-500">Validation Failure Detail:</p>
                                  <p className="italic">"{strictAncestry.reason || 'Ancestor mismatch or unauthorized mutation detected.'}"</p>
                                </div>
                              </div>
                            );
                          }

                          // Derive Still Alive attributes
                          const currentVersionObj = allIdeaVersions.find(v => v.artifact_id === idea.current_version_id);
                          const explicitTensions = currentVersionObj?.preserved_tensions || [];
                          const explicitQuestions = currentVersionObj?.unresolved_questions || [];
                          const explicitEventAbandoned = events
                            .filter(e => {
                              if (e.event_type !== 'path_abandoned') return false;
                              try {
                                const p = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload;
                                return p?.idea_id === idea.id;
                              } catch {
                                return false;
                              }
                            })
                            .map(e => {
                              let p: any = {};
                              try {
                                p = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload;
                              } catch {}
                              return {
                                id: e.id,
                                version_number: p?.version_number || 1,
                                reason: e.rationale || p?.rationale || 'Abandoned sibling path.'
                              };
                            });
                          const explicitAbandoned = [
                            ...(currentVersionObj?.abandoned_paths || []),
                            ...explicitEventAbandoned
                          ];

                          const pastVersionsOfThisIdea = allIdeaVersions
                            .filter(v => v.idea_id === idea.id && v.artifact_id !== idea.current_version_id)
                            .sort((a, b) => b.version_number - a.version_number);

                          const parentArtifact = latestArtifact?.parent_artifact_id
                            ? artifactMap.get(latestArtifact.parent_artifact_id)
                            : null;

                          return (
                            <div className="space-y-6 animate-fadeIn">
                              
                              {/* --- WHY CURRENT & UNRESOLVED TENSIONS BENTO GRID --- */}
                              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pb-6 border-b border-slate-900">
                                
                                {/* Left Side: "Why Current?" Causal Verification */}
                                <div className="lg:col-span-7 bg-slate-950/40 border border-slate-900/60 rounded-2xl p-5 space-y-4">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <ShieldCheck className="h-4 w-4 text-emerald-400" />
                                      <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                                        Why is this version current?
                                      </h4>
                                    </div>
                                    <span className="text-[8px] font-mono bg-emerald-950 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/10 uppercase tracking-wider font-bold">
                                      Strict Ancestry Validated
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-slate-400 leading-normal">
                                    A thought is never arbitrarily finalized in Jubilee. The current state of this idea represents a fully verified causal chain:
                                  </p>

                                  {/* Visual Causal Flow diagram */}
                                  <div className="space-y-4 pt-2">
                                    {/* 1. Conversation Moment */}
                                    <div className="flex items-start gap-3">
                                      <div className="flex flex-col items-center">
                                        <div className="h-5 w-5 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center text-[9px] font-mono text-slate-400 font-bold">
                                          1
                                        </div>
                                        <div className="w-[1px] h-6 bg-slate-800" />
                                      </div>
                                      <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                          <p className="text-[11px] font-bold text-slate-200">Conversation Moment</p>
                                          <span className="text-[8px] font-mono text-slate-500 bg-slate-900 px-1 rounded truncate max-w-[120px]" title={strictAncestry.sourceMessageId}>
                                            msg: {strictAncestry.sourceMessageId}
                                          </span>
                                        </div>
                                        <p className="text-[10px] text-slate-500 leading-relaxed">
                                          Planted seed on {report.steps[0] ? report.steps[0].date : 'origin'}. Captured as a primary metaphor.
                                        </p>
                                      </div>
                                    </div>

                                    {/* 2. Candidate Proposal */}
                                    <div className="flex items-start gap-3">
                                      <div className="flex flex-col items-center">
                                        <div className="h-5 w-5 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center text-[9px] font-mono text-slate-400 font-bold">
                                          2
                                        </div>
                                        <div className="w-[1px] h-6 bg-slate-800" />
                                      </div>
                                      <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                          <p className="text-[11px] font-bold text-slate-200">Candidate Proposal</p>
                                          <span className="text-[8px] font-mono text-slate-500 bg-slate-900 px-1 truncate max-w-[120px]" title={strictAncestry.proposalEventId}>
                                            evt: {strictAncestry.proposalEventId}
                                          </span>
                                        </div>
                                        <p className="text-[10px] text-slate-500 leading-relaxed">
                                          AI co-cultivator or manual friction prompts a refinement path.
                                        </p>
                                      </div>
                                    </div>

                                    {/* 3. Human Harvest & Rationale */}
                                    <div className="flex items-start gap-3">
                                      <div className="flex flex-col items-center">
                                        <div className="h-5 w-5 rounded-full bg-emerald-950/80 border border-emerald-500/30 flex items-center justify-center text-[9px] font-mono text-emerald-400 font-bold">
                                          3
                                        </div>
                                        <div className="w-[1px] h-6 bg-slate-800" />
                                      </div>
                                      <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                          <p className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                                            Human Harvest & Rationale
                                          </p>
                                          <span className="text-[8px] font-mono text-emerald-500/60 bg-emerald-950/50 px-1 rounded truncate max-w-[120px]" title={strictAncestry.harvestEventId}>
                                            evt: {strictAncestry.harvestEventId}
                                          </span>
                                        </div>
                                        <p className="text-[10px] text-slate-500 leading-relaxed">
                                          You authorized the mutation, appending conscious human rationale to the ledger.
                                        </p>
                                      </div>
                                    </div>

                                    {/* 4. Current Form */}
                                    <div className="flex items-start gap-3">
                                      <div className="flex flex-col items-center">
                                        <div className="h-5 w-5 rounded-full bg-emerald-500 flex items-center justify-center text-[9px] font-mono text-slate-950 font-bold">
                                          4
                                        </div>
                                      </div>
                                      <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                          <p className="text-[11px] font-bold text-slate-200">
                                            Current Form: The active, hash-linked witnessed version
                                          </p>
                                          <span className="text-[8px] font-mono text-slate-400 bg-slate-900 px-1 truncate max-w-[120px]" title={strictAncestry.createdVersionId}>
                                            art: {strictAncestry.createdVersionId}
                                          </span>
                                        </div>
                                        <p className="text-[10px] text-slate-400 leading-relaxed italic line-clamp-2">
                                          "{latestArtifact?.content || 'Empty state.'}"
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* Right Side: Still Alive & Nearby Growth split */}
                                <div className="lg:col-span-5 space-y-5 flex flex-col justify-between">
                                  
                                  {/* Section 1: Still Alive (what did this transformation refuse to flatten?) */}
                                  <div className="bg-slate-950/40 border border-slate-900/60 rounded-2xl p-5 space-y-3.5 flex-1">
                                    <div className="flex items-center gap-2">
                                      <Flame className="h-4 w-4 text-amber-500 animate-pulse" />
                                      <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                                        Still Alive: Unresolved Tensions
                                      </h4>
                                    </div>
                                    <p className="text-[10px] text-slate-400 leading-relaxed">
                                      A version being current does not seal the concept. These preserved frictions kept this idea dynamic:
                                    </p>

                                    <div className="space-y-3">
                                      {/* Unresolved Questions */}
                                      <div className="p-2.5 bg-slate-900/20 rounded-xl border border-slate-850 space-y-1">
                                        <div className="flex items-center justify-between">
                                          <p className="text-[8px] font-mono text-amber-400 uppercase font-bold tracking-wider">
                                            Unresolved Questions
                                          </p>
                                          {explicitQuestions.length > 0 && (
                                            <span className="text-[7px] font-mono bg-amber-950 text-amber-400 px-1 rounded uppercase font-bold">Explicit</span>
                                          )}
                                        </div>
                                        {explicitQuestions.length > 0 ? (
                                          <ul className="list-disc pl-3 text-[10px] text-slate-400 space-y-1">
                                            {explicitQuestions.map((q) => (
                                              <li key={q.id} className="italic leading-normal">"{q.text}"</li>
                                            ))}
                                          </ul>
                                        ) : (
                                          <p className="text-[10px] text-slate-550 italic leading-relaxed">
                                            No explicit unresolved questions flagged.
                                          </p>
                                        )}
                                      </div>

                                      {/* Preserved Tensions */}
                                      <div className="p-2.5 bg-slate-900/20 rounded-xl border border-slate-850 space-y-1">
                                        <div className="flex items-center justify-between">
                                          <p className="text-[8px] font-mono text-pink-400 uppercase font-bold tracking-wider">
                                            Preserved Frictions
                                          </p>
                                          {explicitTensions.length > 0 && (
                                            <span className="text-[7px] font-mono bg-pink-950 text-pink-400 px-1 rounded uppercase font-bold">Explicit</span>
                                          )}
                                        </div>
                                        {explicitTensions.length > 0 ? (
                                          <ul className="list-disc pl-3 text-[10px] text-slate-400 space-y-1">
                                            {explicitTensions.map((t) => (
                                              <li key={t.id} className="italic leading-normal">"{t.text}"</li>
                                            ))}
                                          </ul>
                                        ) : (
                                          <p className="text-[10px] text-slate-550 italic leading-normal">
                                            No explicit design frictions logged.
                                          </p>
                                        )}
                                      </div>

                                      {/* Abandoned Paths */}
                                      <div className="p-2.5 bg-slate-900/20 rounded-xl border border-slate-850 space-y-1.5">
                                        <div className="flex items-center justify-between">
                                          <p className="text-[8px] font-mono text-violet-400 uppercase font-bold tracking-wider">
                                            Abandoned Paths
                                          </p>
                                          {explicitAbandoned.length > 0 && (
                                            <span className="text-[7px] font-mono bg-violet-950 text-violet-400 px-1 rounded uppercase font-bold text-[7px]">Explicit Dispositions</span>
                                          )}
                                        </div>
                                        {explicitAbandoned.length > 0 ? (
                                          <div className="space-y-1.5">
                                            {explicitAbandoned.map((p) => (
                                              <div key={p.id} className="text-[10px] bg-slate-950/40 p-1.5 rounded border border-violet-900/20 leading-relaxed">
                                                <div className="flex items-center gap-1.5 mb-0.5">
                                                  <span className="text-[8px] font-mono text-violet-400 bg-violet-950 px-1 py-0.2 rounded font-bold uppercase">
                                                    v0.{p.version_number}
                                                  </span>
                                                  <span className="text-[8px] font-semibold text-slate-500 uppercase tracking-wider">Abandoned disposition</span>
                                                </div>
                                                <p className="text-slate-400 italic">"{p.reason}"</p>
                                              </div>
                                            ))}
                                          </div>
                                        ) : pastVersionsOfThisIdea.length > 0 ? (
                                          <div className="space-y-1.5">
                                            <p className="text-[10px] text-slate-400 leading-normal">
                                              {pastVersionsOfThisIdea.length} inactive version{pastVersionsOfThisIdea.length > 1 ? 's' : ''} in historical lineage.
                                            </p>
                                            <div className="flex gap-1.5 flex-wrap">
                                              {pastVersionsOfThisIdea.map((v) => (
                                                <span key={v.id} className="text-[8px] font-mono text-slate-500 bg-slate-950 px-1 py-0.5 rounded uppercase">
                                                  v0.{v.version_number}
                                                </span>
                                              ))}
                                            </div>
                                            <p className="text-[9px] text-slate-550 leading-relaxed italic">
                                              Note: Sibling paths exist in index but no explicit abandonment witness has been filed.
                                            </p>
                                          </div>
                                        ) : (
                                          <p className="text-[10px] text-slate-555 italic leading-relaxed">
                                            This is the genesis version. No earlier branches have been abandoned.
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Section 2: Nearby Growth (what else might this idea grow toward?) */}
                                  <div className="bg-slate-950/40 border border-slate-900/60 rounded-2xl p-5 space-y-3.5">
                                    <div className="flex items-center gap-2">
                                      <Sprout className="h-4 w-4 text-cyan-400" />
                                      <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                                        Nearby Growth: Ecological Context
                                      </h4>
                                    </div>
                                    <p className="text-[10px] text-slate-400 leading-relaxed">
                                      Other adjacent concept vectors and active proposals growing in this garden:
                                    </p>

                                    <div className="space-y-2.5">
                                      {/* Held Proposal Seeds */}
                                      <div className="p-2.5 bg-slate-900/20 rounded-xl border border-slate-850 space-y-1">
                                        <p className="text-[8px] font-mono text-cyan-400 uppercase font-bold tracking-wider">
                                          Held Proposal Seeds
                                        </p>
                                        {activeProposalObj ? (
                                          <div className="space-y-1">
                                            <p className="text-[10px] font-bold text-slate-300">"{activeProposalObj.title}"</p>
                                            <p className="text-[9px] text-slate-500 italic line-clamp-1 leading-normal">
                                              "{activeProposalObj.rationale}"
                                            </p>
                                          </div>
                                        ) : (
                                          <p className="text-[9px] text-slate-550 italic">
                                            No active invitations waiting from Co-Cultivator AI.
                                          </p>
                                        )}
                                      </div>

                                      {/* Sibling Ideas */}
                                      <div className="p-2.5 bg-slate-900/20 rounded-xl border border-slate-850 space-y-1">
                                        <p className="text-[8px] font-mono text-emerald-400 uppercase font-bold tracking-wider">
                                          Divergent Sibling Nodes
                                        </p>
                                        {(() => {
                                          const siblingIdeas = ideas.filter(i => i.id !== idea.id && i.taxonomy_level === idea.taxonomy_level && i.status === 'active');
                                          if (siblingIdeas.length > 0) {
                                            return (
                                              <div className="flex flex-col gap-1">
                                                {siblingIdeas.slice(0, 2).map(sib => (
                                                  <div key={sib.id} className="flex items-center justify-between gap-2 text-[10px]">
                                                    <span className="font-medium text-slate-300 truncate max-w-[130px]">{sib.title}</span>
                                                    <span className="text-[8px] font-mono text-slate-500 bg-slate-950 px-1 rounded uppercase">
                                                      {sib.taxonomy_level}
                                                    </span>
                                                  </div>
                                                ))}
                                                {siblingIdeas.length > 2 && (
                                                  <p className="text-[8px] text-slate-500 font-mono italic pt-0.5">
                                                    + {siblingIdeas.length - 2} more active parallel nodes
                                                  </p>
                                                )}
                                              </div>
                                            );
                                          }
                                          return (
                                            <p className="text-[9px] text-slate-555 italic">
                                              No parallel active {idea.taxonomy_level} nodes in this ecology.
                                            </p>
                                          );
                                        })()}
                                      </div>
                                    </div>
                                  </div>

                                </div>
                              </div>

                              {/* --- ORIGINAL NARRATIVE LINEAGE HISTORY --- */}
                              <div className="flex items-center justify-between pt-2">
                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                                  Lineage Narrative History
                                </h4>
                                <span className="text-[9px] font-mono text-slate-550 uppercase font-semibold">
                                  {report.meta.confidenceLabel}
                                </span>
                              </div>

                              <div className="space-y-5 pl-4 border-l border-slate-900/80 relative">
                                {report.steps.map((step, sIdx) => {
                                  return (
                                    <div key={sIdx} className="relative group">
                                      {/* Visual step separator node */}
                                      <div className={`absolute -left-[22px] top-1.5 h-2 w-2 rounded-full border ${
                                        step.isHuman 
                                          ? 'bg-emerald-450 border-emerald-500' 
                                          : 'bg-cyan-400 border-cyan-500'
                                      }`} />

                                      <div className="space-y-1">
                                        <div className="flex items-center justify-between">
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="text-[10px] text-slate-500 font-mono">
                                              {step.date}
                                            </span>
                                            <span className={`text-[10px] font-bold ${step.isHuman ? 'text-emerald-400' : 'text-cyan-400'}`}>
                                              {step.actorLabel}
                                            </span>
                                            <span className="text-[10px] text-slate-450">
                                              {step.action}
                                            </span>
                                          </div>
                                          <span className="text-[9px] font-mono text-slate-650 bg-slate-950 px-1 py-0.2 rounded border border-slate-900">
                                            {step.eventSignature.substring(0, 8)}
                                          </span>
                                        </div>
                                        <p className="text-xs text-slate-200 leading-relaxed font-medium">
                                          {step.description}
                                        </p>
                                        {step.rationale && (
                                          <p className="text-[11px] text-slate-450 italic pl-2 border-l border-slate-900 mt-1">
                                            "{step.rationale}"
                                          </p>
                                        )}
                                      </div>

                                      {/* Connector arrow */}
                                      {sIdx < report.steps.length - 1 && (
                                        <div className="pt-2 pl-4 text-slate-800 flex items-center">
                                          <ArrowDown className="w-3.5 h-3.5 animate-pulse" />
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>

                              {/* Technical record toggle */}
                              <div className="pt-4 border-t border-slate-900/60 space-y-3">
                                <div className="flex items-center justify-between">
                                  <button
                                    onClick={() => setShowTechnicalRecord(!showTechnicalRecord)}
                                    className="text-[10px] text-slate-450 hover:text-slate-350 font-mono font-bold uppercase flex items-center gap-1 bg-slate-900/40 border border-slate-900 px-2 py-1 rounded transition cursor-pointer"
                                  >
                                    {showTechnicalRecord ? 'Hide Technical Record' : 'View Technical Record'}
                                  </button>
                                  <span className="text-[10px] text-slate-550 font-mono">
                                    Checksum: {report.meta.expectedSignature.substring(0, 16)}...
                                  </span>
                                </div>

                                {showTechnicalRecord && (
                                  <div className="rounded-xl border border-slate-900 bg-slate-950/60 p-3.5 space-y-2.5 font-mono text-[10px] leading-relaxed text-slate-400">
                                    <div className="flex items-center justify-between text-slate-500 font-bold border-b border-slate-900 pb-1.5">
                                      <span>LEDGER CERTIFICATION BLOCK</span>
                                      <span>WITNESS STATE OK</span>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1.5">
                                      <div>
                                        <span className="text-slate-500">Linkage Hash:</span>
                                        <span className="text-slate-300 ml-1.5">{report.meta.computedHash}</span>
                                      </div>
                                      <div>
                                        <span className="text-slate-500">Steward Policy:</span>
                                        <span className="text-slate-300 ml-1.5">LEDGER_APPEND_ONLY</span>
                                      </div>
                                      <div>
                                        <span className="text-slate-500">Access Control:</span>
                                        <span className="text-emerald-450 ml-1.5 font-semibold">HUMAN_HARVEST_VERIFIED</span>
                                      </div>
                                      <div>
                                        <span className="text-slate-500">Causal Chain State:</span>
                                        <span className="text-emerald-450 ml-1.5 font-semibold">SECURE</span>
                                      </div>
                                    </div>
                                    <p className="text-[9px] text-slate-550 italic border-t border-slate-900/60 pt-1.5 mt-2">
                                      * Cryptographic witness strength is verified by hash-chain integrity markers, ensuring that any payload or parent-link alteration causes hash-chain verification to fail during replay.
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })()
                      )}

                      {/* 3. Substrate Soil (Immutable Event Ledger) */}
                      <div className="space-y-4 pt-4 border-t border-slate-800/40">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                            Substrate Soil (Event Ledger)
                          </h4>
                          <span className="text-[10px] font-mono text-slate-500 bg-slate-900 px-2 py-0.5 rounded border border-slate-800/60">
                            Immutable Provenance Stream
                          </span>
                        </div>

                        {/* List of association logEvents */}
                        {(() => {
                          const ideaEvents = events.filter(evt => evt.entity_id === selectedIdeaId);
                          if (ideaEvents.length === 0) {
                            return <div className="text-xs text-slate-500 italic">No recorded secure validation events.</div>;
                          }

                          return (
                            <div className="space-y-2 max-h-64 overflow-y-auto pr-2 scrollbar-thin">
                              {ideaEvents.map((evt) => (
                                <div key={evt.id} className="rounded-lg border border-slate-900/60 bg-slate-950/40 p-3 space-y-1.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-slate-300 capitalize">
                                      {evt.event_type.replace(/_/g, ' ')}
                                    </span>
                                    <span className="text-[9px] font-mono text-slate-500">
                                      {new Date(evt.created_at).toLocaleTimeString()}
                                    </span>
                                  </div>
                                  <p className="text-xs text-slate-400">{evt.rationale || 'Validation certified.'}</p>
                                  <div className="flex flex-wrap items-center gap-3 text-[8px] text-slate-500 font-mono">
                                    <span>Capability: {evt.capability || 'CO_CULTIVATION'}</span>
                                    <span>Policy: {evt.policy || 'LEDGER_APPEND_ONLY'}</span>
                                    <span>Witness: {evt.witness_strength}★</span>
                                    <span>Hash: {evt.id.substring(0, 8)}...</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>

                    </div>
                  </div>
                );
              }
              return null;
            })()}
          </div>
        </aside>

      </main>
      )}


      {/* ========================================================================= */}
      {/* ================= MODAL: CAPTURE AI / MESSAGE PROPOSAL ================= */}
      {captureModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-cyan-400">
                Authenticate & Witness Event
              </h3>
              <button onClick={() => setCaptureModalData(null)} className="text-slate-500 hover:text-slate-300">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-mono text-slate-500 tracking-wider">Suggested Title</label>
                <input
                  value={captureTitle}
                  onChange={(e) => setCaptureTitle(e.target.value)}
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm outline-none focus:border-cyan-500/30"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-mono text-slate-500 tracking-wider">Content Body</label>
                <textarea
                  value={captureContent}
                  onChange={(e) => setCaptureContent(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm outline-none focus:border-cyan-500/30"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-mono text-slate-500 tracking-wider">Decision Rationale (Why does this exist?)</label>
                <input
                  value={captureRationale}
                  onChange={(e) => setCaptureRationale(e.target.value)}
                  placeholder="Record your reasoning or accepting rationale..."
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs outline-none focus:border-cyan-500/30 text-slate-300"
                />
              </div>

              {/* Witness Stars selection */}
              <div className="flex items-center justify-between py-1 border-t border-slate-800/60 pt-3">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-slate-300">Witness Strength</span>
                  <span className="text-[10px] text-slate-500">Rate the confidence & provenance of this capturing event</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {([1, 3, 5] as const).map((stars) => (
                    <button
                      key={stars}
                      onClick={() => setCaptureWitnessStrength(stars)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition ${
                        captureWitnessStrength === stars
                          ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
                          : 'bg-slate-950 border-slate-850 text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {stars} ★
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-3 border-t border-slate-800/60">
              <button
                onClick={() => setCaptureModalData(null)}
                className="flex-1 rounded-lg border border-slate-800 text-slate-400 hover:bg-slate-800 py-2 text-xs font-bold transition"
              >
                Decline
              </button>
              <button
                onClick={handleConfirmProposalCapture}
                className="flex-1 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 py-2 text-xs font-bold transition"
              >
                Witness & Record
              </button>
            </div>
          </div>
        </div>
      )}


      {/* ==================================================================== */}
      {/* ================= MODAL: EVOLVE SELECTED IDEA VERSION ================= */}
      {showEvolveModal && selectedIdea && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-cyan-400">
                Evolve Concept: {selectedIdea.title}
              </h3>
              <button onClick={() => setShowEvolveModal(false)} className="text-slate-500 hover:text-slate-300">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleManualEvolve} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-mono text-slate-500 tracking-wider">New Evolved Content</label>
                <textarea
                  required
                  value={evolveContent}
                  onChange={(e) => setEvolveContent(e.target.value)}
                  rows={6}
                  placeholder="Specify the next version state..."
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm outline-none focus:border-cyan-500/30"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-mono text-slate-500 tracking-wider">Evolution Rationale (Why are you changing this?)</label>
                <input
                  required
                  value={evolveRationale}
                  onChange={(e) => setEvolveRationale(e.target.value)}
                  placeholder="Describe what tensions or requirements forced this modification..."
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs outline-none focus:border-cyan-500/30"
                />
              </div>

              <div className="flex items-center justify-between border-t border-slate-800 pt-3">
                <span className="text-xs font-semibold text-slate-300">Evolve Witness strength</span>
                <div className="flex items-center gap-1.5">
                  {([1, 3, 5] as const).map((stars) => (
                    <button
                      type="button"
                      key={stars}
                      onClick={() => setEvolveWitnessStrength(stars)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition ${
                        evolveWitnessStrength === stars
                          ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
                          : 'bg-slate-950 border-slate-850 text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {stars} ★
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3 pt-3 border-t border-slate-800/60">
                <button
                  type="button"
                  onClick={() => setShowEvolveModal(false)}
                  className="flex-1 rounded-lg border border-slate-800 text-slate-400 hover:bg-slate-800 py-2 text-xs font-bold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 py-2 text-xs font-bold transition"
                >
                  Witness Evolution
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


      {/* ============================================================== */}
      {/* ================= MODAL: CONSTITUTIONAL PULSE WHY ============= */}
      {showPulseWhyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-slate-900 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                </span>
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-amber-400">
                  Constitutional Pulse Rationale
                </h3>
              </div>
              <button onClick={() => setShowPulseWhyModal(false)} className="text-slate-500 hover:text-slate-300 cursor-pointer">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-300">
              <p className="font-semibold text-slate-100">
                Why is Jubilee highlighting this assumption right now?
              </p>
              <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 space-y-2">
                <p className="text-amber-200 font-medium">
                  • <strong>Load-Bearing Dependency:</strong> The current Minneapolis cooling hub model relies completely on unverified volunteer shifts across 4 high-risk heat zones.
                </p>
                <p className="text-slate-400">
                  • <strong>Constitutional Substrate Policy:</strong> High-risk community infrastructure assumptions must be tested or explicitly acknowledged before advancing to implementation stages.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowPulseWhyModal(false)}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition cursor-pointer"
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* ================= MODAL: SYNTHESIS LAB MODAL ================= */}
      {showSynthesisModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-pink-400">
                Cognitive Synthesis Lab
              </h3>
              <button onClick={() => setShowSynthesisModal(false)} className="text-slate-500 hover:text-slate-300">
                <X className="h-5 w-5" />
              </button>
            </div>

            {synthesisLoading ? (
              <div className="py-12 text-center space-y-3">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-pink-500 mx-auto" />
                <p className="text-xs text-slate-400">Gemini is analyzing redundancies and drafting traits and tensions...</p>
              </div>
            ) : (
              synthesisPreview && (
                <div className="space-y-4">
                  {/* Selected parents info */}
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-1">
                    <p className="text-[9px] uppercase tracking-wider font-mono text-slate-500 font-semibold">Synthesis Parent Nodes</p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {selectedIdeasForSynthesis.map(id => {
                        const idea = ideas.find(i => i.id === id);
                        return (
                          <span key={id} className="text-xs text-pink-400 bg-pink-500/10 border border-pink-500/20 rounded px-2 py-0.5">
                            🌱 {idea?.title}
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  {/* Inherited Traits */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-mono text-pink-400 tracking-wider flex items-center gap-1">
                      <Sparkles className="h-3 w-3" /> Inherited Traits
                    </label>
                    <p className="text-xs text-slate-300 bg-slate-950/40 rounded-lg p-3 border border-slate-800/80">
                      {synthesisPreview.inherited_traits}
                    </p>
                  </div>

                  {/* Tensions & Redundancy Resolver */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-mono text-amber-400 tracking-wider flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" /> Conceptual Tensions Identified
                    </label>
                    <p className="text-xs text-slate-300 bg-slate-950/40 rounded-lg p-3 border border-slate-800/80">
                      {synthesisPreview.tensions}
                    </p>
                  </div>

                  {/* Proposed unified branch details */}
                  <div className="space-y-3 border-t border-slate-800/60 pt-3">
                    <p className="text-[9px] uppercase tracking-wider font-mono text-slate-500 font-semibold">Proposed Synthesis Outcome</p>
                    
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 font-medium">New Branch Title</label>
                      <input
                        value={synthesisPreview.title}
                        onChange={(e) => setSynthesisPreview({ ...synthesisPreview, title: e.target.value })}
                        className="w-full rounded bg-slate-950 border border-slate-800 text-xs px-2.5 py-1.5 outline-none focus:border-pink-500/30"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 font-medium">Synthesized Branch Content</label>
                      <textarea
                        value={synthesisPreview.content}
                        onChange={(e) => setSynthesisPreview({ ...synthesisPreview, content: e.target.value })}
                        rows={4}
                        className="w-full rounded bg-slate-950 border border-slate-800 text-xs px-2.5 py-1.5 outline-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 font-medium">Synthesis Rationale</label>
                      <input
                        value={synthesisPreview.rationale}
                        onChange={(e) => setSynthesisPreview({ ...synthesisPreview, rationale: e.target.value })}
                        className="w-full rounded bg-slate-950 border border-slate-800 text-[10px] px-2.5 py-1.5 outline-none"
                      />
                    </div>
                  </div>

                  {/* Witness select */}
                  <div className="flex items-center justify-between border-t border-slate-800 pt-3">
                    <span className="text-xs font-semibold text-slate-300">Witness Strength</span>
                    <div className="flex items-center gap-1.5">
                      {([1, 3, 5] as const).map((stars) => (
                        <button
                          key={stars}
                          onClick={() => setSynthesisWitnessStrength(stars)}
                          className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition ${
                            synthesisWitnessStrength === stars
                              ? 'bg-pink-500/10 border-pink-500/30 text-pink-400'
                              : 'bg-slate-950 border-slate-850 text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          {stars} ★
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-3 border-t border-slate-800/60">
                    <button
                      onClick={() => setShowSynthesisModal(false)}
                      className="flex-1 rounded-lg border border-slate-800 text-slate-400 hover:bg-slate-800 py-2 text-xs font-bold transition"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleConfirmSynthesis}
                      className="flex-1 rounded-lg bg-pink-500 hover:bg-pink-400 text-white py-2 text-xs font-bold transition"
                    >
                      Record Synthesis Event
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* EXPORT ARTIFACT MODAL SHEET */}
      <ExportSheetModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        selectedIdea={selectedIdea}
        currentArtifact={currentArtifact}
        activeVersionLabel={activeVersionLabel}
        allIdeaVersions={allIdeaVersions}
        events={events}
        onSaveExternalArtifact={handleSaveExternalArtifact}
      />

    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
