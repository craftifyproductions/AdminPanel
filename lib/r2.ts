import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { HeadObjectCommandOutput } from "@aws-sdk/client-s3";
import { MissingEnvError, getR2Config, upsertEnvLocalKey } from "@/lib/env";
import type {
  BucketInfo,
  BucketObjectHint,
  ListResponse,
  R2File,
  R2Folder,
  StatsResponse,
} from "@/lib/types";

export const MAX_FOLDER_NAME_LENGTH = 255;
export const MAX_OBJECT_NAME_LENGTH = 255;
export const MAX_PREFIX_LENGTH = 1024;
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_PREVIEW_BYTES = 20 * 1024 * 1024;
export const MAX_MODEL_PREVIEW_BYTES = 20 * 1024 * 1024;
export const MAX_ARCHIVE_PREVIEW_BYTES = 50 * 1024 * 1024;
export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

export type R2ObjectMeta = {
  key: string;
  contentType: string | null;
  size: number;
  lastModified: string | null;
};

export type R2Object = R2ObjectMeta & {
  body: ReadableStream<Uint8Array>;
};

// A single-request CopyObject cannot move more than 5 GB.
const MAX_COPY_BYTES = 5 * 1024 * 1024 * 1024;
const DELETE_BATCH_SIZE = 1000;
const COPY_CONCURRENCY = 16;
const LIST_PAGE_SIZE = 1000;
const STATS_CACHE_TTL_MS = 120_000;
const EMPTINESS_CONCURRENCY = 4;
const BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export class R2Error extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "R2Error";
    this.status = status;
  }
}

type R2Context = { client: S3Client; bucket: string };

let cached: { key: string; context: R2Context } | null = null;
let statsCache: { expiresAt: number; stats: StatsResponse } | null = null;

function getContext(): R2Context {
  const config = getR2Config();
  const key = `${config.endpoint}\u0000${config.bucket}\u0000${config.accessKeyId}\u0000${config.secretAccessKey}`;
  if (cached?.key === key) return cached.context;

  const client = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    // R2 rejects the CRC32 checksum headers newer SDK versions attach by default,
    // so only send a checksum where the operation itself requires one.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  cached = { key, context: { client, bucket: config.bucket } };
  return cached.context;
}

export function validateFolderName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new R2Error("Folder name is required.", 400);
  if (name.includes("/") || name.includes("\\")) {
    throw new R2Error("Folder name cannot contain slashes.", 400);
  }
  if (name === "." || name === "..") {
    throw new R2Error('Folder name cannot be "." or "..".', 400);
  }
  if (CONTROL_CHARS.test(name)) {
    throw new R2Error("Folder name cannot contain control characters.", 400);
  }
  if (name.length > MAX_FOLDER_NAME_LENGTH) {
    throw new R2Error(`Folder name cannot be longer than ${MAX_FOLDER_NAME_LENGTH} characters.`, 400);
  }
  return name;
}

export function validateObjectName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new R2Error("File name is required.", 400);
  if (name.includes("/") || name.includes("\\")) {
    throw new R2Error("File name cannot contain slashes.", 400);
  }
  if (name === "." || name === "..") {
    throw new R2Error('File name cannot be "." or "..".', 400);
  }
  if (CONTROL_CHARS.test(name)) {
    throw new R2Error("File name cannot contain control characters.", 400);
  }
  if (name.length > MAX_OBJECT_NAME_LENGTH) {
    throw new R2Error(`File name cannot be longer than ${MAX_OBJECT_NAME_LENGTH} characters.`, 400);
  }
  return name;
}

function validateObjectKey(raw: string | null | undefined): string {
  if (!raw) throw new R2Error("File key is required.", 400);
  if (raw.startsWith("/")) throw new R2Error('File key cannot start with "/".', 400);
  if (raw.endsWith("/")) {
    throw new R2Error("That key is a folder. Use the folder actions instead.", 400);
  }
  if (raw.length > MAX_PREFIX_LENGTH) {
    throw new R2Error(`File key cannot be longer than ${MAX_PREFIX_LENGTH} characters.`, 400);
  }
  if (CONTROL_CHARS.test(raw)) {
    throw new R2Error("File key contains invalid characters.", 400);
  }
  if (raw.split("/").includes("..")) {
    throw new R2Error('File key cannot contain ".." segments.', 400);
  }
  return raw;
}

