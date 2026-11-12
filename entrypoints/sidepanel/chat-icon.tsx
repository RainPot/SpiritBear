const paths = {
  add: <path d="M12 5v14M5 12h14" />,
  send: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14m-6-6 6 6 6-6" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="1.7" fill="currentColor" stroke="none" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m7 7 10 10M17 7 7 17" />,
  file: <><path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v5h5m-10 5h6m-6 4h6" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8" cy="9" r="1.3" /><path d="m4 17 4-4 3 3 4-5 5 6" /></>,
}

export function ChatIcon({ name, size = 17 }: { name: keyof typeof paths; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {paths[name]}
  </svg>
}
