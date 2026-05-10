import { createI18n } from 'vue-i18n'
import { readJsonStorage } from '@/lib/storage'
import en from './en'
import zh from './zh'
import zhExtra from './zh-extra'

export type AppLocale = 'en' | 'zh'

const UI_STORAGE_KEY = 'story-generator.ui.v1'

const persisted = readJsonStorage<{ language?: AppLocale }>(UI_STORAGE_KEY, {})
const initialLocale: AppLocale = persisted.language === 'zh' ? 'zh' : 'en'

export const messages = {
  en,
  zh: {
    ...zh,
    phrases: {
      ...(zh.phrases ?? {}),
      ...zhExtra,
    },
  },
}

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: 'en',
  messages,
  missingWarn: false,
  fallbackWarn: false,
})

export function setI18nLocale(locale: AppLocale) {
  i18n.global.locale.value = locale
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
}

export function translatePhrase(source: string) {
  const locale = i18n.global.locale.value as AppLocale
  const phrases = messages[locale]?.phrases as Record<string, string> | undefined
  return phrases?.[source] ?? source
}

setI18nLocale(initialLocale)
