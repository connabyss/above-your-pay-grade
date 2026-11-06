// Locked documents can ship inside the code ENCRYPTED (src/secret_docs.enc.js), keyed by the
// server-only SESSION_SECRET. Then changing a locked document is just a push.
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const un = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFor(secret) {
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: enc.encode("above-your-pay-grade/docs"), info: enc.encode("v1") }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function encryptDocs(secret, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFor(secret), enc.encode(text));
  return { v: 1, iv: b64(iv), data: b64(data) };
}
export async function decryptDocs(secret, sealed) {
  const out = await crypto.subtle.decrypt({ name: "AES-GCM", iv: un(sealed.iv) }, await keyFor(secret), un(sealed.data));
  return new TextDecoder().decode(out);
}
