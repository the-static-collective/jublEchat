import { useState, useEffect, useMemo } from 'react';
import {
  Sprout, Leaf, Send, HelpCircle, GitMerge, Clock, Check, X,
  RefreshCw, Plus, MessageSquare, Sparkles, AlertTriangle, Network, PlusCircle, ArrowLeft,
  Shield, Database, Terminal, CheckCircle2, AlertCircle, History, ArrowDown, ShieldCheck, Flame
} from 'lucide-react';
import { AuthProvider, useAuth } from './lib/auth';
import {
  useIdeas, useIdeaVersions, useArtifacts, useEvents, useEdges,
  createIdea, evolveIdea, logEvent, synthesizeIdeas
} from './lib/hooks';
import { GraphCanvas } from './components/GraphCanvas';
import { type TaxonomyLevel } from './lib/types';
import { resolveWhyCurrentChain, getTamperFixtures, reduceEvents, verifyStrictAncestryPath } from './lib/ledger';
import { runIntegrationTests, type TestResult } from './lib/test-boundary';

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

                      // Check if there is a target idea for evolution
                      const isEvolve = proposal.type === 'evolve_idea';
                      const targetIdea = isEvolve ? ideas.find(i => i.id === proposal.idea_id) : null;
                      const targetArtifact = targetIdea?.current_version_id ? artifactMap.get(targetIdea.current_version_id) : null;

                      return (
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
                          
                          {/* If it is an evolution proposal, show Before and After */}
                          {isEvolve && targetIdea ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
                              <div className="bg-slate-950/60 rounded-lg p-2 border border-slate-900">
                                <p className="text-[8px] text-slate-500 uppercase tracking-wider font-bold">Before (Active State)</p>
                                <p className="text-[11px] text-slate-400 line-clamp-3 mt-0.5 italic">
                                  "{targetArtifact?.content || 'No active state content.'}"
                                </p>
                              </div>
                              <div className="bg-emerald-500/[0.02] rounded-lg p-2 border border-emerald-500/10">
                                <p className="text-[8px] text-emerald-400 uppercase tracking-wider font-bold">After (Proposed State)</p>
                                <p className="text-[11px] text-slate-300 line-clamp-3 mt-0.5">
                                  "{proposal.content}"
                                </p>
                              </div>
                            </div>
                          ) : (
                            <p className="text-xs text-slate-300 line-clamp-4">{proposal.content}</p>
                          )}

                          <div className="bg-slate-900/60 rounded-lg p-2 border border-slate-800">
                            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Suggested Rationale</p>
                            <p className="text-xs text-slate-400 italic mt-0.5">"{proposal.rationale}"</p>
                          </div>

                          <div className="flex items-center gap-1.5 pt-1">
                            <button
                              onClick={() => handleAcceptProposal(proposal)}
                              className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-cyan-500 text-slate-950 px-2.5 py-1.5 text-xs font-bold hover:bg-cyan-400 transition"
                            >
                              <Check className="h-3.5 w-3.5" />
                              {proposal.type === 'new_idea' ? 'Keep as idea' : 'Accept Evolution'}
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
                              className="rounded-lg border border-slate-800 text-slate-400 hover:bg-slate-850 px-2 py-1.5 text-xs font-semibold transition"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setRejectedProposals(prev => ({ ...prev, [proposalKey]: true }))}
                              className="rounded-lg border border-transparent text-slate-500 hover:text-rose-400 hover:bg-rose-500/5 px-2 py-1.5 text-xs font-semibold transition"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      );
                    })}
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


        {/* ================= RIGHT PANE: IDEA CULTIVATION & LINEAGE SUBSTRATE (lg:col-span-7) ================= */}
        <section className="lg:col-span-7 flex flex-col h-full bg-slate-950/20 overflow-hidden border-l border-slate-900">
          {/* Section Header with Graph Toggle */}
          <div className="px-6 py-4 border-b border-slate-800/40 bg-slate-950/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Leaf className="h-4 w-4 text-emerald-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                {selectedIdeaId ? "Idea Lineage & Version Evolution" : "Idea Cultivation Garden"}
              </h2>
            </div>
            
            <div className="flex items-center gap-2">
              {/* Ledger Integrity Audit Console Button */}
              <button
                onClick={() => {
                  setShowAuditConsole(!showAuditConsole);
                  setSelectedIdeaId(null);
                }}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold border transition ${
                  showAuditConsole
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                    : liveAudit.audit.status === 'SECURE'
                    ? 'bg-slate-900 border-slate-800 text-slate-300 hover:text-slate-100'
                    : 'bg-rose-950/40 border-rose-500/30 text-rose-400 animate-pulse'
                }`}
              >
                <Shield className="h-3.5 w-3.5" />
                <span>Audit Console</span>
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                  liveAudit.audit.status === 'SECURE' ? 'bg-emerald-500 shadow-sm shadow-emerald-500/40' : 'bg-rose-500 animate-ping'
                }`} />
              </button>

              {/* Show Substrate Graph Toggle */}
              <button
                onClick={() => {
                  setShowGraph(!showGraph);
                  setShowAuditConsole(false);
                }}
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
                  Synthesize ({selectedIdeasForSynthesis.length})
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

          {/* Split Screen Layout or Selective Focus */}
          <div className="flex-1 flex flex-col overflow-hidden h-full">
            {showAuditConsole ? (
              // ---------------- LEDGER BOUNDARY AUDIT CONSOLE ----------------
              <div className="flex-1 flex flex-col overflow-y-auto p-6 space-y-6 scrollbar-thin animate-fadeIn">
                {/* 1. Header */}
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

                {/* 2. Live DB Health State */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* Real-time certified state */}
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
                        {liveAudit.audit.status === 'SECURE' 
                          ? `The live event ledger has passed all 7 constitutional security validations. Every event contains a cryptographically chained linkage hash.`
                          : liveAudit.audit.message}
                      </p>
                    </div>

                    <div className="text-[9px] text-slate-500 font-mono border-t border-slate-900/60 pt-2 flex items-center justify-between">
                      <span>Verified Event Log Size: {events.length}</span>
                      <span>Linkage: SHA-256 Link Chain</span>
                    </div>
                  </div>

                  {/* Tamper Simulation Sandbox Actions */}
                  <div className="rounded-2xl border border-slate-800/80 bg-slate-900/10 p-4 space-y-3 flex flex-col justify-between">
                    <div>
                      <span className="text-[9px] uppercase tracking-wider font-bold text-slate-400 font-mono">Direct Injection Testing</span>
                      <h4 className="text-xs font-bold text-slate-200 mt-2">Projection Tamper & Sync Test</h4>
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                        Test our "Projection Non-Authority" system: maliciously modify an event directly in the database without human consent. Replay and sync will instantly expose it.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-900/60">
                      <button
                        onClick={handleTriggerTamperSandbox}
                        disabled={events.length === 0}
                        className="flex-1 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 px-2.5 py-1.5 text-xs font-bold transition disabled:opacity-40"
                      >
                        Hack Local DB Event Payload
                      </button>
                      <button
                        onClick={handleRepairStateViaLedgerSync}
                        className="flex-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 px-2.5 py-1.5 text-xs font-bold transition"
                      >
                        Sync & Repair Ledger
                      </button>
                    </div>
                  </div>

                  {/* Production Boundary Integration Tests */}
                  <div className="rounded-2xl border border-slate-800/80 bg-slate-900/10 p-4 space-y-3 flex flex-col justify-between">
                    <div>
                      <span className="text-[9px] uppercase tracking-wider font-bold text-slate-400 font-mono">Boundary Integrity</span>
                      <h4 className="text-xs font-bold text-slate-200 mt-2">Production Security Audit</h4>
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                        Verify append-only constraints, secure identity derivation, and client write blocks.
                      </p>
                    </div>

                    <div className="space-y-2 max-h-[140px] overflow-y-auto scrollbar-thin text-[10px] font-mono">
                      {boundaryTestResults ? (
                        boundaryTestResults.map((res, idx) => (
                          <div key={idx} className="border-b border-slate-900/40 pb-1.5 last:border-0">
                            <div className="flex items-center justify-between">
                              <span className="text-slate-300 font-bold truncate pr-1">{res.name}</span>
                              <span className={`px-1 rounded font-bold text-[8px] uppercase ${
                                res.passed ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-450'
                              }`}>
                                {res.passed ? 'PASS' : 'FAIL'}
                              </span>
                            </div>
                            <p className="text-slate-500 text-[9px] mt-0.5 leading-normal">{res.message}</p>
                          </div>
                        ))
                      ) : (
                        <p className="text-slate-500 italic text-center py-2 text-[9px]">No boundary audit executed yet.</p>
                      )}
                    </div>

                    <div className="pt-2 border-t border-slate-900/60">
                      <button
                        onClick={handleRunBoundaryTests}
                        disabled={boundaryTestingRunning}
                        className="w-full rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20 px-2.5 py-1.5 text-xs font-bold transition disabled:opacity-45 flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        {boundaryTestingRunning ? (
                          <>
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            Auditing Bounds...
                          </>
                        ) : (
                          <>
                            <Shield className="h-3.5 w-3.5" />
                            Run Boundary Audit
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* 3. Replay Test Fixtures Area */}
                <div className="space-y-4 pt-4 border-t border-slate-900/60">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                      Constitutional Replay Test Suite (v0.2.1)
                    </h4>
                    <span className="text-[10px] font-mono text-slate-550">
                      Decoupled Reducer Sandbox
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {/* Fixture Selector side pane */}
                    <div className="md:col-span-1 space-y-2">
                      {Object.entries(getTamperFixtures()).map(([key, f]) => {
                        const isSelected = selectedFixtureKey === key;
                        return (
                          <button
                            key={key}
                            onClick={() => setSelectedFixtureKey(key)}
                            className={`w-full rounded-xl border p-3 text-left transition text-xs flex flex-col gap-1 ${
                              isSelected 
                                ? 'border-amber-550/40 bg-amber-950/20 text-amber-400'
                                : 'border-slate-900/60 bg-slate-950/20 text-slate-450 hover:bg-slate-900/40 hover:text-slate-300'
                            }`}
                          >
                            <span className="font-bold flex items-center gap-1.5">
                              {key === 'valid_chain' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
                              {f.name}
                            </span>
                            <span className="text-[10px] text-slate-550 leading-normal line-clamp-2">
                              {f.description}
                            </span>
                          </button>
                        );
                      })}
                      
                      <button
                        onClick={() => runFixtureAuditTest(selectedFixtureKey)}
                        className="w-full mt-2 flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-slate-950 font-bold px-4 py-2 text-xs transition hover:from-amber-450 hover:to-orange-500 cursor-pointer"
                      >
                        <Terminal className="h-4 w-4" />
                        Execute Sandbox Replay
                      </button>
                    </div>

                    {/* Console Logger display */}
                    <div className="md:col-span-2 flex flex-col rounded-2xl border border-slate-900 bg-slate-950/60 p-4 space-y-3 font-mono text-[11px] leading-relaxed">
                      <div className="flex items-center justify-between border-b border-slate-900/80 pb-2">
                        <span className="text-slate-500 uppercase tracking-wider font-bold">REPLAY ENGINE LOGS</span>
                        <span className="text-[9px] text-slate-600">Pure Reducer (No DB Side Effects)</span>
                      </div>

                      <div className="flex-1 max-h-56 overflow-y-auto pr-2 space-y-1 text-slate-350 min-h-[140px] scrollbar-thin">
                        {fixtureConsoleLogs.length === 0 ? (
                          <span className="text-slate-600 italic">◈ Select a fixture test and click Execute to observe the detached reduction stream...</span>
                        ) : (
                          fixtureConsoleLogs.map((log, i) => (
                            <div key={i} className={
                              log.includes('CRITICAL') || log.includes('mismatch') || log.includes('VIOLATION')
                                ? 'text-rose-400 font-semibold animate-pulse' 
                                : log.includes('SUCCESS') 
                                ? 'text-emerald-400 font-semibold' 
                                : log.includes('EVAL') 
                                ? 'text-slate-500' 
                                : 'text-slate-300'
                            }>
                              {log}
                            </div>
                          ))
                        )}
                      </div>

                      {fixtureTestResult && (
                        <div className={`mt-2 rounded-lg border p-2.5 flex items-center justify-between ${
                          fixtureTestResult.audit.status === 'SECURE'
                            ? 'bg-emerald-950/20 border-emerald-500/20 text-emerald-400'
                            : 'bg-rose-950/20 border-rose-500/20 text-rose-400'
                        }`}>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider">RESULT: {fixtureTestResult.audit.status}</span>
                          </div>
                          {fixtureTestResult.audit.computedHash && (
                            <span className="text-[9px] font-mono opacity-85">
                              hash: {fixtureTestResult.audit.computedHash}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : !selectedIdeaId ? (
              // ---------------- GARDEN OVERLOOK STATE ----------------
              <div className="flex-1 flex flex-col overflow-hidden">
                
                {/* Search, Filter Tabs and Manual Seeding in One Clean Header */}
                <div className="p-4 bg-slate-950/40 border-b border-slate-800/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex flex-1 items-center gap-2 max-w-md">
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Query living concepts in your lineage..."
                      className="w-full rounded-xl border border-slate-800/80 bg-slate-900/40 py-2 px-3 text-xs text-slate-200 placeholder-slate-500 focus:border-cyan-500/40 outline-none transition"
                    />
                  </div>

                  {/* Taxonomy Filter Bar */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(['all', 'insight', 'idea', 'project', 'inactive'] as const).map((filter) => {
                      const count = filter === 'all' 
                        ? activeIdeasCount 
                        : filter === 'insight'
                        ? insightsCount
                        : filter === 'project'
                        ? projectsCount
                        : filter === 'inactive'
                        ? ideas.filter(i => i.lifecycle_status !== 'active').length
                        : ideas.filter(i => i.taxonomy_level === filter && i.lifecycle_status === 'active').length;

                      return (
                        <button
                          key={filter}
                          onClick={() => setTaxonomyFilter(filter)}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold border transition ${
                            taxonomyFilter === filter
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                              : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <span className="capitalize">{filter}</span>
                          <span className="ml-1.5 bg-slate-950 text-slate-500 px-1.5 py-0.2 rounded font-mono text-[9px]">
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Ideas list with Grid/Cards */}
                <div className="flex-1 overflow-y-auto p-6 scrollbar-thin space-y-4">
                  {filteredIdeas.length === 0 ? (
                    <div className="text-center py-16 space-y-4">
                      <div className="h-12 w-12 bg-slate-900/60 rounded-2xl flex items-center justify-center mx-auto border border-slate-800">
                        <Leaf className="h-5 w-5 text-slate-600" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-sm font-semibold text-slate-300">Your Garden is Empty</h3>
                        <p className="text-xs text-slate-500 max-w-xs mx-auto">
                          Plant a new seed by chatting with the AI Co-Cultivator in the left pane or create one manually below.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {filteredIdeas.map((idea) => {
                        const ideaVersions = allIdeaVersions.filter(v => v.idea_id === idea.id);
                        const versionLabel = `v0.${ideaVersions.length || 1}`;
                        const latestArtifact = idea.current_version_id ? artifactMap.get(idea.current_version_id) : null;
                        const isSelectedForSynth = selectedIdeasForSynthesis.includes(idea.id);

                        return (
                          <div
                            key={idea.id}
                            className={`group rounded-2xl border bg-slate-900/30 p-4 hover:bg-slate-900/50 transition cursor-pointer flex flex-col justify-between relative ${
                              selectedIdeasForSynthesis.includes(idea.id)
                                ? 'border-pink-500/30 ring-1 ring-pink-500/20'
                                : 'border-slate-800/60 hover:border-slate-700'
                            }`}
                            onClick={() => setSelectedIdeaId(idea.id)}
                          >
                            <div>
                              {/* Card Header */}
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <span className={`text-[9px] uppercase tracking-wider font-mono font-bold px-2 py-0.5 rounded border ${
                                  idea.taxonomy_level === 'insight'
                                    ? 'bg-amber-950/40 text-amber-400 border-amber-500/10'
                                    : idea.taxonomy_level === 'project'
                                    ? 'bg-violet-950/40 text-violet-400 border-violet-500/10'
                                    : 'bg-emerald-950/40 text-emerald-400 border-emerald-500/10'
                                }`}>
                                  {idea.taxonomy_level}
                                </span>
                                
                                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                  {/* Selection Checkbox for synthesis */}
                                  <button
                                    onClick={() => toggleIdeaForSynthesis(idea.id)}
                                    title="Select for cross-pollination synthesis"
                                    className={`p-1 rounded transition border ${
                                      isSelectedForSynth
                                        ? 'bg-pink-500/20 border-pink-500/40 text-pink-400'
                                        : 'bg-slate-950 border-slate-800 text-slate-600 hover:text-slate-400'
                                    }`}
                                  >
                                    <GitMerge className="h-3 w-3" />
                                  </button>
                                  
                                  <span className="text-[10px] text-slate-500 font-mono font-semibold bg-slate-950/60 border border-slate-850 px-1.5 py-0.5 rounded">
                                    {versionLabel}
                                  </span>
                                </div>
                              </div>

                              {/* Title */}
                              <h3 className="text-sm font-bold text-slate-100 group-hover:text-cyan-400 transition mb-1">
                                {idea.title}
                              </h3>

                              {/* Content Snippet */}
                              <p className="text-xs text-slate-400 line-clamp-3 mb-4">
                                {latestArtifact?.content || "No active content description."}
                              </p>
                            </div>

                            {/* Card Footer */}
                            <div className="flex items-center justify-between border-t border-slate-800/40 pt-2.5 mt-auto text-[10px] text-slate-500">
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {new Date(idea.created_at).toLocaleDateString()}
                              </span>
                              
                              <div className="flex items-center gap-2">
                                {ideaVersions.length > 1 && (
                                  <span className="text-[9px] bg-emerald-500/5 text-emerald-400 px-1.5 rounded border border-emerald-500/10 font-medium">
                                    Evolved {ideaVersions.length - 1}x
                                  </span>
                                )}
                                <span className="flex items-center text-amber-400 font-bold bg-amber-950/20 px-1 rounded border border-amber-500/5">
                                  {latestArtifact?.witness_strength || 5}★
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Inline Manual Seed Form at the bottom of Overlook */}
                <div className="p-4 border-t border-slate-800/50 bg-slate-950/40">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <PlusCircle className="h-3.5 w-3.5 text-cyan-400" />
                      Seed New Living Idea Manually
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(['insight', 'idea', 'project'] as const).map((level) => (
                      <button
                        key={level}
                        onClick={() => {
                          setManualCaptureMode(level);
                          setCaptureTitle('');
                          setCaptureContent('');
                          setCaptureRationale('');
                          setCaptureWitnessStrength(5);
                          setCaptureModalData({
                            text: '',
                            type: level
                          });
                        }}
                        className={`text-xs rounded-lg px-3 py-1.5 font-bold border transition flex items-center gap-1.5 ${
                          level === 'insight'
                            ? 'bg-amber-950/20 border-amber-500/20 text-amber-400 hover:bg-amber-900/20'
                            : level === 'project'
                            ? 'bg-violet-950/20 border-violet-500/20 text-violet-400 hover:bg-violet-900/20'
                            : 'bg-emerald-950/20 border-emerald-500/20 text-emerald-400 hover:bg-emerald-900/20'
                        }`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Seeding {level}
                      </button>
                    ))}
                  </div>
                </div>

              </div>
            ) : (
              // ---------------- DEEP LINEAGE & VERSION TIMELINE STATE ----------------
              (() => {
                const idea = ideas.find(i => i.id === selectedIdeaId);
                if (!idea) return null;

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
                          const latestContent = latestArtifact?.content || '';
                          const lines = latestContent.split(/[\r\n]+/);
                          const unresolvedQuestions = lines
                            .map(l => l.trim())
                            .filter(l => l.endsWith('?'))
                            .slice(0, 3);

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
                                        <p className="text-[8px] font-mono text-amber-400 uppercase font-bold tracking-wider">
                                          Unresolved Questions
                                        </p>
                                        {unresolvedQuestions.length > 0 ? (
                                          <ul className="list-disc pl-3 text-[10px] text-slate-400 space-y-1">
                                            {unresolvedQuestions.map((q, qIdx) => (
                                              <li key={qIdx} className="italic leading-normal">"{q}"</li>
                                            ))}
                                          </ul>
                                        ) : (
                                          <p className="text-[10px] text-slate-550 italic leading-relaxed">
                                            No active questions flagged in the content. Ask an unanswered question to leave a structural tension.
                                          </p>
                                        )}
                                      </div>

                                      {/* Preserved Tensions from rationale */}
                                      <div className="p-2.5 bg-slate-900/20 rounded-xl border border-slate-850 space-y-1">
                                        <p className="text-[8px] font-mono text-pink-400 uppercase font-bold tracking-wider">
                                          Preserved Frictions
                                        </p>
                                        {latestArtifact?.origin ? (
                                          <p className="text-[10px] text-slate-400 leading-normal italic">
                                            "{latestArtifact.origin}"
                                          </p>
                                        ) : (
                                          <p className="text-[10px] text-slate-550 italic leading-normal">
                                            No explicit design frictions logged.
                                          </p>
                                        )}
                                      </div>

                                      {/* Abandoned Paths */}
                                      <div className="p-2.5 bg-slate-900/20 rounded-xl border border-slate-850 space-y-1">
                                        <p className="text-[8px] font-mono text-violet-400 uppercase font-bold tracking-wider">
                                          Abandoned Paths
                                        </p>
                                        {pastVersionsOfThisIdea.length > 0 ? (
                                          <div className="space-y-1">
                                            <p className="text-[10px] text-slate-400 leading-normal">
                                              {pastVersionsOfThisIdea.length} inactive version{pastVersionsOfThisIdea.length > 1 ? 's' : ''} preserved in the immutable history.
                                            </p>
                                            <div className="flex gap-1.5 flex-wrap pt-0.5">
                                              {pastVersionsOfThisIdea.map((v) => (
                                                <span key={v.id} className="text-[8px] font-mono text-slate-500 bg-slate-950 px-1 py-0.5 rounded uppercase">
                                                  v0.{v.version_number}
                                                </span>
                                              ))}
                                            </div>
                                          </div>
                                        ) : (
                                          <p className="text-[10px] text-slate-550 italic leading-relaxed">
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
              })()
            )}
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
