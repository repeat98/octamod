// SPDX-License-Identifier: GPL-3.0-or-later OR Elastic-2.0
// Copyright (c) 2026 Jannik Aßfalg (repeat98)
import { MODULES, resolveSelection } from './modules.ts'

export const BETA_MODULE_IDS: readonly string[] = ['airwindows-chorus']
export const isBetaModule = (id: string) => BETA_MODULE_IDS.includes(id)

// Temporary frontend suspension. Keep the full source catalog and saved pins intact.
export const PAUSED_MODULE_IDS: readonly string[] = ['spectrum', 'modulation', 'character', 'airwindows-chorus', 'midi-scenes']
export function isModulePaused(id: string) { return PAUSED_MODULE_IDS.includes(id) }
// Every module in sdk/catalog.json is offered unless it is paused; build support separately gates firmware.
export const AVAILABLE_MODULES = MODULES.filter(module => !isModulePaused(module.id))
export function availableModules(betaAccess = false) { return MODULES.filter(module => !isModulePaused(module.id) || betaAccess && isBetaModule(module.id)) }
export function isModuleAvailable(id: string, betaAccess = false) { return availableModules(betaAccess).some(module => module.id === id) }
export function moduleAvailabilityError(ids: readonly string[], betaAccess = false): string {
  const paused = resolveSelection(ids).filter(module => isModulePaused(module.id) && !(betaAccess && isBetaModule(module.id)))
  return paused.length ? 'Temporarily unavailable: ' + paused.map(module => module.name).join(', ') + '. Remove these modules from this configuration to continue.' : ''
}
