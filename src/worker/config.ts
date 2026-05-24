// Cloudflare Access configuration for JWT verification.
//
// Both values below are PUBLIC identifiers (not secrets) — they appear in the
// JWT issuer/audience claims and can be inspected by anyone hitting the app.
// Hardcoding them here is intentional; they don't belong in environment
// variables.
//
// Where to find these in the Cloudflare dashboard:
//
//   ACCESS_TEAM_DOMAIN
//     Dashboard → Zero Trust → Settings → Custom Pages → "Team domain"
//     This is the subdomain you picked when first enabling Zero Trust.
//     Format: <team>.cloudflareaccess.com
//
//   ACCESS_AUD_TAG
//     Dashboard → Zero Trust → Access → Applications → media-tracker
//       → Overview → "Application Audience (AUD) Tag"
//     A 64-character hex string unique to this Access application.

export const ACCESS_TEAM_DOMAIN = "zhanghanxue.cloudflareaccess.com";

// TODO: replace before deploying. Until set correctly, all production
// requests will be rejected with 401 (JWT audience claim won't match).
export const ACCESS_AUD_TAG = "b2140886-3d76-460c-bb0d-6c304f996ec4";
