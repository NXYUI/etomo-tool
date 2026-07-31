const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const AdmZip = require('adm-zip')

const devServerUrl = process.env.VITE_DEV_SERVER_URL
const PROJECT_FILE_NAME = 'etomo.project.json'
const BACKUP_FORMAT = 'etomo-backup'
const BACKUP_FORMAT_VERSION = 1
const projectSaveQueues = new Map()

function normalizeProjectPath(projectPath) {
  if (typeof projectPath !== 'string' || projectPath.trim() === '') {
    throw new Error('Project path is required.')
  }

  return path.resolve(projectPath)
}

function ensureInsideProject(projectPath, targetPath) {
  const root = normalizeProjectPath(projectPath)
  const resolvedTarget = path.resolve(targetPath)
  const relative = path.relative(root, resolvedTarget)

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Target path is outside of the project folder.')
  }

  return resolvedTarget
}

function sanitizeSegment(value) {
  return String(value)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .slice(0, 80) || 'item'
}

function isInvalidPathSegment(value) {
  const segment = String(value || '').trim()
  return !segment || /[<>:"/\\|?*\x00-\x1F]/.test(segment) || segment === '.' || segment === '..'
}

function extensionFromMime(mimeType, fileName) {
  const lowerName = String(fileName || '').toLowerCase()
  const knownExtension = path.extname(lowerName)

  if (knownExtension && ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(knownExtension)) {
    return knownExtension === '.jpeg' ? '.jpg' : knownExtension
  }

  switch (mimeType) {
    case 'image/jpeg':
      return '.jpg'
    case 'image/webp':
      return '.webp'
    case 'image/gif':
      return '.gif'
    case 'image/png':
    default:
      return '.png'
  }
}

function mimeFromExtension(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.png':
    default:
      return 'image/png'
  }
}

function toArchivePath(...segments) {
  return segments
    .join('/')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
}

function timestampForFileName() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function parseJsonEntry(zip, entryName) {
  const entry = zip.getEntry(entryName)

  if (!entry || entry.isDirectory) {
    throw new Error(`${entryName} is missing from the backup.`)
  }

  return JSON.parse(zip.readAsText(entry))
}

function getSafeArchiveRelativePath(entryName, rootEntryName) {
  const normalizedEntryName = toArchivePath(entryName)
  const normalizedRootEntryName = `${toArchivePath(rootEntryName).replace(/\/$/, '')}/`

  if (!normalizedEntryName.startsWith(normalizedRootEntryName)) {
    return null
  }

  const relativeEntryName = normalizedEntryName.slice(normalizedRootEntryName.length)

  if (!relativeEntryName || path.isAbsolute(relativeEntryName)) {
    return null
  }

  const normalizedRelativePath = path.normalize(relativeEntryName)

  if (
    normalizedRelativePath === '.' ||
    normalizedRelativePath.startsWith('..') ||
    path.isAbsolute(normalizedRelativePath)
  ) {
    throw new Error('Backup contains an unsafe file path.')
  }

  return normalizedRelativePath
}

async function addProjectFilesToBackup(zip, projectPath, filesRoot, skipAbsolutePath) {
  const root = normalizeProjectPath(projectPath)
  const skippedPath = skipAbsolutePath ? path.resolve(skipAbsolutePath) : ''
  let fileCount = 0

  async function visit(directoryPath) {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true })

    for (const entry of entries) {
      const absolutePath = path.join(directoryPath, entry.name)
      const relativePath = path.relative(root, absolutePath)

      if (!relativePath || relativePath === PROJECT_FILE_NAME) {
        continue
      }

      if (skippedPath && path.resolve(absolutePath) === skippedPath) {
        continue
      }

      if (entry.isDirectory()) {
        await visit(absolutePath)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      const archivePath = toArchivePath(filesRoot, relativePath)
      zip.addFile(archivePath, await fs.readFile(absolutePath))
      fileCount += 1
    }
  }

  await visit(root)

  return fileCount
}

