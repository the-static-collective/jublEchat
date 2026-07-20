import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Sprout, Leaf, Rocket, Brain, Send, HelpCircle, GitMerge, Clock, Check, X,
  ArrowUp, History, Database, ArrowRight, Beaker, LogOut, ChevronRight, RefreshCw, GitBranch, Share2, Star, Eye, Plus, MessageSquare, Sparkles, AlertTriangle, Network
} from 'lucide-react';
import { AuthProvider, useAuth } from './lib/auth';
import { AuthScreen } from './components/AuthScreen';
import {
  useIdeas, useIdeaVersions, useArtifacts, useEvents, useTransformations, useEdges,
  createIdea, evolveIdea, updateIdeaLifecycle, logEvent, synthesizeIdeas
} from './lib/hooks';
import { GraphCanvas } from './components/GraphCanvas';
import { formatDate } from './lib/constants';
import { WITNESS_LABELS, type Idea, type LifecycleStatus, type TaxonomyLevel } from './lib/types';

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: {
    text: string;
    proposals?: Array<{
      type: 'new_idea' | 'evolve_idea' | 'synthesize_ideas';
      title: string;
      content: string;
      rationale: string;
      taxonomy_level?: 'insight' | 'idea' | 'project';
      idea_id?: string;
      parent_ids?: string[];
    }>;
  };
  created_at: string;
}

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

  // Local UI States
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [aiLoading, setAILoading] = useState(false);
  
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
  const [selectedIdeasForSynthesis, setSelectedIdeasForSynthesis] = useState<string[]>([]);
  
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
  const [showGraph, setShowGraph] = useState(false);
  const [highlightWhyExist, setHighlightWhyExist] = useState(false);

  // Maps & Derivations
  const artifactMap = useMemo(() => new Map(artifacts.map((a) => [a.id, a])), [artifacts]);
  const selectedIdea = useMemo(() => ideas.find((i) => i.id === selectedIdeaId), [ideas, selectedIdeaId]);
  
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
        // Reset if corrupted
        localStorage.removeItem('jubilee_chat_messages');
      }
    } else {
      // Welcome seed
      const welcome: ChatMessage[] = [
        {
          id: 'welcome-msg',
          role: 'model',
          content: {
            text: "Welcome, Operator, to the **Conversation Garden** (Jubilee v0.2).\n\nHere, thoughts are cultivated as organic, event-sourced entities. As we discuss, you can **hover over any message** to capture its essence instantly into our lineage ledger across three levels:\n\n1. 🧠 **Insights**: Raw observations or spark seeds (e.g., 'Noticed latency spikes on cold start').\n2. 🌱 **Ideas**: Cultivated, structured concepts ready for refinement (e.g., 'Dynamic ServiceWorker offline sync').\n3. 🚀 **Projects**: Active, operational pursuits with execution pathways (e.g., 'Build offline.ts file sync utility').\n\nLet's cultivate our shared memory substrate. What are we thinking?",
            proposals: []
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

  const handleClearChatHistory = () => {
    if (confirm("Are you sure you want to clear your conversation substrate?")) {
      localStorage.removeItem('jubilee_chat_messages');
      window.location.reload();
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Background Orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        <div className="absolute -top-40 -left-40 h-[480px] w-[480px] rounded-full bg-cyan-500/5 blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 h-[480px] w-[480px] rounded-full bg-violet-500/5 blur-[120px]" />
        <div className="absolute top-1/3 right-1/4 h-80 w-80 rounded-full bg-amber-500/3 blur-[100px]" />
      </div>

      {/* Header Bar */}
      <header className="relative z-10 border-b border-slate-800/60 bg-slate-950/80 backdrop-blur-xl px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-cyan-400 via-teal-400 to-violet-500 flex items-center justify-center shadow-lg shadow-cyan-500/10">
              <Sprout className="h-5 w-5 text-slate-950 font-bold" />
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-400 border-2 border-slate-950" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-slate-100">Jubilee</h1>
              <span className="text-[10px] bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded font-mono font-medium">v0.2</span>
            </div>
            <p className="text-[10px] text-slate-400">The Conversation Garden Substrate</p>
          </div>
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

        {/* Sign Out & Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleClearChatHistory}
            className="text-[10px] text-slate-500 hover:text-slate-300 transition bg-slate-900 border border-slate-800/80 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5"
            title="Reset Chat History"
          >
            <RefreshCw className="h-3 w-3" />
            Reset Chat
          </button>
          <div className="w-px h-4 bg-slate-800 hidden sm:block" />
          <div className="items-center gap-2 hidden sm:flex">
            <div className="h-7 w-7 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-300 border border-slate-700/50">
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

      {/* Workspace Arena: Split Screen */}
      <div className="flex-1 relative z-10 grid grid-cols-1 lg:grid-cols-12 overflow-hidden h-[calc(100vh-73px)]">
        
        {/* ================= LEFT PANE: CONVERSATIONAL SUBSTRATE (lg:col-span-5) ================= */}
        <section className="lg:col-span-5 border-r border-slate-800/50 flex flex-col bg-slate-950/40 h-full overflow-hidden">
          {/* Section Header */}
          <div className="px-6 py-4 border-b border-slate-800/40 bg-slate-950/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-cyan-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">Conversational Substrate</h2>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-slate-500 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
              <Sparkles className="h-3 w-3 text-cyan-400" />
              AI Partner Active
            </div>
          </div>

          {/* Message Stream */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
            {messages.map((msg) => (
              <div
                key={msg.id}
                onMouseEnter={() => setHoveredMessage(msg.id)}
                onMouseLeave={() => setHoveredMessage(null)}
                className={`group relative flex flex-col max-w-[90%] ${
                  msg.role === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'
                }`}
              >
                {/* Message Header */}
                <span className="text-[9px] text-slate-500 font-mono mb-1">
                  {msg.role === 'user' ? 'OPERATOR' : 'CO-CULTIVATOR'} • {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>

                {/* Message Body */}
                <div
                  className={`rounded-2xl px-4 py-3.5 border text-sm transition relative ${
                    msg.role === 'user'
                      ? 'bg-slate-900/60 border-slate-700/40 text-slate-200'
                      : 'bg-slate-900/30 border-cyan-500/15 text-slate-300 shadow-lg shadow-cyan-500/[0.02]'
                  }`}
                >
                  <SimpleMarkdown text={msg.content.text} />

                  {/* Inline Capture / Cultivation Hover Button */}
                  {hoveredMessage === msg.id && (
                    <div className="absolute -bottom-8 right-2 flex items-center gap-1.5 bg-slate-900/90 border border-slate-700/60 rounded-lg px-2 py-1 shadow-xl z-20">
                      <span className="text-[9px] text-slate-500 font-medium">Cultivate Message:</span>
                      <button
                        onClick={() => {
                          setCaptureTitle("Captured Insight");
                          setCaptureContent(msg.content.text);
                          setCaptureRationale("Extracted during conversation.");
                          setCaptureModalData({ text: msg.content.text, type: 'insight' });
                        }}
                        className="text-[9px] text-amber-400 hover:text-amber-300 font-semibold"
                      >
                        🧠 Insight
                      </button>
                      <span className="text-slate-700">|</span>
                      <button
                        onClick={() => {
                          setCaptureTitle("Captured Idea");
                          setCaptureContent(msg.content.text);
                          setCaptureRationale("Evolved from conversation.");
                          setCaptureModalData({ text: msg.content.text, type: 'idea' });
                        }}
                        className="text-[9px] text-emerald-400 hover:text-emerald-300 font-semibold"
                      >
                        🌱 Idea
                      </button>
                      <span className="text-slate-700">|</span>
                      <button
                        onClick={() => {
                          setCaptureTitle("Captured Project");
                          setCaptureContent(msg.content.text);
                          setCaptureRationale("Committed to execution path.");
                          setCaptureModalData({ text: msg.content.text, type: 'project' });
                        }}
                        className="text-[9px] text-violet-400 hover:text-violet-300 font-semibold"
                      >
                        🚀 Project
                      </button>
                    </div>
                  )}
                </div>

                {/* Proposals Render (First-Class AI Suggestions) */}
                {msg.content.proposals && msg.content.proposals.length > 0 && (
                  <div className="mt-3 w-full space-y-3 pl-2 border-l border-cyan-500/20">
                    <div className="flex items-center gap-1.5 text-[10px] text-cyan-400 font-semibold">
                      <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                      Cognitive Proposals Awaiting Validation
                    </div>
                    {msg.content.proposals.map((proposal, idx) => (
                      <div
                        key={idx}
                        className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.03] p-3.5 hover:bg-cyan-500/[0.05] transition space-y-2.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] uppercase tracking-wider font-mono font-bold text-cyan-400 bg-cyan-950 px-1.5 py-0.5 rounded border border-cyan-500/20">
                            {proposal.type.replace('_', ' ')}
                          </span>
                          <span className="text-[10px] text-slate-400 font-medium italic">
                            Level: {(proposal.taxonomy_level || 'idea').toUpperCase()}
                          </span>
                        </div>
                        <h4 className="text-sm font-bold text-slate-100">{proposal.title}</h4>
                        <p className="text-xs text-slate-300 line-clamp-3">{proposal.content}</p>
                        <div className="bg-slate-900/60 rounded-lg p-2 border border-slate-800">
                          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Suggested Rationale</p>
                          <p className="text-xs text-slate-400 italic mt-0.5">{proposal.rationale}</p>
                        </div>
                        <div className="flex items-center gap-2 pt-1.5">
                          <button
                            onClick={() => handleAcceptProposal(proposal)}
                            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-cyan-500 text-slate-950 px-2.5 py-1.5 text-xs font-bold hover:bg-cyan-400 transition"
                          >
                            <Check className="h-3.5 w-3.5" />
                            Accept & Witness
                          </button>
                          <button
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
                            className="rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 px-2.5 py-1.5 text-xs font-medium transition"
                          >
                            Edit
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
          <div className="p-4 border-t border-slate-800/50 bg-slate-950/60">
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
                className="absolute right-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 p-2 transition"
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


        {/* ================= RIGHT PANE: PROVENANCE GARDEN (lg:col-span-7) ================= */}
        <section className="lg:col-span-7 flex flex-col h-full bg-slate-950/20 overflow-hidden">
          {/* Section Header with Graph Toggle */}
          <div className="px-6 py-4 border-b border-slate-800/40 bg-slate-950/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Leaf className="h-4 w-4 text-emerald-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">Garden Lineage & Synthesis Ledger</h2>
            </div>
            
            <div className="flex items-center gap-2">
              {/* Show Substrate Graph Toggle */}
              <button
                onClick={() => setShowGraph(!showGraph)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold border transition ${
                  showGraph
                    ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Network className="h-3.5 w-3.5" />
                {showGraph ? 'Hide Graph' : 'Show Substrate Graph'}
              </button>

              {/* Synthesize Button */}
              {selectedIdeasForSynthesis.length >= 2 && (
                <button
                  onClick={handleOpenSynthesisLab}
                  className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-pink-500 to-violet-600 hover:from-pink-400 hover:to-violet-500 text-white px-3 py-1 text-xs font-bold transition shadow-lg shadow-pink-500/10"
                >
                  <GitMerge className="h-3.5 w-3.5" />
                  Synthesize Selected ({selectedIdeasForSynthesis.length})
                </button>
              )}
            </div>
          </div>

          {/* Substrate Graph Canvas (Collapsible Substrate Layer) */}
          {showGraph && (
            <div className="h-72 border-b border-slate-800/60 bg-slate-950/40 relative">
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

          {/* Dynamic 2-column Garden Layout (Ideas list + Selected lineage) */}
          <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-hidden h-full">
            
            {/* Column A: Cultivated Ideas & Seeds list (md:col-span-5) */}
            <div className="md:col-span-5 border-r border-slate-800/40 flex flex-col h-full bg-slate-950/10">
              
              {/* Search and Fast Filters */}
              <div className="p-4 space-y-3 border-b border-slate-800/40 bg-slate-950/20">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Query organism title..."
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-900/30 py-2 px-3 text-xs text-slate-100 placeholder-slate-500 focus:border-cyan-500/30 outline-none"
                />

                {/* Taxonomy Filter Bar */}
                <div className="flex flex-wrap gap-1">
                  {(['all', 'insight', 'idea', 'project', 'inactive'] as const).map((lvl) => (
                    <button
                      key={lvl}
                      onClick={() => setTaxonomyFilter(lvl)}
                      className={`text-[9px] uppercase tracking-wider font-semibold rounded px-2 py-1 transition border ${
                        taxonomyFilter === lvl
                          ? 'bg-slate-800 border-slate-700 text-slate-200'
                          : 'bg-transparent border-transparent text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
              </div>

              {/* Ideas Seed Panel Quick Trigger */}
              <div className="p-3 border-b border-slate-800/40 bg-slate-900/10">
                {manualCaptureMode ? (
                  <form onSubmit={handleCreateManualIdea} className="space-y-2.5 bg-slate-900/50 border border-slate-800 p-2.5 rounded-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-bold text-cyan-400">PLANT SEED: {manualCaptureMode.toUpperCase()}</span>
                      <button type="button" onClick={() => setManualCaptureMode(null)} className="text-slate-500 hover:text-slate-300">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <input
                      required
                      placeholder="Title..."
                      value={captureTitle}
                      onChange={(e) => setCaptureTitle(e.target.value)}
                      className="w-full rounded bg-slate-950 border border-slate-800 text-xs px-2 py-1 outline-none focus:border-cyan-500/40"
                    />
                    <textarea
                      placeholder="Content/Description..."
                      value={captureContent}
                      onChange={(e) => setCaptureContent(e.target.value)}
                      rows={2}
                      className="w-full rounded bg-slate-950 border border-slate-800 text-xs px-2 py-1 outline-none resize-none"
                    />
                    <input
                      placeholder="Rationale / Why does this exist?"
                      value={captureRationale}
                      onChange={(e) => setCaptureRationale(e.target.value)}
                      className="w-full rounded bg-slate-950 border border-slate-800 text-[10px] px-2 py-1 outline-none"
                    />
                    <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
                      <span>Witness Rating:</span>
                      <div className="flex items-center gap-1">
                        {([1, 3, 5] as const).map((stars) => (
                          <button
                            type="button"
                            key={stars}
                            onClick={() => setCaptureWitnessStrength(stars)}
                            className={`px-1.5 py-0.5 rounded ${captureWitnessStrength === stars ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' : 'text-slate-500'}`}
                          >
                            {stars}★
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      type="submit"
                      className="w-full rounded bg-cyan-500 text-slate-950 py-1.5 text-xs font-bold hover:bg-cyan-400 transition"
                    >
                      Authenticate and Seed
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mr-1">Seed Manual Node:</span>
                    <button
                      onClick={() => {
                        setManualCaptureMode('insight');
                        setCaptureTitle('');
                        setCaptureContent('');
                      }}
                      className="text-[10px] text-amber-500 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded px-2 py-0.5"
                    >
                      + Insight
                    </button>
                    <button
                      onClick={() => {
                        setManualCaptureMode('idea');
                        setCaptureTitle('');
                        setCaptureContent('');
                      }}
                      className="text-[10px] text-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded px-2 py-0.5"
                    >
                      + Idea
                    </button>
                    <button
                      onClick={() => {
                        setManualCaptureMode('project');
                        setCaptureTitle('');
                        setCaptureContent('');
                      }}
                      className="text-[10px] text-violet-500 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 rounded px-2 py-0.5"
                    >
                      + Project
                    </button>
                  </div>
                )}
              </div>

              {/* Organisms List */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {filteredIdeas.length === 0 ? (
                  <div className="text-center py-8 text-xs text-slate-600 italic">
                    No active organisms found in this filter. Let's seed something!
                  </div>
                ) : (
                  filteredIdeas.map((idea) => {
                    const isSelected = selectedIdeaId === idea.id;
                    const levelColors: Record<TaxonomyLevel, string> = {
                      insight: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
                      idea: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
                      project: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
                    };
                    const colorClass = levelColors[idea.taxonomy_level || 'idea'] || levelColors.idea;
                    
                    return (
                      <div
                        key={idea.id}
                        className={`group rounded-xl border p-3 flex items-start gap-2.5 transition cursor-pointer text-left ${
                          isSelected
                            ? 'border-cyan-500/60 bg-cyan-500/[0.05]'
                            : 'border-slate-800/80 bg-slate-900/20 hover:border-slate-700/60 hover:bg-slate-900/40'
                        }`}
                        onClick={() => setSelectedIdeaId(idea.id)}
                      >
                        {/* Checkbox for Synthesis Selection */}
                        <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIdeasForSynthesis.includes(idea.id)}
                            onChange={() => toggleIdeaForSynthesis(idea.id)}
                            className="rounded border-slate-700 text-cyan-500 focus:ring-0 cursor-pointer h-3.5 w-3.5"
                          />
                        </div>

                        {/* Idea Title & Metadata */}
                        <div className="flex-1 min-w-0">
                          <h3 className="text-xs font-bold text-slate-200 truncate group-hover:text-cyan-400 transition">
                            {idea.title}
                          </h3>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${colorClass}`}>
                              {idea.taxonomy_level || 'idea'}
                            </span>
                            <span className="text-[9px] text-slate-500">
                              {new Date(idea.created_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <ChevronRight className="h-3.5 w-3.5 text-slate-600 shrink-0 self-center" />
                      </div>
                    );
                  })
                )}
              </div>
            </div>


            {/* Column B: Selected Provenance Lineage Detail (md:col-span-7) */}
            <div className="md:col-span-7 flex flex-col h-full overflow-y-auto bg-slate-950/30">
              
              {!selectedIdea ? (
                <div className="flex h-full min-h-[300px] items-center justify-center p-6">
                  <div className="text-center space-y-2">
                    <Sprout className="mx-auto h-8 w-8 text-slate-700" />
                    <p className="text-xs font-medium text-slate-500">Select an organism to view its complete provenance lineage</p>
                    <p className="text-[10px] text-slate-600">Trace derivations, rationales, and verify witness events in real-time</p>
                  </div>
                </div>
              ) : (
                <div className="p-6 space-y-6">
                  
                  {/* Detailed Lineage Header */}
                  <div className="border-b border-slate-800/40 pb-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-cyan-400 bg-cyan-950 border border-cyan-500/20 px-2 py-0.5 rounded">
                          {(selectedIdea.taxonomy_level || 'idea').toUpperCase()}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">ID: {selectedIdea.id}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {/* Change Lifecycle select */}
                        <select
                          value={selectedIdea.lifecycle_status}
                          onChange={async (e) => {
                            await updateIdeaLifecycle(selectedIdea.id, e.target.value as any);
                            refetchIdeas();
                            refetchEvents();
                          }}
                          className="rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-400 px-2 py-1 outline-none"
                        >
                          <option value="active">Active</option>
                          <option value="dormant">Dormant</option>
                          <option value="merged">Merged</option>
                          <option value="abandoned">Composted</option>
                        </select>
                      </div>
                    </div>
                    <h3 className="text-lg font-bold text-slate-100">{selectedIdea.title}</h3>
                  </div>

                  {/* Why Does This Exist Rationale Spotlight */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => setHighlightWhyExist(!highlightWhyExist)}
                        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold border transition ${
                          highlightWhyExist
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-300'
                        }`}
                      >
                        <HelpCircle className="h-3.5 w-3.5" />
                        Why does this exist?
                      </button>
                    </div>

                    {highlightWhyExist && (
                      <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.02] p-4 space-y-3 shadow-lg shadow-amber-500/[0.01]">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] uppercase tracking-wider font-mono text-amber-400 font-bold">Provenance Rationale Witnessed</span>
                          <span className="text-[10px] text-slate-500 font-mono">Contemporaneous Validation</span>
                        </div>
                        {selectedIdeaEvents.length > 0 ? (
                          <div className="space-y-3">
                            {selectedIdeaEvents.filter(e => e.rationale || e.payload?.rationale).map((e, index) => (
                              <div key={index} className="border-l-2 border-amber-500/30 pl-3">
                                <p className="text-xs text-slate-300 italic">
                                  "{e.rationale || e.payload?.rationale || 'Seeded in garden'}"
                                </p>
                                <div className="flex items-center gap-2 mt-1.5 text-[9px] text-slate-500">
                                  <span>Witness Strength: {e.witness_strength ? `${e.witness_strength}★` : 'None'}</span>
                                  <span>•</span>
                                  <span>Logged by: {e.actor_id || 'System'}</span>
                                  <span>•</span>
                                  <span>{formatDate(e.created_at)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500 italic">This concept emerged organically without explicit rationalization events.</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Active Current Version Content */}
                  <div className="rounded-2xl border border-slate-800/80 bg-slate-900/20 p-5 space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="text-[10px] uppercase font-mono text-slate-500 tracking-wider">Active State Content</span>
                      <button
                        onClick={() => {
                          setEvolveContent(currentArtifact?.content || '');
                          setShowEvolveModal(true);
                        }}
                        className="text-[10px] text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-1"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Evolve Version
                      </button>
                    </div>
                    <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
                      {currentArtifact?.content || "No content recorded for this version."}
                    </p>
                  </div>

                  {/* Provenance Event Stream - the Soil */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                      <Database className="h-4 w-4 text-cyan-400" />
                      Immutable Event Stream (Substrate Soil)
                    </div>

                    {selectedIdeaEvents.length === 0 ? (
                      <p className="text-xs text-slate-500 italic">No historical events recorded for this element.</p>
                    ) : (
                      <div className="space-y-2 border-l border-slate-800/60 pl-3">
                        {selectedIdeaEvents.map((evt) => (
                          <div key={evt.id} className="relative py-1 flex items-start gap-3 hover:bg-slate-900/20 rounded px-2 transition">
                            <div className="absolute -left-[17px] top-2.5 h-2 w-2 rounded-full bg-cyan-500 border border-slate-950" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-slate-200">
                                  {evt.event_type.replace(/_/g, ' ')}
                                </span>
                                <span className="text-[9px] font-mono text-slate-500">
                                  {new Date(evt.created_at).toLocaleTimeString()}
                                </span>
                              </div>
                              <p className="text-xs text-slate-400 mt-1">{evt.rationale || "Witness authenticated."}</p>
                              <div className="flex items-center gap-3 mt-1 text-[9px] text-slate-600 font-mono">
                                <span>Capability: {evt.capability}</span>
                                <span>Policy: {evt.policy}</span>
                                <span>Witness: {evt.witness_strength}★</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                </div>
              )}
            </div>

          </div>
        </section>

      </div>


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
