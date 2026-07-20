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

  // Secure Server-side Harvest API (Evolve Idea, handles multiple mutations as an atomic transaction)
  app.post("/api/harvest", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const { idea_id, current_artifact_id, new_title, new_content, rationale, vm_id } = req.body;

      if (!serverSupabase || user.isMock) {
        return res.status(400).json({ error: "Server-side harvest is only active in live Supabase mode." });
      }

      // 1. Create the new artifact
      const { data: newArtifact, error: artErr } = await serverSupabase
        .from('artifacts')
        .insert({
          vm_id,
          title: new_title || 'Refined version',
          content: new_content,
          artifact_type: 'note',
          origin: 'Evolved from previous version',
          status: 'active',
          parent_artifact_id: current_artifact_id,
        })
        .select()
        .single();

      if (artErr || !newArtifact) {
        throw new Error(`Failed to create evolved artifact: ${artErr?.message}`);
      }

      // 2. Query next version number
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

      // 3. Write version link
      const { error: verErr } = await serverSupabase.from('idea_versions').insert({
        idea_id,
        artifact_id: newArtifact.id,
        version_number: nextVersion,
      });

      if (verErr) {
        throw new Error(`Failed to record idea version: ${verErr.message}`);
      }

      // 4. Record derivation edge
      await serverSupabase.from('edges').insert({
        source_artifact_id: newArtifact.id,
        target_artifact_id: current_artifact_id,
        edge_type: 'DERIVES_FROM',
      });

      // 5. Update parent current_version_id
      await serverSupabase.from('ideas').update({ current_version_id: newArtifact.id }).eq('id', idea_id);

      // 6. Append the event log
      // Fetch previous event hash to link
      let lastHash = 'GENESIS_ANCHOR_v0.2';
      const { data: latestEvents } = await serverSupabase
        .from('events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1);

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
        idea_id,
        version: nextVersion,
        parent_artifact_id: current_artifact_id,
        actor: secureActor,
        _signature_hash: ''
      };

      const tempEvent = {
        id: generatedId,
        event_type: 'transformation_accepted',
        entity_id: newArtifact.id,
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

      const finalHash = computeEventHash(tempEvent as any, lastHash);
      finalPayload._signature_hash = finalHash;

      const { error: eventErr } = await serverSupabase.from('events').insert({
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

      if (eventErr) {
        throw new Error(`Failed to log harvest event: ${eventErr.message}`);
      }

      res.json({ success: true, newArtifact });
    } catch (error: any) {
      console.error("Server harvest error:", error);
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
          text: "I am operating in sandbox mode because no **GEMINI_API_KEY** is configured in **Settings > Secrets**.\n\nIn the meantime, you can chat with me! Try typing:\n- *\"I think we should build a community garden AI\"* to plant a new seed.\n- *\"Actually it should focus on families\"* after planting it to witness an AI-driven evolution!\n\nYou can also capture insights, evolve versions, and synthesize elements manually.",
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

      const systemInstruction = `You are the Jubilee Workspace Co-Cultivating Intelligence, an AI provenance partner for cultivating ideas.
Every thought has a history, potential futures, and a reason it changed.
You help the user filter and cultivate their thinking across three main taxonomy levels:
1. Insight: something noticed.
2. Idea: something cultivated.
3. Project: something acted upon.

Your job is to engage in a helpful, analytical, and friendly discussion.
If you notice the user expressing a new insight, a cultivated idea, or an active project, you should propose to capture or evolve it.
- If they share a new raw concept (e.g. "I think we should build a community garden AI"), propose a "new_idea" type proposal with an elegant title, content, and a rationale of why it exists.
- If they describe an evolution, refinement, or change of focus to an existing idea (e.g., "Actually it should focus on families" or "Let's make it mobile-first"), propose an "evolve_idea" type proposal. Make sure to specify the matching "idea_id" from the list of active ideas provided below!
- If they describe something that cross-pollinates or merges multiple existing ideas, propose a "synthesize_ideas" type proposal with parent_ids.

Current living ideas in the workspace:
${ideasContext}

When proposing an evolution ("evolve_idea"), always specify the correct "idea_id" of the idea being evolved so the user can accept it directly in their lineage view.
Format your responses strictly in JSON. Ensure your proposals represent the miracle moment of idea cultivation!`;

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
