const fs = require('fs');
const path = require('path');

const DB_FILE = process.env.DB_PATH || path.join(__dirname, 'users.json');

function readStore() {
  try {
    const content = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return { users: [] };
  }
}

function writeStore(store) {
  fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function findUserByProvider(provider, providerId) {
  const store = readStore();
  return store.users.find((u) => u.provider === provider && u.providerId === providerId);
}

function findUserByEmail(email) {
  const store = readStore();
  const normalized = normalizeEmail(email);
  return store.users.find((u) => normalizeEmail(u.email) === normalized);
}

function createUser({ provider, providerId, email, name, password }) {
  const store = readStore();
  const id = (store.users.length ? store.users[store.users.length - 1].id : 0) + 1;
  const user = { id, provider, providerId, email, name, password, createdAt: new Date().toISOString() };
  store.users.push(user);
  writeStore(store);
  return user;
}

function ensureUsers(users) {
  if (!Array.isArray(users) || users.length === 0) return;
  const store = readStore();
  for (const item of users) {
    const exists = store.users.some(
      (u) => u.provider === item.provider && u.providerId === item.provider_id
    );
    if (!exists) {
      const id = (store.users.length ? store.users[store.users.length - 1].id : 0) + 1;
      store.users.push({
        id,
        provider: item.provider,
        providerId: item.provider_id,
        email: item.email,
        name: item.name,
        password: item.password,
        createdAt: new Date().toISOString(),
      });
    }
  }
  writeStore(store);
}

module.exports = {
  findUserByProvider,
  findUserByEmail,
  createUser,
  ensureUsers,
};
