-- Sewn GarmentCode garments ({SIZE}.garment.json, one per size) are stored in
-- garment-cad beside the rest meshes; a 6-size jogger's sewn mesh is a few MB.
UPDATE storage.buckets
SET file_size_limit = 16777216
WHERE id = 'garment-cad';