export function normalizePrefix(raw: string | null | undefined): string {
  if (raw === null || raw === undefined || raw === "") return "";
  if (raw.startsWith("/")) throw new R2Error('Folder path cannot start with "/".', 400);
  if (!raw.endsWith("/")) throw new R2Error('Folder path must end with "/".', 400);
  if (raw.length > MAX_PREFIX_LENGTH) {
    throw new R2Error(`Folder path cannot be longer than ${MAX_PREFIX_LENGTH} characters.`, 400);
  }
  if (CONTROL_CHARS.test(raw)) {
    throw new R2Error("Folder path contains invalid characters.", 400);
  }
  if (raw.split("/").includes("..")) {
    throw new R2Error('Folder path cannot contain ".." segments.', 400);
  }
  return raw;
}

function lastSegment(prefix: string): string {
  const body = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const index = body.lastIndexOf("/");
  return index === -1 ? body : body.slice(index + 1);
}

function parentOf(prefix: string): string {
  const body = prefix.slice(0, -1);
  const index = body.lastIndexOf("/");
  return index === -1 ? "" : body.slice(0, index + 1);
}

function parentOfKey(key: string): string {
  const index = key.lastIndexOf("/");
  return index === -1 ? "" : key.slice(0, index + 1);
}

function copySource(bucket: string, key: string): string {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `${encodeURIComponent(bucket)}/${path}`;
}

function isNotFound(error: unknown): boolean {
  const name = errorName(error);
  if (name === "NotFound" || name === "NoSuchKey") return true;
  if (typeof error !== "object" || error === null) return false;
  const metadata = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
  return metadata?.httpStatusCode === 404;
}

function isCopyTooLarge(error: unknown): boolean {
  if (errorName(error) === "EntityTooLarge") return true;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("larger than the maximum allowable size");
}

async function headObject(key: string): Promise<HeadObjectCommandOutput | null> {
  const { client, bucket } = getContext();
  try {
    return await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function prefixExists(prefix: string): Promise<boolean> {
  const { client, bucket } = getContext();
  const page = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1 }),
  );
  return (page.Contents?.length ?? 0) > 0 || (page.CommonPrefixes?.length ?? 0) > 0;
}

export async function listLevel(prefix: string): Promise<ListResponse> {
  const normalized = normalizePrefix(prefix);
  const { client, bucket } = getContext();

  const folders: R2Folder[] = [];
  const files: R2File[] = [];
  let token: string | undefined;

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: normalized,
        Delimiter: "/",
        MaxKeys: LIST_PAGE_SIZE,
        ContinuationToken: token,
      }),
    );

    for (const common of page.CommonPrefixes ?? []) {
      const childPrefix = common.Prefix;
      if (!childPrefix) continue;
      folders.push({ name: lastSegment(childPrefix), prefix: childPrefix });
    }

    for (const object of page.Contents ?? []) {
      const key = object.Key;
      if (!key) continue;
      // The zero-byte marker object standing in for this folder is not a file.
      if (key === normalized || key.endsWith("/")) continue;
      files.push({
        name: key.startsWith(normalized) ? key.slice(normalized.length) : lastSegment(key),
        key,
        size: object.Size ?? 0,
        lastModified: object.LastModified?.toISOString() ?? null,
      });
    }

    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  folders.sort((a, b) => collator.compare(a.name, b.name));
  files.sort((a, b) => collator.compare(a.name, b.name));

  return { prefix: normalized, folders, files };
}

export async function listAllKeys(prefix: string): Promise<string[]> {
  const { client, bucket } = getContext();
  const keys: string[] = [];
  let token: string | undefined;

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: LIST_PAGE_SIZE,
        ContinuationToken: token,
      }),
    );
    for (const object of page.Contents ?? []) {
      if (object.Key) keys.push(object.Key);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  return keys;
}

export async function createFolder(parentPrefix: string, name: string): Promise<string> {
  const parent = normalizePrefix(parentPrefix);
  const folderName = validateFolderName(name);
  const prefix = `${parent}${folderName}/`;

  if (prefix.length > MAX_PREFIX_LENGTH) {
    throw new R2Error("Resulting folder path is too long.", 400);
  }
  if (await prefixExists(prefix)) {
    throw new R2Error(`"${folderName}" already exists here.`, 409);
  }

  const { client, bucket } = getContext();
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: prefix, Body: "", ContentLength: 0 }),
  );

  return prefix;
}

