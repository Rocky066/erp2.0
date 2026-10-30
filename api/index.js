// ==============================================================================
// SCHOOL ERP SAAS — VERCEL SERVERLESS FUNCTION HANDLER
// Entry point for Vercel deployment. Routes all requests to the application
// router in server.js with Supabase state synchronization.
// ==============================================================================

const { appHandler, setInMemoryDb } = require('../server.js');
const Supabase = require('../services/supabase.js');

let initialized = false;

module.exports = async (req, res) => {
  // If Supabase is configured, load initial snapshot into inMemoryDb
  if (!initialized && Supabase.isConfigured()) {
    try {
      const snapshot = await Supabase.loadFullDbFromSupabase();
      if (snapshot) {
        setInMemoryDb(snapshot);
      }
      initialized = true;
    } catch (err) {
      console.warn('[VERCEL] Initial Supabase state synchronization notice:', err.message);
    }
  }

  return appHandler(req, res);
};
