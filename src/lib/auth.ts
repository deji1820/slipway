import { prisma } from "./prisma";
import type { Tenant } from "@prisma/client";

/**
 * SECURITY TODO: apiKeyHash is currently stored and compared as a plain
 * string, matching what the test scripts seeded ("test-tenant-key-hash").
 * Before this goes anywhere near production, API keys must be hashed
 * (e.g. SHA-256) before storage, and this lookup must hash the incoming
 * header value the same way before comparing — never store or compare
 * raw API keys. Flagged here rather than silently "fixed" so it isn't
 * missed: see AGENT.md's security section.
 */
export async function authenticateTenant(req: Request): Promise<Tenant | null> {
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) return null;

  const tenant = await prisma.tenant.findUnique({
    where: { apiKeyHash: apiKey },
  });

  return tenant;
}
