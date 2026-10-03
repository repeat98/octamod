export type IconName = 'grid' | 'wave' | 'sliders' | 'search' | 'plus' | 'check' | 'arrow' | 'back' | 'download' | 'file' | 'shield' | 'star' | 'close' | 'message' | 'help' | 'heart' | 'bookmark' | 'pin' | 'lock' | 'quote'
const paths: Record<IconName, string> = {
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  pin: 'm16 3 5 5-4 1-3 5 1 3-8-8 3 1 5-3zM9 15l-6 6',
  lock: 'M5 10h14v11H5zM8 10V7a4 4 0 0 1 8 0v3m-4 5v2',
  quote: 'M4 6h6v6H4zM14 6h6v6h-6zM10 12c0 4-2 6-6 6m16-6c0 4-2 6-6 6',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  wave: 'M2 12h3l3-8 4 16 4-16 3 8h3',
  sliders: 'M4 7h5m4 0h7M4 17h9m4 0h3M9 4v6m8 4v6',
  search: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 6 6',
  plus: 'M12 5v14M5 12h14',
  check: 'm5 12 4 4L19 6',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  back: 'm14 5-7 7 7 7',
  download: 'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',
  file: 'M6 2h8l4 4v16H6zM14 2v5h4M9 12h6m-6 4h6',
  shield: 'm12 2 8 3v7c0 5-8 10-8 10S4 17 4 12V5zM8 12l3 3 5-6',
  star: 'm12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.4L12 17.5l-5.7 3.1 1.1-6.4L2.8 9.7l6.4-.9z',
  close: 'm6 6 12 12M6 18 18 6',
  message: 'M4 4h16v13H9l-5 4z',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM9 9a3 3 0 1 1 5 2.2c-1.2.8-2 1.1-2 2.8m0 3h.01',
}
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={paths[name]} /></svg>
}