async function ensureDirectoryIsEmpty(directoryPath) {
  try {
    const entries = await fs.readdir(directoryPath)

    if (entries.length > 0) {
      throw new Error('Restore target folder must be empty.')
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      await fs.mkdir(directoryPath, { recursive: true })
      return
    }

    throw error
  }
}

function getProjectQueueKey(projectPath) {
  return process.platform === 'win32' ? projectPath.toLowerCase() : projectPath
}

function enqueueProjectSave(projectPath, task) {
  const queueKey = getProjectQueueKey(projectPath)
  const previousTask = projectSaveQueues.get(queueKey) || Promise.resolve()
  const currentTask = previousTask.catch(() => undefined).then(task)

  projectSaveQueues.set(queueKey, currentTask)
  currentTask.finally(() => {
    if (projectSaveQueues.get(queueKey) === currentTask) {
      projectSaveQueues.delete(queueKey)
    }
  })

  return currentTask
}

function createUniqueFolderName(name, usedNames) {
  const baseName = sanitizeSegment(name || 'project')
  let folderName = baseName
  let suffix = 2

  while (usedNames.has(folderName.toLowerCase())) {
    folderName = `${baseName}-${suffix}`
    suffix += 1
  }

  usedNames.add(folderName.toLowerCase())

  return folderName
}

async function addProjectBackupEntry(zip, project, projectIndex, backupFilePath) {
  const projectId = `project-${String(projectIndex + 1).padStart(3, '0')}`
  const projectEntryRoot = toArchivePath('projects', projectId)
  const filesRoot = toArchivePath(projectEntryRoot, 'files')
  const projectPath =
    typeof project.projectPath === 'string' && project.projectPath.trim()
      ? normalizeProjectPath(project.projectPath)
      : ''
  const state = project.state || (projectPath ? await readProjectState(projectPath) : null)

  if (!state || typeof state !== 'object') {
    throw new Error('Project state is required for backup.')
  }

  zip.addFile(
    toArchivePath(projectEntryRoot, PROJECT_FILE_NAME),
    Buffer.from(JSON.stringify(state, null, 2), 'utf8'),
  )

  const fileCount = projectPath
    ? await addProjectFilesToBackup(zip, projectPath, filesRoot, backupFilePath)
    : 0

  return {
    manifestProject: {
      id: projectId,
      sourceId: typeof project.id === 'string' ? project.id : '',
      name: project.projectName || (projectPath ? path.basename(projectPath) : projectId),
      originalPath: projectPath,
      projectFile: toArchivePath(projectEntryRoot, PROJECT_FILE_NAME),
      filesRoot,
    },
    fileCount,
  }
}

async function restoreProjectFromBackup(zip, project, projectPath) {
  const projectState = parseJsonEntry(zip, project.projectFile)

  await fs.mkdir(projectPath, { recursive: true })
  await fs.writeFile(
    path.join(projectPath, PROJECT_FILE_NAME),
    JSON.stringify(projectState, null, 2),
    'utf8',
  )

  const filesRoot = typeof project.filesRoot === 'string' ? project.filesRoot : ''
  let fileCount = 0

  if (filesRoot) {
    for (const entry of zip.getEntries()) {
      const relativePath = getSafeArchiveRelativePath(entry.entryName, filesRoot)

      if (!relativePath) {
        continue
      }

      const absolutePath = ensureInsideProject(projectPath, path.join(projectPath, relativePath))

      if (entry.isDirectory) {
        await fs.mkdir(absolutePath, { recursive: true })
        continue
      }

      await fs.mkdir(path.dirname(absolutePath), { recursive: true })
      await fs.writeFile(absolutePath, entry.getData())
      fileCount += 1
    }
  }

  return {
    sourceId: typeof project.sourceId === 'string' ? project.sourceId : '',
    path: projectPath,
    state: projectState,
    characterFolders: await listCharacterFolders(projectPath),
    fileCount,
  }
}

