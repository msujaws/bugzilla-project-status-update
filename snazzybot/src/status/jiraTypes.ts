// Normalized Jira types for internal use
export type JiraIssue = {
  key: string;
  id: string;
  summary: string;
  project: string;
  projectName: string;
  component?: string;
  status: string;
  statusCategory: string;
  resolution?: string;
  assignee?: string;
  assigneeDisplayName?: string;
  assigneeEmail?: string;
  updated: string;
  resolutionDate?: string;
  labels: string[];
  isSecure: boolean;
};

export type JiraChangelogChange = {
  field: string;
  fieldtype: string;
  from: string | null;
  fromString: string | null;
  to: string | null;
  toString: string | null;
};

export type JiraChangelogItem = {
  id: string;
  created: string;
  items: JiraChangelogChange[];
};

export type JiraIssueHistory = {
  key: string;
  id: string;
  changelog: JiraChangelogItem[];
};

// Raw API response types from Jira Cloud API v3
export type JiraRawSearchResponse = {
  expand?: string;
  startAt: number;
  maxResults: number;
  total: number;
  issues: JiraRawIssue[];
};

export type JiraRawIssue = {
  expand?: string;
  id: string;
  self: string;
  key: string;
  fields: {
    summary: string;
    status: {
      self?: string;
      description?: string;
      iconUrl?: string;
      name: string;
      id: string;
      statusCategory: {
        self?: string;
        id: number;
        key: string;
        colorName?: string;
        name: string;
      };
    };
    resolution?: {
      self?: string;
      id: string;
      description?: string;
      name: string;
    } | null;
    resolutiondate?: string | null;
    updated: string;
    project: {
      self?: string;
      id: string;
      key: string;
      name: string;
      projectTypeKey?: string;
      avatarUrls?: Record<string, string>;
    };
    components?: Array<{
      self?: string;
      id: string;
      name: string;
      description?: string;
    }>;
    assignee?: {
      self?: string;
      accountId: string;
      emailAddress?: string;
      displayName: string;
      active?: boolean;
      timeZone?: string;
    } | null;
    labels?: string[];
    security?: {
      self?: string;
      id: string;
      name: string;
      description?: string;
    } | null;
  };
};

export type JiraRawChangelogResponse = {
  startAt: number;
  maxResults: number;
  total: number;
  histories?: Array<{
    id: string;
    author?: {
      self?: string;
      accountId: string;
      emailAddress?: string;
      displayName: string;
      active?: boolean;
    };
    created: string;
    items?: Array<{
      field: string;
      fieldtype: string;
      fieldId?: string;
      from: string | null;
      fromString: string | null;
      to: string | null;
      toString: string | null;
    }>;
  }>;
};
