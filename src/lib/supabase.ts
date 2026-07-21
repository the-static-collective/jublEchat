import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const isConfigured = 
  supabaseUrl && 
  supabaseAnonKey && 
  !supabaseUrl.includes('placeholder') && 
  !supabaseUrl.includes('your-');

// Mock Database Storage
class MockQueryBuilder {
  private tableName: string;
  private selects: string = '*';
  private filters: { column: string; value: any }[] = [];
  private orderColumn: string | null = null;
  private orderAscending: boolean = true;
  private limitValue: number | null = null;
  private isSingle: boolean = false;
  private isMaybeSingle: boolean = false;
  private insertData: any = null;
  private updateData: any = null;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  select(columns: string = '*') {
    this.selects = columns;
    return this;
  }

  insert(data: any) {
    this.insertData = data;
    return this;
  }

  update(data: any) {
    this.updateData = data;
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push({ column, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderColumn = column;
    this.orderAscending = options?.ascending ?? true;
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  single() {
    this.isSingle = true;
    return this;
  }

  maybeSingle() {
    this.isMaybeSingle = true;
    return this;
  }

  private getTableData(): any[] {
    const key = `jubilee_table_${this.tableName}`;
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {
        console.error("Failed to parse local table data for:", this.tableName, e);
      }
    }

    // Seed default data if not present
    const seed = SEED_DATA[this.tableName] || [];
    localStorage.setItem(key, JSON.stringify(seed));
    return seed;
  }

  private saveTableData(data: any[]) {
    const key = `jubilee_table_${this.tableName}`;
    localStorage.setItem(key, JSON.stringify(data));
  }

  private execute() {
    let list = [...this.getTableData()];

    // Apply Filter
    if (this.filters.length > 0) {
      list = list.filter(item => {
        return this.filters.every(f => item[f.column] === f.value);
      });
    }

    // Apply Update if active
    if (this.updateData) {
      if (this.tableName === 'events') {
        throw new Error("ERROR: permission denied for relation events");
      }
      const allData = this.getTableData();
      const updatedList: any[] = [];
      const updatedAll = allData.map(item => {
        // Match filter against the original item
        const matches = this.filters.every(f => item[f.column] === f.value);
        if (matches) {
          const updated = { ...item, ...this.updateData };
          updatedList.push(updated);
          return updated;
        }
        return item;
      });
      this.saveTableData(updatedAll);
      return { data: this.isSingle || this.isMaybeSingle ? (updatedList[0] || null) : updatedList, error: null };
    }

    // Apply Insert if active
    if (this.insertData) {
      const allData = this.getTableData();
      const rawRecords = Array.isArray(this.insertData) ? this.insertData : [this.insertData];
      const inserted = rawRecords.map(item => {
        const record = {
          id: item.id || crypto.randomUUID(),
          created_at: item.created_at || new Date().toISOString(),
          ...item
        };
        // Set default owner_id
        const sessionRaw = localStorage.getItem('jubilee_session');
        if (sessionRaw) {
          try {
            const sess = JSON.parse(sessionRaw);
            if (sess?.user?.id) {
              record.owner_id = sess.user.id;
            }
          } catch {}
        }
        return record;
      });
      this.saveTableData([...allData, ...inserted]);
      return { data: this.isSingle || this.isMaybeSingle ? inserted[0] : inserted, error: null };
    }

    // Apply Sorting
    if (this.orderColumn) {
      const col = this.orderColumn;
      const asc = this.orderAscending;
      list.sort((a, b) => {
        const valA = a[col];
        const valB = b[col];
        if (valA === undefined || valA === null) return 1;
        if (valB === undefined || valB === null) return -1;
        if (typeof valA === 'number' && typeof valB === 'number') {
          return asc ? valA - valB : valB - valA;
        }
        return asc 
          ? String(valA).localeCompare(String(valB)) 
          : String(valB).localeCompare(String(valA));
      });
    }

    // Apply Limit
    if (this.limitValue !== null) {
      list = list.slice(0, this.limitValue);
    }

    // Single / MaybeSingle formatting
    if (this.isSingle) {
      return { data: list[0] || null, error: list[0] ? null : { message: 'Row not found' } };
    }
    if (this.isMaybeSingle) {
      return { data: list[0] || null, error: null };
    }

    return { data: list, error: null };
  }

  async then(onfulfilled?: (value: any) => any, onrejected?: (reason: any) => any) {
    try {
      const result = this.execute();
      if (onfulfilled) return onfulfilled(result);
      return result;
    } catch (e) {
      if (onrejected) return onrejected(e);
      throw e;
    }
  }
}

const SEED_DATA: Record<string, any[]> = {
  vms: [
    {
      id: 'a0000000-0000-0000-0000-000000000001',
      name: 'Workspace Core',
      description: 'System level kernel substrate',
      color: '#06b6d4',
      parent_id: null,
      created_at: '2026-07-20T22:08:21Z',
    },
    {
      id: 'a0000000-0000-0000-0000-000000000002',
      name: 'Seed Garden',
      description: 'Initial captures and raw thoughts',
      color: '#10b981',
      parent_id: null,
      created_at: '2026-07-20T22:08:21Z',
    },
    {
      id: 'a0000000-0000-0000-0000-000000000003',
      name: 'Synthesis Lab',
      description: 'Cross-pollination workspace',
      color: '#ec4899',
      parent_id: null,
      created_at: '2026-07-20T22:08:21Z',
    }
  ],
  ideas: [
    {
      id: 'idea-mpls-01',
      title: 'Make Minneapolis neighborhood cooling mutual-aid infrastructure',
      current_version_id: 'art-mpls-v02',
      lifecycle_status: 'active',
      taxonomy_level: 'idea',
      created_at: '2026-07-21T10:00:00Z',
    }
  ],
  idea_versions: [
    {
      id: 'id-v-mpls-01',
      idea_id: 'idea-mpls-01',
      artifact_id: 'art-mpls-v01',
      version_number: 1,
      created_at: '2026-07-20T22:00:00Z',
    },
    {
      id: 'id-v-mpls-02',
      idea_id: 'idea-mpls-01',
      artifact_id: 'art-mpls-v02',
      version_number: 2,
      created_at: '2026-07-21T10:00:00Z',
    }
  ],
  artifacts: [
    {
      id: 'art-mpls-v01',
      vm_id: 'a0000000-0000-0000-0000-000000000001',
      title: 'v0.1 Initial observation',
      content: 'Neighborhood extreme heat response requires localized shade & water points across vulnerable urban corridors.',
      artifact_type: 'thought',
      origin: 'Initial Observation',
      status: 'active',
      parent_artifact_id: null,
      created_at: '2026-07-20T22:00:00Z',
    },
    {
      id: 'art-mpls-v02',
      vm_id: 'a0000000-0000-0000-0000-000000000001',
      title: 'v0.2 Proposed cooling-network model',
      content: 'Deploy community-managed shade hubs with ice distribution across 4 high-risk zones. Depends on recurring volunteer shift coverage.',
      artifact_type: 'note',
      origin: 'Proposed Cooling-Network Model',
      status: 'active',
      parent_artifact_id: 'art-mpls-v01',
      created_at: '2026-07-21T10:00:00Z',
    }
  ],
  claims: [
    {
      id: 'claim-mpls-01',
      artifact_id: 'art-mpls-v02',
      text: 'Volunteer shift coverage required across 4 cooling hubs.',
      confidence: 0.9,
      created_at: '2026-07-21T10:05:00Z',
    }
  ],
  transformations: [],
  edges: [
    {
      id: 'edge-mpls-01',
      source_artifact_id: 'art-mpls-v02',
      target_artifact_id: 'art-mpls-v01',
      edge_type: 'DERIVES_FROM',
      created_at: '2026-07-21T10:00:00Z'
    }
  ],
  receipts: [],
  events: [
    {
      id: 'evt-mpls-01',
      event_type: 'artifact_created',
      entity_id: 'art-mpls-v01',
      entity_type: 'artifact',
      actor: 'human',
      actor_id: 'Community Witness',
      capability: 'system-init',
      policy: 'v0.1',
      payload: { title: 'v0.1 Initial observation', idea_id: 'idea-mpls-01' },
      created_at: '2026-07-20T22:00:00Z',
      rationale: 'Initial observation captured for neighborhood cooling.',
      source_proposal_id: null,
      witness_strength: 5,
    },
    {
      id: 'evt-mpls-02',
      event_type: 'transformation_accepted',
      entity_id: 'art-mpls-v02',
      entity_type: 'artifact',
      actor: 'system',
      actor_id: 'Co-Cultivator AI',
      capability: 'evolve-idea',
      policy: 'v0.2',
      payload: { 
        idea_id: 'idea-mpls-01', 
        version: 2, 
        parent_artifact_id: 'art-mpls-v01',
        tensions: ['volunteer capacity unknown'],
        archived_siblings: ['city-led approach']
      },
      created_at: '2026-07-21T10:00:00Z',
      rationale: 'Proposed cooling-network model with community hubs.',
      source_proposal_id: null,
      witness_strength: 5,
    }
  ],
  proposals: []
};

const mockAuthChangeListeners: ((event: string, session: any) => void)[] = [];

const mockSupabase = {
  auth: {
    async getSession() {
      const raw = localStorage.getItem('jubilee_session');
      if (raw) {
        try {
          return { data: { session: JSON.parse(raw) }, error: null };
        } catch {}
      }
      return { data: { session: null }, error: null };
    },
    onAuthStateChange(callback: (event: string, session: any) => void) {
      mockAuthChangeListeners.push(callback);
      // Run immediately with current session
      const raw = localStorage.getItem('jubilee_session');
      let session = null;
      if (raw) {
        try {
          session = JSON.parse(raw);
        } catch {}
      }
      setTimeout(() => callback('SIGNED_IN', session), 0);

      return {
        data: {
          subscription: {
            unsubscribe() {
              const idx = mockAuthChangeListeners.indexOf(callback);
              if (idx !== -1) mockAuthChangeListeners.splice(idx, 1);
            }
          }
        }
      };
    },
    async signInWithPassword({ email }: { email: string }) {
      const user = { id: 'user-001', email };
      const session = { user, expires_at: Date.now() + 100000 };
      localStorage.setItem('jubilee_session', JSON.stringify(session));
      mockAuthChangeListeners.forEach(listener => listener('SIGNED_IN', session));
      return { data: { session }, error: null };
    },
    async signUp({ email }: { email: string }) {
      const user = { id: 'user-001', email };
      const session = { user, expires_at: Date.now() + 100000 };
      localStorage.setItem('jubilee_session', JSON.stringify(session));
      mockAuthChangeListeners.forEach(listener => listener('SIGNED_IN', session));
      return { data: { session }, error: null };
    },
    async signOut() {
      localStorage.removeItem('jubilee_session');
      mockAuthChangeListeners.forEach(listener => listener('SIGNED_OUT', null));
      return { error: null };
    }
  },
  from(tableName: string) {
    return new MockQueryBuilder(tableName);
  }
};

export const supabase = isConfigured 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : (mockSupabase as any);
