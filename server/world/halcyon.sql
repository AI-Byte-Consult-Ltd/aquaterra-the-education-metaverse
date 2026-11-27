-- Halcyon Archipelago (2026-11-27): what the ground of the new wild palm isles holds for industry.
-- The plots themselves come from land-registry.json by the hourly sync ([65 OPS]); this adds only geology.
INSERT INTO aquaterra_geology (biome, resource, factor)
SELECT b, r, f::numeric FROM (VALUES
  ('palms', 'wood', 1.2), ('palms', 'sand', 1.4), ('palms', 'clay', 0.8), ('palms', 'stone', 1.0), ('palms', 'copper', 0.5)
) v (b, r, f)
ON CONFLICT (biome, resource) DO NOTHING;
