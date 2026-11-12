export function isTabTask(task: string): boolean {
  return /标签页|标签组|选项卡|(?:这个|当前).{0,8}窗口.{0,12}(?:网页|页面)|\b(?:tabs?|tab group|open pages|this window)\b/i.test(task)
}

const tabChangeIntent = {
  group: /分组为|编组|归组|归类|(?:按|把|给).{0,32}分组|分组一下|整理.{0,12}标签页(?!\s*(?:的)?(?:内容|信息|资料|结果))|(?:放进|放入|加到|归到|移入|归为|归入).{0,12}组|\b(?:group (?:these|the|my|all|selected|open)|group .{0,40} into|organize|organise|categorize)\b/i,
  ungroup: /取消分组|解除分组|拆组|移出.{0,12}组|\b(?:ungroup|remove .{0,24} from .{0,12}group)\b/i,
  move: /移动|移到|挪到|拖到|排到|放到|放在|调整顺序|重排|\b(?:move|reorder)\b/i,
  activate: /切到|切换到|跳到|转到|聚焦|\b(?:activate|focus|switch to)\b/i,
} as const

export type TabChange = keyof typeof tabChangeIntent

export function requestsTabChange(task: string, action: TabChange): boolean {
  const request = task.replace(/[「『“][^」』”\n]*[」』”]/g, "")
  if (/(?:如何|怎么|怎样|\bhow (?:to|do|can)\b)/i.test(request)) return false
  if (/(?:不(?:要|用|必|需要)|别|without|don't|do not).{0,12}(?:分组|编组|调整|移动|切换|group|move|reorder|switch)/i.test(request)) return false
  return tabChangeIntent[action].test(request)
}

export function requestsAnyTabChange(task: string): boolean {
  return (Object.keys(tabChangeIntent) as TabChange[]).some(action => requestsTabChange(task, action))
}

export function requestsTabSummary(task: string): boolean {
  return /总结|汇总|概括|归纳|对比|比较|提炼|整理.{0,16}(?:内容|信息|资料)|\b(?:summari[sz]e|compare|synthesi[sz]e|overview)\b/i.test(task)
}
