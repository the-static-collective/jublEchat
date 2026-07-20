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
  artifacts: [
    {
      id: 'art-01',
      vm_id: 'a0000000-0000-0000-0000-000000000001',
      title: 'Primary Jubilee Core',
      content: 'An event-sourced workspace where every artifact has a past, a current form, possible futures, and a reason it changed.',
      artifact_type: 'note',
      origin: 'System Init',
      status: 'active',
      parent_artifact_id: null,
      created_at: '2026-07-20T22:10:00Z',
    },
    {
      id: 'art-02',
      vm_id: 'a0000000-0000-0000-0000-000000000002',
      title: 'Local Memory Substrate',
      content: 'Designing a robust local-storage persistence module to allow instant client-side execution when offline or detached from Supabase.',
      artifact_type: 'thought',
      origin: 'System Init',
      status: 'active',
      parent_artifact_id: null,
      created_at: '2026-07-20T22:12:00Z',
    }
  ],
  claims: [
    {
      id: 'claim-01',
      artifact_id: 'art-01',
      text: 'Provable history of all transitions is preserved.',
      confidence: 1.0,
      created_at: '2026-07-20T22:10:30Z',
    }
  ],
  transformations: [],
  edges: [],
  receipts: [],
  events: [
    {
      id: 'evt-01',
      event_type: 'vm_created',
      entity_id: 'a0000000-0000-0000-0000-000000000001',
      entity_type: 'vm',
      actor: 'system',
      actor_id: 'Root Substrate',
      capability: 'system-init',
      policy: 'v0.1',
      payload: { name: 'Workspace Core' },
      created_at: '2026-07-20T22:08:21Z',
      rationale: 'Initializing Workspace Core substrate.',
      source_proposal_id: null,
      witness_strength: 5,
    },
    {
      id: 'evt-02',
      event_type: 'artifact_created',
      entity_id: 'art-01',
      entity_type: 'artifact',
      actor: 'system',
      actor_id: 'Root Substrate',
      capability: 'system-init',
      policy: 'v0.1',
      payload: { title: 'Primary Jubilee Core' },
      created_at: '2026-07-20T22:10:00Z',
      rationale: 'Primary core note setup.',
      source_proposal_id: null,
      witness_strength: 5,
    }
  ],
  proposals: [],
  ideas: [
    {
      id: 'idea-01',
      title: 'Primary Jubilee Core',
      current_version_id: 'art-01',
      lifecycle_status: 'active',
      taxonomy_level: 'idea',
      created_at: '2026-07-20T22:10:00Z',
    },
    {
      id: 'idea-02',
      title: 'Local Memory Substrate',
      current_version_id: 'art-02',
      lifecycle_status: 'active',
      taxonomy_level: 'insight',
      created_at: '2026-07-20T22:12:00Z',
    }
  ],
  idea_versions: [
    {
      id: 'id-v-01',
      idea_id: 'idea-01',
      artifact_id: 'art-01',
      version_number: 1,
      created_at: '2026-07-20T22:10:00Z',
    },
    {
      id: 'id-v-02',
      idea_id: 'idea-02',
      artifact_id: 'art-02',
      version_number: 1,
      created_at: '2026-07-20T22:12:00Z',
    }
  ]
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
