import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import deTranslations from '../locales/de.json';
import enTranslations from '../locales/en.json';
import thTranslations from '../locales/th.json';

// Translation resources
const resources = {
  en: {
    translation: enTranslations,
  },
  th: {
    translation: thTranslations,
  },
  de: {
    translation: deTranslations,
  },
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: localStorage.getItem('aaelink-language') || 'en', // Default language
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

// Save language preference
i18n.on('languageChanged', (lng) => {
  localStorage.setItem('aaelink-language', lng);
});

export default i18n;
