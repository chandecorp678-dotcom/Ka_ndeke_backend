require("dotenv").config();
const { pool } = require("./db");
const logger = require("./logger");

async function fixBalanceColumn() {
  try {
    console.log('Starting balance column fix...');

    // Check current column type
    const checkType = await pool.query(`
      SELECT data_type FROM information_schema.columns 
      WHERE table_name='users' AND column_name='balance'
    `);

    console.log('Current balance column type:', checkType.rows[0]?.data_type);

    // If it's not NUMERIC, we need to fix it
    if (checkType.rows[0]?.data_type !== 'numeric') {
      console.log('Converting balance column to NUMERIC...');
      
      // Add a temporary column
      await pool.query(`
        ALTER TABLE users 
        ADD COLUMN balance_temp NUMERIC(18,2) DEFAULT 0
      `);
      
      // Copy data over with proper conversion
      await pool.query(`
        UPDATE users 
        SET balance_temp = CAST(COALESCE(balance, '0') AS NUMERIC(18,2))
      `);
      
      // Drop old column
      await pool.query(`
        ALTER TABLE users 
        DROP COLUMN balance
      `);
      
      // Rename temp column
      await pool.query(`
        ALTER TABLE users 
        RENAME COLUMN balance_temp TO balance
      `);
      
      console.log('✅ Balance column fixed!');
    } else {
      console.log('✅ Balance column is already NUMERIC');
    }

    // Verify
    const verify = await pool.query(`SELECT balance FROM users LIMIT 1`);
    console.log('Sample balance value:', verify.rows[0]?.balance, 'Type:', typeof verify.rows[0]?.balance);

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

fixBalanceColumn();
