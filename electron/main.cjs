const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')

const devServerUrl = process.env.VITE_DEV_SERVER_URL
const PROJECT_FILE_NAME = 'babechat.project.json'

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
  const mainWindow = new BrowserWindow({
    width: 1420,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: 'BabeChat',
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
  const projectFilePath = path.join(projectPath, PROJECT_FILE_NAME)
  const tempProjectFilePath = path.join(
    projectPath,
    `${PROJECT_FILE_NAME}.${process.pid}.tmp`,
  )

  await fs.mkdir(projectPath, { recursive: true })
  await fs.writeFile(tempProjectFilePath, JSON.stringify(payload.state, null, 2), 'utf8')
  await fs.rename(tempProjectFilePath, projectFilePath)

  return { ok: true, filePath: projectFilePath }
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

  await fs.mkdir(path.dirname(absolutePath), { recursive: true })
  await fs.writeFile(absolutePath, imageBuffer)

  return {
    absolutePath,
    relativePath: relativePath.split(path.sep).join('/'),
  }
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

  try {
    await fs.unlink(absolutePath)
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error
    }
  }

  return { ok: true }
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
