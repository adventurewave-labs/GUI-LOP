-- Initial Migration: Create GUI-LOP Database Schema
-- This script creates the complete database schema from scratch
-- Week 3, Phase 1 - Migration from in-memory Maps to PostgreSQL

-- Create database if it doesn't exist (run as superuser)
-- CREATE DATABASE IF NOT EXISTS gui_lop;

-- Connect to the database
-- \c gui_lop;

-- Run the main schema
\i database/schemas/01_main_schema.sql