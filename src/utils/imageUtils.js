import { supabase } from '../supabaseClient';

export const MAX_BADGE_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
export const BADGE_BUCKET = 'team-logos';

/**
 * Validates that a selected file is an allowed image type and within the 2 MB size limit.
 * @param {File} file
 * @returns {{ valid: boolean, error?: string }}
 */
export const validateBadgeFile = (file) => {
  if (!file) {
    return { valid: false, error: 'No file selected.' };
  }

  const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];
  if (!file.type || (!allowedTypes.includes(file.type) && !file.type.startsWith('image/'))) {
    return {
      valid: false,
      error: 'Unsupported file format. Please select a PNG, JPG, WebP, or SVG image.'
    };
  }

  if (file.size > MAX_BADGE_FILE_SIZE) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `Image is too large (${sizeMb} MB). Maximum allowed file size is 2 MB.`
    };
  }

  return { valid: true };
};

/**
 * Resizes an image file to fit inside a square canvas (maxSize x maxSize),
 * preserving aspect ratio with transparent padding, and exports as a WebP Blob.
 *
 * @param {File} file
 * @param {number} maxSize
 * @returns {Promise<Blob>}
 */
export const resizeImageToWebp = (file, maxSize = 256) => {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('Could not initialize image processing canvas.'));
          return;
        }

        ctx.clearRect(0, 0, maxSize, maxSize);

        // Scale proportionally to fit inside maxSize x maxSize
        const scale = Math.min(maxSize / img.width, maxSize / img.height);
        const drawWidth = Math.round(img.width * scale);
        const drawHeight = Math.round(img.height * scale);
        const offsetX = Math.round((maxSize - drawWidth) / 2);
        const offsetY = Math.round((maxSize - drawHeight) / 2);

        ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(objectUrl);
            if (!blob) {
              reject(new Error('Failed to encode image as WebP.'));
              return;
            }
            resolve(blob);
          },
          'image/webp',
          0.88
        );
      } catch (err) {
        URL.revokeObjectURL(objectUrl);
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not load the selected image. Please try another file.'));
    };

    img.src = objectUrl;
  });
};

/**
 * Generates a deterministic, URL-safe storage path for a team's badge.
 * @param {string|number|null} clubId
 * @param {string} teamName
 * @returns {string}
 */
export const getTeamBadgePath = (clubId, teamName) => {
  const safeClub = clubId ? String(clubId).replace(/[^a-zA-Z0-9_-]/g, '') : 'default';
  const slug = (teamName || 'team')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'team';
  return `${safeClub}/${slug}.webp`;
};

/**
 * Uploads a processed WebP Blob to the Supabase `team-logos` storage bucket.
 * Surfaces a clear error message if the bucket is not yet configured.
 *
 * @param {Blob} blob
 * @param {string|number|null} clubId
 * @param {string} teamName
 * @returns {Promise<string>} Public URL with cache-busting query param
 */
export const uploadTeamBadge = async (blob, clubId, teamName) => {
  const path = getTeamBadgePath(clubId, teamName);

  const { error: uploadError } = await supabase.storage
    .from(BADGE_BUCKET)
    .upload(path, blob, {
      contentType: 'image/webp',
      cacheControl: '3600',
      upsert: true
    });

  if (uploadError) {
    const msg = uploadError.message || '';
    if (msg.toLowerCase().includes('bucket') && msg.toLowerCase().includes('not found')) {
      throw new Error(
        `Logo storage is not configured yet (the '${BADGE_BUCKET}' bucket was not found in Supabase Storage).`
      );
    }
    if (msg.toLowerCase().includes('row-level security') || uploadError.statusCode === '403') {
      throw new Error(
        `Permission denied when uploading to '${BADGE_BUCKET}'. Check your Supabase Storage RLS policies.`
      );
    }
    throw new Error(msg || 'Failed to upload team badge.');
  }

  const { data } = supabase.storage.from(BADGE_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) {
    throw new Error('Could not retrieve public URL for uploaded badge.');
  }

  return `${data.publicUrl}?v=${Date.now()}`;
};

/**
 * Removes a team's badge from Supabase Storage.
 * Ignores errors if the file doesn't exist.
 *
 * @param {string|number|null} clubId
 * @param {string} teamName
 */
export const deleteTeamBadge = async (clubId, teamName) => {
  const path = getTeamBadgePath(clubId, teamName);
  try {
    await supabase.storage.from(BADGE_BUCKET).remove([path]);
  } catch (err) {
    console.warn('Could not delete badge from storage:', err);
  }
};

