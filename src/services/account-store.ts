import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { Account } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_PATH = join(__dirname, '..', '..', 'data', 'accounts.json');

export async function loadAccounts(): Promise<Account[]> {
  if (!existsSync(DATA_PATH)) {
    return [];
  }
  const raw = await readFile(DATA_PATH, 'utf-8');
  return JSON.parse(raw) as Account[];
}

export async function saveAccounts(accounts: Account[]): Promise<void> {
  await writeFile(DATA_PATH, JSON.stringify(accounts, null, 2) + '\n', 'utf-8');
}

export async function addAccount(codexHome: string, remark: string): Promise<Account> {
  const accounts = await loadAccounts();
  const newAccount: Account = {
    id: `acc-${randomUUID().slice(0, 8)}`,
    codexHome,
    enabled: true,
    healthy: true,
    remark,
    usageCount: 0,
    lastUsedAt: null,
  };
  accounts.push(newAccount);
  await saveAccounts(accounts);
  return newAccount;
}

export async function updateAccount(
  id: string,
  partial: Partial<Omit<Account, 'id'>>,
): Promise<Account | null> {
  const accounts = await loadAccounts();
  const index = accounts.findIndex((a) => a.id === id);
  if (index === -1) return null;
  accounts[index] = { ...accounts[index], ...partial };
  await saveAccounts(accounts);
  return accounts[index];
}

export async function removeAccount(id: string): Promise<boolean> {
  const accounts = await loadAccounts();
  const index = accounts.findIndex((a) => a.id === id);
  if (index === -1) return false;
  accounts.splice(index, 1);
  await saveAccounts(accounts);
  return true;
}
