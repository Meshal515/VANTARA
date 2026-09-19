-- B4/B1 closure — PostgreSQL is no longer an owner of social state.
--
-- These tables were retired when profiles/presence/activity/comments/
-- recommendations/settings moved to D1. Keeping them physically present
-- invites a future route to recreate a second source of truth. No data here is
-- authoritative; the ownership matrix explicitly names D1 as the sole owner.

DROP TABLE IF EXISTS vantara_comment_reactions;
DROP TABLE IF EXISTS vantara_comments;
DROP TABLE IF EXISTS vantara_recommendations;
DROP TABLE IF EXISTS vantara_activity_events;
DROP TABLE IF EXISTS vantara_reading_sessions;
DROP TABLE IF EXISTS vantara_presence;
DROP TABLE IF EXISTS vantara_profiles;
DROP TABLE IF EXISTS vantara_user_gates;

DROP TYPE IF EXISTS comment_target;
DROP TYPE IF EXISTS recommendation_state;
DROP TYPE IF EXISTS presence_status;
