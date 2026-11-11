export function requestsMarkdown(task: string): boolean {
  const text = task.normalize("NFKC").replace(/[「『“][^」』”\n]*[」』”]/g, "")
  const action = /(?:保存|另存|导出|下载|存成|存为|写入|落盘|\b(?:save|export|download)\b)/i
  const clauses = text.split(/[。！？!?；;，,\n]/)
  if (clauses.some(clause => /(?:不需要|不用|无需|不要|不必|先不|暂不|别|without|do not|don't).{0,12}(?:保存|另存|存成|存为|导出|下载|写入|落盘|生成.{0,10}文件|save|export|download)/i.test(clause))) return false
  return clauses.some(clause => {
    if (/(?:如何|怎么|怎样|为什么|\bhow\s+(?:to|do|can)\b).{0,15}(?:保存|另存|导出|下载|save|export|download)/i.test(clause)) return false
    const target = /(?:\bmarkdown\b|\.md\b|文件|报告|本地|\bfile\b)/i
    return (action.test(clause) && target.test(clause)) || /生成.{0,10}(?:markdown\s*文件|\.md\s*文件)/i.test(clause)
  })
}