async function runBounded<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  let failure: unknown = null;

  const worker = async (): Promise<void> => {
    while (failure === null) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        await task(items[index]);
      } catch (error) {
        if (failure === null) failure = error;
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure !== null) throw failure;
}

async function deleteKeys(keys: readonly string[]): Promise<number> {
  const { client, bucket } = getContext();
  let deleted = 0;

  for (let start = 0; start < keys.length; start += DELETE_BATCH_SIZE) {
    const batch = keys.slice(start, start + DELETE_BATCH_SIZE);
    const result = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    const errors = result.Errors ?? [];
    if (errors.length > 0) {
      throw new R2Error(
        `R2 refused to delete ${errors.length} of ${batch.length} objects (${errors[0]?.Code ?? "unknown error"}).`,
        500,
      );
    }
    deleted += batch.length;
  }

  return deleted;
}

export async function renameFolder(
  prefix: string,
  newName: string,
): Promise<{ prefix: string; moved: number }> {
  const source = normalizePrefix(prefix);
  if (!source) throw new R2Error("The bucket root cannot be renamed.", 400);

  const folderName = validateFolderName(newName);
  const target = `${parentOf(source)}${folderName}/`;
  if (target === source) return { prefix: source, moved: 0 };
  if (target.length > MAX_PREFIX_LENGTH) {
    throw new R2Error("Resulting folder path is too long.", 400);
  }

  const keys = await listAllKeys(source);
  if (keys.length === 0) throw new R2Error("Folder not found.", 404);
  if (await prefixExists(target)) {
    throw new R2Error(`"${folderName}" already exists here.`, 409);
  }

  const { client, bucket } = getContext();
  await runBounded(keys, COPY_CONCURRENCY, async (key) => {
    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: `${target}${key.slice(source.length)}`,
        CopySource: copySource(bucket, key),
      }),
    );
  });

  await deleteKeys(keys);
  return { prefix: target, moved: keys.length };
}

export async function deleteFolder(prefix: string): Promise<number> {
  const target = normalizePrefix(prefix);
  if (!target) throw new R2Error("The bucket root cannot be deleted.", 400);

  const keys = await listAllKeys(target);
  if (keys.length === 0) throw new R2Error("Folder not found.", 404);

  return deleteKeys(keys);
}

export async function renameObject(key: string, newName: string): Promise<string> {
  const source = validateObjectKey(key);
  const name = validateObjectName(newName);

  const head = await headObject(source);
  if (!head) throw new R2Error("File not found.", 404);

  const target = `${parentOfKey(source)}${name}`;
  if (target === source) return source;
  if (target.length > MAX_PREFIX_LENGTH) {
    throw new R2Error("Resulting file path is too long.", 400);
  }
  if ((head.ContentLength ?? 0) > MAX_COPY_BYTES) {
    throw new R2Error("This file is larger than 5 GB, which is too large to rename.", 400);
  }
  if (await headObject(target)) {
    throw new R2Error(`"${name}" already exists here.`, 409);
  }

  const { client, bucket } = getContext();
  try {
    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: target,
        CopySource: copySource(bucket, source),
      }),
    );
  } catch (error) {
    if (isCopyTooLarge(error)) {
      throw new R2Error("This file is larger than 5 GB, which is too large to rename.", 400);
    }
    throw error;
  }

  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: source }));
  return target;
}

export async function deleteObject(key: string): Promise<void> {
  const target = validateObjectKey(key);
  if (!(await headObject(target))) throw new R2Error("File not found.", 404);

  const { client, bucket } = getContext();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: target }));
}

const MAX_BULK_DELETE_KEYS = 10_000;

export async function deleteObjects(keys: string[]): Promise<number> {
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new R2Error("At least one file key is required.", 400);
  }
  if (keys.length > MAX_BULK_DELETE_KEYS) {
    throw new R2Error(`Cannot delete more than ${MAX_BULK_DELETE_KEYS} files at once.`, 400);
  }

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    const target = validateObjectKey(key);
    if (seen.has(target)) continue;
    seen.add(target);
    unique.push(target);
  }

  return deleteKeys(unique);
}