async function readProjectState(projectPath) {
  const root = normalizeProjectPath(projectPath)
  const projectFilePath = path.join(root, PROJECT_FILE_NAME)

  try {
    const rawProject = await fs.readFile(projectFilePath, 'utf8')
    return JSON.parse(rawProject)
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null
    }

    throw error
  }
}

async function listCharacterFolders(projectPath) {
  const root = normalizeProjectPath(projectPath)

  try {
    const entries = await fs.readdir(root, { withFileTypes: true })

    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !isInvalidPathSegment(name))
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return []
    }

    throw error
  }
}

function createMainWindow() {
  const iconPath = path.join(__dirname, '..', devServerUrl ? 'public' : 'dist', 'icon.ico')
  const mainWindow = new BrowserWindow({
    width: 1420,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: 'etomo-tool',
    icon: iconPath,
    backgroundColor: '#f6f7f8',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl)
    return
  }

  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

ipcMain.handle('project:select-folder', async () => {
  const result = await dialog.showOpenDialog({
    title: '프로젝트 폴더 선택',
    properties: ['openDirectory', 'createDirectory'],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true }
  }

  const projectPath = result.filePaths[0]
  const state = await readProjectState(projectPath)
  const characterFolders = await listCharacterFolders(projectPath)

  return {
    canceled: false,
    path: projectPath,
    state,
    characterFolders,
  }
})

ipcMain.handle('project:save-state', async (_event, payload) => {
  const projectPath = normalizeProjectPath(payload.projectPath)

  return enqueueProjectSave(projectPath, async () => {
    const projectFilePath = path.join(projectPath, PROJECT_FILE_NAME)
    const tempProjectFilePath = path.join(
      projectPath,
      `${PROJECT_FILE_NAME}.${process.pid}.${Date.now()}.${Math.random()
        .toString(36)
        .slice(2)}.tmp`,
    )

    try {
      await fs.mkdir(projectPath, { recursive: true })
      await fs.writeFile(tempProjectFilePath, JSON.stringify(payload.state, null, 2), 'utf8')
      await fs.rename(tempProjectFilePath, projectFilePath)

      return { ok: true, filePath: projectFilePath }
    } catch (error) {
      try {
        await fs.unlink(tempProjectFilePath)
      } catch {
        // The temp file may not exist if the write failed before creation.
      }

      throw error
    }
  })
})

ipcMain.handle('backup:export-project', async (_event, payload) => {
  const projectPath = normalizeProjectPath(payload.projectPath)
  const projectName = sanitizeSegment(payload.projectName || path.basename(projectPath))
  const result = await dialog.showSaveDialog({
    title: 'etomo-tool 백업 저장',
    defaultPath: `${projectName}_${timestampForFileName()}.etomo`,
    filters: [
      { name: 'etomo-tool Backup', extensions: ['etomo'] },
      { name: 'ZIP Archive', extensions: ['zip'] },
    ],
  })

  if (result.canceled || !result.filePath) {
    return { canceled: true }
  }

  const backupFilePath = path.resolve(result.filePath)
  const zip = new AdmZip()
  const { manifestProject, fileCount } = await addProjectBackupEntry(
    zip,
    {
      id: payload.projectId,
      projectPath,
      projectName: payload.projectName || path.basename(projectPath),
      state: payload.state,
    },
    0,
    backupFilePath,
  )
  const manifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: app.getVersion(),
    createdAt: new Date().toISOString(),
    scope: 'project',
    projects: [manifestProject],
  }
  const globalPresets = {
    globalProfilePresets: Array.isArray(payload.globalProfilePresets)
      ? payload.globalProfilePresets
      : [],
  }

  zip.addFile('backup.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'))
  zip.addFile(
    'global-presets.json',
    Buffer.from(JSON.stringify(globalPresets, null, 2), 'utf8'),
  )

  await fs.mkdir(path.dirname(backupFilePath), { recursive: true })
  zip.writeZip(backupFilePath)

  return {
    canceled: false,
    filePath: backupFilePath,
    fileCount,
  }
})

