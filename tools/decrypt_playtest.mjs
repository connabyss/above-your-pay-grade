// Maintainers only: node tools/decrypt_playtest.mjs <private_key.jwk.json> <log.json>
import fs from "node:fs";
const [, , keyFile, logFile] = process.argv;
const jwk = JSON.parse(fs.readFileSync(keyFile, "utf8"));
const text = fs.readFileSync(logFile, "utf8");
const blob = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
const un = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const priv = await crypto.subtle.importKey("jwk", jwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
const raw = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, priv, un(blob.key));
const aes = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
const out = await crypto.subtle.decrypt({ name: "AES-GCM", iv: un(blob.iv) }, aes, un(blob.data));
console.log(JSON.stringify(JSON.parse(new TextDecoder().decode(out)), null, 2));
