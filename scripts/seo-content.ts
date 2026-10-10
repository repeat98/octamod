import { AVAILABLE_MODULES, isModulePaused } from '../src/catalog/availability.ts'
import { MODULE_DOCUMENTS_BY_ID } from '../src/catalog/documents.ts'
import { getModuleSource, type FirmwareModule } from '../src/catalog/modules.ts'
import { modulePath } from '../src/catalog/module-links.ts'
import { DIGI_MODS, digiModuleDocument, type DigiMod } from '../src/devices/digi-mods.ts'
import { DEVICES_BY_ID } from '../src/devices/registry.ts'
import { RELEASE_STEPS } from '../src/community/developer-guidance.ts'
import { INDEPENDENCE_NOTICE } from '../src/firmware-notices.ts'
import { escapeHtml, link, list, paragraph } from './page-html.ts'
import { EXTERNAL_PROJECTS, PROJECT_DESCRIPTION, PROJECT_MACHINES, PROJECT_TITLE, PROJECT_TYPES, filterProjects } from '../src/projects/projects.ts'

export function homeContent(appUrl: URL) {
  const modules = (items: { path: string; name: string; description: string }[]) => `<ul>${items.map(item => `<li>${link(new URL(item.path, appUrl).href, item.name)}${paragraph(item.description)}</li>`).join('')}</ul>`
  return '<h1>Mods for Elektron instruments</h1>'
    + paragraph('Explore custom firmware modules for the Elektron Octatrack, Digitakt and Digitone. Choose modules, check compatibility and build firmware in your browser. Your original firmware stays on your device.')
    + '<h2>Octatrack modules</h2>' + modules(AVAILABLE_MODULES.map(module => ({ path: modulePath(module.id), name: module.name, description: module.description })))
    + (['digitakt', 'digitone'] as const).map(device => `<h2>${escapeHtml(DEVICES_BY_ID[device].name)} modules</h2>` + modules(DIGI_MODS.filter(mod => mod.device === device).map(mod => ({ path: `${device}/module/${mod.id}/`, name: mod.title, description: mod.summary })))).join('')
    + '<h2>Build your own module</h2>' + paragraph('Use the instrument SDK, document your module and submit it for review in the Modwerk library.')
    + paragraph(INDEPENDENCE_NOTICE) + link(new URL('submit/', appUrl).href, 'Start developing')
    + '<h2>Explore the community</h2>' + link(new URL('projects/', appUrl).href, PROJECT_TITLE)
}

export function projectsContent(appUrl: URL) {
  return link(appUrl.href, 'Module library') + `<h1>${escapeHtml(PROJECT_TITLE)}</h1>` + paragraph(PROJECT_DESCRIPTION)
    + paragraph('These projects cannot be added to a Modwerk configuration. Visit each project for supported models, OS versions, installation instructions and support.')
    + paragraph(`${EXTERNAL_PROJECTS.length} external projects.`)
    + filterProjects('').map(item => `<article><h2>${link(item.repository, item.name)}</h2>${paragraph(item.author + ' · ' + PROJECT_TYPES[item.type])}${paragraph(item.description)}${paragraph(item.machines.map(id => PROJECT_MACHINES[id]).join(' · '))}</article>`).join('')
}

type ModuleContent = { name: string; version: string; machine: string; summary: string; overview: string; highlights: string[]; usage: string[]; controls: { name: string; doc: string }[]; releases: string[]; limitations: string[]; tests: string; source: string; paused?: boolean }
function moduleContent(module: ModuleContent, appUrl: URL) {
  return link(appUrl.href, 'Module library') + `<h1>${escapeHtml(module.name)} for Elektron ${escapeHtml(module.machine)}</h1>`
    + paragraph(module.summary) + paragraph(`Module version ${module.version}. Base firmware: ${module.releases.join(' / ')}.`)
    + (module.paused ? paragraph('Temporarily unavailable. This module cannot currently be selected for a firmware build.') : '')
    + '<h2>About this module</h2>' + paragraph(module.overview) + list(module.highlights)
    + '<h2>How to use it</h2>' + list(module.usage, true)
    + (module.controls.length ? '<h2>Controls</h2><dl>' + module.controls.map(control => `<dt>${escapeHtml(control.name)}</dt><dd>${escapeHtml(control.doc)}</dd>`).join('') + '</dl>' : '')
    + (module.limitations.length ? '<h2>Compatibility notes</h2>' + list(module.limitations) : '')
    + '<h2>Test evidence</h2>' + paragraph(module.tests) + link(module.source, 'Module source and documentation')
}

export function octatrackContent(module: FirmwareModule, appUrl: URL) {
  const document = MODULE_DOCUMENTS_BY_ID[module.id]
  return moduleContent({ ...document.presentation, name: module.name, version: module.version, machine: 'Octatrack', controls: document.controls, releases: [document.compatibility.firmware], limitations: document.compatibility.limitations, tests: document.tests.summary, source: getModuleSource(module), paused: isModulePaused(module.id) }, appUrl)
}

export function digiContent(mod: DigiMod, appUrl: URL) {
  const document = digiModuleDocument(mod)
  return moduleContent({ ...document.presentation, name: mod.title, version: document.version, machine: DEVICES_BY_ID[mod.device].name, controls: document.controls, releases: document.compatibility.releases, limitations: document.compatibility.limitations, tests: document.tests.summary, source: mod.repository }, appUrl)
}

export function developerContent(appUrl: URL) {
  return link(appUrl.href, 'Module library') + '<h1>Start developing</h1>'
    + paragraph('Build a mod for Elektron instruments with the Modwerk SDKs. Fork the repository, clone your fork and open it in your coding agent. Use Node 24; Octatrack native builds also need Python 3.10+, Docker and your own OS 1.40C.')
    + '<h2>Your first release</h2><ol>' + RELEASE_STEPS.create.map(step => `<li><h3>${escapeHtml(step.title)}</h3>${paragraph(step.summary)}</li>`).join('') + '</ol>'
    + paragraph('First releases require owner review. Registered authors can then publish verified updates to their own modules. Instruments without a published SDK must be integrated and qualified before module development.')
    + '<h2>Three separate catalogues</h2>' + paragraph('Octabam, Modwerk and Elekloader have separate catalogues. Publishing upstream does not submit your module to Modwerk. An Elekloader listing is optional.')
    + link('https://github.com/repeat98/modwerk/blob/main/docs/DEVELOPER_WORKFLOW.md', 'Developer workflow')
}