ipcMain.handle('backup:export-workspace', async (_event, payload) => {
  const projects = Array.isArray(payload.projects) ? payload.projects : []

  if (projects.length === 0) {
    throw new Error('At least one project is required for backup.')
  }

  const result = await dialog.showSaveDialog({
    title: 'etomo-tool 전체 백업 저장',
    defaultPath: `etomo-tool_Workspace_${timestampForFileName()}.etomo`,
    filters: [
      { name: 'etomo-tool Backup', extensions: ['etomo'] },
      { name: 'ZIP Archive', extensions: ['zip'] },
    ],
  })

  if (result.canceled || !result.filePath) {
    return { canceled: true }
  }

  const backupFilePath = path.resolve(result.filePath)
  const zip = new AdmZip()
  const manifestProjects = []
  let fileCount = 0

  for (const [index, project] of projects.entries()) {
    const entry = await addProjectBackupEntry(zip, project, index, backupFilePath)
    manifestProjects.push(entry.manifestProject)
    fileCount += entry.fileCount
  }

  const manifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: app.getVersion(),
    createdAt: new Date().toISOString(),
    scope: 'workspace',
    activeProjectSourceId: typeof payload.activeProjectId === 'string' ? payload.activeProjectId : '',
    projects: manifestProjects,
  }
  const globalPresets = {
    globalProfilePresets: Array.isArray(payload.globalProfilePresets)
      ? payload.globalProfilePresets
      : [],
  }

  zip.addFile('backup.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'))
  zip.addFile(
    'global-presets.json',
    Buffer.from(JSON.stringify(globalPresets, null, 2), 'utf8'),
  )

  await fs.mkdir(path.dirname(backupFilePath), { recursive: true })
  zip.writeZip(backupFilePath)

  return {
    canceled: false,
    filePath: backupFilePath,
    projectCount: manifestProjects.length,
    fileCount,
  }
})

ipcMain.handle('backup:import-project', async () => {
  const backupResult = await dialog.showOpenDialog({
    title: 'etomo-tool 백업 선택',
    properties: ['openFile'],
    filters: [
      { name: 'etomo-tool Backup', extensions: ['etomo'] },
      { name: 'ZIP Archive', extensions: ['zip'] },
    ],
  })

  if (backupResult.canceled || backupResult.filePaths.length === 0) {
    return { canceled: true }
  }

  const backupFilePath = backupResult.filePaths[0]
  const zip = new AdmZip(backupFilePath)
  const manifest = parseJsonEntry(zip, 'backup.json')

  if (manifest.format !== BACKUP_FORMAT || manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error('Unsupported etomo-tool backup format.')
  }

  const backupProjects = Array.isArray(manifest.projects)
    ? manifest.projects.filter((project) => project && typeof project.projectFile === 'string')
    : []

  if (backupProjects.length === 0) {
    throw new Error('Backup does not contain a project.')
  }

  const restoreResult = await dialog.showOpenDialog({
    title: manifest.scope === 'workspace' ? '새 프로젝트 묶음 폴더 선택' : '새 프로젝트 폴더 선택',
    properties: ['openDirectory', 'createDirectory'],
  })

  if (restoreResult.canceled || restoreResult.filePaths.length === 0) {
    return { canceled: true }
  }

  const restoreRoot = normalizeProjectPath(restoreResult.filePaths[0])
  let fileCount = 0
  let restoredProjects = []

  await ensureDirectoryIsEmpty(restoreRoot)

  if (manifest.scope === 'workspace') {
    const usedFolderNames = new Set()

    for (const [index, project] of backupProjects.entries()) {
      const folderName = createUniqueFolderName(project.name || project.id || `project-${index + 1}`, usedFolderNames)
      const projectPath = ensureInsideProject(restoreRoot, path.join(restoreRoot, folderName))
      const restoredProject = await restoreProjectFromBackup(zip, project, projectPath)
      restoredProjects.push(restoredProject)
      fileCount += restoredProject.fileCount
    }
  } else {
    const restoredProject = await restoreProjectFromBackup(zip, backupProjects[0], restoreRoot)
    restoredProjects = [restoredProject]
    fileCount = restoredProject.fileCount
  }

  let globalProfilePresets = []

  try {
    const globalPresetState = parseJsonEntry(zip, 'global-presets.json')
    globalProfilePresets = Array.isArray(globalPresetState.globalProfilePresets)
      ? globalPresetState.globalProfilePresets
      : []
  } catch {
    globalProfilePresets = []
  }

  return {
    canceled: false,
    path: restoredProjects[0]?.path,
    state: restoredProjects[0]?.state,
    characterFolders: restoredProjects[0]?.characterFolders ?? [],
    projects: restoredProjects,
    activeProjectSourceId:
      typeof manifest.activeProjectSourceId === 'string' ? manifest.activeProjectSourceId : '',
    globalProfilePresets,
    fileCount,
  }
})

