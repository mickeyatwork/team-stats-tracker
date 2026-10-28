/**
 * Match Variants and Format Preferences
 */

export const MATCH_VARIANTS = {
  '5-a-side': {
    key: '5-a-side',
    label: '5-a-side'
  },
  '7-a-side': {
    key: '7-a-side',
    label: '7-a-side'
  },
  '9-a-side': {
    key: '9-a-side',
    label: '9-a-side'
  },
  '11-a-side': {
    key: '11-a-side',
    label: '11-a-side'
  }
};

export const MATCH_VARIANT_KEYS = Object.keys(MATCH_VARIANTS);

export const getDefaultMatchVariant = () => {
  try {
    return localStorage.getItem('preferred_match_variant') || '7-a-side';
  } catch {
    return '7-a-side';
  }
};

export const setDefaultMatchVariant = (variant) => {
  try {
    localStorage.setItem('preferred_match_variant', variant);
  } catch (e) {
    console.error('Failed to set preferred match variant', e);
  }
};
