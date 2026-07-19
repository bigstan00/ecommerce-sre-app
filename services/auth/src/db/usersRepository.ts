import { pool } from './pool';

export interface User {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  created_at: Date;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const { rows } = await pool.query<User>(
    'SELECT id, email, password_hash, name, created_at FROM users WHERE email = $1',
    [email],
  );
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<User | null> {
  const { rows } = await pool.query<User>(
    'SELECT id, email, password_hash, name, created_at FROM users WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

export async function createUser(params: { email: string; passwordHash: string; name: string }): Promise<User> {
  const { rows } = await pool.query<User>(
    `INSERT INTO users (email, password_hash, name)
     VALUES ($1, $2, $3)
     RETURNING id, email, password_hash, name, created_at`,
    [params.email, params.passwordHash, params.name],
  );
  return rows[0];
}
