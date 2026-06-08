const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;
const dbUrl = process.env.DB_URL;

if (!dbUrl) {
  console.error('Missing DB_URL environment variable.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname)));

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      amount NUMERIC(12, 2) NOT NULL,
      paid_by_id TEXT,
      paid_by_name TEXT,
      splits JSONB NOT NULL,
      split_mode TEXT NOT NULL,
      deleted BOOLEAN NOT NULL DEFAULT FALSE,
      edited BOOLEAN NOT NULL DEFAULT FALSE,
      history JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at BIGINT NOT NULL
    )
  `);
}

function mapExpenseRow(row) {
  return {
    id: row.id,
    desc: row.description,
    amount: Number(row.amount),
    paidById: row.paid_by_id,
    paidByName: row.paid_by_name,
    splits: row.splits || {},
    splitMode: row.split_mode,
    deleted: row.deleted,
    edited: row.edited,
    history: row.history || [],
    createdAt: Number(row.created_at),
  };
}

app.get('/api/members', async (_req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM members ORDER BY created_at ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/members/:id', async (req, res) => {
  const { id } = req.params;
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    await pool.query(
      `INSERT INTO members (id, name)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [id, name]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/members/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM members WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/expenses', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM expenses ORDER BY created_at DESC');
    res.json(result.rows.map(mapExpenseRow));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/expenses/:id', async (req, res) => {
  const { id } = req.params;
  const expense = req.body || {};

  if (!expense.desc || !expense.amount || !expense.createdAt) {
    return res.status(400).json({ error: 'invalid expense payload' });
  }

  try {
    await pool.query(
      `INSERT INTO expenses (
        id, description, amount, paid_by_id, paid_by_name,
        splits, split_mode, deleted, edited, history, created_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6::jsonb, $7, $8, $9, $10::jsonb, $11
      )
      ON CONFLICT (id) DO UPDATE SET
        description = EXCLUDED.description,
        amount = EXCLUDED.amount,
        paid_by_id = EXCLUDED.paid_by_id,
        paid_by_name = EXCLUDED.paid_by_name,
        splits = EXCLUDED.splits,
        split_mode = EXCLUDED.split_mode,
        deleted = EXCLUDED.deleted,
        edited = EXCLUDED.edited,
        history = EXCLUDED.history,
        created_at = EXCLUDED.created_at`,
      [
        id,
        expense.desc,
        Number(expense.amount),
        expense.paidById || null,
        expense.paidByName || null,
        JSON.stringify(expense.splits || {}),
        expense.splitMode || 'equal',
        Boolean(expense.deleted),
        Boolean(expense.edited),
        JSON.stringify(expense.history || []),
        Number(expense.createdAt),
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/expenses/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM expenses WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

initSchema()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server listening on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database schema:', err.message);
    process.exit(1);
  });
