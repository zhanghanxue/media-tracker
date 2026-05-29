import type { MiddlewareHandler } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { ACCESS_AUD_TAG, ACCESS_TEAM_DOMAIN } from "../config";

// Cloudflare Access issues a signed JWT in the `Cf-Access-Jwt-Assertion`
// header for every request that passes the edge auth policy. We verify the
// signature against CF's published JWKS as defense-in-depth: even if the
// Access policy is misconfigured, the route is altered, or someone bypasses
// the edge, the in-Worker check still requires a valid signed JWT issued
// for THIS application (matching audience tag).
//
// In local dev there's no CF Access in front, so we honor a LOCAL_DEV_BYPASS
// env var (set via gitignored .dev.vars) and inject a fake user.

const JWKS = createRemoteJWKSet(
  new URL(`https://${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`),
);

interface AccessJWTPayload {
  email?: string;
  // Service tokens (non-interactive clients like the bulk-import script) carry
  // no email — they identify by `common_name` (the token's name). The edge
  // Access policy is what authorizes them to reach us; the in-Worker check just
  // needs a valid signed JWT for this app's audience, then an identity to record.
  common_name?: string;
}

export type AuthEnv = {
  LOCAL_DEV_BYPASS?: string;
};

export type AuthVariables = {
  user: { email: string };
};

export const cfAccessAuth: MiddlewareHandler<{
  Bindings: AuthEnv;
  Variables: AuthVariables;
}> = async (c, next) => {
  if (c.env.LOCAL_DEV_BYPASS === "1") {
    c.set("user", { email: "dev@local" });
    return next();
  }

  const jwt = c.req.header("Cf-Access-Jwt-Assertion");
  if (!jwt) return c.json({ error: "unauthorized" }, 401);

  try {
    const { payload } = await jwtVerify(jwt, JWKS, {
      issuer: `https://${ACCESS_TEAM_DOMAIN}`,
      audience: ACCESS_AUD_TAG,
    });
    const p = payload as AccessJWTPayload;
    const identity = p.email ?? p.common_name;
    if (!identity) return c.json({ error: "unauthorized" }, 401);
    c.set("user", { email: identity });
  } catch {
    return c.json({ error: "unauthorized" }, 401);
  }

  return next();
};
