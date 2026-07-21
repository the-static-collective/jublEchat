import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { computeEventHash } from "./src/lib/ledger";

// Initialize Server-bound Supabase Client
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;

const isSupabaseConfigured = 
  supabaseUrl && 
  supabaseAnonKey && 
  !supabaseUrl.includes('placeholder') && 
  !supabaseUrl.includes('your-');

const serverSupabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

async function getAuthenticatedUser(req: express.Request) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Authorization header is required');
  }
  const token = authHeader.substring(7);

  if (!serverSupabase) {
    // Mock / Sandbox mode fallback
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf8');
      const session = JSON.parse(decoded);
      if (session?.user) {
        return { id: session.user.id, email: session.user.email, isMock: true };
      }
    } catch {}
    return { id: 'mock-user-id', email: 'mock-user@example.com', isMock: true };
  }

  // Verify token securely with Supabase auth service
  const { data: { user }, error } = await serverSupabase.auth.getUser(token);
  if (error || !user) {
    throw new Error('Invalid authentication token: ' + (error?.message || 'No user found'));
  }
  return { id: user.id, email: user.email, isMock: false };
}

async function startServer() {
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && !isSupabaseConfigured) {
    throw new Error('SECURE_BACKEND_REQUIRED: Cannot run production server without live Supabase database credentials configured.');
  }

  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Initialize Gemini client
  const apiKey = process.env.GEMINI_API_KEY;
  const ai = new GoogleGenAI({
    apiKey: apiKey || "dummy-key-for-build",
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  // Secure Server-side Event Logging Endpoint (Derives actor identity from auth token)
  app.post("/api/events/log", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const eventData = req.body;

      if (!serverSupabase || user.isMock) {
        return res.status(400).json({ error: "Server-side logging is only active in live Supabase mode." });
      }

      // Strict Event Type Allowlist: Restricts high-authority, state-changing event creation to prevent direct injection bypass
      const ALLOWED_LOG_EVENT_TYPES = [
        'user_feedback',
        'manual_observation',
        'note_captured',
        'test_integrity_endpoint',
        'user_action_logged'
      ];

      const { event_type } = eventData;
      if (!ALLOWED_LOG_EVENT_TYPES.includes(event_type)) {
        return res.status(403).json({
          error: `Forbidden: Creation of high-authority or ledger-consequential event type '${event_type}' via the generic log endpoint is strictly restricted. Material updates must be authorized through command-specific endpoints.`
        });
      }

      // 1. Fetch previous event hash to maintain cryptographic link chain
      let lastHash = 'GENESIS_ANCHOR_v0.2';
      const { data: latestEvents, error: fetchErr } = await serverSupabase
        .from('events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1);

      if (fetchErr) {
        throw new Error(`Failed to fetch latest events: ${fetchErr.message}`);
      }

      if (latestEvents && latestEvents.length > 0) {
        const latestEvent = latestEvents[0];
        const p = typeof latestEvent.payload === 'string' 
          ? JSON.parse(latestEvent.payload) 
          : latestEvent.payload;
        if (p && p._signature_hash) {
          lastHash = p._signature_hash;
        }
      }

      const generatedId = crypto.randomUUID();
      const secureActor = {
        source: 'authenticated_session',
        id: user.id,
        email: user.email
      };

      const finalPayload = {
        ...(eventData.payload || {}),
        actor: secureActor,
        _signature_hash: ''
      };

      const tempEvent = {
        id: generatedId,
        event_type: eventData.event_type,
        entity_id: eventData.entity_id || null,
        entity_type: eventData.entity_type || null,
        actor: eventData.actor || 'human',
        actor_id: user.email,
        capability: eventData.capability || 'manual-capture',
        policy: eventData.policy || 'v0.2.1',
        payload: finalPayload,
        created_at: new Date().toISOString(),
        rationale: eventData.rationale || null,
        source_proposal_id: eventData.source_proposal_id || null,
        witness_strength: eventData.witness_strength || 5,
      };

      // Compute final hash
      const finalHash = computeEventHash(tempEvent as any, lastHash);
      finalPayload._signature_hash = finalHash;

      // Insert directly into events table via server context
      const { error: insertErr } = await serverSupabase.from('events').insert({
        id: generatedId,
        event_type: tempEvent.event_type,
        entity_id: tempEvent.entity_id,
        entity_type: tempEvent.entity_type,
        actor: tempEvent.actor,
        actor_id: tempEvent.actor_id,
        capability: tempEvent.capability,
        policy: tempEvent.policy,
        payload: finalPayload,
        created_at: tempEvent.created_at,
        rationale: tempEvent.rationale,
        source_proposal_id: tempEvent.source_proposal_id,
        witness_strength: tempEvent.witness_strength,
      });

      if (insertErr) {
        throw new Error(`Failed to insert event: ${insertErr.message}`);
      }

      res.json({ success: true, eventId: generatedId, hash: finalHash });
    } catch (error: any) {
      console.error("Server event logging error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Secure Server-side Harvest API (Evolve Idea, handles multiple mutations as an atomic database transaction)
  app.post("/api/harvest", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const { idea_id, current_artifact_id, new_title, new_content, rationale, vm_id, expected_last_event_hash, actor, idempotency_key, preserved_tensions, unresolved_questions, abandoned_paths } = req.body;

      if (!serverSupabase || user.isMock) {
        return res.status(400).json({ error: "Server-side harvest is only active in live Supabase mode." });
      }

      // Assert actor is human; reject model-originated harvests
      if (actor === 'ai' || actor === 'machine') {
        return res.status(403).json({ error: "Forbidden: Evolving ideas via harvest is a strictly human-authenticated privilege." });
      }

      // Resolve idempotency key
      const finalIdempotencyKey = idempotency_key || `harvest-${idea_id}-${current_artifact_id}`;

      // Fetch latest event hash to perform Compare-and-Swap (CAS) on ledger head
      let lastHash = 'GENESIS_ANCHOR_v0.2';
      const { data: latestEvents, error: fetchErr } = await serverSupabase
        .from('events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1);

      if (fetchErr) {
        throw new Error(`Failed to fetch latest events: ${fetchErr.message}`);
      }

      if (latestEvents && latestEvents.length > 0) {
        const latestEvent = latestEvents[0];
        const p = typeof latestEvent.payload === 'string' 
          ? JSON.parse(latestEvent.payload) 
          : latestEvent.payload;
        if (p && p._signature_hash) {
          lastHash = p._signature_hash;
        }
      }

      // If expected head is provided, perform CAS check server-side early
      if (expected_last_event_hash && expected_last_event_hash !== lastHash) {
        return res.status(409).json({ error: "LEDGER_HEAD_CHANGED" });
      }

      // Determine next version number for local hash calculation
      const { data: versions, error: verQueryErr } = await serverSupabase
        .from('idea_versions')
        .select('version_number')
        .eq('idea_id', idea_id)
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (verQueryErr) {
        throw new Error(`Failed to query version history: ${verQueryErr.message}`);
      }

      const nextVersion = (versions?.version_number ?? 0) + 1;

      // Pre-compute the secure event signature hash
      const secureActor = {
        source: 'authenticated_session',
        id: user.id,
        email: user.email
      };

      const finalPayload = {
        idea_id,
        version: nextVersion,
        parent_artifact_id: current_artifact_id,
        idempotency_key: finalIdempotencyKey,
        actor: secureActor,
        preserved_tensions: preserved_tensions || [],
        unresolved_questions: unresolved_questions || [],
        abandoned_paths: abandoned_paths || [],
        _signature_hash: ''
      };

      const tempEvent = {
        id: crypto.randomUUID(),
        event_type: 'transformation_accepted',
        entity_id: '00000000-0000-0000-0000-000000000000', // temporary placeholder for hash calc
        entity_type: 'artifact',
        actor: 'human',
        actor_id: user.email,
        capability: 'evolve-idea',
        policy: 'v0.4',
        payload: finalPayload,
        created_at: new Date().toISOString(),
        rationale,
        source_proposal_id: null,
        witness_strength: 5,
      };

      const computedHash = computeEventHash(tempEvent as any, lastHash);

      // Invoke the fully atomic PostgreSQL RPC transaction
      const { data: rpcResult, error: rpcErr } = await serverSupabase.rpc('harvest_proposal_v2', {
        p_idea_id: idea_id,
        p_current_artifact_id: current_artifact_id,
        p_new_title: new_title,
        p_new_content: new_content,
        p_rationale: rationale,
        p_vm_id: vm_id,
        p_actor_id: user.id,
        p_actor_email: user.email,
        p_idempotency_key: finalIdempotencyKey,
        p_expected_last_event_hash: lastHash,
        p_computed_hash: computedHash
      });

      if (rpcErr) {
        if (rpcErr.message.includes('BASE_VERSION_NO_LONGER_CURRENT')) {
          return res.status(409).json({ error: "BASE_VERSION_NO_LONGER_CURRENT" });
        }
        if (rpcErr.message.includes('LEDGER_HEAD_CHANGED')) {
          return res.status(409).json({ error: "LEDGER_HEAD_CHANGED" });
        }
        throw new Error(`Database transaction failed: ${rpcErr.message}`);
      }

      res.json({
        success: rpcResult.success,
        is_duplicate: rpcResult.is_duplicate,
        newArtifact: rpcResult.new_artifact
      });
    } catch (error: any) {
      console.error("Server harvest error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Dedicated Command Endpoint: Authoritatively declare sibling path abandoned
  app.post("/api/ideas/:ideaId/versions/:versionId/abandon", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const { ideaId, versionId } = req.params;
      const { rationale } = req.body;

      if (!serverSupabase || user.isMock) {
        return res.status(400).json({ error: "Server-side abandonment is only active in live Supabase mode." });
      }

      // 1. Verify the actor may cultivate that idea (retrieve ownership)
      const { data: idea, error: ideaErr } = await serverSupabase
        .from('ideas')
        .select('*')
        .eq('id', ideaId)
        .maybeSingle();

      if (ideaErr || !idea) {
        return res.status(404).json({ error: `Idea '${ideaId}' not found.` });
      }

      // If owner_id is set, verify the user is indeed the owner
      if (idea.owner_id && idea.owner_id !== user.id) {
        return res.status(403).json({ error: "Forbidden: You are not authorized to cultivate this idea." });
      }

      // 2. Reject abandonment of the current version unless that is a separately defined operation
      if (idea.current_version_id === versionId) {
        return res.status(400).json({ error: "Forbidden: Cannot abandon the current active version of an idea." });
      }

      // 3. Confirm the version belongs to the specified idea
      const { data: version, error: versionErr } = await serverSupabase
        .from('idea_versions')
        .select('*')
        .eq('artifact_id', versionId)
        .eq('idea_id', ideaId)
        .maybeSingle();

      if (versionErr || !version) {
        return res.status(404).json({ error: `Version '${versionId}' does not belong to idea '${ideaId}'.` });
      }

      // 4. Fetch previous event hash to maintain cryptographic link chain
      let lastHash = 'GENESIS_ANCHOR_v0.2';
      const { data: latestEvents, error: fetchErr } = await serverSupabase
        .from('events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1);

      if (fetchErr) {
        throw new Error(`Failed to fetch latest events: ${fetchErr.message}`);
      }

      if (latestEvents && latestEvents.length > 0) {
        const latestEvent = latestEvents[0];
        const p = typeof latestEvent.payload === 'string' 
          ? JSON.parse(latestEvent.payload) 
          : latestEvent.payload;
        if (p && p._signature_hash) {
          lastHash = p._signature_hash;
        }
      }

      const generatedId = crypto.randomUUID();
      const secureActor = {
        source: 'authenticated_session',
        id: user.id,
        email: user.email
      };

      const finalPayload = {
        idea_id: ideaId,
        version_id: versionId,
        version_number: version.version_number,
        actor_kind: 'human',
        rationale: rationale || 'Consciously abandoned sibling path.',
        witnessed_at: new Date().toISOString(),
        actor: secureActor,
        _signature_hash: ''
      };

      const tempEvent = {
        id: generatedId,
        event_type: 'path_abandoned',
        entity_id: versionId,
        entity_type: 'artifact',
        actor: 'human',
        actor_id: user.email,
        capability: 'abandon-path',
        policy: 'v0.4',
        payload: finalPayload,
        created_at: new Date().toISOString(),
        rationale: rationale || null,
        source_proposal_id: null,
        witness_strength: 5,
      };

      // Compute final hash
      const finalHash = computeEventHash(tempEvent as any, lastHash);

      // Invoke the fully atomic PostgreSQL RPC transaction for path abandonment
      const { data: rpcResult, error: rpcErr } = await serverSupabase.rpc('abandon_path_v1', {
        p_idea_id: ideaId,
        p_version_id: versionId,
        p_rationale: rationale,
        p_actor_id: user.id,
        p_actor_email: user.email,
        p_expected_last_event_hash: lastHash,
        p_computed_hash: finalHash
      });

      if (rpcErr) {
        if (rpcErr.message.includes('FORBIDDEN_CULTIVATION_RIGHTS')) {
          return res.status(403).json({ error: "Forbidden: You are not authorized to cultivate this idea." });
        }
        if (rpcErr.message.includes('CANNOT_ABANDON_CURRENT_VERSION')) {
          return res.status(400).json({ error: "Forbidden: Cannot abandon the current active version of an idea." });
        }
        if (rpcErr.message.includes('LEDGER_HEAD_CHANGED')) {
          return res.status(409).json({ error: "LEDGER_HEAD_CHANGED" });
        }
        throw new Error(`Database transaction failed: ${rpcErr.message}`);
      }

      res.json({ success: true, eventId: generatedId, hash: finalHash });
    } catch (error: any) {
      console.error("Server path abandonment error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API endpoint for chat
  app.post("/api/chat", async (req, res) => {
    try {
      const { message, history, activeIdeas } = req.body;

      if (!apiKey) {
        const textLower = message.toLowerCase();

        // Scenario 1: User wants to seed a community garden AI
        if (textLower.includes("garden") && !textLower.includes("family") && !textLower.includes("families")) {
          return res.json({
            text: "That sounds like a beautiful, highly collaborative idea! A community garden AI could help self-organize shared tools, water schedules, and crop rotation.\n\nShould we capture this as a living concept in your garden lineage?",
            provenance: {
              contributor: "Co-Cultivator AI",
              informed_by: "New Operational Trajectory",
              delta_summary: "Initial extraction of community garden self-organization claims."
            },
            deliberation: {
              claims: [
                "Self-organization reduces overhead in shared community spaces.",
                "Automated scheduling optimizes water and tool utilization."
              ],
              assumptions: [
                "Garden members are willing to share scheduling data.",
                "Internet connectivity is accessible at garden sites."
              ],
              tensions: [
                "Individual plot autonomy vs. Collective resource constraints."
              ],
              next_moves: [
                { action: "adopt", label: "Seed Community Garden AI", description: "Record new idea seed into workspace ledger." },
                { action: "fork", label: "Fork into Urban Farming Variant", description: "Create a sibling path tailored for rooftop plots." },
                { action: "test", label: "Define Field Trial Experiment", description: "Log an experimental hypothesis for water-scheduling adoption." }
              ]
            },
            pulse: {
              headline: "This proposal is ready for a test; its central assumption remains unchallenged.",
              readiness_status: "ready_for_test",
              recommended_act: {
                action: "test",
                label: "Run Field Trial Experiment",
                description: "Validate data-sharing willingness with 5 garden members before full rollout."
              },
              evidence: {
                claims_count: 2,
                tensions_count: 1,
                unchallenged_assumption: "Garden members are willing to share scheduling data.",
                alternative_branches: ["Urban Farming Variant", "Rooftop Hydroponics"]
              }
            },
            proposals: [
              {
                type: "new_idea",
                title: "Community Garden AI",
                content: "A collaborative coordination system for community gardens to manage shared resources, crop rotations, water schedules, and knowledge sharing.",
                rationale: "To transition from individual isolated plots to an intelligent, self-organizing organic commons.",
                taxonomy_level: "idea"
              }
            ]
          });
        }

        // Scenario 2: User wants to evolve it for families
        if (textLower.includes("family") || textLower.includes("families") || textLower.includes("child") || textLower.includes("children")) {
          // Find if there's an existing idea matching Community Garden AI
          const gardenIdea = activeIdeas?.find((i: any) => i.title.toLowerCase().includes("garden"));
          const targetId = gardenIdea ? gardenIdea.id : "manual-garden-id";

          return res.json({
            text: "Focusing on families is a powerful shift! It changes the design focus from standard agricultural infrastructure to high human adoption, intergenerational play, and collective child-rearing in nature.\n\nI can propose an evolution of our existing community garden idea to reflect this family-centered coordination focus.",
            provenance: {
              contributor: "Operator + Co-Cultivator AI",
              informed_by: gardenIdea ? `Active Idea: "${gardenIdea.title}"` : "Community Garden Base",
              delta_summary: "Evolved target audience from generic infrastructure to family-centered intergenerational play."
            },
            deliberation: {
              claims: [
                "Family engagement increases long-term garden retention by 3x.",
                "Intergenerational play spaces foster communal safety and learning."
              ],
              assumptions: [
                "Parents want structured rotations for child-rearing in outdoor spaces."
              ],
              tensions: [
                "Quiet gardening plots vs. Active child play areas."
              ],
              next_moves: [
                { action: "adopt", label: "Adopt Family-Centered Evolution", description: "Evolve current active garden idea to family focus." },
                { action: "fork", label: "Fork Path into Youth Education Branch", description: "Branch out a dedicated educational curriculum path." },
                { action: "challenge", label: "Challenge Safety Assumptions", description: "Log tension regarding child safety in tool areas." }
              ]
            },
            pulse: {
              headline: "New trajectory identified; central child-safety assumption requires challenge.",
              readiness_status: "needs_tension_check",
              recommended_act: {
                action: "challenge",
                label: "Challenge Safety Assumptions",
                description: "Examine quiet vs. active zone separation before adopting evolution."
              },
              evidence: {
                claims_count: 2,
                tensions_count: 1,
                unchallenged_assumption: "Parents want structured rotations for child-rearing.",
                alternative_branches: ["Youth Education Branch"]
              }
            },
            proposals: [
              {
                type: "evolve_idea",
                title: "Family-Centered Community Garden Coordination System",
                content: "A specialized community garden substrate focused on intergenerational adoption, family-friendly crop allocation, collaborative child-friendly play-and-grow spaces, and parental rotation systems.",
                rationale: "Shifted from infrastructure focus to human adoption.",
                taxonomy_level: "idea",
                idea_id: targetId
              }
            ]
          });
        }

        // Default sandbox response
        return res.json({
          text: "I am operating as your **Co-Cultivator & AI Moderator**.\n\nI turn raw conversation into structured claims, tensions, and concrete next moves. Try typing:\n- *\"I think we should build a community garden AI\"* to plant a new seed.\n- *\"Actually it should focus on families\"* after planting it to witness an AI-driven evolution!",
          provenance: {
            contributor: "Co-Cultivator AI",
            informed_by: "Workspace State Ledger",
            delta_summary: "Standing by for operator inputs and deliberation analysis."
          },
          deliberation: {
            claims: [
              "Every thought has a history, potential futures, and a reason it changed.",
              "Ideas become inspectable, forkable, and collectively governed artifacts."
            ],
            assumptions: [
              "Conversations contain hidden structured claims awaiting extraction."
            ],
            tensions: [
              "Ephemeral chat chatter vs. Immutable ledger lineage."
            ],
            next_moves: [
              { action: "adopt", label: "Propose Seed Concept", description: "Draft a new idea seed." },
              { action: "fork", label: "Explore Sibling Branch", description: "Branch an existing active idea." },
              { action: "test", label: "Run Structural Tension Check", description: "Analyze active ideas for unresolved tensions." }
            ]
          },
          pulse: {
            headline: "Workspace standing by; plant a seed to start the deliberation loop.",
            readiness_status: "ripe_for_synthesis",
            recommended_act: {
              action: "adopt",
              label: "Seed Community Garden AI",
              description: "Type 'I think we should build a community garden AI' to initiate lineage tracking."
            },
            evidence: {
              claims_count: 2,
              tensions_count: 1,
              unchallenged_assumption: "Conversations contain structured claims."
            }
          },
          proposals: [
            {
              type: "new_idea",
              title: "Manual Seed Example",
              content: "This is a sample idea you can seed manually into your workspace.",
              rationale: "To show how ideas are captured from conversations even in sandbox mode.",
              taxonomy_level: "idea"
            }
          ]
        });
      }

      // Structure active ideas context to ground the AI's understanding
      const ideasContext = activeIdeas && activeIdeas.length > 0
        ? `Here are the current active ideas/insights/projects in the workspace:\n${activeIdeas.map((i: any) => `- [ID: ${i.id}] "${i.title}" (Status: ${i.lifecycle_status}, Level: ${i.taxonomy_level || 'idea'}). Content: ${i.content || 'None'}`).join('\n')}`
        : "There are currently no active ideas in the workspace.";

      const systemInstruction = `You are the Jubilee Workspace Co-Cultivating Intelligence, an AI provenance partner and constitutional moderator for cultivating ideas.
Every thought has a history, potential futures, and a reason it changed. You turn conversation into evolving shared work.

You help the user filter and cultivate their thinking across three main taxonomy levels:
1. Insight: something noticed.
2. Idea: something cultivated.
3. Project: something acted upon.

Your job is to engage in a helpful, analytical discussion AND extract a structured Idea-to-Deliberation loop:
1. Extract explicit or implicit Claims.
2. Identify underlying Assumptions.
3. Name conceptual or structural Tensions.
4. Recommend concrete Next Moves: "adopt" (evolve/accept), "test" (experiment), "fork" (branch direction), "challenge" (question), or "retire" (archive path with rationale).

Provide a clear Provenance Cue indicating who contributed, what prior ideas informed this thought, and what changed.

Current living ideas in the workspace:
${ideasContext}

Format your responses strictly in JSON. Ensure your proposals and deliberation loops turn chatter into inspectable, forkable artifacts!`;

      // Format history into contents parts for GoogleGenAI SDK
      const contents = [];
      if (history && Array.isArray(history)) {
        for (const turn of history) {
          contents.push({
            role: turn.role === "user" ? "user" : "model",
            parts: [{ text: typeof turn.content === 'string' ? turn.content : JSON.stringify(turn.content) }]
          });
        }
      }
      contents.push({
        role: "user",
        parts: [{ text: message }]
      });

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              text: {
                type: Type.STRING,
                description: "The main conversational response in markdown."
              },
              provenance: {
                type: Type.OBJECT,
                properties: {
                  contributor: { type: Type.STRING, description: "E.g., 'Co-Cultivator AI' or 'Operator + AI'" },
                  informed_by: { type: Type.STRING, description: "Prior idea/version or context that informed this response" },
                  delta_summary: { type: Type.STRING, description: "Brief summary of what shifted or evolved" }
                }
              },
              deliberation: {
                type: Type.OBJECT,
                properties: {
                  claims: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Extracted claims" },
                  assumptions: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Extracted underlying assumptions" },
                  tensions: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Identified tensions" },
                  next_moves: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        action: { type: Type.STRING, enum: ["adopt", "test", "fork", "challenge", "retire"] },
                        label: { type: Type.STRING },
                        description: { type: Type.STRING }
                      },
                      required: ["action", "label"]
                    }
                  }
                }
              },
              pulse: {
                type: Type.OBJECT,
                properties: {
                  headline: { type: Type.STRING, description: "A concise constitutional pulse summary statement." },
                  readiness_status: { type: Type.STRING, enum: ["ready_for_test", "needs_tension_check", "unchallenged_assumptions", "ripe_for_synthesis"] },
                  recommended_act: {
                    type: Type.OBJECT,
                    properties: {
                      action: { type: Type.STRING, enum: ["adopt", "test", "fork", "challenge", "retire"] },
                      label: { type: Type.STRING },
                      description: { type: Type.STRING }
                    },
                    required: ["action", "label"]
                  },
                  evidence: {
                    type: Type.OBJECT,
                    properties: {
                      claims_count: { type: Type.INTEGER },
                      tensions_count: { type: Type.INTEGER },
                      unchallenged_assumption: { type: Type.STRING },
                      alternative_branches: { type: Type.ARRAY, items: { type: Type.STRING } }
                    }
                  }
                },
                required: ["headline", "readiness_status", "recommended_act"]
              },
              proposals: {
                type: Type.ARRAY,
                description: "Optional list of evolution, capture, or synthesis proposals.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    type: {
                      type: Type.STRING,
                      description: "The type of proposal.",
                      enum: ["new_idea", "evolve_idea", "synthesize_ideas"]
                    },
                    title: {
                      type: Type.STRING,
                      description: "E.g., name of the new idea or proposed version."
                    },
                    content: {
                      type: Type.STRING,
                      description: "Core content/details of the proposal."
                    },
                    rationale: {
                      type: Type.STRING,
                      description: "The reason this should exist."
                    },
                    taxonomy_level: {
                      type: Type.STRING,
                      description: "The proposed level in our taxonomy.",
                      enum: ["insight", "idea", "project"]
                    },
                    idea_id: {
                      type: Type.STRING,
                      description: "Existing idea ID if evolving an existing idea."
                    },
                    parent_ids: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: "IDs of parent ideas being synthesized or combined."
                    }
                  },
                  required: ["type", "title", "content", "rationale"]
                }
              }
            },
            required: ["text"]
          }
        }
      });

      const textOutput = response.text;
      if (textOutput) {
        return res.json(JSON.parse(textOutput));
      } else {
        throw new Error("Empty response from Gemini API");
      }
    } catch (error: any) {
      console.error("Gemini API Error:", error);
      res.status(500).json({
        text: "I encountered an issue processing that thought. Let's try expressing it a bit differently.",
        error: error.message,
        proposals: []
      });
    }
  });

  // API endpoint for synthesizing preview (traits, tensions, proposed new branch)
  app.post("/api/synthesize-preview", async (req, res) => {
    try {
      const { parentIdeas } = req.body;

      if (!apiKey) {
        return res.json({
          title: "Synthesized Concept",
          content: "Merged synthesis of selected nodes.",
          inherited_traits: "A dynamic synthesis of traits from: " + parentIdeas.map((i: any) => i.title).join(", "),
          tensions: "No structural tensions identified in sandbox mode.",
          rationale: "Combining multiple nodes of inquiry to resolve duplication."
        });
      }

      const prompt = `Analyze these parent ideas to be synthesized:
${parentIdeas.map((i: any, index: number) => `Parent ${index + 1}:
Title: "${i.title}"
Content: "${i.content || 'None'}"
Taxonomy Level: "${i.taxonomy_level || 'idea'}"`).join('\n\n')}

Your response must strictly be JSON matching this schema:
{
  "title": "A concise, elegant title for the new synthesized branch",
  "content": "The actual proposed text content of the combined, evolved idea",
  "inherited_traits": "What core traits, philosophies, or technical attributes are inherited from each parent?",
  "tensions": "What contradictions, redundancies, or conceptual tensions exist between these parents that this synthesis resolves?",
  "rationale": "Clear decision rationale answering: Why does this synthesis exist?"
}

Be insightful, precise, and professional.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              content: { type: Type.STRING },
              inherited_traits: { type: Type.STRING },
              tensions: { type: Type.STRING },
              rationale: { type: Type.STRING }
            },
            required: ["title", "content", "inherited_traits", "tensions", "rationale"]
          }
        }
      });

      const textOutput = response.text;
      if (textOutput) {
        return res.json(JSON.parse(textOutput));
      } else {
        throw new Error("Empty response from Gemini API for synthesis preview");
      }
    } catch (error: any) {
      console.error("Gemini API Synthesis Preview Error:", error);
      res.status(500).json({
        title: "Synthesized Concept",
        content: "Evolved concept resolving parent traits.",
        inherited_traits: "Evolved features from multiple sources.",
        tensions: "Complexity threshold resolved through consolidation.",
        rationale: "Synthesis forced by operator."
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
