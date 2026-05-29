// Client API for media_video_parts — the URL list for watching-mode items
// (e.g. a game watched as a multi-part playthrough).

import type { MediaVideoPart } from "../../worker/db/schema";

export type { MediaVideoPart };

export async function fetchVideoParts(
  mediaId: number,
): Promise<MediaVideoPart[]> {
  const res = await fetch(`/api/media/${mediaId}/parts`);
  if (!res.ok) throw new Error(`Couldn't load video parts (HTTP ${res.status})`);
  const data = (await res.json()) as { parts: MediaVideoPart[] };
  return data.parts;
}

export async function addVideoPartApi(
  mediaId: number,
  url: string,
  title: string | null,
): Promise<void> {
  const res = await fetch(`/api/media/${mediaId}/parts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, title }),
  });
  if (!res.ok) throw new Error(`Couldn't add link (HTTP ${res.status})`);
}

export async function deleteVideoPartApi(
  mediaId: number,
  partId: number,
): Promise<void> {
  const res = await fetch(`/api/media/${mediaId}/parts/${partId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Couldn't remove link (HTTP ${res.status})`);
}
