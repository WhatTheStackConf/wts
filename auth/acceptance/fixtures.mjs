import { hash } from 'bcryptjs';
import { DatabaseSync } from 'node:sqlite';

export const importedId = 'syntheticuser01';
export const importedEmail = 'imported@acceptance.localhost';
export const importedPassword = 'Synthetic imported password 01!';
export const resetPassword = 'Synthetic changed password 02!';
export const signupEmail = 'signup@acceptance.localhost';
export const signupPassword = 'Synthetic signup password 03!';
export const googleId = 'synthetic-google-subject-001';
export const githubId = 'synthetic-github-subject-002';
export const boundaryPassword = 'a'.repeat(72);
export const legacyLongPassword = 'b'.repeat(73);
export const unicodeCredentials = [
  { id: 'syntheticuser05', email: 'unicode-boundary@acceptance.localhost', password: '雪'.repeat(24) },
  { id: 'syntheticuser06', email: 'unicode-space@acceptance.localhost', password: '  Café🦀password  ' },
];

export async function snapshot() {
  async function user(id, email, password, externalAuths = []) {
    return {
      id, email, name: `Synthetic ${id}`, verified: true,
      created: '2024-01-01T12:00:00.000Z', updated: '2024-01-02T12:00:00.000Z',
      passwordHash: await hash(password, 10), avatar: '', avatarUrl: null,
      preferredLanguage: 'en', username: id, emailVisibility: false, externalAuths,
    };
  }
  return {
    version: 1,
    source: { kind: 'pocketbase', version: '0.30.4', collectionId: '_pb_users_auth_', offline: true },
    users: [
      await user(importedId, importedEmail, importedPassword, [
        { provider: 'google', providerId: googleId }, { provider: 'github', providerId: githubId },
      ]),
      await user('syntheticuser02', 'second@acceptance.localhost', 'Synthetic second password 04!'),
      await user('syntheticuser03', 'boundary@acceptance.localhost', boundaryPassword),
      await user('syntheticuser04', 'legacy@acceptance.localhost', legacyLongPassword),
    ],
  };
}

export function offlinePocketBase(path, data, legacy) {
  const db = new DatabaseSync(path);
  const password = legacy ? '_passwordHash' : 'password';
  const record = legacy ? 'recordId' : 'recordRef';
  const collection = legacy ? 'collectionId' : 'collectionRef';
  try {
    db.exec(`CREATE TABLE _collections (id TEXT, name TEXT, type TEXT);
      CREATE TABLE users (id TEXT, email TEXT, name TEXT, verified INTEGER, created TEXT, updated TEXT,
        "${password}" TEXT, avatar TEXT, preferredLanguage TEXT, username TEXT, emailVisibility INTEGER);
      CREATE TABLE _externalAuths ("${record}" TEXT, "${collection}" TEXT, provider TEXT, providerId TEXT);`);
    db.prepare('INSERT INTO _collections VALUES (?, ?, ?)').run(data.source.collectionId, 'users', 'auth');
    const userInsert = db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const linkInsert = db.prepare('INSERT INTO _externalAuths VALUES (?, ?, ?, ?)');
    for (const user of data.users) {
      userInsert.run(user.id, user.email, user.name, Number(user.verified), user.created, user.updated,
        user.passwordHash, user.avatar, user.preferredLanguage, user.username, Number(user.emailVisibility));
      for (const link of user.externalAuths) linkInsert.run(user.id, data.source.collectionId, link.provider, link.providerId);
    }
  } finally { db.close(); }
}

export function clientManifest({ clientId, origin }) {
  return {
    version: 1, clientId, name: `Synthetic ${clientId}`,
    redirectUris: [`${origin}/callback`], scopes: ['openid', 'profile', 'email', 'wts.profile'],
  };
}