const MAX_BULK_DELETE_FOLDERS = 500;

export type BulkDeleteResult = {
  deletedFiles: number;
  deletedFolders: number;
  deletedObjects: number;
};

function isUnderPrefix(keyOrPrefix: string, ancestor: string): boolean {
  return keyOrPrefix === ancestor || keyOrPrefix.startsWith(ancestor);
}

/** Drops folders nested under other selected folders (longest-prefix wins as parent). */
function collapseFolderPrefixes(prefixes: string[]): string[] {
  const sorted = [...prefixes].sort((a, b) => a.length - b.length || collator.compare(a, b));
  const kept: string[] = [];
  for (const prefix of sorted) {
    if (kept.some((ancestor) => isUnderPrefix(prefix, ancestor))) continue;
    kept.push(prefix);
  }
  return kept;
}

/**
 * Deletes files and folders in one operation.
 * File keys under any selected folder prefix are skipped (folder delete covers them).
 * Nested folder prefixes under a selected parent are also skipped.
 */
export async function bulkDelete(input: {
  files?: string[];
  folders?: string[];
}): Promise<BulkDeleteResult> {
  const rawFiles = input.files ?? [];
  const rawFolders = input.folders ?? [];

  if (!Array.isArray(rawFiles) || !Array.isArray(rawFolders)) {
    throw new R2Error('"files" and "folders" must be arrays when provided.', 400);
  }
  if (rawFiles.length === 0 && rawFolders.length === 0) {
    throw new R2Error("Select at least one file or folder to delete.", 400);
  }
  if (rawFiles.length > MAX_BULK_DELETE_KEYS) {
    throw new R2Error(`Cannot delete more than ${MAX_BULK_DELETE_KEYS} files at once.`, 400);
  }
  if (rawFolders.length > MAX_BULK_DELETE_FOLDERS) {
    throw new R2Error(`Cannot delete more than ${MAX_BULK_DELETE_FOLDERS} folders at once.`, 400);
  }

  const folderSeen = new Set<string>();
  const folders: string[] = [];
  for (const entry of rawFolders) {
    if (typeof entry !== "string") {
      throw new R2Error('"folders" must be an array of strings.', 400);
    }
    const prefix = normalizePrefix(entry);
    if (!prefix) throw new R2Error("The bucket root cannot be deleted.", 400);
    if (folderSeen.has(prefix)) continue;
    folderSeen.add(prefix);
    folders.push(prefix);
  }

  const collapsedFolders = collapseFolderPrefixes(folders);

  const fileSeen = new Set<string>();
  const files: string[] = [];
  for (const entry of rawFiles) {
    if (typeof entry !== "string") {
      throw new R2Error('"files" must be an array of strings.', 400);
    }
    const key = validateObjectKey(entry);
    if (fileSeen.has(key)) continue;
    fileSeen.add(key);
    if (collapsedFolders.some((prefix) => isUnderPrefix(key, prefix))) continue;
    files.push(key);
  }

  if (files.length === 0 && collapsedFolders.length === 0) {
    throw new R2Error("Select at least one file or folder to delete.", 400);
  }

  let deletedObjects = 0;
  if (files.length > 0) {
    deletedObjects += await deleteKeys(files);
  }

  for (const prefix of collapsedFolders) {
    deletedObjects += await deleteFolder(prefix);
  }

  return {
    deletedFiles: files.length,
    deletedFolders: collapsedFolders.length,
    deletedObjects,
  };
}

export async function getObjectMeta(key: string | null | undefined): Promise<R2ObjectMeta> {
  const target = validateObjectKey(key);
  const head = await headObject(target);
  if (!head) throw new R2Error("File not found.", 404);

  return {
    key: target,
    contentType: head.ContentType ?? null,
    size: head.ContentLength ?? 0,
    lastModified: head.LastModified?.toISOString() ?? null,
  };
}

export async function getObject(key: string | null | undefined): Promise<R2Object> {
  const target = validateObjectKey(key);
  const { client, bucket } = getContext();

  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: target }));
    if (!result.Body) throw new R2Error("File not found.", 404);

    return {
      key: target,
      contentType: result.ContentType ?? null,
      size: result.ContentLength ?? 0,
      lastModified: result.LastModified?.toISOString() ?? null,
      body: result.Body.transformToWebStream(),
    };
  } catch (error) {
    if (error instanceof R2Error) throw error;
    if (isNotFound(error)) throw new R2Error("File not found.", 404);
    throw error;
  }
}

