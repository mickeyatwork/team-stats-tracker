export const THEMES = {
  CYAN: 'cyan',
  CRIMSON: 'crimson'
};

export const THEME_STORAGE_KEY = 'app_theme_preference';

export const THEME_CONFIGS = {
  [THEMES.CYAN]: {
    id: THEMES.CYAN,
    name: 'Electric Cyan',
    subtitle: 'Midnight Navy & Sky Cyan',
    primaryColor: '#0284c7',
    darkColor: '#0c4a6e',
    lightColor: '#e0f2fe',
    isDefault: true
  },
  [THEMES.CRIMSON]: {
    id: THEMES.CRIMSON,
    name: 'Vibrant Crimson',
    subtitle: 'Ruby Scarlet & Rose Accents',
    primaryColor: '#e11d48',
    darkColor: '#be123c',
    lightColor: '#ffe4e6',
    isDefault: false
  }
};

export function getSavedTheme() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === THEMES.CRIMSON) return THEMES.CRIMSON;
    return THEMES.CYAN;
  } catch {
    return THEMES.CYAN;
  }
}

export function applyTheme(theme) {
  try {
    const validTheme = theme === THEMES.CRIMSON ? THEMES.CRIMSON : THEMES.CYAN;
    document.documentElement.setAttribute('data-theme', validTheme);
    localStorage.setItem(THEME_STORAGE_KEY, validTheme);
    return validTheme;
  } catch {
    return theme;
  }
}
