import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from "react"
import { getExtensionName } from "../../src/extension-name"
import { resolveUiLanguage, translate, uiLanguageKey, type Translate, type UiLanguage } from "../../src/i18n"

const LanguageContext = createContext<{ language: UiLanguage; t: Translate } | null>(null)

export function LanguageProvider({ initial, children }: { initial: UiLanguage; children: ReactNode }) {
  const [language, setLanguage] = useState(initial)

  useLayoutEffect(() => {
    document.documentElement.lang = language
    document.title = getExtensionName(language)
  }, [language])

  useEffect(() => {
    const update: Parameters<typeof chrome.storage.local.onChanged.addListener>[0] = changes => {
      if (changes[uiLanguageKey]) setLanguage(resolveUiLanguage(changes[uiLanguageKey].newValue))
    }
    chrome.storage.local.onChanged.addListener(update)
    return () => chrome.storage.local.onChanged.removeListener(update)
  }, [])

  return <LanguageContext.Provider value={{ language, t: (message, values) => translate(language, message, values) }}>
    {children}
  </LanguageContext.Provider>
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) throw new Error("侧栏缺少语言设置")
  return context
}
