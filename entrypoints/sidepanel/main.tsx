import { createRoot } from "react-dom/client"
import { getExtensionName } from "../../src/extension-name"
import { App } from "./app"
import "./style.css"

document.title = getExtensionName()
const root = document.getElementById("root")
if (root) createRoot(root).render(<App />)
