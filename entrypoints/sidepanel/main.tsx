import { createRoot } from "react-dom/client"
import { readUiLanguage, resolveUiLanguage } from "../../src/i18n"
import { App } from "./app"
import { LanguageProvider } from "./language"
import "./style.css"

const root = document.getElementById("root")
if (root) {
  const app = createRoot(root)
  void readUiLanguage().catch(() => resolveUiLanguage()).then(language => {
    app.render(<LanguageProvider initial={language}><App /></LanguageProvider>)
  })
}
