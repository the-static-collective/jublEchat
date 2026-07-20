import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

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

  // API endpoint for chat
  app.post("/api/chat", async (req, res) => {
    try {
      const { message, history, activeIdeas } = req.body;

      if (!apiKey) {
        return res.json({
          text: "I am operating in sandbox mode because no **GEMINI_API_KEY** is configured. You can provide your Gemini API key in **Settings > Secrets** to enable live AI intelligence.\n\nIn the meantime, you can still type messages, capture insights, and evolve your ideas manually using the workspace!",
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
For example, if the user describes an evolution or modification to an existing idea, propose an 'evolve_idea' type.
If they describe something that cross-pollinates multiple existing ideas, propose a 'synthesize_ideas' type with parent_ids.
If they share a raw seed, propose a 'new_idea' (with a suggested level of 'insight', 'idea', or 'project').

${ideasContext}

You MUST respond strictly in the following JSON schema format:
{
  "text": "Your markdown-formatted conversational response to the user. Explain your thoughts and why you are proposing these actions.",
  "proposals": [
    {
      "type": "new_idea" | "evolve_idea" | "synthesize_ideas",
      "title": "A concise, elegant title",
      "content": "The actual proposed text content of the idea, version, or branch",
      "rationale": "Clear rationale statement answering 'Why does this exist?'",
      "taxonomy_level": "insight" | "idea" | "project", // defaults to 'idea' if not specified
      "idea_id": "if type is 'evolve_idea', specify the ID of the existing idea being evolved from the context",
      "parent_ids": ["if type is 'synthesize_ideas' or 'evolve_idea', specify the relevant existing idea IDs being cross-pollinated or evolved"]
    }
  ]
}

Ensure your output is a single valid JSON object. Keep conversations highly collaborative, intellectual, and clear.`;

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
