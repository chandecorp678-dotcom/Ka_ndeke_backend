require("dotenv").config();
const { pool } = require("./db");
const logger = require("./logger");

async function addZilsUUID() {
  try {
    console.log('🔄 Starting Zils UUID column migration...');

    // Add zils_uuid column if it doesn't exist
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS zils_uuid VARCHAR(255) UNIQUE
    `);
    console.log('✅ zils_uuid column added to users table');

    // Create index for faster lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_zils_uuid ON users (zils_uuid)
    `);
    console.log('✅ Index created for zils_uuid');

    console.log('✅ Migration completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

addZilsUUID();