ipcMain.handle('project:save-image-file', async (_event, payload) => {
  const projectPath = normalizeProjectPath(payload.projectPath)
  const imageMatch = String(payload.dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)

  if (!imageMatch) {
    throw new Error('Only image data URLs can be saved.')
  }

  const mimeType = imageMatch[1]
  const imageBuffer = Buffer.from(imageMatch[2], 'base64')
  if (isInvalidPathSegment(payload.characterCode)) {
    throw new Error('A valid character code is required.')
  }

  const characterFolder = payload.characterCode.trim()
  if (!String(payload.code || '').trim()) {
    throw new Error('A valid image state code is required.')
  }

  const codeFileName = sanitizeSegment(payload.code)
  const extension = extensionFromMime(mimeType, payload.fileName)
  const relativePath = path.join(characterFolder, `${codeFileName}${extension}`)
  const absolutePath = ensureInsideProject(projectPath, path.join(projectPath, relativePath))

  // Serialize through the per-project queue so rapid saves/deletes on the same
  // slot cannot interleave and leave the preview and disk out of sync.
  return enqueueProjectSave(projectPath, async () => {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await fs.writeFile(absolutePath, imageBuffer)

    return {
      absolutePath,
      relativePath: relativePath.split(path.sep).join('/'),
    }
  })
})

ipcMain.handle('project:ensure-character-folder', async (_event, payload) => {
  const projectPath = normalizeProjectPath(payload.projectPath)

  if (isInvalidPathSegment(payload.characterCode)) {
    throw new Error('A valid character code is required.')
  }

  const characterFolder = payload.characterCode.trim()
  const relativePath = path.join(characterFolder)
  const absolutePath = ensureInsideProject(projectPath, path.join(projectPath, relativePath))

  await fs.mkdir(absolutePath, { recursive: true })

  return {
    ok: true,
    absolutePath,
    relativePath: relativePath.split(path.sep).join('/'),
  }
})

ipcMain.handle('project:sync-character-folders', async (_event, payload) => {
  const projectPath = normalizeProjectPath(payload.projectPath)
  const characterCodes = Array.isArray(payload.characterCodes)
    ? payload.characterCodes.map((code) => String(code).trim()).filter(Boolean)
    : []

  for (const characterCode of characterCodes) {
    if (isInvalidPathSegment(characterCode)) {
      throw new Error('A valid character code is required.')
    }
  }

  const desiredCharacterFolders = new Set(characterCodes)
  const createdFolders = []
  const existingFolders = []

  await fs.mkdir(projectPath, { recursive: true })

  for (const characterCode of desiredCharacterFolders) {
    const absolutePath = ensureInsideProject(projectPath, path.join(projectPath, characterCode))
    let exists = true

    try {
      await fs.access(absolutePath)
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        throw error
      }

      exists = false
    }

    await fs.mkdir(absolutePath, { recursive: true })

    if (exists) {
      existingFolders.push(characterCode)
    } else {
      createdFolders.push(characterCode)
    }
  }

  return {
    ok: true,
    createdFolders,
    existingFolders,
    removedFolders: [],
  }
})

