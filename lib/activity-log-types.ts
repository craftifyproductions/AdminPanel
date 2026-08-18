export type ActivityLogRow = {
  id: string;
  user_id: string;
  user_email: string;
  action: string;
  summary: string | null;
  path: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ActivityLogGroup = {
  userId: string;
  email: string;
  count: number;
  lastActivityAt: string;
  events: ActivityLogRow[];
};
