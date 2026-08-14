from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one exact match, found {count}")
    return text.replace(old, new, 1)


# Align shared types with behavior the application already exercises.
types_path = Path("src/lib/types.ts")
types = types_path.read_text()
types = replace_once(
    types,
    "  type: ArtifactType;\n  status: ArtifactStatus;\n",
    "  type: string;\n  status: ArtifactStatus;\n",
    "graph node presentation type",
)
types = replace_once(
    types,
    "  | 'receipt_issued'\n  | 'vm_created';\n",
    "  | 'receipt_issued'\n  | 'path_abandoned'\n  | 'vm_created';\n",
    "path abandoned event type",
)
types = replace_once(
    types,
    "  created_at: string;\n  preserved_tensions: FrictionRef[];\n",
    "  created_at: string;\n  content?: string | null;\n  rationale?: string | null;\n  witness_strength?: number | null;\n  preserved_tensions: FrictionRef[];\n",
    "idea version legacy projection fields",
)
types_path.write_text(types)

# The App already performs optimistic event projection; expose the hook setter it uses.
hooks_path = Path("src/lib/hooks.ts")
hooks = hooks_path.read_text()
hooks = replace_once(
    hooks,
    "  return { events, loading, refetch: fetch };\n",
    "  return { events, setEvents, loading, refetch: fetch };\n",
    "useEvents setter exposure",
)
hooks_path.write_text(hooks)

# Bring App's lightweight graph/legacy-view usage into its declared contracts.
app_path = Path("src/App.tsx")
app = app_path.read_text()
app = replace_once(
    app,
    "  const { events, refetch: refetchEvents } = useEvents();\n",
    "  const { events, setEvents, refetch: refetchEvents } = useEvents();\n",
    "App useEvents destructure",
)
app = replace_once(
    app,
    """      return {
        id: idea.id,
        label: idea.title,
        type,
      };
""",
    """      return {
        id: idea.id,
        label: idea.title,
        type,
        status: idea.lifecycle_status === 'active' ? 'active' : 'retired',
        vm_id: '',
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
      };
""",
    "App graph node completeness",
)
app = replace_once(
    app,
    """              if (enableLegacyView) {
                const idea = ideas.find(i => i.id === selectedIdeaId);

                const ideaVersions = allIdeaVersions.filter(v => v.idea_id === idea.id);
""",
    """              if (enableLegacyView) {
                const idea = ideas.find(i => i.id === selectedIdeaId);
                if (!idea) return null;

                const ideaVersions = allIdeaVersions.filter(v => v.idea_id === idea.id);
""",
    "legacy view missing idea guard",
)
app = replace_once(
    app,
    "i.status === 'active'",
    "i.lifecycle_status === 'active'",
    "sibling idea lifecycle status",
)
app_path.write_text(app)

# Supabase is intentionally wrapped through a loose adapter; annotate auth callbacks explicitly.
auth_path = Path("src/lib/auth.tsx")
auth = auth_path.read_text()
auth = replace_once(
    auth,
    "import type { Session, User } from '@supabase/supabase-js';\n",
    "import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';\n",
    "auth type imports",
)
auth = replace_once(
    auth,
    "    supabase.auth.getSession().then(({ data }) => {\n",
    "    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {\n",
    "getSession callback type",
)
auth = replace_once(
    auth,
    "    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {\n",
    "    const { data: listener } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, newSession: Session | null) => {\n",
    "auth state callback types",
)
auth_path.write_text(auth)

print("Applied existing TypeScript contract-floor repair successfully.")
