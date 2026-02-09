'use strict';

/**
 * Simple migration script to add Phase 9.2A columns.
 * Run this ONCE via: node migration-9.2a.js
 */

require("dotenv").config();
const { Pool } = require("pg");
const logger = require("./logger");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
});

async function migrate() {
  try {
    console.log('Starting migration...');

    // Add columns to rounds table
    console.log('Adding settlement_window_seconds to rounds...');
    await pool.query(`ALTER TABLE rounds ADD COLUMN IF NOT EXISTS settlement_window_seconds INTEGER DEFAULT 300`);
    console.log('✓ settlement_window_seconds added');

    console.log('Adding settlement_closed_at to rounds...');
    await pool.query(`ALTER TABLE rounds ADD COLUMN IF NOT EXISTS settlement_closed_at TIMESTAMPTZ`);
    console.log('✓ settlement_closed_at added');

    // Add columns to bets table
    console.log('Adding bet_placed_at to bets...');
    await pool.query(`ALTER TABLE bets ADD COLUMN IF NOT EXISTS bet_placed_at TIMESTAMPTZ DEFAULT NOW()`);
    console.log('✓ bet_placed_at added');

    console.log('Adding claimed_at to bets...');
    await pool.query(`ALTER TABLE bets ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ`);
    console.log('✓ claimed_at added');

    // Create indexes
    console.log('Creating indexes...');
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_rounds_settlement_closed_at ON rounds (settlement_closed_at)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_bets_claimed_at ON bets (claimed_at DESC)`);
    console.log('✓ Indexes created');

    console.log('\n✅ Migration completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
