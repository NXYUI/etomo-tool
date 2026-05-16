/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    platform: string
    versions: {
      chrome?: string
      electron?: string
      node?: string
    }
    selectProjectFolder: () => Promise<{
      canceled: boolean
      path?: string
      state?: unknown
      characterFolders?: string[]
    }>
    saveProjectState: (
      projectPath: string,
      state: unknown,
    ) => Promise<{ ok: boolean; filePath: string }>
    ensureCharacterFolder: (
      projectPath: string,
      characterCode: string,
    ) => Promise<{ ok: boolean; absolutePath: string; relativePath: string }>
    syncCharacterFolders: (
      projectPath: string,
      characterCodes: string[],
    ) => Promise<{
      ok: boolean
      createdFolders: string[]
      existingFolders?: string[]
      removedFolders: string[]
    }>
    renameCharacterFolder: (
      projectPath: string,
      previousCharacterCode: string,
      nextCharacterCode: string,
    ) => Promise<{
      ok: boolean
      renamed: boolean
      absolutePath: string
      relativePath: string
    }>
    deleteCharacterFolder: (
      projectPath: string,
      characterCode: string,
    ) => Promise<{ ok: boolean; absolutePath: string; relativePath: string }>
    saveImageFile: (payload: {
      projectPath: string
      characterCode: string
      code: string
      fileName: string
      dataUrl: string
    }) => Promise<{ absolutePath: string; relativePath: string }>
    deleteImageFile: (
      projectPath: string,
      relativePath: string,
    ) => Promise<{ ok: boolean }>
    readImageAsDataUrl: (
      projectPath: string,
      relativePath: string,
    ) => Promise<{ dataUrl: string }>
  }
}