export async function putObjectText(
  key: string,
  content: string,
  contentType?: string,
): Promise<void> {
  const target = validateObjectKey(key);
  if (typeof content !== "string") {
    throw new R2Error("Content must be a string.", 400);
  }

  const byteLength = Buffer.byteLength(content, "utf8");
  if (byteLength > MAX_TEXT_BYTES) {
    throw new R2Error("Text content cannot be larger than 2 MiB.", 413);
  }

  const type =
    typeof contentType === "string" && contentType.trim()
      ? contentType.trim()
      : "text/plain; charset=utf-8";

  const { client, bucket } = getContext();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: target,
      Body: content,
      ContentType: type,
      ContentLength: byteLength,
    }),
  );
}

export async function probeBucket(): Promise<StatsResponse> {
  let bucketName = "";

  try {
    const { client, bucket } = getContext();
    bucketName = bucket;
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
    }
    return { bucket: bucketName, objectCount: null, totalSize: null, connected: true };
  } catch (error) {
    console.error("[r2] bucket probe failed", error);
    return {
      bucket: bucketName,
      objectCount: null,
      totalSize: null,
      connected: false,
      error: resolveR2Error(error).message,
    };
  }
}

export async function getStats(options?: { fresh?: boolean }): Promise<StatsResponse> {
  if (!options?.fresh && statsCache && Date.now() < statsCache.expiresAt) {
    return statsCache.stats;
  }

  let bucketName = "";

  try {
    const { client, bucket } = getContext();
    bucketName = bucket;

    let objectCount = 0;
    let totalSize = 0;
    let token: string | undefined;

    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          MaxKeys: LIST_PAGE_SIZE,
          ContinuationToken: token,
        }),
      );
      for (const object of page.Contents ?? []) {
        objectCount += 1;
        totalSize += object.Size ?? 0;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);

    const stats: StatsResponse = { bucket: bucketName, objectCount, totalSize, connected: true };
    statsCache = { expiresAt: Date.now() + STATS_CACHE_TTL_MS, stats };
    return stats;
  } catch (error) {
    console.error("[r2] stats lookup failed", error);
    statsCache = null;
    return {
      bucket: bucketName,
      objectCount: 0,
      totalSize: 0,
      connected: false,
      error: resolveR2Error(error).message,
    };
  }
}

export function validateBucketName(raw: string): string {
  const name = raw.trim().toLowerCase();
  if (!name) throw new R2Error("Bucket name is required.", 400);
  if (name !== raw.trim()) {
    throw new R2Error("Bucket name must be lowercase.", 400);
  }
  if (name.length < 3 || name.length > 63) {
    throw new R2Error("Bucket name must be between 3 and 63 characters.", 400);
  }
  if (!BUCKET_NAME_PATTERN.test(name)) {
    throw new R2Error(
      "Bucket name must use lowercase letters, numbers, and hyphens, and cannot start or end with a hyphen.",
      400,
    );
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) {
    throw new R2Error("Bucket name cannot be formatted like an IP address.", 400);
  }
  return name;
}

async function persistBucketName(name: string): Promise<void> {
  await upsertEnvLocalKey("R2_BUCKET_NAME", name);
}

async function activateBucket(bucketName: string): Promise<void> {
  await persistBucketName(bucketName);
  process.env.R2_BUCKET_NAME = bucketName;
  cached = null;
  statsCache = null;
}

async function probeBucketEmptiness(
  client: S3Client,
  bucketName: string,
): Promise<BucketObjectHint> {
  try {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucketName, MaxKeys: 1 }),
    );
    return (page.Contents?.length ?? 0) > 0 ? "has-objects" : "empty";
  } catch {
    return "unknown";
  }
}

