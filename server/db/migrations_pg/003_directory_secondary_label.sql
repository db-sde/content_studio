-- Disambiguates course entries that share a name across different universities (e.g. two
-- different universities both approved as "MBA in Finance") — stores the course's own
-- university_name at approval time so the frontend can show/compose "MBA in Finance — NMIMS"
-- instead of an ambiguous bare name, and can scope the Linked Course dropdown to whichever
-- university the draft's Linked University field currently names. Null for university entries
-- (nothing to disambiguate a university against).
ALTER TABLE directory_entries ADD COLUMN secondary_label TEXT;
