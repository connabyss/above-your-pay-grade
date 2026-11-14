# Contributing

All help is welcome: bug reports, ideas, typo fixes, art, or code. Found a way to make PENNY leak something she shouldn't? That counts too, and it's the best kind of help.

## Quick ways to help
- **Found a bug or something hard to read or use?** Open an issue and say what you did and what happened. A screenshot helps.
- **Found a leak?** Open an issue with the steps. If it exposes something real (not just game secrets), report it privately with GitHub's "Report a vulnerability" button on the Security tab instead.
- **Want to change code?** Fork the repo, make your change on a branch, and open a pull request.

## Running it locally
- `npm install`, then `npm test` (no network needed except `tests/sidechannel_live.test.js`).
- `npm run dev` plays it locally. The page is in `public/`, the server in `worker/index.js`.

## Accessibility
Please keep it playable for everyone: everything should work with a keyboard and on a phone, text should pass contrast, and motion should calm down when "reduce motion" is turned on.

Be kind. The game roasts corporate policy, never people.
