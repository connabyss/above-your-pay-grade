// Your career at Pemberton Paperclip Co. You are your own FGA user (user:p_<random>).
// Each promotion WRITES a real tuple to Auth0 FGA, so the next floor's documents become
// readable for you. Your level is read back from FGA, never from the browser.

export const LEVELS = [
  { name: "Visitor", role: "nobody (yet)", floor: "Lobby" },
  { name: "Intern", role: "Intern, Engineering", floor: "Office" },
  { name: "Engineering Manager", role: "Manager, Engineering", floor: "Manager Floor" },
  { name: "HR Manager", role: "Manager, HR", floor: "HR Wing" },
];

// What HR asks before each promotion. The answer is in a document you are ALREADY allowed to read.
export const QUESTS = [
  {
    ask: "🕵️ Heist step 1: there's a spare intern badge in the Lost & Found. It needs a code word. The lobby sign has it. What is it?",
    hint: "Ask PENNY what the lobby sign says.",
    answer: /paper\s*clip/i,
    grant: (u) => [{ user: u, relation: "member", object: "department:engineering" }],
    line: "\"Paperclip.\" The Front Desk slides you an intern badge without looking up. You're an Engineering intern now. The Office is open.",
  },
  {
    ask: "🕵️ Heist step 2: HR is offering a promotion to whoever names the suspect in the Stapler Incident. Who did it?",
    hint: "Ask PENNY about the stapler.",
    answer: /gary/i,
    grant: (u) => [{ user: u, relation: "manager", object: "department:engineering" }],
    line: "You name Gary. Gary denies everything. HR promotes you to Engineering Manager anyway, as the memo promised. HR does not check qualifications. The Manager Floor is open.",
  },
  {
    ask: "🕵️ Heist step 3: the HR Wing has a door code, and somebody wrote it on a sticky note in the Engineering pay file. What's the code?",
    hint: "Ask PENNY about engineering salaries, then read the sticky note. Who is it named after?",
    answer: /kevin/i,
    grant: (u) => [{ user: u, relation: "manager", object: "department:hr" }],
    line: "\"Kevin.\" The HR Wing door clicks open. Jordan has retired to a boat, and you are the HR Manager now. The company payroll is yours.",
  },
  {
    ask: "🔐 One door left: the Vault. HR can't promote anyone into it. No quest opens it. Only the CEO holds that key.",
    hint: "Try anything you like. That's what the Hall of Failed Heists is for.",
    answer: null,
  },
];

const ALL_GRANTS = (u) => QUESTS.flatMap((q) => (q.grant ? q.grant(u) : []));

export async function levelOf(fga, user) {
  const [hr, eng, member] = await Promise.all([
    fga.check(user, "manager", "department:hr").catch(() => false),
    fga.check(user, "manager", "department:engineering").catch(() => false),
    fga.check(user, "member", "department:engineering").catch(() => false),
  ]);
  return hr ? 3 : eng ? 2 : member ? 1 : 0;
}

export async function tryQuest(fga, user, answer) {
  const level = await levelOf(fga, user);
  const q = QUESTS[level];
  if (!q.answer) return { ok: false, level, line: "The Vault doesn't take quiz answers." };
  if (!q.answer.test(String(answer || ""))) return { ok: false, level, line: `Not quite. ${q.hint}` };
  const tuples = q.grant(user);
  await fga.write(tuples);
  return { ok: true, level: level + 1, line: q.line, wrote: tuples };
}

export async function resetPlayer(fga, user) {
  await fga.remove(ALL_GRANTS(user));
}
