import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export type ApiRequest = {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  [Symbol.asyncIterator]?: () => AsyncIterator<string | Uint8Array>;
  resume?: () => void;
};

export type ApiResponse = {
  status(code: number): ApiResponse;
  json(value: unknown): void;
  setHeader(name: string, value: string): void;
};

export function setPrivateHeaders(response: ApiResponse) {
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("Vary", "Authorization");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

export function respond(response: ApiResponse, status: number, body: unknown) {
  response.status(status).json(body);
}

export function bearerToken(request: ApiRequest) {
  const header = request.headers?.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function secureTokenMatch(candidate: string | null, expected: string | undefined) {
  if (!candidate || !expected) return false;
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  if (candidateBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(candidateBytes, expectedBytes);
}

export function emailIsAllowlisted(email: string | null | undefined, rawList: string | undefined) {
  if (!email || !rawList) return false;
  const allowed = new Set(
    rawList
      .split(",")
      .map(value => value.trim().toLowerCase())
      .filter(Boolean)
  );
  return allowed.has(email.trim().toLowerCase());
}

export function createAdminClient() {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const SOVEREIGNHALT_WORKSPACE = {
  slug: "sovereignhalt-primary",
  name: "SovereignHalt",
  plan: "sovereignhalt-private-v1",
} as const;

const SEEDED_WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";
type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;
type WorkspaceRow = { id: string; slug: string; name: string; plan: string };

export function isSovereignHaltWorkspace(workspace: WorkspaceRow | null): workspace is WorkspaceRow {
  return Boolean(
    workspace &&
    workspace.id !== SEEDED_WORKSPACE_ID &&
    workspace.slug === SOVEREIGNHALT_WORKSPACE.slug &&
    workspace.name === SOVEREIGNHALT_WORKSPACE.name &&
    workspace.plan === SOVEREIGNHALT_WORKSPACE.plan,
  );
}

export async function getSovereignHaltWorkspace(
  admin: AdminClient,
  createIfMissing = false,
): Promise<{ workspace: WorkspaceRow | null; error: boolean }> {
  const read = async () => {
    const { data, error } = await admin
      .from("workspaces")
      .select("id, slug, name, plan")
      .eq("slug", SOVEREIGNHALT_WORKSPACE.slug)
      .maybeSingle();
    return { workspace: (data as WorkspaceRow | null) ?? null, error: Boolean(error) };
  };
  const current = await read();
  if (current.error) return { workspace: null, error: true };
  if (current.workspace)
    return isSovereignHaltWorkspace(current.workspace)
      ? { workspace: current.workspace, error: false }
      : { workspace: null, error: true };
  if (!createIfMissing) return { workspace: null, error: false };

  const { data: created, error: createError } = await admin
    .from("workspaces")
    .insert(SOVEREIGNHALT_WORKSPACE)
    .select("id, slug, name, plan")
    .single();
  if (!createError && created) {
    const workspace = created as WorkspaceRow;
    return isSovereignHaltWorkspace(workspace)
      ? { workspace, error: false }
      : { workspace: null, error: true };
  }

  // A concurrent first event may win the unique-slug insert; only accept the
  // row after validating its immutable marker fields.
  const raced = await read();
  if (!raced.error && isSovereignHaltWorkspace(raced.workspace))
    return { workspace: raced.workspace, error: false };
  return { workspace: null, error: true };
}

export type BoundedBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "too_large" | "invalid" };

export async function readBoundedRequestBody(request: ApiRequest): Promise<BoundedBodyResult> {
  const lengthHeader = request.headers?.["content-length"];
  const declaredLength = Array.isArray(lengthHeader) ? lengthHeader[0] : lengthHeader;
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > 4096) {
    request.resume?.();
    return { ok: false, reason: "too_large" };
  }

  const iterator = request[Symbol.asyncIterator];
  if (typeof iterator === "function") {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const stream: AsyncIterable<string | Uint8Array> = {
      [Symbol.asyncIterator]: () => iterator.call(request),
    };
    try {
      for await (const chunk of stream) {
        const bytes = Buffer.from(chunk);
        totalBytes += bytes.byteLength;
        if (totalBytes > 4096) {
          request.resume?.();
          return { ok: false, reason: "too_large" };
        }
        chunks.push(bytes);
      }
    } catch {
      return { ok: false, reason: "invalid" };
    }
    const value = parseRequestBody(Buffer.concat(chunks).toString("utf8"));
    return value === null ? { ok: false, reason: "invalid" } : { ok: true, value };
  }

  const value = parseRequestBody(request.body);
  return value === null ? { ok: false, reason: "invalid" } : { ok: true, value };
}

export function parseRequestBody(value: unknown) {
  try {
    if (typeof value === "string") {
      if (Buffer.byteLength(value, "utf8") > 4096) return null;
      return JSON.parse(value) as unknown;
    }
    if (value === null || typeof value !== "object") return null;
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") return null;
    if (Buffer.byteLength(serialized, "utf8") > 4096) return null;
    return value;
  } catch {
    return null;
  }
}
