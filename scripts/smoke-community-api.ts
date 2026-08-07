/**
 * Smoke-test community CRUD endpoints (Step 2).
 * Usage: npx tsx scripts/smoke-community-api.ts
 */
const API = process.env.API_URL ?? 'http://localhost:3004/api';

async function login(email: string, password: string) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{ token?: string; id: string; displayName: string }>;
}

async function main() {
  const user = await login('martha.feyissa@prime.edu.et', 'teacher123');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-user-id': user.id,
  };
  if (user.token) headers.Authorization = `Bearer ${user.token}`;

  const communitiesRes = await fetch(`${API}/communities`, { headers });
  if (!communitiesRes.ok) {
    throw new Error(`GET /communities ${communitiesRes.status}: ${await communitiesRes.text()}`);
  }
  const communities = (await communitiesRes.json()) as { id: string; name: string }[];
  console.log(
    'Communities:',
    communities.map((c) => c.name).join(', ') || '(none)'
  );
  if (communities.length === 0) throw new Error('Expected seeded communities');

  const communityId = communities.find((c) => c.name.includes('Biology'))?.id ?? communities[0].id;
  const channelsRes = await fetch(`${API}/communities/${communityId}/channels`, { headers });
  if (!channelsRes.ok) {
    throw new Error(`GET channels ${channelsRes.status}: ${await channelsRes.text()}`);
  }
  const channels = (await channelsRes.json()) as { id: string; name: string }[];
  console.log('Channels:', channels.map((c) => `#${c.name}`).join(', '));

  const general = channels.find((c) => c.name === 'general') ?? channels[0];
  const postRes = await fetch(`${API}/channels/${general.id}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ content: 'Smoke test message from Martha — hello community!' }),
  });
  if (!postRes.ok) throw new Error(`POST message ${postRes.status}: ${await postRes.text()}`);
  const message = (await postRes.json()) as { id: string; content: string };
  console.log('Posted:', message.id, message.content.slice(0, 40));

  const histRes = await fetch(`${API}/channels/${general.id}/messages?limit=10`, { headers });
  if (!histRes.ok) throw new Error(`GET messages ${histRes.status}`);
  const hist = (await histRes.json()) as { messages: unknown[]; hasMore: boolean };
  console.log('History count:', hist.messages.length, 'hasMore:', hist.hasMore);

  const threadRes = await fetch(`${API}/messages/${message.id}/thread`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: 'Smoke thread' }),
  });
  if (!threadRes.ok) throw new Error(`POST thread ${threadRes.status}: ${await threadRes.text()}`);
  const thread = (await threadRes.json()) as { id: string };
  console.log('Thread:', thread.id);

  const replyRes = await fetch(`${API}/threads/${thread.id}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ content: 'Thread reply — works!' }),
  });
  if (!replyRes.ok) throw new Error(`POST thread msg ${replyRes.status}: ${await replyRes.text()}`);
  console.log('Thread reply ok');

  console.log('STEP 2 SMOKE OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
