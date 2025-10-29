export type ProductComponent = { product: string; component: string };

export type GenerateParams = {
  components?: ProductComponent[];
  metabugs?: number[];
  whiteboards?: string[];
  days?: number;
  model?: string;
  format?: "md" | "html";
  debug?: boolean;
  voice?: "normal" | "pirate" | "snazzy-robot";
  audience?: "technical" | "product" | "leadership";
  ids?: number[];
  includePatchContext?: boolean;
};

export type EnvLike = {
  BUGZILLA_API_KEY: string;
  OPENAI_API_KEY: string;
  BUGZILLA_HOST?: string;
  SNAZZY_SKIP_CACHE?: boolean;
};

export type ProgressHooks = {
  phase?: (name: string, meta?: Record<string, unknown>) => void;
  progress?: (name: string, current: number, total?: number) => void;
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
};

export type Bug = {
  id: number;
  summary: string;
  product: string;
  component: string;
  status: string;
  resolution?: string;
  assigned_to?: string;
  assigned_to_detail?: {
    id?: number;
    name?: string;
    real_name?: string;
    nick?: string;
    display_name?: string;
  };
  last_change_time: string;
  groups?: string[];
  depends_on?: number[];
  blocks?: number[];
};

export type BugHistoryChange = {
  field_name: string;
  removed: string;
  added: string;
};

export type BugHistoryEntry = {
  id: number;
  assigned_to?: string;
  assigned_to_detail?: {
    id?: number;
    name?: string;
    real_name?: string;
    nick?: string;
    display_name?: string;
  };
  history: Array<{
    when: string;
    changes?: BugHistoryChange[];
  }>;
};

export type BugHistoryPayload = {
  bugs: BugHistoryEntry[];
};
