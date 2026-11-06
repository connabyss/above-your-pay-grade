// Maintainers only. Encrypts the locked documents with a key derived from SESSION_SECRET, so the
// ciphertext can live in this public repo and the worker decrypts it at run time.
// node tools/encrypt_docs.mjs <SESSION_SECRET file or SETUP file> <SECRET_DOCS.json> > src/secret_docs.enc.js
import fs from "node:fs";
import { encryptDocs } from "../src/sealed.js";
const [, , secretFile, docsFile] = process.argv;
const raw = fs.readFileSync(secretFile, "utf8");
const secret = (/^SESSION_SECRET=(.+)$/m.exec(raw)?.[1] || raw).trim();
const docs = fs.readFileSync(docsFile, "utf8").trim();
JSON.parse(docs);
const sealed = await encryptDocs(secret, docs);
process.stdout.write(`// The locked documents, ENCRYPTED. Without the server's SESSION_SECRET this is noise.\n// Made with tools/encrypt_docs.mjs.\nexport const SEALED_DOCS = ${JSON.stringify(sealed)};\n`);
