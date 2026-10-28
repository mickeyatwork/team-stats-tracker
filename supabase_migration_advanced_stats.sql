-- Migration: Add Attempts at Goal and Defensive Contributions columns to match_stats table

ALTER TABLE match_stats 
ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS defensive_contributions INTEGER DEFAULT 0;
