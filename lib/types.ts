export type R2Folder = { name: string; prefix: string };
export type R2File = { name: string; key: string; size: number; lastModified: string | null };
export type ListResponse = { prefix: string; folders: R2Folder[]; files: R2File[] };
export type StatsResponse = {
  bucket: string;
  objectCount: number | null;
  totalSize: number | null;
  connected: boolean;
  error?: string;
};
export type BucketObjectHint = "empty" | "has-objects" | "unknown";
export type BucketInfo = {
  name: string;
  creationDate: string | null;
  objectHint: BucketObjectHint;
};
export type BucketsResponse = {
  buckets: BucketInfo[];
  active: string;
};
export type ApiError = { error: string };
