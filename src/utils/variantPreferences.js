export const MATCH_VARIANTS = [
  '5-a-side',
  '6-a-side',
  '7-a-side',
  '8-a-side',
  '9-a-side',
  '11-a-side'
];

export const getDefaultMatchVariant = () => {
  try {
    return localStorage.getItem('preferred_match_variant') || '5-a-side';
  } catch {
    return '5-a-side';
  }
};

export const setDefaultMatchVariant = (variant) => {
  try {
    localStorage.setItem('preferred_match_variant', variant);
  } catch (e) {
    console.error('Failed to set preferred match variant', e);
  }
};