ipcMain.handle('project:rename-character-folder', async (_event, payload) => {
  const projectPath = normalizeProjectPath(payload.projectPath)

  if (isInvalidPathSegment(payload.previousCharacterCode)) {
    throw new Error('A valid previous character code is required.')
  }

  if (isInvalidPathSegment(payload.nextCharacterCode)) {
    throw new Error('A valid next character code is required.')
  }

  const previousFolder = payload.previousCharacterCode.trim()
  const nextFolder = payload.nextCharacterCode.trim()
  const previousPath = ensureInsideProject(projectPath, path.join(projectPath, previousFolder))
  const nextPath = ensureInsideProject(projectPath, path.join(projectPath, nextFolder))

  if (previousFolder === nextFolder) {
    await fs.mkdir(nextPath, { recursive: true })

    return {
      ok: true,
      renamed: false,
      absolutePath: nextPath,
      relativePath: nextFolder,
    }
  }

  await fs.mkdir(projectPath, { recursive: true })

  let previousExists = true
  try {
    await fs.access(previousPath)
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error
    }

    previousExists = false
  }

  if (!previousExists) {
    await fs.mkdir(nextPath, { recursive: true })

    return {
      ok: true,
      renamed: false,
      absolutePath: nextPath,
      relativePath: nextFolder,
    }
  }

  const isCaseOnlyRename =
    process.platform === 'win32' &&
    previousPath.toLowerCase() === nextPath.toLowerCase() &&
    previousPath !== nextPath

  if (isCaseOnlyRename) {
    const temporaryPath = ensureInsideProject(
      projectPath,
      path.join(projectPath, `.${previousFolder}.${process.pid}.rename-tmp`),
    )

    await fs.rename(previousPath, temporaryPath)
    await fs.rename(temporaryPath, nextPath)
  } else {
    try {
      await fs.access(nextPath)
      throw new Error('Target character folder already exists.')
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        throw error
      }
    }

    await fs.rename(previousPath, nextPath)
  }

  return {
    ok: true,
    renamed: true,
    absolutePath: nextPath,
    relativePath: nextFolder,
  }
})

ipcMain.handle('project:delete-character-folder', async (_event, payload) => {
  const projectPath = normalizeProjectPath(payload.projectPath)

  if (isInvalidPathSegment(payload.characterCode)) {
    throw new Error('A valid character code is required.')
  }

  const characterFolder = payload.characterCode.trim()
  const absolutePath = ensureInsideProject(projectPath, path.join(projectPath, characterFolder))

  await fs.rm(absolutePath, { recursive: true, force: true })

  return {
    ok: true,
    absolutePath,
    relativePath: characterFolder,
  }
})

ipcMain.handle('project:read-image-as-data-url', async (_event, payload) => {
  const projectPath = normalizeProjectPath(payload.projectPath)
  const absolutePath = ensureInsideProject(projectPath, path.join(projectPath, payload.relativePath))
  const imageBuffer = await fs.readFile(absolutePath)
  const mimeType = mimeFromExtension(absolutePath)

  return {
    dataUrl: `data:${mimeType};base64,${imageBuffer.toString('base64')}`,
  }
})

ipcMain.handle('project:delete-image-file', async (_event, payload) => {
  const projectPath = normalizeProjectPath(payload.projectPath)
  const relativePath = String(payload.relativePath || '')

  if (!relativePath.trim()) {
    throw new Error('Image path is required.')
  }

  const absolutePath = ensureInsideProject(projectPath, path.join(projectPath, relativePath))

  return enqueueProjectSave(projectPath, async () => {
    try {
      await fs.unlink(absolutePath)
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        throw error
      }
    }

    return { ok: true }
  })
})

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
