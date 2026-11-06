// Playtest mode, OPT-IN only: open the site with ?playtest=1 and this browser's games are
// recorded (questions, PENNY's answers, FGA results) so the maintainers can review the run.
// Nobody else is recorded. The log is only ever handed out ENCRYPTED with a public key; the
// private key is not in this repo, so the endpoint is safe to be public.

import { PLAYTEST_PUBLIC_KEY } from "./playtest_key.js";

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

export async function encryptForMaintainers(obj, jwk = PLAYTEST_PUBLIC_KEY) {
  const pub = await crypto.subtle.importKey("jwk", jwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(JSON.stringify(obj)));
  const rawKey = await crypto.subtle.exportKey("raw", aes);
  const key = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pub, rawKey);
  return { v: 1, key: b64(key), iv: b64(iv), data: b64(data) };
}

export function playtestEvent(kind, who, extra) {
  return {
    t: new Date().toISOString(),
    kind,
    player: who.badge.user,
    level: who.level,
    ...extra,
  };
}

export const isPlaytester = (req) => /(?:^|;\s*)playtest=1(?:;|$)/.test(req.headers.get("cookie") || "");