export async function listBuckets(): Promise<BucketInfo[]> {
  const { client } = getContext();
  const result = await client.send(new ListBucketsCommand({}));
  const buckets = (result.Buckets ?? [])
    .map((bucket) => ({
      name: bucket.Name ?? "",
      creationDate: bucket.CreationDate?.toISOString() ?? null,
    }))
    .filter((bucket) => bucket.name.length > 0)
    .sort((a, b) => collator.compare(a.name, b.name));

  const hints = new Map<string, BucketObjectHint>();
  for (const bucket of buckets) hints.set(bucket.name, "unknown");

  await runBounded(buckets, EMPTINESS_CONCURRENCY, async (bucket) => {
    hints.set(bucket.name, await probeBucketEmptiness(client, bucket.name));
  });

  return buckets.map((bucket) => ({
    name: bucket.name,
    creationDate: bucket.creationDate,
    objectHint: hints.get(bucket.name) ?? "unknown",
  }));
}

export async function switchBucket(name: string): Promise<string> {
  const bucketName = validateBucketName(name);
  const { client, bucket: active } = getContext();
  if (bucketName === active) return bucketName;

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucketName }));
  } catch (error) {
    if (isNotFound(error)) {
      throw new R2Error(`Bucket "${bucketName}" was not found.`, 404);
    }
    const code = errorName(error);
    if (code === "NoSuchBucket") {
      throw new R2Error(`Bucket "${bucketName}" was not found.`, 404);
    }
    throw error;
  }

  await activateBucket(bucketName);
  return bucketName;
}

export async function createBucket(name: string): Promise<string> {
  const bucketName = validateBucketName(name);
  const { client } = getContext();

  try {
    await client.send(new CreateBucketCommand({ Bucket: bucketName }));
  } catch (error) {
    const code = errorName(error);
    if (code === "BucketAlreadyExists" || code === "BucketAlreadyOwnedByYou") {
      throw new R2Error(`Bucket "${bucketName}" already exists.`, 409);
    }
    throw error;
  }

  await activateBucket(bucketName);
  return bucketName;
}

export async function deleteBucket(name: string): Promise<void> {
  const bucketName = validateBucketName(name);
  const { client, bucket: active } = getContext();

  const listed = await client.send(new ListBucketsCommand({}));
  const names = (listed.Buckets ?? [])
    .map((bucket) => bucket.Name ?? "")
    .filter((entry) => entry.length > 0);

  if (!names.includes(bucketName)) {
    throw new R2Error(`Bucket "${bucketName}" was not found.`, 404);
  }

  if (names.length <= 1) {
    throw new R2Error("Cannot delete the only remaining bucket.", 400);
  }

  const page = await client.send(
    new ListObjectsV2Command({ Bucket: bucketName, MaxKeys: 1 }),
  );
  if ((page.Contents?.length ?? 0) > 0) {
    throw new R2Error(
      `Bucket "${bucketName}" is not empty. Empty it before deleting.`,
      409,
    );
  }

  try {
    await client.send(new DeleteBucketCommand({ Bucket: bucketName }));
  } catch (error) {
    const code = errorName(error);
    if (code === "BucketNotEmpty" || code === "BucketNotEmptyException") {
      throw new R2Error(
        `Bucket "${bucketName}" is not empty. Empty it before deleting.`,
        409,
      );
    }
    if (isNotFound(error) || code === "NoSuchBucket") {
      throw new R2Error(`Bucket "${bucketName}" was not found.`, 404);
    }
    throw error;
  }

  if (bucketName !== active) return;

  const remaining = names
    .filter((entry) => entry !== bucketName)
    .sort((a, b) => collator.compare(a, b));
  const next = remaining[0];
  if (!next) {
    throw new R2Error("Cannot delete the only remaining bucket.", 400);
  }
  await activateBucket(next);
}

function errorName(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" && name ? name : null;
}

export function resolveR2Error(error: unknown): { status: number; message: string } {
  if (error instanceof R2Error) return { status: error.status, message: error.message };
  if (error instanceof MissingEnvError) return { status: 500, message: error.message };

  const name = errorName(error);
  switch (name) {
    case "NoSuchBucket":
      return { status: 500, message: "The configured R2 bucket does not exist." };
    case "AccessDenied":
    case "InvalidAccessKeyId":
    case "SignatureDoesNotMatch":
    case "CredentialsProviderError":
      return {
        status: 500,
        message: "R2 rejected the credentials. Check R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.",
      };
    case "TimeoutError":
    case "NetworkingError":
      return { status: 500, message: "Could not reach R2. Check the network and R2_ACCOUNT_ID." };
    default:
      return {
        status: 500,
        message: name
          ? `R2 request failed (${name}).`
          : "R2 request failed for an unknown reason.",
      };
  }
}
