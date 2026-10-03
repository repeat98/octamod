import { MODULES } from '../catalog/modules'
import { compareModuleVersions } from '../catalog/versions'
export const FORUM_CATEGORIES = { general: 'General discussion', modules: 'Module help', issues: 'Bug reports', configs: 'Shared configurations' } as const
export type ForumCategory = keyof typeof FORUM_CATEGORIES
export type SharedConfiguration = { name: string; moduleIds: string[]; moduleVersions: Record<string,string>; keepStockFx2: boolean }
export function sharedConfiguration(value: unknown): SharedConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose a configuration to share.')
  const item = value as SharedConfiguration
  if (Object.keys(item).some(key => !['name','moduleIds','moduleVersions','keepStockFx2'].includes(key))) throw new Error('Only configuration names, module choices, versions and settings can be shared. Firmware and other files are not accepted.')
  if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80 || typeof item.keepStockFx2 !== 'boolean' || !Array.isArray(item.moduleIds) || !item.moduleIds.length || item.moduleIds.length > 100 || new Set(item.moduleIds).size !== item.moduleIds.length || item.moduleIds.some(id => typeof id !== 'string' || !MODULES.some(module => module.id === id))) throw new Error('This configuration has invalid module choices or settings.')
  if (!item.moduleVersions || typeof item.moduleVersions !== 'object' || Array.isArray(item.moduleVersions) || Object.keys(item.moduleVersions).length !== item.moduleIds.length || Object.keys(item.moduleVersions).some(id => !item.moduleIds.includes(id))) throw new Error('Include the exact version of every module.')
  for (const id of item.moduleIds) {
    const version = item.moduleVersions[id]
    if (typeof version !== 'string' || version.length > 80) throw new Error('Include the exact version of every module.')
    compareModuleVersions(version, version)
  }
  return { name: item.name.trim(), moduleIds: [...item.moduleIds], moduleVersions: { ...item.moduleVersions }, keepStockFx2: item.keepStockFx2 }
}
export type ForumThread = { id:string;title:string;category:ForumCategory;module_id:string|null;username:string;status:'open'|'resolved';locked:number;pinned:number;hidden?:number;created_at:string;updated_at:string;replies:number }
export type ForumPost = {id:string;body:string;username:string|null;user_id?:string;created_at:string;edited_at:string|null;hidden:number;likes:number;liked:boolean;canEdit:boolean}
export type ThreadDetail = {thread:ForumThread;posts:ForumPost[];configuration:SharedConfiguration|null;issue:{device:string;version:string;steps:string;expected:string;actual:string}|null;following:boolean;bookmarked:boolean;hasMore:boolean}
