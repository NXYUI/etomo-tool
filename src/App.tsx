import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  ClipboardPaste,
  Eye,
  EyeOff,
  FileText,
  FolderOpen,
  Grid3X3,
  GripVertical,
  ImageUp,
  PanelTop,
  Plus,
  Save,
  Table2,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react'
import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ChangeEvent,
  ClipboardEvent,
  DragEvent,
  ErrorInfo,
  KeyboardEvent,
  CSSProperties,
  ReactNode,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type TokenProvider = 'claude' | 'gemini'
type StatusKind = 'info' | 'success' | 'warning' | 'error'
type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type ToolId = 'overview' | 'guidelines' | 'images' | 'editor' | 'lorebook' | 'profile'

interface EmotionSlot {
  label: string
  code: string
  imagePath?: string
  imageName?: string
  updatedAt?: string
}

interface CharacterAssets {
  code: string
  displayName?: string
  slots: EmotionSlot[]
  profileFields: ProfileField[]
  profilePresetId?: string
}

interface CompletionRule {
  id: string
  trigger: string
  replacement: string
}

interface PromptTab {
  id: string
  title: string
  text: string
  updatedAt?: string
}

interface LoreCard {
  id: string
  title: string
  body: string
  keywords: string[]
  collapsed?: boolean
}

interface ProfileField {
  id: string
  name: string
  value: string
}

interface ProfilePreset {
  id: string
  name: string
  fields: string[]
}

interface ChatbotState {
  id: string
  title: string
  codeText: string
  activeCharacterCode: string
  characters: CharacterAssets[]
  editorText: string
  activePromptTabId: string
  promptTabs: PromptTab[]
  tokenProvider: TokenProvider
  tokenLimit: number
  markdownEnabled: boolean
  promptFontSize: number
  imageCardSize: number
  completionsFolded: boolean
  completions: CompletionRule[]
  lorebook: LoreCard[]
  loreCardWidth: number
  loreCardHeight: number
  loreGridColumns: number
  profilePresets: ProfilePreset[]
}

interface ProjectPayload {
  version: number
  updatedAt: string
  chatbot: ChatbotState
}

interface ProjectWorkspace {
  id: string
  projectPath: string
  chatbot: ChatbotState
}

interface LocalSnapshot {
  version: number
  activeProjectId: string
  projects: ProjectWorkspace[]
  globalProfilePresets: ProfilePreset[]
  activeTool?: ToolId
  projectsFolded?: boolean
}

type ChatbotInput = Partial<ChatbotState> & {
  characterCode?: unknown
  name?: unknown
  profileFields?: unknown
  slots?: unknown
}

interface CompletionMatch {
  rule: CompletionRule
  start: number
  end: number
}

interface ToolItem {
  id: ToolId
  label: string
  description: string
}

interface DropdownOption {
  value: string
  label: string
}

interface StyledDropdownProps {
  ariaLabel: string
  className?: string
  disabled?: boolean
  onChange: (value: string) => void
  options: DropdownOption[]
  placeholder?: string
  value: string
}

interface AppErrorBoundaryState {
  error: Error | null
}

const STORAGE_KEY = 'etomo.localProjectState'
const PROJECT_VERSION = 16
const PROMPT_FONT_DEFAULT_SIZE = 14
const PROMPT_FONT_MIN_SIZE = 11
const PROMPT_FONT_MAX_SIZE = 24
const IMAGE_CARD_DEFAULT_SIZE = 144
const IMAGE_CARD_MIN_SIZE = 120
const IMAGE_CARD_MAX_SIZE = 420
const LORE_CARD_DEFAULT_WIDTH = 260
const LORE_CARD_DEFAULT_HEIGHT = 260
const LORE_CARD_MIN_WIDTH = 220
const LORE_CARD_MIN_HEIGHT = 190
const LORE_CARD_MAX_WIDTH = 520
const LORE_CARD_MAX_HEIGHT = 520
const LORE_GRID_MAX_COLUMNS = 12
const MARKDOWN_PLUGINS = [remarkGfm]
const EMPTY_SLOTS: EmotionSlot[] = []
const DEFAULT_CODE_TEXT = ''
const TOKEN_LIMIT_OPTIONS = [5000, 6000, 7000]

const LEGACY_DEFAULT_PROFILE_FIELD_NAMES = new Set([
  '이름',
  '나이',
  '외모',
  '복장',
  '성격',
  '배경',
  '말투',
  '말투참조용 대사예시',
  '성격,말투 참조용 캐릭터',
])

const TOOL_ITEMS: ToolItem[] = [
  {
    id: 'overview',
    label: '전체 정리',
    description: '프로젝트 현황',
  },
  {
    id: 'editor',
    label: '프롬프트',
    description: '본문, 글자 수, 자동완성',
  },
  {
    id: 'profile',
    label: '챗봇 시트',
    description: '프로필 테이블',
  },
  {
    id: 'images',
    label: '이미지 코드',
    description: '표정 코드와 이미지 파일',
  },
  {
    id: 'lorebook',
    label: '로어북',
    description: '호출어와 코르크 보드',
  },
  {
    id: 'guidelines',
    label: '유저 가이드라인',
    description: '사용 설명서',
  },
]

const TOOL_HEADING_IDS: Record<ToolId, string> = {
  overview: 'overview-heading',
  guidelines: 'guidelines-heading',
  images: 'image-code-heading',
  editor: 'editor-heading',
  lorebook: 'lore-heading',
  profile: 'profile-heading',
}

const APP_GUIDELINE_QUICK_STEPS = [
  '새 폴더를 만들고 프로젝트 폴더로 지정합니다.',
  '챗봇 시트에서 캐릭터 코드를 추가합니다.',
  '캐릭터 표시 이름과 시트 항목을 필요한 만큼 작성합니다.',
  '이미지 코드에서 상태 코드를 입력하고 격자를 확인합니다.',
  '각 상태 카드에 이미지를 등록합니다.',
  '프롬프트, 로어북, 백업을 정리합니다.',
]

const APP_GUIDELINE_SECTIONS = [
  {
    title: '프로젝트 폴더',
    items: [
      '프로젝트 폴더 하나는 챗봇 하나의 작업 공간입니다.',
      '되도록 이미 존재하는 폴더를 바로 지정하지 말고, 새 폴더를 만든 뒤 프로젝트 폴더로 지정하세요.',
      '기존 자료는 새 프로젝트 폴더가 만들어진 뒤 필요한 파일만 옮기는 편이 안전합니다.',
      '프로젝트 데이터는 지정한 폴더 안의 etomo.project.json에 저장됩니다.',
    ],
  },
  {
    title: '캐릭터 코드와 시트',
    items: [
      '챗봇 안의 등장인물마다 캐릭터 코드를 하나씩 등록합니다.',
      '캐릭터 코드는 프로젝트 폴더 바로 아래에 만들어지는 폴더 이름입니다.',
      '표시 이름은 앱에서 알아보기 위한 이름이며, 실제 폴더명은 캐릭터 코드가 기준입니다.',
      '시트 항목은 캐릭터마다 따로 관리되므로 필요한 항목만 직접 추가하세요.',
    ],
  },
  {
    title: '이미지 코드',
    items: [
      '이미지 코드는 KEY=VALUE 형식만 인식합니다. 형식에 맞지 않는 줄은 무시됩니다.',
      '예: 평상시=001, 웃음=002',
      'VALUE에 쉼표가 있으면 각 값이 별도 카드로 분리됩니다. 예: 식사=16,17,18',
      '이미지를 등록하면 선택한 캐릭터 코드 폴더 안에 상태 코드 파일명으로 저장됩니다.',
    ],
  },
  {
    title: '프롬프트',
    items: [
      '프롬프트는 탭 단위로 관리합니다.',
      '입력 내용은 프로젝트 JSON에 자동 저장됩니다.',
      '글자 수는 JavaScript value.length 기준(바베챗 상세 설정 입력란 토큰)으로 계산합니다.',
      '마크다운 미리보기는 필요할 때만 켜고, 앱을 다시 열면 기본적으로 꺼진 상태에서 시작합니다.',
    ],
  },
  {
    title: '로어북',
    items: [
      '로어북은 카드 단위로 작성합니다.',
      '각 카드는 제목, 본문, 호출어를 가집니다.',
      '호출어는 카드 하나당 최대 5개까지 등록할 수 있습니다.',
      '카드 순서는 드래그 앤 드롭 또는 우선순위 버튼으로 조정합니다.',
    ],
  },
  {
    title: '백업',
    items: [
      '프로젝트 백업은 현재 프로젝트만 .etomo 파일로 저장합니다.',
      '전체 백업은 열려 있는 프로젝트와 전역 프리셋을 함께 저장합니다.',
      '가져오기는 기존 프로젝트에 병합하거나 덮어쓰지 않고 새 프로젝트로만 복원합니다.',
      '중요한 작업 전에는 프로젝트 폴더 자체도 별도로 복사해 두는 편이 좋습니다.',
    ],
  },
]

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function createPromptTab(title = '프롬프트 1', text = ''): PromptTab {
  return {
    id: createId('prompt'),
    title,
    text,
    updatedAt: new Date().toISOString(),
  }
}

function parseCodeText(input: string) {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/^([^=]+?)=(.+)$/)

      if (!match) {
        return []
      }

      const label = match[1].trim()

      return match[2]
        .split(',')
        .map((code) => ({
          label,
          code: code.trim(),
        }))
    })
    .filter(
      (item): item is { label: string; code: string } =>
        item.label.length > 0 && item.code.length > 0,
    )
}

function findInvalidCodeLines(input: string) {
  return input
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(({ line }) => {
      if (!line) {
        return false
      }

      const match = line.match(/^([^=]+?)=(.+)$/)

      if (!match) {
        return true
      }

      const label = match[1].trim()
      const codes = match[2]
        .split(',')
        .map((code) => code.trim())
        .filter(Boolean)

      return label.length === 0 || codes.length === 0
    })
    .map(({ lineNumber }) => lineNumber)
}

function createSlot(label: string, code: string, previous?: EmotionSlot): EmotionSlot {
  return {
    label,
    code,
    imagePath: previous?.imagePath,
    imageName: previous?.imageName,
    updatedAt: previous?.updatedAt,
  }
}

function createCharacterAssets(
  code: string,
  slots: EmotionSlot[] = [],
  profileFields: ProfileField[] = [],
  profilePresetId?: string,
  displayName = '',
): CharacterAssets {
  return {
    code,
    displayName: displayName.trim(),
    slots,
    profileFields,
    profilePresetId,
  }
}

function createChatbot(title = '새 챗봇'): ChatbotState {
  const initialPromptTab = createPromptTab()

  return {
    id: createId('chatbot'),
    title,
    codeText: DEFAULT_CODE_TEXT,
    activeCharacterCode: '',
    characters: [],
    editorText: initialPromptTab.text,
    activePromptTabId: initialPromptTab.id,
    promptTabs: [initialPromptTab],
    tokenProvider: 'claude',
    tokenLimit: 4000,
    markdownEnabled: false,
    promptFontSize: PROMPT_FONT_DEFAULT_SIZE,
    imageCardSize: IMAGE_CARD_DEFAULT_SIZE,
    completionsFolded: false,
    loreCardWidth: LORE_CARD_DEFAULT_WIDTH,
    loreCardHeight: LORE_CARD_DEFAULT_HEIGHT,
    loreGridColumns: 0,
    completions: [],
    lorebook: [
      {
        id: createId('lore'),
        title: '세계관 메모',
        body: '',
        keywords: [],
        collapsed: true,
      },
    ],
    profilePresets: [],
  }
}

function getProjectFolderName(projectPath: string) {
  return projectPath.trim().split(/[\\/]/).filter(Boolean).at(-1) ?? ''
}

function getProjectDisplayName(project: ProjectWorkspace) {
  return getProjectFolderName(project.projectPath) || project.chatbot.title.trim() || '새 챗봇'
}

function getProfilePresetNameKey(name: string) {
  return name.trim().toLowerCase()
}

function mergeProfilePresets(presets: ProfilePreset[]) {
  const mergedPresetsByName = new Map<string, ProfilePreset>()

  for (const preset of presets) {
    const name = preset.name.trim()
    const key = getProfilePresetNameKey(name)

    if (!key) {
      continue
    }

    const existingPreset = mergedPresetsByName.get(key)

    if (!existingPreset) {
      mergedPresetsByName.set(key, {
        ...preset,
        name,
        fields: [...new Set(preset.fields.map((field) => field.trim()).filter(Boolean))],
      })
      continue
    }

    mergedPresetsByName.set(key, {
      ...existingPreset,
      fields: [
        ...new Set([...existingPreset.fields, ...preset.fields].map((field) => field.trim()).filter(Boolean)),
      ],
    })
  }

  return [...mergedPresetsByName.values()]
}

function getProjectProfilePresets(projects: ProjectWorkspace[]) {
  return projects.flatMap((project) => project.chatbot.profilePresets)
}

function getCharacterDisplayLabel(character: CharacterAssets) {
  return character.displayName?.trim() || character.code
}

function getCharacterMenuLabel(character: CharacterAssets) {
  const displayName = character.displayName?.trim()

  return displayName ? `${displayName} (${character.code})` : character.code
}

function mergeChatbotWithCharacterFolders(chatbot: ChatbotState, folderCodes?: string[]) {
  if (!Array.isArray(folderCodes) || folderCodes.length === 0) {
    return chatbot
  }

  const existingCodes = new Set(chatbot.characters.map((character) => character.code))
  const folderCharacters = [
    ...new Set(
      folderCodes
        .map((folderCode) => folderCode.trim())
        .filter((folderCode) => folderCode && !hasInvalidPathChars(folderCode)),
    ),
  ]
    .filter((folderCode) => !existingCodes.has(folderCode))
    .map((folderCode) => createCharacterAssets(folderCode))

  if (folderCharacters.length === 0) {
    return chatbot
  }

  return {
    ...chatbot,
    activeCharacterCode: chatbot.activeCharacterCode || folderCharacters[0].code,
    characters: [...chatbot.characters, ...folderCharacters],
  }
}

function formatProfileExportCell(value: string) {
  return value.trim().replace(/\r\n|\r|\n/g, '\\n').replace(/\|/g, '/')
}

function getProfileExportText(character: CharacterAssets) {
  const fields = character.profileFields.filter(
    (field) => field.name.trim() || field.value.trim(),
  )
  const keys = fields.map((field, index) =>
    formatProfileExportCell(field.name || `KEY${index + 1}`),
  )
  const values = fields.map((field) => formatProfileExportCell(field.value))

  return `${keys.join('|')}\n${values.join('|')}`
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()

  try {
    document.execCommand('copy')
  } finally {
    textarea.remove()
  }
}

function remapProjectPresetAssignments(
  projects: ProjectWorkspace[],
  globalProfilePresets: ProfilePreset[],
) {
  const globalPresetById = new Map(globalProfilePresets.map((preset) => [preset.id, preset]))
  const globalPresetByName = new Map(
    globalProfilePresets.map((preset) => [getProfilePresetNameKey(preset.name), preset]),
  )

  return projects.map((project) => {
    const projectPresetById = new Map(
      project.chatbot.profilePresets.map((preset) => [preset.id, preset]),
    )

    return {
      ...project,
      chatbot: {
        ...project.chatbot,
        characters: project.chatbot.characters.map((character) => {
          if (!character.profilePresetId) {
            return character
          }

          const globalPreset = globalPresetById.get(character.profilePresetId)

          if (globalPreset) {
            return character
          }

          const legacyPreset = projectPresetById.get(character.profilePresetId)
          const remappedPreset = legacyPreset
            ? globalPresetByName.get(getProfilePresetNameKey(legacyPreset.name))
            : undefined

          return {
            ...character,
            profilePresetId: remappedPreset?.id ?? character.profilePresetId,
          }
        }),
      },
    }
  })
}

function getComparableProjectPath(projectPath: string) {
  return projectPath.trim().replace(/[\\/]+$/, '').toLowerCase()
}

function createProjectWorkspace(
  projectPath = '',
  chatbot = createChatbot(getProjectFolderName(projectPath) || '새 챗봇'),
  id = createId('project'),
): ProjectWorkspace {
  const projectFolderName = getProjectFolderName(projectPath)

  return {
    id,
    projectPath,
    chatbot: projectFolderName ? { ...chatbot, title: projectFolderName } : chatbot,
  }
}

function createInitialSnapshot(): LocalSnapshot {
  const project = createProjectWorkspace()

  return {
    version: PROJECT_VERSION,
    activeProjectId: project.id,
    projects: [project],
    globalProfilePresets: [],
    activeTool: 'profile',
    projectsFolded: false,
  }
}

function getPersistedChatbot(chatbot: ChatbotState): ChatbotState {
  return {
    ...chatbot,
    markdownEnabled: false,
  }
}

function createProjectPayload(chatbot: ChatbotState): ProjectPayload {
  return {
    version: PROJECT_VERSION,
    updatedAt: new Date().toISOString(),
    chatbot: getPersistedChatbot(chatbot),
  }
}

function normalizeTokenProvider(value: unknown): TokenProvider {
  return value === 'gemini' ? 'gemini' : 'claude'
}

function normalizeSlot(input: Partial<EmotionSlot> | null | undefined, fallbackIndex: number): EmotionSlot {
  const slot: Partial<EmotionSlot> = input && typeof input === 'object' ? input : {}

  return {
    label: typeof slot.label === 'string' ? slot.label : `항목 ${fallbackIndex + 1}`,
    code: typeof slot.code === 'string' ? slot.code : String(fallbackIndex + 1).padStart(3, '0'),
    imagePath: typeof slot.imagePath === 'string' ? slot.imagePath : undefined,
    imageName: typeof slot.imageName === 'string' ? slot.imageName : undefined,
    updatedAt: typeof slot.updatedAt === 'string' ? slot.updatedAt : undefined,
  }
}

function normalizeLoreCardSize(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.min(Math.max(Math.round(value), min), max)
}

function normalizePromptFontSize(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return PROMPT_FONT_DEFAULT_SIZE
  }

  return Math.min(Math.max(Math.round(value), PROMPT_FONT_MIN_SIZE), PROMPT_FONT_MAX_SIZE)
}

function normalizeImageCardSize(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return IMAGE_CARD_DEFAULT_SIZE
  }

  return Math.min(Math.max(Math.round(value), IMAGE_CARD_MIN_SIZE), IMAGE_CARD_MAX_SIZE)
}

function normalizeLoreGridColumns(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }

  return Math.min(Math.max(Math.round(value), 0), LORE_GRID_MAX_COLUMNS)
}

function normalizeCharacterAssets(input: unknown, fallbackIndex: number): CharacterAssets | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  const maybeCharacter = input as Partial<CharacterAssets>
  const code =
    typeof maybeCharacter.code === 'string'
      ? maybeCharacter.code.trim()
      : `character_${fallbackIndex + 1}`

  if (!code) {
    return null
  }

  return createCharacterAssets(
    code,
    Array.isArray(maybeCharacter.slots)
      ? maybeCharacter.slots.map((slot, index) => normalizeSlot(slot, index))
      : [],
    normalizeProfileFields(maybeCharacter),
    typeof maybeCharacter.profilePresetId === 'string' ? maybeCharacter.profilePresetId : undefined,
    typeof maybeCharacter.displayName === 'string' ? maybeCharacter.displayName : '',
  )
}

function normalizeProfileFields(input: { profileFields?: unknown }) {
  if (!Array.isArray(input.profileFields)) {
    return []
  }

  const normalizedFields = input.profileFields.map((rawField) => {
    const field: Partial<ProfileField> =
      rawField && typeof rawField === 'object' ? rawField : {}

    return {
      id: typeof field.id === 'string' ? field.id : createId('profile'),
      name: typeof field.name === 'string' ? field.name : '',
      value: typeof field.value === 'string' ? field.value : '',
    }
  })
  const containsOnlyEmptyLegacyDefaults =
    normalizedFields.length > 0 &&
    normalizedFields.every(
      (field) =>
        LEGACY_DEFAULT_PROFILE_FIELD_NAMES.has(field.name) &&
        field.value.trim() === '',
    )

  return containsOnlyEmptyLegacyDefaults ? [] : normalizedFields
}

function normalizeProfilePresets(input: { profilePresets?: unknown }) {
  if (!Array.isArray(input.profilePresets)) {
    return []
  }

  return input.profilePresets
    .map((preset) => {
      if (!preset || typeof preset !== 'object') {
        return null
      }

      const maybePreset = preset as Partial<ProfilePreset>
      const fields = Array.isArray(maybePreset.fields)
        ? maybePreset.fields.filter((field): field is string => typeof field === 'string')
        : []
      const normalizedFields = [...new Set(fields.map((field) => field.trim()).filter(Boolean))]

      if (
        typeof maybePreset.name !== 'string' ||
        !maybePreset.name.trim() ||
        normalizedFields.length === 0
      ) {
        return null
      }

      return {
        id: typeof maybePreset.id === 'string' ? maybePreset.id : createId('preset'),
        name: maybePreset.name,
        fields: normalizedFields,
      }
    })
    .filter((preset): preset is ProfilePreset => Boolean(preset))
}

function normalizeChatbotTitle(input: ChatbotInput, fallbackTitle: string) {
  if (typeof input.title === 'string' && input.title.trim()) {
    return input.title
  }

  if (typeof input.name === 'string' && input.name.trim() && input.name.trim() !== '캐릭터 1') {
    return input.name
  }

  return fallbackTitle
}

function normalizePromptTabs(input: ChatbotInput) {
  const rawPromptTabs = Array.isArray(input.promptTabs) ? input.promptTabs : []
  const promptTabs = rawPromptTabs
    .map((tab, index): PromptTab | null => {
      if (!tab || typeof tab !== 'object') {
        return null
      }

      const maybeTab = tab as Partial<PromptTab>
      const title =
        typeof maybeTab.title === 'string' && maybeTab.title.trim()
          ? maybeTab.title.trim()
          : `프롬프트 ${index + 1}`
      const text = typeof maybeTab.text === 'string' ? maybeTab.text : ''

      const normalizedTab: PromptTab = {
        id: typeof maybeTab.id === 'string' ? maybeTab.id : createId('prompt'),
        title,
        text,
      }

      if (typeof maybeTab.updatedAt === 'string') {
        normalizedTab.updatedAt = maybeTab.updatedAt
      }

      return normalizedTab
    })
    .filter((tab): tab is PromptTab => Boolean(tab))

  const normalizedPromptTabs =
    promptTabs.length > 0
      ? promptTabs
      : [createPromptTab('프롬프트 1', typeof input.editorText === 'string' ? input.editorText : '')]
  const activePromptTabId =
    typeof input.activePromptTabId === 'string' &&
    normalizedPromptTabs.some((tab) => tab.id === input.activePromptTabId)
      ? input.activePromptTabId
      : normalizedPromptTabs[0].id
  const activePromptText =
    normalizedPromptTabs.find((tab) => tab.id === activePromptTabId)?.text ?? ''

  return {
    activePromptTabId,
    promptTabs: normalizedPromptTabs,
    editorText: activePromptText,
  }
}

function normalizeChatbot(input: ChatbotInput, fallbackTitle = '새 챗봇'): ChatbotState {
  const codeText = typeof input.codeText === 'string' ? input.codeText : DEFAULT_CODE_TEXT
  const normalizedPromptState = normalizePromptTabs(input)
  const profilePresets = normalizeProfilePresets(input)
  const legacyCharacterCode = typeof input.characterCode === 'string' ? input.characterCode.trim() : ''
  const legacySlots = Array.isArray(input.slots)
    ? input.slots.map((slot, index) => normalizeSlot(slot, index))
    : []
  const legacyProfileFields = normalizeProfileFields(input)
  const normalizedCharacters = Array.isArray(input.characters)
    ? input.characters
        .map((character, index) => normalizeCharacterAssets(character, index))
        .filter((character): character is CharacterAssets => Boolean(character))
    : []
  const uniqueCharacters: CharacterAssets[] = []
  const seenCharacterCodes = new Set<string>()

  for (const character of normalizedCharacters) {
    if (seenCharacterCodes.has(character.code)) {
      continue
    }

    uniqueCharacters.push(character)
    seenCharacterCodes.add(character.code)
  }

  if (legacyProfileFields.length > 0 && uniqueCharacters.length > 0) {
    const targetCharacterCode =
      typeof input.activeCharacterCode === 'string' &&
      uniqueCharacters.some((character) => character.code === input.activeCharacterCode)
        ? input.activeCharacterCode
        : uniqueCharacters[0].code
    const targetCharacter = uniqueCharacters.find(
      (character) => character.code === targetCharacterCode,
    )

    if (targetCharacter && targetCharacter.profileFields.length === 0) {
      targetCharacter.profileFields = legacyProfileFields
    }
  }

  const characters =
    uniqueCharacters.length > 0
      ? uniqueCharacters
      : legacyCharacterCode
        ? [createCharacterAssets(legacyCharacterCode, legacySlots, legacyProfileFields)]
        : []
  const normalizedPresetCharacters = characters.map((character) => ({
    ...character,
    profilePresetId:
      typeof character.profilePresetId === 'string' && character.profilePresetId.trim()
        ? character.profilePresetId
        : undefined,
  }))
  const characterCodes = new Set(normalizedPresetCharacters.map((character) => character.code))
  const activeCharacterCode =
    typeof input.activeCharacterCode === 'string' && characterCodes.has(input.activeCharacterCode)
      ? input.activeCharacterCode
      : normalizedPresetCharacters[0]?.code ?? ''
  const rawLorebook = Array.isArray(input.lorebook)
    ? input.lorebook.filter((card): card is LoreCard => Boolean(card) && typeof card === 'object')
    : []
  const legacySizedLoreCard = rawLorebook.find(
    (card) =>
      typeof (card as Partial<LoreCard> & { width?: unknown }).width === 'number' ||
      typeof (card as Partial<LoreCard> & { height?: unknown }).height === 'number',
  ) as (Partial<LoreCard> & { width?: unknown; height?: unknown }) | undefined
  const legacyLoreCardWidth = normalizeLoreCardSize(
    legacySizedLoreCard?.width,
    LORE_CARD_DEFAULT_WIDTH,
    LORE_CARD_MIN_WIDTH,
    LORE_CARD_MAX_WIDTH,
  )
  const legacyLoreCardHeight = normalizeLoreCardSize(
    legacySizedLoreCard?.height,
    LORE_CARD_DEFAULT_HEIGHT,
    LORE_CARD_MIN_HEIGHT,
    LORE_CARD_MAX_HEIGHT,
  )
  const loreCardWidth = normalizeLoreCardSize(
    input.loreCardWidth,
    legacyLoreCardWidth,
    LORE_CARD_MIN_WIDTH,
    LORE_CARD_MAX_WIDTH,
  )
  const loreCardHeight = normalizeLoreCardSize(
    input.loreCardHeight,
    legacyLoreCardHeight,
    LORE_CARD_MIN_HEIGHT,
    LORE_CARD_MAX_HEIGHT,
  )
  const loreGridColumns = normalizeLoreGridColumns(input.loreGridColumns)

  return {
    id: typeof input.id === 'string' ? input.id : createId('chatbot'),
    title: normalizeChatbotTitle(input, fallbackTitle),
    codeText,
    activeCharacterCode,
    characters: normalizedPresetCharacters,
    editorText: normalizedPromptState.editorText,
    activePromptTabId: normalizedPromptState.activePromptTabId,
    promptTabs: normalizedPromptState.promptTabs,
    tokenProvider: normalizeTokenProvider(input.tokenProvider),
    tokenLimit: typeof input.tokenLimit === 'number' ? input.tokenLimit : 4000,
    markdownEnabled: false,
    promptFontSize: normalizePromptFontSize(input.promptFontSize),
    imageCardSize: normalizeImageCardSize(input.imageCardSize),
    completionsFolded:
      typeof input.completionsFolded === 'boolean' ? input.completionsFolded : false,
    loreCardWidth,
    loreCardHeight,
    loreGridColumns,
    completions: Array.isArray(input.completions)
      ? input.completions
          .filter((rule): rule is CompletionRule => Boolean(rule) && typeof rule === 'object')
          .map((rule) => ({
            id: typeof rule.id === 'string' ? rule.id : createId('completion'),
            trigger: typeof rule.trigger === 'string' ? rule.trigger : '',
            replacement: typeof rule.replacement === 'string' ? rule.replacement : '',
          }))
      : [],
    lorebook: rawLorebook.length > 0
      ? rawLorebook.map((card) => ({
          id: typeof card.id === 'string' ? card.id : createId('lore'),
          title: typeof card.title === 'string' ? card.title : '로어북 카드',
          body: typeof card.body === 'string' ? card.body : '',
          keywords: Array.isArray(card.keywords)
            ? card.keywords
                .filter((keyword): keyword is string => typeof keyword === 'string')
                .slice(0, 5)
            : [],
          collapsed: typeof card.collapsed === 'boolean' ? card.collapsed : true,
        }))
      : [],
    profilePresets,
  }
}

function normalizeProjectPayload(input: unknown): ProjectPayload | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  const maybeProject = input as Partial<ProjectPayload> & {
    activeBotId?: unknown
    bots?: ChatbotInput[]
  }

  if (maybeProject.chatbot && typeof maybeProject.chatbot === 'object') {
    return {
      version: PROJECT_VERSION,
      updatedAt:
        typeof maybeProject.updatedAt === 'string'
          ? maybeProject.updatedAt
          : new Date().toISOString(),
      chatbot: normalizeChatbot(maybeProject.chatbot as ChatbotInput),
    }
  }

  if (!Array.isArray(maybeProject.bots) || maybeProject.bots.length === 0) {
    return null
  }

  const legacyBot =
    typeof maybeProject.activeBotId === 'string'
      ? maybeProject.bots.find((bot) => bot.id === maybeProject.activeBotId) ?? maybeProject.bots[0]
      : maybeProject.bots[0]

  return {
    version: PROJECT_VERSION,
    updatedAt:
      typeof maybeProject.updatedAt === 'string'
        ? maybeProject.updatedAt
        : new Date().toISOString(),
    chatbot: normalizeChatbot(legacyBot, '새 챗봇'),
  }
}

function normalizeProjectWorkspace(input: unknown): ProjectWorkspace | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  const maybeProject = input as Partial<ProjectWorkspace>

  if (!maybeProject.chatbot || typeof maybeProject.chatbot !== 'object') {
    return null
  }

  const projectPath = typeof maybeProject.projectPath === 'string' ? maybeProject.projectPath : ''

  return createProjectWorkspace(
    projectPath,
    normalizeChatbot(maybeProject.chatbot as ChatbotInput),
    typeof maybeProject.id === 'string' ? maybeProject.id : createId('project'),
  )
}

function loadLocalSnapshot(): LocalSnapshot {
  try {
    const rawSnapshot = localStorage.getItem(STORAGE_KEY)

    if (!rawSnapshot) {
      return createInitialSnapshot()
    }

    const parsedSnapshot = JSON.parse(rawSnapshot)
    if (Array.isArray(parsedSnapshot.projects)) {
      const projects = parsedSnapshot.projects
        .map((project: unknown) => normalizeProjectWorkspace(project))
        .filter((project: ProjectWorkspace | null): project is ProjectWorkspace =>
          Boolean(project),
        )

      if (projects.length > 0) {
        const globalProfilePresets = mergeProfilePresets([
          ...normalizeProfilePresets({
            profilePresets:
              parsedSnapshot.globalProfilePresets ?? parsedSnapshot.profilePresets,
          }),
          ...getProjectProfilePresets(projects),
        ])
        const remappedProjects = remapProjectPresetAssignments(projects, globalProfilePresets)
        const activeProjectExists = projects.some(
          (project: ProjectWorkspace) => project.id === parsedSnapshot.activeProjectId,
        )

        return {
          version: PROJECT_VERSION,
          activeProjectId: activeProjectExists
            ? String(parsedSnapshot.activeProjectId)
            : remappedProjects[0].id,
          projects: remappedProjects,
          globalProfilePresets,
          activeTool:
            parsedSnapshot.activeTool === 'images' ||
            parsedSnapshot.activeTool === 'editor' ||
            parsedSnapshot.activeTool === 'lorebook' ||
            parsedSnapshot.activeTool === 'profile' ||
            parsedSnapshot.activeTool === 'guidelines' ||
            parsedSnapshot.activeTool === 'overview'
              ? parsedSnapshot.activeTool
              : 'profile',
          projectsFolded: Boolean(parsedSnapshot.projectsFolded),
        }
      }
    }

    const normalizedProject = normalizeProjectPayload(parsedSnapshot)

    if (!normalizedProject) {
      return createInitialSnapshot()
    }

    const projectPath =
      typeof parsedSnapshot.projectPath === 'string' ? parsedSnapshot.projectPath : ''
    const project = createProjectWorkspace(projectPath, normalizedProject.chatbot)
    const globalProfilePresets = mergeProfilePresets(normalizedProject.chatbot.profilePresets)
    const remappedProjects = remapProjectPresetAssignments([project], globalProfilePresets)

    return {
      version: PROJECT_VERSION,
      activeProjectId: remappedProjects[0].id,
      projects: remappedProjects,
      globalProfilePresets,
      activeTool: 'profile',
      projectsFolded: false,
    }
  } catch {
    return createInitialSnapshot()
  }
}

function previewKey(projectId: string, characterCode: string, slotKey: string) {
  return `${projectId}:${characterCode}:${slotKey}`
}

function getSlotKey(slot: EmotionSlot) {
  return slot.code.trim() || slot.label
}

function getTextLength(value: string) {
  return value.length
}

function getAppGuidelinesText() {
  return APP_GUIDELINE_SECTIONS.map(
    (section) =>
      `${section.title}\n${section.items.map((item) => `- ${item}`).join('\n')}`,
  ).join('\n\n')
}

function findCompletionMatch(
  text: string,
  cursorIndex: number,
  rules: CompletionRule[],
): CompletionMatch | null {
  const beforeCursor = text.slice(0, cursorIndex)
  const orderedRules = [...rules]
    .filter((rule) => rule.trigger.trim() && rule.replacement.trim())
    .sort((first, second) => second.trigger.length - first.trigger.length)

  for (const rule of orderedRules) {
    if (beforeCursor.endsWith(rule.trigger)) {
      return {
        rule,
        start: cursorIndex - rule.trigger.length,
        end: cursorIndex,
      }
    }
  }

  return null
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () => reject(reader.error))
    reader.readAsDataURL(file)
  })
}

function pickImageFile(files: FileList | File[]) {
  return Array.from(files).find((file) => file.type.startsWith('image/'))
}

function pickClipboardImage(event: ClipboardEvent<HTMLElement>) {
  const fileFromList = pickImageFile(event.clipboardData.files)

  if (fileFromList) {
    return fileFromList
  }

  return Array.from(event.clipboardData.items)
    .filter((item) => item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .find((file): file is File => Boolean(file))
}

function parseKeywords(value: string) {
  return value
    .split(',')
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .slice(0, 5)
}

function parsePresetFields(value: string) {
  return [
    ...new Set(
      value
        .split(/[\n,|]/)
        .map((field) => field.trim())
        .filter(Boolean),
    ),
  ]
}

function hasInvalidPathChars(value: string) {
  const trimmedValue = value.trim()

  return (
    trimmedValue.length > 0 &&
    (trimmedValue === '.' ||
      trimmedValue === '..' ||
      /[<>:"/\\|?*\x00-\x1F]/.test(trimmedValue))
  )
}

function findDuplicateCodes(items: Array<{ code: string }>) {
  const seenCodes = new Set<string>()
  const duplicateCodes = new Set<string>()

  for (const item of items) {
    if (seenCodes.has(item.code)) {
      duplicateCodes.add(item.code)
      continue
    }

    seenCodes.add(item.code)
  }

  return [...duplicateCodes]
}

function getToolMetric(toolId: ToolId, chatbot: ChatbotState, textLength: number) {
  switch (toolId) {
    case 'overview':
      return `${chatbot.characters.length}명`
    case 'guidelines':
      return `${APP_GUIDELINE_SECTIONS.length}개 항목`
    case 'images':
      return chatbot.activeCharacterCode ? `${chatbot.characters.length}명` : '캐릭터 코드 필요'
    case 'editor':
      return `${textLength.toLocaleString()}자`
    case 'lorebook':
      return `${chatbot.lorebook.length}개 카드`
    case 'profile':
      return chatbot.activeCharacterCode ? `${chatbot.characters.length}명` : '캐릭터 코드 필요'
  }
}

function renderToolIcon(toolId: ToolId) {
  switch (toolId) {
    case 'overview':
      return <ClipboardList size={18} aria-hidden="true" />
    case 'guidelines':
      return <ClipboardPaste size={18} aria-hidden="true" />
    case 'images':
      return <Grid3X3 size={18} aria-hidden="true" />
    case 'editor':
      return <FileText size={18} aria-hidden="true" />
    case 'lorebook':
      return <BookOpen size={18} aria-hidden="true" />
    case 'profile':
      return <Table2 size={18} aria-hidden="true" />
  }
}

function StyledDropdown({
  ariaLabel,
  className = '',
  disabled = false,
  onChange,
  options,
  placeholder = '선택',
  value,
}: StyledDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const selectedOption = options.find((option) => option.value === value)

  return (
    <div
      className={`dropdown-control ${className}${disabled ? ' disabled' : ''}`}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget as Node | null

        if (!event.currentTarget.contains(nextTarget)) {
          setIsOpen(false)
        }
      }}
    >
      <button
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="dropdown-button"
        disabled={disabled}
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setIsOpen(true)
          }

          if (event.key === 'Escape') {
            setIsOpen(false)
          }
        }}
      >
        <span>{selectedOption?.label ?? placeholder}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {isOpen && !disabled && (
        <div className="dropdown-menu" role="listbox">
          {options.map((option) => (
            <button
              aria-selected={option.value === value}
              key={option.value}
              role="option"
              type="button"
              onClick={() => {
                onChange(option.value)
                setIsOpen(false)
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('etomo-tool render error', error, errorInfo)
  }

  render() {
    if (!this.state.error) {
      return this.props.children
    }

    return (
      <main className="fatal-error">
        <section>
          <AlertTriangle size={28} aria-hidden="true" />
          <h1>화면 렌더링 오류</h1>
          <p>{this.state.error.message || '알 수 없는 렌더링 오류가 발생했습니다.'}</p>
          <button type="button" onClick={() => this.setState({ error: null })}>
            다시 시도
          </button>
        </section>
      </main>
    )
  }
}

function EtomoToolApp() {
  const initialSnapshot = useMemo(loadLocalSnapshot, [])
  const [projects, setProjects] = useState<ProjectWorkspace[]>(initialSnapshot.projects)
  const [globalProfilePresets, setGlobalProfilePresets] = useState<ProfilePreset[]>(
    initialSnapshot.globalProfilePresets,
  )
  const [activeProjectId, setActiveProjectId] = useState(initialSnapshot.activeProjectId)
  const [activeTool, setActiveTool] = useState<ToolId>(initialSnapshot.activeTool ?? 'profile')
  const [projectsFolded, setProjectsFolded] = useState(Boolean(initialSnapshot.projectsFolded))
  const [imagePreviews, setImagePreviews] = useState<Record<string, string>>({})
  const [failedImageKeys, setFailedImageKeys] = useState<Set<string>>(() => new Set())
  const [savingSlotId, setSavingSlotId] = useState<string | null>(null)
  const [deletingSlotId, setDeletingSlotId] = useState<string | null>(null)
  const [deleteTargetSlotKey, setDeleteTargetSlotKey] = useState<string | null>(null)
  const [promptCloseTargetId, setPromptCloseTargetId] = useState<string | null>(null)
  const [isDashboardVisible, setIsDashboardVisible] = useState(true)
  const [newCharacterCode, setNewCharacterCode] = useState('')
  const [characterCodeDraft, setCharacterCodeDraft] = useState('')
  const [characterDisplayNameDraft, setCharacterDisplayNameDraft] = useState('')
  const [newPresetName, setNewPresetName] = useState('')
  const [newPresetFieldsText, setNewPresetFieldsText] = useState('')
  const [cursorIndex, setCursorIndex] = useState(0)
  const [completionSuggestionSelected, setCompletionSuggestionSelected] = useState(false)
  const [isTokenLimitMenuOpen, setIsTokenLimitMenuOpen] = useState(false)
  const [draggingLoreCardId, setDraggingLoreCardId] = useState<string | null>(null)
  const [loreDropTargetId, setLoreDropTargetId] = useState<string | null>(null)
  const [loreKeywordDrafts, setLoreKeywordDrafts] = useState<Record<string, string>>({})
  const [loreCardWidthText, setLoreCardWidthText] = useState(String(LORE_CARD_DEFAULT_WIDTH))
  const [loreCardHeightText, setLoreCardHeightText] = useState(String(LORE_CARD_DEFAULT_HEIGHT))
  const [loreGridColumnsText, setLoreGridColumnsText] = useState('0')
  const [promptFontSizeText, setPromptFontSizeText] = useState(
    String(PROMPT_FONT_DEFAULT_SIZE),
  )
  const [imageCardSizeText, setImageCardSizeText] = useState(
    String(IMAGE_CARD_DEFAULT_SIZE),
  )
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>('idle')
  const [status, setStatus] = useState<{ kind: StatusKind; message: string }>({
    kind: 'info',
    message: '프로젝트 탭을 열면 해당 폴더 하나가 챗봇 하나의 작업 공간이 됩니다.',
  })
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const activeProject = (projects.find((project) => project.id === activeProjectId) ??
    projects[0]) as ProjectWorkspace
  const projectPath = activeProject.projectPath
  const chatbot = activeProject.chatbot

  useEffect(() => {
    if (!isDashboardVisible) {
      return undefined
    }

    const dashboardTimer = window.setTimeout(() => {
      setIsDashboardVisible(false)
    }, 10000)

    return () => window.clearTimeout(dashboardTimer)
  }, [isDashboardVisible])

  useEffect(() => {
    setLoreCardWidthText(String(chatbot.loreCardWidth))
    setLoreCardHeightText(String(chatbot.loreCardHeight))
    setLoreGridColumnsText(String(chatbot.loreGridColumns))
  }, [activeProjectId, chatbot.loreCardHeight, chatbot.loreCardWidth, chatbot.loreGridColumns])

  useEffect(() => {
    setPromptFontSizeText(String(chatbot.promptFontSize))
  }, [activeProjectId, chatbot.promptFontSize])

  useEffect(() => {
    setImageCardSizeText(String(chatbot.imageCardSize))
  }, [activeProjectId, chatbot.imageCardSize])

  const projectState = useMemo<ProjectPayload>(
    () => createProjectPayload(chatbot),
    [chatbot],
  )
  const activeCharacter =
    chatbot.characters.find((character) => character.code === chatbot.activeCharacterCode) ??
    chatbot.characters[0]
  const activeCharacterCode = activeCharacter?.code ?? ''
  const activeCharacterSlots = activeCharacter?.slots ?? EMPTY_SLOTS
  const activeCharacterProfileFields = activeCharacter?.profileFields ?? []
  const activeCharacterFolderPath = activeCharacterCode || '캐릭터코드'
  const activeCharacterPreset = activeCharacter?.profilePresetId
    ? globalProfilePresets.find((preset) => preset.id === activeCharacter.profilePresetId)
    : undefined
  const activePromptTab =
    chatbot.promptTabs.find((tab) => tab.id === chatbot.activePromptTabId) ??
    chatbot.promptTabs[0]
  const activePromptText = activePromptTab?.text ?? ''
  const promptEditorStyle: CSSProperties = {
    fontSize: `${chatbot.promptFontSize}px`,
  }
  const imageSlotGridStyle = {
    '--image-card-size': `${chatbot.imageCardSize}px`,
  } as CSSProperties
  const characterFolderKey = useMemo(
    () => chatbot.characters.map((character) => character.code).join('\u0000'),
    [chatbot.characters],
  )
  const hasInvalidActiveCharacterCode = hasInvalidPathChars(activeCharacterCode)
  const trimmedNewCharacterCode = newCharacterCode.trim()
  const hasInvalidNewCharacterCode = hasInvalidPathChars(trimmedNewCharacterCode)
  const trimmedCharacterCodeDraft = characterCodeDraft.trim()
  const hasInvalidCharacterCodeDraft = hasInvalidPathChars(trimmedCharacterCodeDraft)

  useEffect(() => {
    setCharacterCodeDraft(activeCharacter?.code ?? '')
    setCharacterDisplayNameDraft(activeCharacter?.displayName ?? '')
  }, [activeCharacter?.code, activeCharacter?.displayName, activeProjectId])

  useEffect(() => {
    if (!projects.some((project) => project.id === activeProjectId)) {
      setActiveProjectId(projects[0].id)
    }
  }, [activeProjectId, projects])

  // 최신 스냅샷 쓰기 함수를 ref로 유지해, 디바운스 타이머와 beforeunload flush가
  // 항상 마지막 상태를 저장하도록 한다. 쓰기 실패(쿼터 초과 등)가 앱을 죽이지 않게 감싼다.
  const persistLocalSnapshotRef = useRef(() => {})
  persistLocalSnapshotRef.current = () => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: PROJECT_VERSION,
          activeProjectId,
          activeTool,
          projectsFolded,
          projects: projects.map((project) => ({
            ...project,
            chatbot: getPersistedChatbot(project.chatbot),
          })),
          globalProfilePresets,
        }),
      )
    } catch (error) {
      console.error('로컬 스냅샷 저장에 실패했습니다.', error)
    }
  }

  useEffect(() => {
    const snapshotTimer = window.setTimeout(() => persistLocalSnapshotRef.current(), 500)

    return () => window.clearTimeout(snapshotTimer)
  }, [activeProjectId, activeTool, globalProfilePresets, projects, projectsFolded])

  // 디바운스 중에 프로젝트를 전환하거나 창을 닫아도 마지막 편집이 디스크에 남도록
  // 대기 중인 저장을 ref에 보관하고, 전환/종료 시점에 flush한다.
  const pendingProjectSaveRef = useRef<{ projectPath: string; state: ProjectPayload } | null>(null)

  const flushPendingProjectSave = useCallback(() => {
    const pendingSave = pendingProjectSaveRef.current

    if (!pendingSave || !window.electronAPI?.saveProjectState) {
      return
    }

    pendingProjectSaveRef.current = null
    window.electronAPI.saveProjectState(pendingSave.projectPath, pendingSave.state).catch(() => {
      setStatus({
        kind: 'error',
        message: '프로젝트 파일 저장에 실패했습니다.',
      })
    })
  }, [])

  useEffect(() => {
    if (!projectPath || !window.electronAPI?.saveProjectState) {
      return undefined
    }

    setAutoSaveStatus('saving')
    pendingProjectSaveRef.current = { projectPath, state: projectState }
    const saveTimer = window.setTimeout(() => {
      const pendingSave = pendingProjectSaveRef.current

      if (!pendingSave) {
        return
      }

      pendingProjectSaveRef.current = null
      window.electronAPI
        ?.saveProjectState(pendingSave.projectPath, pendingSave.state)
        .then(() => setAutoSaveStatus('saved'))
        .catch(() => {
          setAutoSaveStatus('error')
          setStatus({
            kind: 'error',
            message: '프로젝트 파일 저장에 실패했습니다.',
          })
        })
    }, 450)

    return () => window.clearTimeout(saveTimer)
  }, [projectPath, projectState])

  useEffect(() => {
    // 활성 프로젝트가 바뀌면(또는 언마운트되면) 이전 프로젝트의 대기 중인 저장을 즉시 실행한다.
    return () => flushPendingProjectSave()
  }, [flushPendingProjectSave, projectPath])

  useEffect(() => {
    const flushBeforeUnload = () => {
      flushPendingProjectSave()
      persistLocalSnapshotRef.current()
    }

    window.addEventListener('beforeunload', flushBeforeUnload)

    return () => window.removeEventListener('beforeunload', flushBeforeUnload)
  }, [flushPendingProjectSave])

  useEffect(() => {
    setAutoSaveStatus('idle')
  }, [activeProjectId])

  useEffect(() => {
    // 비활성 프로젝트의 base64 미리보기를 메모리에서 내려 세션 내 무한 누적을 막는다.
    // 다시 전환하면 이미지 로드 effect가 디스크에서 다시 읽는다.
    const activePrefix = `${activeProjectId}:`

    setImagePreviews((current) => {
      const keptEntries = Object.entries(current).filter(([key]) => key.startsWith(activePrefix))

      return keptEntries.length === Object.keys(current).length
        ? current
        : Object.fromEntries(keptEntries)
    })
    setFailedImageKeys((current) => {
      const keptKeys = [...current].filter((key) => key.startsWith(activePrefix))

      return keptKeys.length === current.size ? current : new Set(keptKeys)
    })
  }, [activeProjectId])

  useEffect(() => {
    if (!projectPath) {
      return undefined
    }

    const electronAPI = window.electronAPI
    const characterCodes = characterFolderKey
      .split('\u0000')
      .filter((characterCode) => characterCode && !hasInvalidPathChars(characterCode))

    if (electronAPI?.syncCharacterFolders) {
      let cancelled = false

      electronAPI
        .syncCharacterFolders(projectPath, characterCodes)
        .then((result) => {
          if (cancelled || result.createdFolders.length === 0) {
            return
          }

          setStatus({
            kind: 'success',
            message: `캐릭터 폴더를 동기화했습니다. 생성 ${result.createdFolders.length}개`,
          })
        })
        .catch(() => {
          if (cancelled) {
            return
          }

          setStatus({
            kind: 'error',
            message: '캐릭터 폴더 동기화에 실패했습니다.',
          })
        })

      return () => {
        cancelled = true
      }
    }

    if (!electronAPI?.ensureCharacterFolder || characterCodes.length === 0) {
      return undefined
    }

    let cancelled = false

    Promise.allSettled(
      characterCodes.map((characterCode) =>
        electronAPI.ensureCharacterFolder(projectPath, characterCode),
      ),
    ).then((results) => {
      if (cancelled || results.every((result) => result.status === 'fulfilled')) {
        return
      }

      setStatus({
        kind: 'error',
        message: '일부 캐릭터 폴더를 생성하지 못했습니다.',
      })
    })

    return () => {
      cancelled = true
    }
  }, [characterFolderKey, projectPath])

  useEffect(() => {
    if (!projectPath || !window.electronAPI?.readImageAsDataUrl) {
      return undefined
    }

    const missingImages = activeCharacterSlots
      .filter((slot) => {
        const key = previewKey(activeProject.id, activeCharacterCode, getSlotKey(slot))

        return slot.imagePath && !imagePreviews[key] && !failedImageKeys.has(key)
      })
      .map((slot) => ({
        key: previewKey(activeProject.id, activeCharacterCode, getSlotKey(slot)),
        relativePath: slot.imagePath ?? '',
      }))

    if (missingImages.length === 0) {
      return undefined
    }

    let cancelled = false

    Promise.all(
      missingImages.map(async (image) => {
        try {
          const result = await window.electronAPI?.readImageAsDataUrl(
            projectPath,
            image.relativePath,
          )
          return result ? { key: image.key, dataUrl: result.dataUrl } : null
        } catch {
          return { key: image.key, dataUrl: null }
        }
      }),
    ).then((loadedImages) => {
      if (cancelled) {
        return
      }

      const successfulImages = loadedImages.filter(
        (image): image is { key: string; dataUrl: string } => Boolean(image?.dataUrl),
      )
      const failedKeys = loadedImages
        .filter(
          (image): image is { key: string; dataUrl: null } =>
            image !== null && image.dataUrl === null,
        )
        .map((image) => image.key)

      if (successfulImages.length > 0) {
        setImagePreviews((current) => {
          const nextPreviews = { ...current }

          for (const loadedImage of successfulImages) {
            nextPreviews[loadedImage.key] = loadedImage.dataUrl
          }

          return nextPreviews
        })
      }

      if (failedKeys.length > 0) {
        setFailedImageKeys((current) => {
          const nextFailedKeys = new Set(current)

          for (const failedKey of failedKeys) {
            nextFailedKeys.add(failedKey)
          }

          return nextFailedKeys
        })
      }
    })

    return () => {
      cancelled = true
    }
  }, [
    activeCharacterCode,
    activeCharacterSlots,
    activeProject.id,
    failedImageKeys,
    imagePreviews,
    projectPath,
  ])

  const currentTextLength = useMemo(() => getTextLength(activePromptText), [activePromptText])
  const activePromptLineCount =
    activePromptText.length === 0 ? 1 : activePromptText.split(/\r\n|\r|\n/).length
  const isOverTextLimit =
    chatbot.tokenLimit > 0 && currentTextLength > chatbot.tokenLimit
  const completionMatch = useMemo(
    () => findCompletionMatch(activePromptText, cursorIndex, chatbot.completions),
    [activePromptText, chatbot.completions, cursorIndex],
  )
  const completionMatchKey = completionMatch
    ? `${completionMatch.rule.id}:${completionMatch.start}:${completionMatch.end}`
    : ''
  const activeToolMeta = TOOL_ITEMS.find((tool) => tool.id === activeTool) ?? TOOL_ITEMS[0]
  const activeToolHeadingId = TOOL_HEADING_IDS[activeTool]
  const deleteTargetSlot = deleteTargetSlotKey
    ? activeCharacter?.slots.find((slot) => getSlotKey(slot) === deleteTargetSlotKey)
    : undefined
  const promptCloseTargetTab = promptCloseTargetId
    ? chatbot.promptTabs.find((tab) => tab.id === promptCloseTargetId)
    : undefined

  useEffect(() => {
    setCompletionSuggestionSelected(false)
  }, [completionMatchKey])

  useEffect(() => {
    if (
      chatbot.activeCharacterCode &&
      !chatbot.characters.some((character) => character.code === chatbot.activeCharacterCode)
    ) {
      updateChatbot((chatbot) => ({
        ...chatbot,
        activeCharacterCode: chatbot.characters[0]?.code ?? '',
      }))
    }
  }, [chatbot.activeCharacterCode, chatbot.characters])

  useEffect(() => {
    setNewCharacterCode('')
    setNewPresetName('')
    setNewPresetFieldsText('')
    setDeleteTargetSlotKey(null)
  }, [activeProjectId])

  function updateChatbot(updater: (chatbot: ChatbotState) => ChatbotState) {
    setProjects((currentProjects) =>
      currentProjects.map((project) =>
        project.id === activeProject.id
          ? { ...project, chatbot: updater(project.chatbot) }
          : project,
      ),
    )
  }

  function updateActiveProject(updater: (project: ProjectWorkspace) => ProjectWorkspace) {
    setProjects((currentProjects) =>
      currentProjects.map((project) =>
        project.id === activeProject.id ? updater(project) : project,
      ),
    )
  }

  function updateActiveCharacterSlots(updater: (slots: EmotionSlot[]) => EmotionSlot[]) {
    if (!activeCharacterCode) {
      return
    }

    updateChatbot((chatbot) => ({
      ...chatbot,
      characters: chatbot.characters.map((character) =>
        character.code === activeCharacterCode
          ? { ...character, slots: updater(character.slots) }
          : character,
      ),
    }))
  }

  function updateActiveCharacterProfileFields(
    updater: (profileFields: ProfileField[]) => ProfileField[],
  ) {
    if (!activeCharacterCode) {
      return
    }

    updateChatbot((chatbot) => ({
      ...chatbot,
      characters: chatbot.characters.map((character) =>
        character.code === activeCharacterCode
          ? { ...character, profileFields: updater(character.profileFields) }
          : character,
      ),
    }))
  }

  function handleSelectCharacterCode(characterCode: string) {
    updateChatbot((chatbot) => ({
      ...chatbot,
      activeCharacterCode: characterCode,
    }))
    setDeleteTargetSlotKey(null)
  }

  function handleAddCharacterCode() {
    const characterCode = newCharacterCode.trim()

    if (!characterCode) {
      setStatus({
        kind: 'error',
        message: '추가할 캐릭터 코드를 입력해야 합니다.',
      })
      return
    }

    if (hasInvalidPathChars(characterCode)) {
      setStatus({
        kind: 'error',
        message: '캐릭터 코드에는 \\ / : * ? " < > | 같은 경로 문자를 사용할 수 없습니다.',
      })
      return
    }

    if (chatbot.characters.some((character) => character.code === characterCode)) {
      setStatus({
        kind: 'error',
        message: `이미 등록된 캐릭터 코드입니다: ${characterCode}`,
      })
      return
    }

    updateChatbot((chatbot) => ({
      ...chatbot,
      activeCharacterCode: characterCode,
      characters: [...chatbot.characters, createCharacterAssets(characterCode)],
    }))
    setNewCharacterCode('')

    if (!projectPath) {
      setStatus({
        kind: 'success',
        message: `${characterCode} 캐릭터 코드를 추가했습니다. 프로젝트 폴더를 지정하면 ${characterCode} 폴더가 생성됩니다.`,
      })
      return
    }

    if (!window.electronAPI?.ensureCharacterFolder) {
      setStatus({
        kind: 'warning',
        message: `${characterCode} 캐릭터 코드는 추가했지만 폴더 생성은 Electron 앱에서만 사용할 수 있습니다.`,
      })
      return
    }

    void window.electronAPI
      .ensureCharacterFolder(projectPath, characterCode)
      .then((result) => {
        setStatus({
          kind: 'success',
          message: `${characterCode} 캐릭터 코드를 추가하고 ${result.relativePath} 폴더를 만들었습니다.`,
        })
      })
      .catch(() => {
        setStatus({
          kind: 'error',
          message: `${characterCode} 캐릭터 코드는 추가했지만 폴더 생성에 실패했습니다.`,
        })
      })
  }

  function handleRemoveCharacterCode(characterCode: string) {
    if (
      projectPath &&
      window.electronAPI?.deleteCharacterFolder &&
      !window.confirm(`${characterCode} 폴더와 그 안의 파일을 삭제하시겠습니까?`)
    ) {
      return
    }

    const remainingCharacters = chatbot.characters.filter(
      (character) => character.code !== characterCode,
    )
    const nextActiveCharacterCode =
      chatbot.activeCharacterCode === characterCode
        ? remainingCharacters[0]?.code ?? ''
        : chatbot.activeCharacterCode

    updateChatbot((chatbot) => ({
      ...chatbot,
      activeCharacterCode: nextActiveCharacterCode,
      characters: chatbot.characters.filter((character) => character.code !== characterCode),
    }))
    setDeleteTargetSlotKey(null)
    setStatus({
      kind: 'success',
      message: `${characterCode} 캐릭터 코드를 제거했습니다.`,
    })

    if (!projectPath || !window.electronAPI?.deleteCharacterFolder) {
      return
    }

    void window.electronAPI.deleteCharacterFolder(projectPath, characterCode).catch(() => {
      setStatus({
        kind: 'error',
        message: `${characterCode} 캐릭터 폴더 삭제에 실패했습니다.`,
      })
    })
  }

  async function handleSaveActiveCharacterMeta() {
    if (!activeCharacter) {
      return
    }

    const nextCode = trimmedCharacterCodeDraft
    const nextDisplayName = characterDisplayNameDraft.trim()
    const previousCode = activeCharacter.code
    const isCodeChanged = nextCode !== previousCode

    if (!nextCode) {
      setStatus({
        kind: 'error',
        message: '캐릭터 코드를 입력해야 합니다.',
      })
      return
    }

    if (hasInvalidCharacterCodeDraft) {
      setStatus({
        kind: 'error',
        message: '캐릭터 코드에는 \\ / : * ? " < > | 같은 경로 문자를 사용할 수 없습니다.',
      })
      return
    }

    if (
      isCodeChanged &&
      chatbot.characters.some((character) => character.code === nextCode)
    ) {
      setStatus({
        kind: 'error',
        message: `이미 등록된 캐릭터 코드입니다: ${nextCode}`,
      })
      return
    }

    if (isCodeChanged && projectPath && window.electronAPI?.renameCharacterFolder) {
      try {
        await window.electronAPI.renameCharacterFolder(projectPath, previousCode, nextCode)
      } catch {
        setStatus({
          kind: 'error',
          message: `${previousCode} 폴더를 ${nextCode} 폴더로 변경하지 못했습니다.`,
        })
        return
      }
    }

    updateChatbot((chatbot) => ({
      ...chatbot,
      activeCharacterCode:
        chatbot.activeCharacterCode === previousCode ? nextCode : chatbot.activeCharacterCode,
      characters: chatbot.characters.map((character) => {
        if (character.code !== previousCode) {
          return character
        }

        return {
          ...character,
          code: nextCode,
          displayName: nextDisplayName,
          slots: character.slots.map((slot) => ({
            ...slot,
            imagePath:
              isCodeChanged && slot.imagePath?.startsWith(`${previousCode}/`)
                ? `${nextCode}/${slot.imagePath.slice(previousCode.length + 1)}`
                : slot.imagePath,
          })),
        }
      }),
    }))

    if (isCodeChanged) {
      setImagePreviews({})
      setFailedImageKeys(new Set())
    }

    setStatus({
      kind: 'success',
      message: isCodeChanged
        ? `${previousCode} 캐릭터 코드를 ${nextCode}로 변경했습니다.`
        : `${getCharacterDisplayLabel({ ...activeCharacter, displayName: nextDisplayName })} 표시 정보를 저장했습니다.`,
    })
  }

  async function handleCopyActiveProfileText() {
    if (!activeCharacter) {
      setStatus({
        kind: 'error',
        message: '텍스트로 추출할 캐릭터가 없습니다.',
      })
      return
    }

    const text = getProfileExportText(activeCharacter)

    if (!activeCharacter.profileFields.some((field) => field.name.trim() || field.value.trim())) {
      setStatus({
        kind: 'warning',
        message: '추출할 시트 항목이 없습니다.',
      })
      return
    }

    try {
      await copyTextToClipboard(text)
      setStatus({
        kind: 'success',
        message: `${getCharacterDisplayLabel(activeCharacter)} 시트를 텍스트로 복사했습니다.`,
      })
    } catch {
      setStatus({
        kind: 'error',
        message: '시트 텍스트를 클립보드에 복사하지 못했습니다.',
      })
    }
  }

  async function handleCopyUserGuidelines() {
    const text = getAppGuidelinesText()

    try {
      await copyTextToClipboard(text)
      setStatus({
        kind: 'success',
        message: '유저 가이드라인을 클립보드에 복사했습니다.',
      })
    } catch {
      setStatus({
        kind: 'error',
        message: '유저 가이드라인 복사에 실패했습니다.',
      })
    }
  }

  function applyProfilePresetToCharacter(presetId: string) {
    if (!activeCharacterCode) {
      setStatus({
        kind: 'error',
        message: '먼저 캐릭터 코드를 추가해야 프리셋을 할당할 수 있습니다.',
      })
      return
    }

    if (!presetId) {
      updateChatbot((chatbot) => ({
        ...chatbot,
        characters: chatbot.characters.map((character) =>
          character.code === activeCharacterCode
            ? { ...character, profilePresetId: undefined }
            : character,
        ),
      }))
      setStatus({
        kind: 'success',
        message: `${activeCharacterCode} 캐릭터의 프리셋 할당을 해제했습니다.`,
      })
      return
    }

    const preset = globalProfilePresets.find((preset) => preset.id === presetId)

    if (!preset) {
      return
    }

    updateChatbot((chatbot) => ({
      ...chatbot,
      characters: chatbot.characters.map((character) => {
        if (character.code !== activeCharacterCode) {
          return character
        }

        const existingFieldsByName = new Map(
          character.profileFields.map((field) => [field.name, field]),
        )
        const presetFields = preset.fields.map((fieldName) => {
          const existingField = existingFieldsByName.get(fieldName)

          return existingField ?? { id: createId('profile'), name: fieldName, value: '' }
        })
        const additionalFields = character.profileFields.filter(
          (field) => !preset.fields.includes(field.name),
        )

        return {
          ...character,
          profilePresetId: preset.id,
          profileFields: [...presetFields, ...additionalFields],
        }
      }),
    }))
    setStatus({
      kind: 'success',
      message: `${activeCharacterCode} 캐릭터에 ${preset.name} 프리셋을 할당했습니다.`,
    })
  }

  function handleCreateProfilePreset() {
    const name = newPresetName.trim()
    const fields = parsePresetFields(newPresetFieldsText)

    if (!name) {
      setStatus({
        kind: 'error',
        message: '프리셋 이름을 입력해야 합니다.',
      })
      return
    }

    if (fields.length === 0) {
      setStatus({
        kind: 'error',
        message: '프리셋 항목을 1개 이상 입력해야 합니다.',
      })
      return
    }

    if (
      globalProfilePresets.some(
        (preset) => getProfilePresetNameKey(preset.name) === getProfilePresetNameKey(name),
      )
    ) {
      setStatus({
        kind: 'error',
        message: `이미 같은 이름의 프리셋이 있습니다: ${name}`,
      })
      return
    }

    setGlobalProfilePresets((presets) =>
      mergeProfilePresets([...presets, { id: createId('preset'), name, fields }]),
    )
    setNewPresetName('')
    setNewPresetFieldsText('')
    setStatus({
      kind: 'success',
      message: `${name} 전역 항목 프리셋을 만들었습니다.`,
    })
  }

  function handleDeleteProfilePreset(presetId: string) {
    const preset = globalProfilePresets.find((preset) => preset.id === presetId)
    const presetNameKey = preset ? getProfilePresetNameKey(preset.name) : ''

    setGlobalProfilePresets((presets) => presets.filter((preset) => preset.id !== presetId))
    setProjects((currentProjects) =>
      currentProjects.map((project) => ({
        ...project,
        chatbot: {
          ...project.chatbot,
          profilePresets: project.chatbot.profilePresets.filter(
            (projectPreset) =>
              projectPreset.id !== presetId &&
              getProfilePresetNameKey(projectPreset.name) !== presetNameKey,
          ),
          characters: project.chatbot.characters.map((character) =>
            character.profilePresetId === presetId
              ? { ...character, profilePresetId: undefined }
              : character,
          ),
        },
      })),
    )
    setStatus({
      kind: 'success',
      message: `${preset?.name ?? '항목'} 프리셋을 삭제했습니다.`,
    })
  }

  function handleFocusProject(projectId: string) {
    setActiveProjectId(projectId)
  }

  function handleCloseProject(projectId: string) {
    if (projects.length === 1) {
      setStatus({
        kind: 'warning',
        message: '프로젝트 탭은 최소 1개가 필요합니다.',
      })
      return
    }

    const closedProjectIndex = projects.findIndex((project) => project.id === projectId)
    const remainingProjects = projects.filter((project) => project.id !== projectId)
    setProjects(remainingProjects)

    if (activeProjectId === projectId) {
      const nextProject =
        remainingProjects[Math.max(0, closedProjectIndex - 1)] ?? remainingProjects[0]
      setActiveProjectId(nextProject.id)
    }
  }

  async function handleExportProjectBackup() {
    if (!projectPath) {
      setStatus({
        kind: 'error',
        message: '백업하려면 먼저 프로젝트 폴더를 지정해야 합니다.',
      })
      return
    }

    if (!window.electronAPI?.exportProjectBackup || !window.electronAPI.saveProjectState) {
      setStatus({
        kind: 'error',
        message: '백업 저장은 Electron 앱에서 사용할 수 있습니다.',
      })
      return
    }

    try {
      setAutoSaveStatus('saving')
      await window.electronAPI.saveProjectState(projectPath, projectState)
      setAutoSaveStatus('saved')

      const result = await window.electronAPI.exportProjectBackup({
        projectId: activeProject.id,
        projectPath,
        projectName: getProjectDisplayName(activeProject),
        state: projectState,
        globalProfilePresets,
      })

      if (result.canceled) {
        return
      }

      setStatus({
        kind: 'success',
        message: `백업을 저장했습니다. 포함 파일 ${result.fileCount ?? 0}개`,
      })
    } catch {
      setAutoSaveStatus('error')
      setStatus({
        kind: 'error',
        message: '백업 저장에 실패했습니다.',
      })
    }
  }

  async function handleExportWorkspaceBackup() {
    if (!window.electronAPI?.exportWorkspaceBackup) {
      setStatus({
        kind: 'error',
        message: '전체 백업 저장은 Electron 앱에서 사용할 수 있습니다.',
      })
      return
    }

    try {
      setAutoSaveStatus('saving')

      if (window.electronAPI.saveProjectState) {
        await Promise.all(
          projects
            .filter((project) => Boolean(project.projectPath))
            .map((project) =>
              window.electronAPI?.saveProjectState(
                project.projectPath,
                createProjectPayload(project.chatbot),
              ),
            ),
        )
      }

      setAutoSaveStatus('saved')

      const result = await window.electronAPI.exportWorkspaceBackup({
        activeProjectId,
        projects: projects.map((project) => ({
          id: project.id,
          projectPath: project.projectPath,
          projectName: getProjectDisplayName(project),
          state: createProjectPayload(project.chatbot),
        })),
        globalProfilePresets,
      })

      if (result.canceled) {
        return
      }

      setStatus({
        kind: 'success',
        message: `전체 백업을 저장했습니다. 프로젝트 ${result.projectCount ?? projects.length}개 / 포함 파일 ${result.fileCount ?? 0}개`,
      })
    } catch {
      setAutoSaveStatus('error')
      setStatus({
        kind: 'error',
        message: '전체 백업 저장에 실패했습니다.',
      })
    }
  }

  async function handleImportProjectBackup() {
    if (!window.electronAPI?.importProjectBackup) {
      setStatus({
        kind: 'error',
        message: '백업 가져오기는 Electron 앱에서 사용할 수 있습니다.',
      })
      return
    }

    try {
      const result = await window.electronAPI.importProjectBackup()

      if (result.canceled || !result.path) {
        return
      }

      const importedProjects =
        result.projects && result.projects.length > 0
          ? result.projects
          : result.path
            ? [
                {
                  sourceId: result.activeProjectSourceId ?? '',
                  path: result.path,
                  state: result.state,
                  characterFolders: result.characterFolders ?? [],
                  fileCount: result.fileCount ?? 0,
                },
              ]
            : []
      const normalizedImports = importedProjects
        .map((project) => ({
          ...project,
          payload: normalizeProjectPayload(project.state),
        }))
        .filter(
          (project): project is typeof project & { payload: ProjectPayload } =>
            Boolean(project.payload),
        )

      if (normalizedImports.length === 0) {
        setStatus({
          kind: 'error',
          message: '백업 안의 프로젝트 데이터를 읽지 못했습니다.',
        })
        return
      }

      const importedGlobalProfilePresets = normalizeProfilePresets({
        profilePresets: result.globalProfilePresets,
      })
      const importedProfilePresets = [
        ...normalizedImports.flatMap((project) => project.payload.chatbot.profilePresets),
        ...importedGlobalProfilePresets,
      ]
      const nextGlobalProfilePresets = mergeProfilePresets([
        ...globalProfilePresets,
        ...importedProfilePresets,
      ])
      const nextProjects = remapProjectPresetAssignments(
        normalizedImports.map((project) =>
          createProjectWorkspace(
            project.path,
            mergeChatbotWithCharacterFolders(project.payload.chatbot, project.characterFolders),
            createId('project'),
          ),
        ),
        nextGlobalProfilePresets,
      )
      const activeImportedIndex = normalizedImports.findIndex(
        (project) => project.sourceId && project.sourceId === result.activeProjectSourceId,
      )
      const nextActiveProject = nextProjects[Math.max(activeImportedIndex, 0)] ?? nextProjects[0]

      if (importedProfilePresets.length > 0) {
        setGlobalProfilePresets(nextGlobalProfilePresets)
      }
      setProjects((currentProjects) => [...currentProjects, ...nextProjects])
      setActiveProjectId(nextActiveProject.id)
      setImagePreviews({})
      setFailedImageKeys(new Set())
      setAutoSaveStatus('idle')
      setActiveTool('profile')
      setStatus({
        kind: 'success',
        message: `백업을 새 프로젝트로 가져왔습니다. 프로젝트 ${nextProjects.length}개 / 복원 파일 ${result.fileCount ?? 0}개`,
      })
    } catch {
      setStatus({
        kind: 'error',
        message: '백업 가져오기에 실패했습니다. 새 프로젝트 폴더는 비어 있어야 합니다.',
      })
    }
  }

  async function handleSelectProjectFolder() {
    if (!window.electronAPI?.selectProjectFolder) {
      setStatus({
        kind: 'error',
        message: '프로젝트 폴더 선택은 Electron 앱에서 사용할 수 있습니다.',
      })
      return
    }

    try {
      const result = await window.electronAPI.selectProjectFolder()

      if (result.canceled || !result.path) {
        return
      }

      const loadedProject = normalizeProjectPayload(result.state)
      const selectedPath = result.path
      const selectedComparablePath = getComparableProjectPath(selectedPath)
      const existingProject = projects.find(
        (project) => getComparableProjectPath(project.projectPath) === selectedComparablePath,
      )
      const shouldAttachCurrentDraft =
        !existingProject && !activeProject.projectPath && !loadedProject
      const nextProjectId =
        existingProject?.id ?? (shouldAttachCurrentDraft ? activeProject.id : createId('project'))
      const nextChatbot = mergeChatbotWithCharacterFolders(
        loadedProject?.chatbot ??
          (shouldAttachCurrentDraft
            ? activeProject.chatbot
            : createChatbot(getProjectFolderName(selectedPath) || '새 챗봇')),
        result.characterFolders,
      )
      const importedProfilePresets = loadedProject?.chatbot.profilePresets ?? []
      const nextGlobalProfilePresets = mergeProfilePresets([
        ...globalProfilePresets,
        ...importedProfilePresets,
      ])
      const [nextProject] = remapProjectPresetAssignments(
        [createProjectWorkspace(selectedPath, nextChatbot, nextProjectId)],
        nextGlobalProfilePresets,
      )

      if (importedProfilePresets.length > 0) {
        setGlobalProfilePresets(nextGlobalProfilePresets)
      }
      setProjects((currentProjects) => {
        if (existingProject) {
          return currentProjects.map((project) =>
            project.id === existingProject.id ? nextProject : project,
          )
        }

        if (shouldAttachCurrentDraft) {
          return currentProjects.map((project) =>
            project.id === activeProject.id ? nextProject : project,
          )
        }

        return [...currentProjects, nextProject]
      })
      setActiveProjectId(nextProject.id)
      setImagePreviews({})
      setFailedImageKeys(new Set())
      setAutoSaveStatus('idle')

      if (loadedProject) {
        setActiveTool('profile')
        setStatus({
          kind: 'success',
          message: '챗봇 프로젝트 폴더와 저장된 작업을 불러왔습니다.',
        })
        return
      }

      setActiveTool('profile')
      setStatus({
        kind: 'success',
        message: '챗봇 프로젝트 폴더가 지정되었습니다.',
      })
    } catch {
      setStatus({
        kind: 'error',
        message: '프로젝트 폴더를 열거나 프로젝트 파일을 읽는 중 문제가 발생했습니다.',
      })
    }
  }

  async function handleChangeActiveProjectFolder() {
    if (!window.electronAPI?.selectProjectFolder) {
      setStatus({
        kind: 'error',
        message: '프로젝트 폴더 선택은 Electron 앱에서 사용할 수 있습니다.',
      })
      return
    }

    try {
      const result = await window.electronAPI.selectProjectFolder()

      if (result.canceled || !result.path) {
        return
      }

      const selectedPath = result.path
      const selectedComparablePath = getComparableProjectPath(selectedPath)
      const activeComparablePath = getComparableProjectPath(activeProject.projectPath)
      const alreadyOpenProject = projects.find(
        (project) =>
          project.id !== activeProject.id &&
          getComparableProjectPath(project.projectPath) === selectedComparablePath,
      )

      if (alreadyOpenProject) {
        setActiveProjectId(alreadyOpenProject.id)
        setStatus({
          kind: 'warning',
          message: '선택한 폴더는 이미 다른 프로젝트 탭으로 열려 있어 해당 탭으로 이동했습니다.',
        })
        return
      }

      if (activeComparablePath && activeComparablePath === selectedComparablePath) {
        setStatus({
          kind: 'info',
          message: '현재 프로젝트에 이미 지정된 폴더입니다.',
        })
        return
      }

      updateActiveProject((project) => ({
        ...project,
        projectPath: selectedPath,
        chatbot: mergeChatbotWithCharacterFolders(
          {
            ...project.chatbot,
            title: getProjectFolderName(selectedPath) || project.chatbot.title,
          },
          result.characterFolders,
        ),
      }))
      setImagePreviews({})
      setFailedImageKeys(new Set())
      setAutoSaveStatus('idle')
      setStatus({
        kind: result.state ? 'warning' : 'success',
        message: result.state
          ? '저장 폴더를 변경했습니다. 선택한 폴더의 기존 etomo-tool 저장 파일은 현재 챗봇 내용으로 갱신됩니다.'
          : '현재 챗봇의 프로젝트 폴더를 변경했습니다.',
      })
    } catch {
      setStatus({
        kind: 'error',
        message: '프로젝트 폴더를 변경하는 중 문제가 발생했습니다.',
      })
    }
  }

  function handleApplyCodeText() {
    if (!activeCharacterCode) {
      setStatus({
        kind: 'error',
        message: '먼저 챗봇 시트에서 캐릭터 코드를 등록해야 격자를 생성할 수 있습니다.',
      })
      setActiveTool('profile')
      return
    }

    if (hasInvalidActiveCharacterCode) {
      setStatus({
        kind: 'error',
        message: '캐릭터 코드에는 \\ / : * ? " < > | 같은 경로 문자를 사용할 수 없습니다.',
      })
      setActiveTool('profile')
      return
    }

    const parsedItems = parseCodeText(chatbot.codeText)

    if (parsedItems.length === 0) {
      setStatus({
        kind: 'error',
        message: '이름=코드 형식의 항목을 1개 이상 입력해야 합니다.',
      })
      return
    }

    const duplicateCodes = findDuplicateCodes(parsedItems)

    if (duplicateCodes.length > 0) {
      setStatus({
        kind: 'error',
        message: `중복된 이미지 코드가 있습니다: ${duplicateCodes.join(', ')}`,
      })
      return
    }

    updateActiveCharacterSlots((slots) => {
      const previousSlotsByCode = new Map(slots.map((slot) => [getSlotKey(slot), slot]))

      return parsedItems.map(({ label, code }) =>
        createSlot(label, code, previousSlotsByCode.get(code)),
      )
    })
    setStatus({
      kind: 'success',
      message: `${parsedItems.length}개의 이미지 코드 항목을 적용했습니다.`,
    })
  }

  async function saveImageToSlot(slot: EmotionSlot, file: File) {
    if (!projectPath || !window.electronAPI?.saveImageFile) {
      setStatus({
        kind: 'error',
        message: '이미지를 저장하려면 먼저 프로젝트 폴더를 지정해야 합니다.',
      })
      return
    }

    if (!activeCharacterCode) {
      setStatus({
        kind: 'error',
        message: '이미지를 저장하려면 먼저 챗봇 시트에서 캐릭터 코드를 등록해야 합니다.',
      })
      setActiveTool('profile')
      return
    }

    if (hasInvalidActiveCharacterCode) {
      setStatus({
        kind: 'error',
        message: '캐릭터 코드에는 \\ / : * ? " < > | 같은 경로 문자를 사용할 수 없습니다.',
      })
      setActiveTool('profile')
      return
    }

    try {
      const slotKey = getSlotKey(slot)

      setSavingSlotId(slotKey)
      const dataUrl = await fileToDataUrl(file)
      const result = await window.electronAPI.saveImageFile({
        projectPath,
        characterCode: activeCharacterCode,
        code: slot.code,
        fileName: file.name,
        dataUrl,
      })

      setImagePreviews((currentPreviews) => ({
        ...currentPreviews,
        [previewKey(activeProject.id, activeCharacterCode, slotKey)]: dataUrl,
      }))
      setFailedImageKeys((current) => {
        const nextFailedKeys = new Set(current)
        nextFailedKeys.delete(previewKey(activeProject.id, activeCharacterCode, slotKey))
        return nextFailedKeys
      })
      updateActiveCharacterSlots((slots) =>
        slots.map((currentSlot) =>
          getSlotKey(currentSlot) === slotKey
            ? {
                ...currentSlot,
                imagePath: result.relativePath,
                imageName: file.name,
                updatedAt: new Date().toISOString(),
              }
            : currentSlot,
        ),
      )
      setStatus({
        kind: 'success',
        message: `${slot.label} 이미지를 상태 코드 파일명 ${slot.code}로 저장했습니다.`,
      })
    } catch {
      setStatus({
        kind: 'error',
        message: '이미지 저장에 실패했습니다.',
      })
    } finally {
      setSavingSlotId(null)
    }
  }

  async function deleteImageFromSlot(slot: EmotionSlot) {
    const slotKey = getSlotKey(slot)
    const previewMapKey = previewKey(activeProject.id, activeCharacterCode, slotKey)

    if (!slot.imagePath) {
      setImagePreviews((currentPreviews) => {
        const nextPreviews = { ...currentPreviews }
        delete nextPreviews[previewMapKey]
        return nextPreviews
      })
      setDeleteTargetSlotKey(null)
      return
    }

    if (!projectPath || !window.electronAPI?.deleteImageFile) {
      setStatus({
        kind: 'error',
        message: '이미지를 삭제하려면 먼저 프로젝트 폴더를 지정해야 합니다.',
      })
      return
    }

    try {
      setDeletingSlotId(slotKey)
      await window.electronAPI.deleteImageFile(projectPath, slot.imagePath)
      setImagePreviews((currentPreviews) => {
        const nextPreviews = { ...currentPreviews }
        delete nextPreviews[previewMapKey]
        return nextPreviews
      })
      setFailedImageKeys((current) => {
        const nextFailedKeys = new Set(current)
        nextFailedKeys.delete(previewMapKey)
        return nextFailedKeys
      })
      updateActiveCharacterSlots((slots) =>
        slots.map((currentSlot) =>
          getSlotKey(currentSlot) === slotKey
            ? {
                ...currentSlot,
                imagePath: undefined,
                imageName: undefined,
                updatedAt: undefined,
              }
            : currentSlot,
        ),
      )
      setStatus({
        kind: 'success',
        message: `${slot.label} 이미지 등록을 해제했습니다.`,
      })
    } catch {
      setStatus({
        kind: 'error',
        message: '이미지 삭제에 실패했습니다.',
      })
    } finally {
      setDeletingSlotId(null)
      setDeleteTargetSlotKey(null)
    }
  }

  function handleSlotDrop(event: DragEvent<HTMLElement>, slot: EmotionSlot) {
    event.preventDefault()
    const file = pickImageFile(event.dataTransfer.files)

    if (file) {
      void saveImageToSlot(slot, file)
    }
  }

  function handleSlotPaste(event: ClipboardEvent<HTMLElement>, slot: EmotionSlot) {
    const file = pickClipboardImage(event)

    if (file) {
      event.preventDefault()
      void saveImageToSlot(slot, file)
    }
  }

  function handleSlotFileChange(event: ChangeEvent<HTMLInputElement>, slot: EmotionSlot) {
    const file = pickImageFile(event.target.files ?? [])

    if (file) {
      void saveImageToSlot(slot, file)
    }

    event.currentTarget.value = ''
  }

  function handleEditorChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const value = event.currentTarget.value
    const selectionStart = event.currentTarget.selectionStart

    setCursorIndex(selectionStart)
    updateChatbot((chatbot) => ({
      ...chatbot,
      editorText: value,
      promptTabs: chatbot.promptTabs.map((tab) =>
        tab.id === chatbot.activePromptTabId
          ? { ...tab, text: value, updatedAt: new Date().toISOString() }
          : tab,
      ),
    }))
  }

  function insertCompletion(match = completionMatch) {
    if (!match) {
      return
    }

    const nextText = `${activePromptText.slice(0, match.start)}${match.rule.replacement}${activePromptText.slice(match.end)}`
    const nextCursorIndex = match.start + match.rule.replacement.length

    updateChatbot((chatbot) => ({
      ...chatbot,
      editorText: nextText,
      promptTabs: chatbot.promptTabs.map((tab) =>
        tab.id === chatbot.activePromptTabId
          ? { ...tab, text: nextText, updatedAt: new Date().toISOString() }
          : tab,
      ),
    }))
    setCompletionSuggestionSelected(false)
    setCursorIndex(nextCursorIndex)
    window.requestAnimationFrame(() => {
      editorRef.current?.focus()
      editorRef.current?.setSelectionRange(nextCursorIndex, nextCursorIndex)
    })
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (completionMatch && event.key === 'ArrowDown') {
      event.preventDefault()
      setCompletionSuggestionSelected(true)
      return
    }

    if (completionMatch && event.key === 'ArrowUp') {
      event.preventDefault()
      setCompletionSuggestionSelected(false)
      return
    }

    if (completionMatch && completionSuggestionSelected && event.key === 'Enter') {
      event.preventDefault()
      insertCompletion(completionMatch)
      return
    }

    if (completionMatch && event.key === 'Escape') {
      event.preventDefault()
      setCompletionSuggestionSelected(false)
      return
    }

    if (event.key === 'Tab' && completionMatch) {
      event.preventDefault()
      insertCompletion(completionMatch)
    }
  }

  function updateCompletionRule(
    ruleId: string,
    field: keyof Pick<CompletionRule, 'trigger' | 'replacement'>,
    value: string,
  ) {
    updateChatbot((chatbot) => ({
      ...chatbot,
      completions: chatbot.completions.map((rule) =>
        rule.id === ruleId ? { ...rule, [field]: value } : rule,
      ),
    }))
  }

  function updatePromptFontSize(value: string) {
    const numericValue = value.trim() ? Number(value) : chatbot.promptFontSize

    if (!Number.isFinite(numericValue)) {
      setPromptFontSizeText(String(chatbot.promptFontSize))
      return
    }

    const nextValue = normalizePromptFontSize(numericValue)

    updateChatbot((chatbot) => ({
      ...chatbot,
      promptFontSize: nextValue,
    }))
    setPromptFontSizeText(String(nextValue))
  }

  function updateImageCardSize(value: string) {
    const numericValue = value.trim() ? Number(value) : chatbot.imageCardSize

    if (!Number.isFinite(numericValue)) {
      setImageCardSizeText(String(chatbot.imageCardSize))
      return
    }

    const nextValue = normalizeImageCardSize(numericValue)

    updateChatbot((chatbot) => ({
      ...chatbot,
      imageCardSize: nextValue,
    }))
    setImageCardSizeText(String(nextValue))
  }

  function updateLoreCard(
    cardId: string,
    field: keyof Pick<LoreCard, 'title' | 'body' | 'keywords' | 'collapsed'>,
    value: string | string[] | boolean,
  ) {
    updateChatbot((chatbot) => ({
      ...chatbot,
      lorebook: chatbot.lorebook.map((card) =>
        card.id === cardId ? { ...card, [field]: value } : card,
      ),
    }))
  }

  function updateLoreKeywordsFromText(cardId: string, value: string) {
    setLoreKeywordDrafts((drafts) => ({
      ...drafts,
      [cardId]: value,
    }))
    updateLoreCard(cardId, 'keywords', parseKeywords(value))
  }

  function commitLoreKeywordDraft(cardId: string) {
    setLoreKeywordDrafts((drafts) => {
      const nextDrafts = { ...drafts }
      delete nextDrafts[cardId]

      return nextDrafts
    })
  }

  function updateLoreCardSize(
    field: keyof Pick<ChatbotState, 'loreCardWidth' | 'loreCardHeight'>,
    value: string,
  ) {
    const fallbackValue =
      field === 'loreCardWidth' ? chatbot.loreCardWidth : chatbot.loreCardHeight
    const numericValue = value.trim() ? Number(value) : fallbackValue

    if (!Number.isFinite(numericValue)) {
      if (field === 'loreCardWidth') {
        setLoreCardWidthText(String(fallbackValue))
      } else {
        setLoreCardHeightText(String(fallbackValue))
      }

      return
    }

    const nextValue =
      field === 'loreCardWidth'
        ? normalizeLoreCardSize(
            numericValue,
            LORE_CARD_DEFAULT_WIDTH,
            LORE_CARD_MIN_WIDTH,
            LORE_CARD_MAX_WIDTH,
          )
        : normalizeLoreCardSize(
            numericValue,
            LORE_CARD_DEFAULT_HEIGHT,
            LORE_CARD_MIN_HEIGHT,
            LORE_CARD_MAX_HEIGHT,
          )

    updateChatbot((chatbot) => ({
      ...chatbot,
      [field]: nextValue,
    }))

    if (field === 'loreCardWidth') {
      setLoreCardWidthText(String(nextValue))
    } else {
      setLoreCardHeightText(String(nextValue))
    }
  }

  function updateLoreGridColumns(value: string) {
    const numericValue = value.trim() ? Number(value) : 0

    if (!Number.isFinite(numericValue)) {
      setLoreGridColumnsText(String(chatbot.loreGridColumns))
      return
    }

    const nextValue = normalizeLoreGridColumns(numericValue)

    updateChatbot((chatbot) => ({
      ...chatbot,
      loreGridColumns: nextValue,
    }))
    setLoreGridColumnsText(String(nextValue))
  }

  function reorderLoreCard(sourceCardId: string, targetCardId: string) {
    if (sourceCardId === targetCardId) {
      return
    }

    updateChatbot((chatbot) => {
      const sourceIndex = chatbot.lorebook.findIndex((card) => card.id === sourceCardId)
      const targetIndex = chatbot.lorebook.findIndex((card) => card.id === targetCardId)

      if (sourceIndex === -1 || targetIndex === -1) {
        return chatbot
      }

      const nextLorebook = [...chatbot.lorebook]
      const [movedCard] = nextLorebook.splice(sourceIndex, 1)
      nextLorebook.splice(targetIndex, 0, movedCard)

      return {
        ...chatbot,
        lorebook: nextLorebook,
      }
    })
  }

  function moveLoreCard(cardId: string, direction: -1 | 1) {
    updateChatbot((chatbot) => {
      const currentIndex = chatbot.lorebook.findIndex((card) => card.id === cardId)
      const nextIndex = currentIndex + direction

      if (
        currentIndex === -1 ||
        nextIndex < 0 ||
        nextIndex >= chatbot.lorebook.length
      ) {
        return chatbot
      }

      const nextLorebook = [...chatbot.lorebook]
      const [movedCard] = nextLorebook.splice(currentIndex, 1)
      nextLorebook.splice(nextIndex, 0, movedCard)

      return {
        ...chatbot,
        lorebook: nextLorebook,
      }
    })
  }

  function handleLoreCardDragStart(event: DragEvent<HTMLElement>, cardId: string) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', cardId)
    setDraggingLoreCardId(cardId)
  }

  function handleLoreCardDrop(event: DragEvent<HTMLElement>, targetCardId: string) {
    event.preventDefault()
    const sourceCardId = event.dataTransfer.getData('text/plain') || draggingLoreCardId

    if (sourceCardId) {
      reorderLoreCard(sourceCardId, targetCardId)
    }

    setDraggingLoreCardId(null)
    setLoreDropTargetId(null)
  }

  function updateProfileField(
    fieldId: string,
    fieldName: keyof Pick<ProfileField, 'name' | 'value'>,
    value: string,
  ) {
    updateActiveCharacterProfileFields((profileFields) =>
      profileFields.map((field) =>
        field.id === fieldId ? { ...field, [fieldName]: value } : field,
      ),
    )
  }

  function handleAddPromptTab() {
    const nextTab = createPromptTab(`프롬프트 ${chatbot.promptTabs.length + 1}`)

    updateChatbot((chatbot) => ({
      ...chatbot,
      editorText: nextTab.text,
      activePromptTabId: nextTab.id,
      promptTabs: [...chatbot.promptTabs, nextTab],
    }))
    setCursorIndex(0)
    setCompletionSuggestionSelected(false)
  }

  function handleSelectPromptTab(tabId: string) {
    const nextActiveTab = chatbot.promptTabs.find((tab) => tab.id === tabId)

    if (!nextActiveTab) {
      return
    }

    updateChatbot((chatbot) => ({
      ...chatbot,
      editorText: nextActiveTab.text,
      activePromptTabId: nextActiveTab.id,
    }))
    setCursorIndex(0)
    setCompletionSuggestionSelected(false)
  }

  function handleRenamePromptTab(tabId: string, title: string) {
    updateChatbot((chatbot) => ({
      ...chatbot,
      promptTabs: chatbot.promptTabs.map((tab) =>
        tab.id === tabId ? { ...tab, title, updatedAt: new Date().toISOString() } : tab,
      ),
    }))
  }

  function closePromptTab(tabId: string) {
    if (chatbot.promptTabs.length <= 1) {
      setStatus({
        kind: 'warning',
        message: '프롬프트 탭은 최소 1개가 필요합니다.',
      })
      return
    }

    const closedTabIndex = chatbot.promptTabs.findIndex((tab) => tab.id === tabId)
    const remainingTabs = chatbot.promptTabs.filter((tab) => tab.id !== tabId)
    const nextActiveTab =
      chatbot.activePromptTabId === tabId
        ? remainingTabs[Math.max(0, closedTabIndex - 1)] ?? remainingTabs[0]
        : remainingTabs.find((tab) => tab.id === chatbot.activePromptTabId) ?? remainingTabs[0]

    updateChatbot((chatbot) => ({
      ...chatbot,
      editorText: nextActiveTab.text,
      activePromptTabId: nextActiveTab.id,
      promptTabs: remainingTabs,
    }))
    setCursorIndex(0)
    setCompletionSuggestionSelected(false)
  }

  function handleClosePromptTab(tabId: string) {
    if (chatbot.promptTabs.length <= 1) {
      closePromptTab(tabId)
      return
    }

    const targetTab = chatbot.promptTabs.find((tab) => tab.id === tabId)

    if (!targetTab) {
      return
    }

    if (targetTab.text.length > 0) {
      setPromptCloseTargetId(tabId)
      return
    }

    closePromptTab(tabId)
  }

  function confirmClosePromptTab() {
    if (!promptCloseTargetId) {
      return
    }

    closePromptTab(promptCloseTargetId)
    setPromptCloseTargetId(null)
  }

  function renderOverviewTool() {
    const totalSlots = chatbot.characters.reduce(
      (total, character) => total + character.slots.length,
      0,
    )
    const registeredImages = chatbot.characters.reduce(
      (total, character) =>
        total + character.slots.filter((slot) => Boolean(slot.imagePath)).length,
      0,
    )
    const missingImages = totalSlots - registeredImages
    const parsedImageCodes = parseCodeText(chatbot.codeText)
    const invalidCodeLines = findInvalidCodeLines(chatbot.codeText)
    const activeProjectName = getProjectDisplayName(activeProject)

    return (
      <>
        <div className="section-heading">
          <ClipboardList size={18} aria-hidden="true" />
          <h2 id="overview-heading">전체 정리</h2>
        </div>

        <div className="overview-stat-grid" aria-label="프로젝트 요약">
          <article className="overview-stat">
            <span>챗봇</span>
            <strong>{activeProjectName}</strong>
            <small>{projectPath || '프로젝트 폴더 미지정'}</small>
          </article>
          <article className="overview-stat">
            <span>캐릭터</span>
            <strong>{chatbot.characters.length.toLocaleString()}명</strong>
            <small>{activeCharacterCode || '선택 없음'}</small>
          </article>
          <article className="overview-stat">
            <span>이미지</span>
            <strong>
              {registeredImages.toLocaleString()} / {totalSlots.toLocaleString()}
            </strong>
            <small>{missingImages > 0 ? `${missingImages}개 미등록` : '누락 없음'}</small>
          </article>
          <article className="overview-stat">
            <span>프롬프트</span>
            <strong>{currentTextLength.toLocaleString()}자</strong>
            <small>
              {chatbot.tokenLimit > 0 ? `제한 ${chatbot.tokenLimit.toLocaleString()}자` : '제한 없음'}
            </small>
          </article>
        </div>

        <div className="overview-layout">
          <section className="overview-section overview-section-wide">
            {chatbot.characters.length === 0 ? (
              <div className="overview-empty">
                <strong>등록된 캐릭터 코드가 없습니다.</strong>
                <button className="primary-button" type="button" onClick={() => setActiveTool('profile')}>
                  <Table2 size={16} aria-hidden="true" />
                  챗봇 시트
                </button>
              </div>
            ) : (
              <div className="overview-character-list">
                {chatbot.characters.map((character) => {
                  const savedSlots = character.slots.filter((slot) => Boolean(slot.imagePath))
                  const missingSlots = character.slots.filter((slot) => !slot.imagePath)
                  const assignedPreset = character.profilePresetId
                    ? globalProfilePresets.find(
                        (preset) => preset.id === character.profilePresetId,
                      )
                    : undefined

                  return (
                    <article className="overview-character-row" key={character.code}>
                      <div className="overview-character-main">
                        <strong>{getCharacterDisplayLabel(character)}</strong>
                        <span>
                          {character.code} / 시트 {character.profileFields.length}개 / 이미지 {savedSlots.length}
                          개 등록 / 전체 {character.slots.length}개
                        </span>
                      </div>
                      <div className="overview-chip-row">
                        <span>{assignedPreset?.name ?? '프리셋 없음'}</span>
                        {missingSlots.length > 0 ? (
                          <span className="warning-chip">{missingSlots.length}개 누락</span>
                        ) : (
                          <span>이미지 완료</span>
                        )}
                      </div>
                      {missingSlots.length > 0 && (
                        <div className="overview-missing-list">
                          {missingSlots.slice(0, 6).map((slot) => (
                            <span key={getSlotKey(slot)}>
                              {slot.label}={slot.code}
                            </span>
                          ))}
                          {missingSlots.length > 6 && <span>+{missingSlots.length - 6}</span>}
                        </div>
                      )}
                      <div className="overview-action-row">
                        <button
                          className="icon-text-button"
                          type="button"
                          onClick={() => {
                            handleSelectCharacterCode(character.code)
                            setActiveTool('profile')
                          }}
                        >
                          <Table2 size={15} aria-hidden="true" />
                          시트
                        </button>
                        <button
                          className="icon-text-button"
                          type="button"
                          onClick={() => {
                            handleSelectCharacterCode(character.code)
                            setActiveTool('images')
                          }}
                        >
                          <Grid3X3 size={15} aria-hidden="true" />
                          이미지
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <section className="overview-section">
            <div className="subsection-heading">
              <ClipboardPaste size={17} aria-hidden="true" />
              <h3>유저 가이드라인</h3>
            </div>
            <div className="overview-detail-list">
              <span>{APP_GUIDELINE_SECTIONS.length.toLocaleString()}개 항목</span>
              <span>읽기 전용</span>
            </div>
            <button className="icon-text-button" type="button" onClick={() => setActiveTool('guidelines')}>
              <ClipboardPaste size={15} aria-hidden="true" />
              가이드라인으로 이동
            </button>
          </section>

          <section className="overview-section">
            <div className="subsection-heading">
              <Grid3X3 size={17} aria-hidden="true" />
              <h3>이미지 코드</h3>
            </div>
            <div className="overview-detail-list">
              <span>기준 코드 {parsedImageCodes.length.toLocaleString()}개</span>
              <span>{invalidCodeLines.length > 0 ? `${invalidCodeLines.length}행 오류` : '형식 정상'}</span>
              <span>저장 경로 {activeCharacterFolderPath}/상태코드.확장자</span>
            </div>
            <button className="icon-text-button" type="button" onClick={() => setActiveTool('images')}>
              <Grid3X3 size={15} aria-hidden="true" />
              이미지 코드로 이동
            </button>
          </section>

          <section className="overview-section">
            <div className="subsection-heading">
              <FileText size={17} aria-hidden="true" />
              <h3>프롬프트</h3>
            </div>
            <div className="overview-detail-list">
              <span>탭 {chatbot.promptTabs.length.toLocaleString()}개</span>
              <span>현재 {activePromptTab?.title.trim() || '이름 없는 탭'}</span>
              <span>{currentTextLength.toLocaleString()}자</span>
              <span>{isOverTextLimit ? '제한 초과' : '글자 수 정상'}</span>
              <span>자동완성 {chatbot.completions.length.toLocaleString()}개</span>
            </div>
            <button className="icon-text-button" type="button" onClick={() => setActiveTool('editor')}>
              <FileText size={15} aria-hidden="true" />
              프롬프트로 이동
            </button>
          </section>

          <section className="overview-section">
            <div className="subsection-heading">
              <BookOpen size={17} aria-hidden="true" />
              <h3>로어북</h3>
            </div>
            <div className="overview-detail-list">
              <span>카드 {chatbot.lorebook.length.toLocaleString()}개</span>
              <span>
                호출어{' '}
                {chatbot.lorebook
                  .reduce((total, card) => total + card.keywords.length, 0)
                  .toLocaleString()}
                개
              </span>
              <span>
                본문 입력{' '}
                {chatbot.lorebook.filter((card) => card.body.trim()).length.toLocaleString()}개
              </span>
            </div>
            <button className="icon-text-button" type="button" onClick={() => setActiveTool('lorebook')}>
              <BookOpen size={15} aria-hidden="true" />
              로어북으로 이동
            </button>
          </section>

          <section className="overview-section">
            <div className="subsection-heading">
              <Table2 size={17} aria-hidden="true" />
              <h3>전역 프리셋</h3>
            </div>
            <div className="overview-detail-list">
              <span>{globalProfilePresets.length.toLocaleString()}개 사용 가능</span>
              <span>
                할당됨{' '}
                {chatbot.characters
                  .filter((character) => Boolean(character.profilePresetId))
                  .length.toLocaleString()}
                명
              </span>
            </div>
            <button className="icon-text-button" type="button" onClick={() => setActiveTool('profile')}>
              <Table2 size={15} aria-hidden="true" />
              시트로 이동
            </button>
          </section>
        </div>
      </>
    )
  }

  function renderGuidelinesTool() {
    const guidelineText = getAppGuidelinesText()
    const guidelineLength = getTextLength(guidelineText)

    return (
      <>
        <div className="section-heading">
          <ClipboardPaste size={18} aria-hidden="true" />
          <h2 id="guidelines-heading">유저 가이드라인</h2>
          <button
            className="icon-text-button"
            type="button"
            onClick={() => void handleCopyUserGuidelines()}
            title="유저 가이드라인 복사"
          >
            <FileText size={15} aria-hidden="true" />
            복사
          </button>
        </div>

        <div className="guidelines-workspace">
          <div className="guidelines-document" aria-label="유저 가이드라인 문서">
            {APP_GUIDELINE_SECTIONS.map((section) => (
              <section className="guideline-card" key={section.title}>
                <h3>{section.title}</h3>
                <ol>
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              </section>
            ))}
          </div>

          <aside className="guidelines-side-panel" aria-label="가이드라인 정보">
            <div className="guidelines-stat-list">
              <div>
                <span>항목</span>
                <strong>{APP_GUIDELINE_SECTIONS.length.toLocaleString()}</strong>
              </div>
              <div>
                <span>단계</span>
                <strong>{APP_GUIDELINE_QUICK_STEPS.length.toLocaleString()}</strong>
              </div>
              <div>
                <span>글자</span>
                <strong>{guidelineLength.toLocaleString()}</strong>
              </div>
            </div>

            <div className="guidelines-summary" aria-label="권장 작업 순서">
              <strong>권장 작업 순서</strong>
              <ol>
                {APP_GUIDELINE_QUICK_STEPS.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          </aside>
        </div>
      </>
    )
  }

  function renderImageTool() {
    return (
      <>
        <div className="section-heading">
          <Grid3X3 size={18} aria-hidden="true" />
          <h2 id="image-code-heading">이미지 코드</h2>
          <label className="image-card-size-control">
            <span>카드</span>
            <input
              aria-label="이미지 코드 카드 크기"
              inputMode="numeric"
              max={IMAGE_CARD_MAX_SIZE}
              min={IMAGE_CARD_MIN_SIZE}
              pattern="[0-9]*"
              type="text"
              value={imageCardSizeText}
              onBlur={() => updateImageCardSize(imageCardSizeText)}
              onChange={(event) => setImageCardSizeText(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  updateImageCardSize(imageCardSizeText)
                }
              }}
            />
          </label>
        </div>

        {chatbot.characters.length > 0 && (
          <div className="character-picker-row">
            <div className="character-picker-field">
              <span>캐릭터</span>
              <StyledDropdown
                ariaLabel="캐릭터 선택"
                value={activeCharacterCode}
                onChange={handleSelectCharacterCode}
                options={chatbot.characters.map((character) => ({
                  value: character.code,
                  label: getCharacterMenuLabel(character),
                }))}
              />
            </div>
            <span>{activeCharacterFolderPath}</span>
          </div>
        )}

        {(!activeCharacterCode || hasInvalidActiveCharacterCode) && (
          <div className="requirement-panel">
            <AlertTriangle size={22} aria-hidden="true" />
            <div>
              <strong>
                {!activeCharacterCode
                  ? '캐릭터 코드가 먼저 필요합니다.'
                  : '캐릭터 코드에 사용할 수 없는 문자가 있습니다.'}
              </strong>
              <p>
                챗봇 시트에서 캐릭터 코드를 등록한 뒤 이미지 코드 격자를 생성하고 이미지를
                저장할 수 있습니다.
              </p>
            </div>
            <button className="primary-button" type="button" onClick={() => setActiveTool('profile')}>
              <Table2 size={16} aria-hidden="true" />
              챗봇 시트
            </button>
          </div>
        )}

        {activeCharacterCode && !hasInvalidActiveCharacterCode && (
          <div className="image-tool-layout">
          <div className="code-panel">
            <textarea
              className="code-input"
              aria-label="이미지 코드 입력"
              spellCheck={false}
              wrap="off"
              value={chatbot.codeText}
              onChange={(event) => {
                const codeText = event.currentTarget.value
                updateChatbot((chatbot) => ({ ...chatbot, codeText }))
              }}
            />

            <div className="toolbar-row">
              <button className="primary-button" type="button" onClick={handleApplyCodeText}>
                <Grid3X3 size={16} aria-hidden="true" />
                적용
              </button>
              <span>{activeCharacterSlots.length}개 항목</span>
            </div>
          </div>

          {activeCharacterSlots.length === 0 ? (
            <div className="empty-tool-state">
              <Grid3X3 size={24} aria-hidden="true" />
              <strong>아직 생성된 격자가 없습니다.</strong>
              <p>왼쪽 입력칸에 이름=코드 형식으로 작성한 뒤 적용하세요.</p>
            </div>
          ) : (
            <div className="slot-grid" aria-label="이미지 코드 격자" style={imageSlotGridStyle}>
              {activeCharacterSlots.map((slot) => {
                const slotKey = getSlotKey(slot)
                const imagePreview = slot.imagePath
                  ? imagePreviews[previewKey(activeProject.id, activeCharacterCode, slotKey)]
                  : undefined

                return (
                  <article
                    className={imagePreview ? 'slot-card has-image' : 'slot-card'}
                    key={slotKey}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => handleSlotDrop(event, slot)}
                    onPaste={(event) => handleSlotPaste(event, slot)}
                    tabIndex={0}
                  >
                    <div className="slot-image">
                      {imagePreview ? (
                        <img src={imagePreview} alt={`${slot.label} 이미지`} />
                      ) : (
                        <div className="empty-image">
                          <ClipboardPaste size={22} aria-hidden="true" />
                          <span>Drop / Paste</span>
                        </div>
                      )}
                    </div>
                    <div className="slot-meta">
                      <div>
                        <strong>{slot.label}</strong>
                        <span>{slot.code}</span>
                      </div>
                      <div className="slot-actions">
                        {slot.imagePath && (
                          <button
                            className="icon-button danger"
                            type="button"
                            onClick={() => setDeleteTargetSlotKey(getSlotKey(slot))}
                            disabled={deletingSlotId === slotKey || savingSlotId === slotKey}
                            title="이미지 등록 해제"
                          >
                            <Trash2 size={15} aria-hidden="true" />
                          </button>
                        )}
                        <label className="icon-button attach-button" title="이미지 첨부">
                          <ImageUp size={16} aria-hidden="true" />
                          <input
                            accept="image/*"
                            type="file"
                            onChange={(event) => handleSlotFileChange(event, slot)}
                          />
                        </label>
                      </div>
                    </div>
                    {savingSlotId === slotKey && <p className="slot-saving">저장 중</p>}
                    {deletingSlotId === slotKey && <p className="slot-saving">삭제 중</p>}
                  </article>
                )
              })}
            </div>
          )}
          </div>
        )}
      </>
    )
  }

  function renderEditorTool() {
    return (
      <>
        <div className="notepad-shell">
          <div className="prompt-tab-strip" aria-label="프롬프트 탭">
            {chatbot.promptTabs.map((tab) => (
              <div
                className={
                  tab.id === chatbot.activePromptTabId ? 'prompt-tab active' : 'prompt-tab'
                }
                key={tab.id}
              >
                {tab.id === chatbot.activePromptTabId ? (
                  <div className="prompt-tab-main prompt-tab-title-editor">
                    <input
                      aria-label="프롬프트 탭 이름"
                      value={tab.title}
                      onChange={(event) =>
                        handleRenamePromptTab(tab.id, event.currentTarget.value)
                      }
                    />
                    <span>{getTextLength(tab.text).toLocaleString()}자</span>
                  </div>
                ) : (
                  <button
                    className="prompt-tab-main"
                    type="button"
                    onClick={() => handleSelectPromptTab(tab.id)}
                  >
                    <strong>{tab.title.trim() || '이름 없는 탭'}</strong>
                    <span>{getTextLength(tab.text).toLocaleString()}자</span>
                  </button>
                )}
                {chatbot.promptTabs.length > 1 && (
                  <button
                    className="prompt-tab-close"
                    type="button"
                    onClick={() => handleClosePromptTab(tab.id)}
                    title="프롬프트 탭 닫기"
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
            <button
              className="icon-button notepad-add-tab"
              type="button"
              onClick={handleAddPromptTab}
              title="프롬프트 탭 추가"
            >
              <Plus size={16} aria-hidden="true" />
            </button>
            <div className="metrics-bar prompt-tab-actions">
              <label
                className="token-limit-label"
                onBlur={(event) => {
                  const nextTarget = event.relatedTarget as Node | null

                  if (!event.currentTarget.contains(nextTarget)) {
                    setIsTokenLimitMenuOpen(false)
                  }
                }}
              >
                글자 제한
                <div className="token-limit-control">
                  <input
                    className="token-limit-input"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    type="text"
                    value={chatbot.tokenLimit}
                    onFocus={() => setIsTokenLimitMenuOpen(true)}
                    onChange={(event) => {
                      const tokenLimit = Number(event.currentTarget.value) || 0
                      updateChatbot((chatbot) => ({
                        ...chatbot,
                        tokenLimit,
                      }))
                    }}
                  />
                  <button
                    aria-expanded={isTokenLimitMenuOpen}
                    aria-label="글자 수 제한 프리셋"
                    className="token-limit-menu-button"
                    type="button"
                    onClick={() => setIsTokenLimitMenuOpen((isOpen) => !isOpen)}
                  >
                    <ChevronDown size={13} aria-hidden="true" />
                  </button>
                  {isTokenLimitMenuOpen && (
                    <div className="token-limit-menu" role="listbox">
                      {TOKEN_LIMIT_OPTIONS.map((tokenLimit) => (
                        <button
                          key={tokenLimit}
                          role="option"
                          aria-selected={chatbot.tokenLimit === tokenLimit}
                          type="button"
                          onClick={() => {
                            updateChatbot((chatbot) => ({
                              ...chatbot,
                              tokenLimit,
                            }))
                            setIsTokenLimitMenuOpen(false)
                          }}
                        >
                          {tokenLimit}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </label>
              <label className="prompt-font-size-label">
                폰트
                <input
                  aria-label="프롬프트 편집기 폰트 크기"
                  inputMode="numeric"
                  max={PROMPT_FONT_MAX_SIZE}
                  min={PROMPT_FONT_MIN_SIZE}
                  pattern="[0-9]*"
                  type="text"
                  value={promptFontSizeText}
                  onBlur={() => updatePromptFontSize(promptFontSizeText)}
                  onChange={(event) => setPromptFontSizeText(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      updatePromptFontSize(promptFontSizeText)
                    }
                  }}
                />
              </label>
              <button
                aria-pressed={chatbot.markdownEnabled}
                className={
                  chatbot.markdownEnabled
                    ? 'icon-text-button preview-toggle active'
                    : 'icon-text-button preview-toggle'
                }
                type="button"
                onClick={() =>
                  updateChatbot((chatbot) => ({
                    ...chatbot,
                    markdownEnabled: !chatbot.markdownEnabled,
                  }))
                }
              >
                {chatbot.markdownEnabled ? (
                  <Eye size={16} aria-hidden="true" />
                ) : (
                  <EyeOff size={16} aria-hidden="true" />
                )}
                미리보기
              </button>
            </div>
          </div>

        {isOverTextLimit && (
          <div className="limit-warning">
            <AlertTriangle size={16} aria-hidden="true" />
            글자 수 제한을 초과했습니다.
          </div>
        )}

        <div
          className={
            chatbot.completionsFolded
              ? 'prompt-editor-body completions-folded'
              : 'prompt-editor-body'
          }
        >
          <div className="prompt-editor-main">
        <div className="editor-grid notepad-editor-grid editor-grid-single">
          <div className={chatbot.markdownEnabled ? 'editor-wrap preview-mode' : 'editor-wrap'}>
            {chatbot.markdownEnabled ? (
              <div
                className="markdown-preview"
                aria-label="마크다운 미리보기"
                style={promptEditorStyle}
              >
                <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>
                  {activePromptText || ' '}
                </ReactMarkdown>
              </div>
            ) : (
              <>
                <textarea
                  ref={editorRef}
                  className="prompt-input"
                  value={activePromptText}
                  onChange={handleEditorChange}
                  onKeyDown={handleEditorKeyDown}
                  onClick={(event) => setCursorIndex(event.currentTarget.selectionStart)}
                  onKeyUp={(event) => setCursorIndex(event.currentTarget.selectionStart)}
                  onSelect={(event) => setCursorIndex(event.currentTarget.selectionStart)}
                  spellCheck={false}
                  style={promptEditorStyle}
                />
                {completionMatch && (
                  <button
                    aria-selected={completionSuggestionSelected}
                    className={
                      completionSuggestionSelected
                        ? 'completion-suggestion selected'
                        : 'completion-suggestion'
                    }
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault()
                      insertCompletion(completionMatch)
                    }}
                  >
                    <WandSparkles size={16} aria-hidden="true" />
                    <span>{completionMatch.rule.replacement}</span>
                    <kbd>{completionSuggestionSelected ? 'Enter' : '↓ / Tab'}</kbd>
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="notepad-statusbar" aria-label="프롬프트 상태">
          <span>{activePromptTab?.title.trim() || '이름 없는 탭'}</span>
          <span>{activePromptLineCount.toLocaleString()}줄</span>
          <span>{currentTextLength.toLocaleString()}자</span>
          <span>{chatbot.tokenLimit > 0 ? `제한 ${chatbot.tokenLimit.toLocaleString()}자` : '제한 없음'}</span>
          <span>{chatbot.promptTabs.length.toLocaleString()}개 탭</span>
        </div>
        </div>

          <aside
            className={
              chatbot.completionsFolded
                ? 'completion-side-panel folded'
                : 'completion-side-panel'
            }
            aria-label="자동완성 키워드"
          >
            {chatbot.completionsFolded ? (
              <button
                className="completion-fold-tab"
                type="button"
                onClick={() =>
                  updateChatbot((chatbot) => ({
                    ...chatbot,
                    completionsFolded: false,
                  }))
                }
                title="자동완성 펼치기"
              >
                OPEN
              </button>
            ) : (
              <>
                <div className="completion-side-header">
                  <div>
                    <WandSparkles size={16} aria-hidden="true" />
                    <h3>자동완성</h3>
                  </div>
                  <button
                    className="completion-fold-button"
                    type="button"
                    onClick={() =>
                      updateChatbot((chatbot) => ({
                        ...chatbot,
                        completionsFolded: true,
                      }))
                    }
                    title="자동완성 접기"
                  >
                    FOLD
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() =>
                      updateChatbot((chatbot) => ({
                        ...chatbot,
                        completions: [
                          ...chatbot.completions,
                          { id: createId('completion'), trigger: '', replacement: '' },
                        ],
                      }))
                    }
                    title="자동완성 규칙 추가"
                  >
                    <Plus size={16} aria-hidden="true" />
                  </button>
                </div>

                <div className="completion-list">
                  {chatbot.completions.map((rule) => (
                    <div className="completion-row" key={rule.id}>
                      <input
                        aria-label="자동완성 호출어"
                        placeholder="/trigger"
                        value={rule.trigger}
                        onChange={(event) => {
                          const trigger = event.currentTarget.value
                          updateCompletionRule(rule.id, 'trigger', trigger)
                        }}
                      />
                      <input
                        aria-label="자동완성 결과"
                        placeholder="완성할 텍스트"
                        value={rule.replacement}
                        onChange={(event) => {
                          const replacement = event.currentTarget.value
                          updateCompletionRule(rule.id, 'replacement', replacement)
                        }}
                      />
                      <button
                        className="icon-button danger"
                        type="button"
                        onClick={() =>
                          updateChatbot((chatbot) => ({
                            ...chatbot,
                            completions: chatbot.completions.filter(
                              (currentRule) => currentRule.id !== rule.id,
                            ),
                          }))
                        }
                        title="자동완성 규칙 삭제"
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </aside>
        </div>
        </div>

        <div className="subsection-heading">
          <WandSparkles size={17} aria-hidden="true" />
          <h3>자동완성</h3>
          <button
            className="icon-button"
            type="button"
            onClick={() =>
              updateChatbot((chatbot) => ({
                ...chatbot,
                completions: [
                  ...chatbot.completions,
                  { id: createId('completion'), trigger: '', replacement: '' },
                ],
              }))
            }
            title="자동완성 규칙 추가"
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="completion-list">
          {chatbot.completions.map((rule) => (
            <div className="completion-row" key={rule.id}>
              <input
                aria-label="자동완성 호출어"
                placeholder="/trigger"
                value={rule.trigger}
                onChange={(event) => {
                  const trigger = event.currentTarget.value
                  updateCompletionRule(rule.id, 'trigger', trigger)
                }}
              />
              <input
                aria-label="자동완성 결과"
                placeholder="완성될 텍스트"
                value={rule.replacement}
                onChange={(event) => {
                  const replacement = event.currentTarget.value
                  updateCompletionRule(rule.id, 'replacement', replacement)
                }}
              />
              <button
                className="icon-button danger"
                type="button"
                onClick={() =>
                  updateChatbot((chatbot) => ({
                    ...chatbot,
                    completions: chatbot.completions.filter(
                      (currentRule) => currentRule.id !== rule.id,
                    ),
                  }))
                }
                title="자동완성 규칙 삭제"
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      </>
    )
  }

  function renderLorebookTool() {
    const isLoreGridMode = chatbot.loreGridColumns > 0
    const loreBoardStyle = isLoreGridMode
      ? ({ '--lore-grid-columns': chatbot.loreGridColumns } as CSSProperties)
      : undefined

    return (
      <>
        <div className="section-heading">
          <BookOpen size={18} aria-hidden="true" />
          <h2 id="lore-heading">로어북</h2>
          <div className="lore-size-controls" aria-label="로어북 카드 공통 크기">
            <label>
              <span>W</span>
              <input
                aria-label="로어북 카드 너비"
                inputMode="numeric"
                pattern="[0-9]*"
                type="text"
                value={loreCardWidthText}
                onBlur={() => updateLoreCardSize('loreCardWidth', loreCardWidthText)}
                onChange={(event) => {
                  const nextValue = event.currentTarget.value

                  if (/^\d*$/.test(nextValue)) {
                    setLoreCardWidthText(nextValue)
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    updateLoreCardSize('loreCardWidth', loreCardWidthText)
                    event.currentTarget.blur()
                  }
                }}
              />
            </label>
            <label>
              <span>H</span>
              <input
                aria-label="로어북 카드 높이"
                inputMode="numeric"
                pattern="[0-9]*"
                type="text"
                value={loreCardHeightText}
                onBlur={() => updateLoreCardSize('loreCardHeight', loreCardHeightText)}
                onChange={(event) => {
                  const nextValue = event.currentTarget.value

                  if (/^\d*$/.test(nextValue)) {
                    setLoreCardHeightText(nextValue)
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    updateLoreCardSize('loreCardHeight', loreCardHeightText)
                    event.currentTarget.blur()
                  }
                }}
              />
            </label>
            <label>
              <span>열</span>
              <input
                aria-label="로어북 자동 그리드 열 수"
                inputMode="numeric"
                pattern="[0-9]*"
                title="0이면 W 값 기준, 1 이상이면 보드 폭을 열 수만큼 나눕니다."
                type="text"
                value={loreGridColumnsText}
                onBlur={() => updateLoreGridColumns(loreGridColumnsText)}
                onChange={(event) => {
                  const nextValue = event.currentTarget.value

                  if (/^\d*$/.test(nextValue)) {
                    setLoreGridColumnsText(nextValue)
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    updateLoreGridColumns(loreGridColumnsText)
                    event.currentTarget.blur()
                  }
                }}
              />
            </label>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() =>
              updateChatbot((chatbot) => ({
                ...chatbot,
                lorebook: [
                  ...chatbot.lorebook,
                  {
                    id: createId('lore'),
                    title: '로어북 카드',
                    body: '',
                    keywords: [],
                    collapsed: true,
                  },
                ],
              }))
            }
            title="로어북 카드 추가"
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>

        <div
          className={isLoreGridMode ? 'cork-board grid-mode' : 'cork-board'}
          style={loreBoardStyle}
        >
          {chatbot.lorebook.map((card, index) => {
            const isCollapsed = card.collapsed ?? true
            const cardWidth = isLoreGridMode ? undefined : chatbot.loreCardWidth
            const cardHeight = chatbot.loreCardHeight

            return (
              <article
                className={[
                  'lore-card',
                  isCollapsed ? 'collapsed' : 'expanded',
                  draggingLoreCardId === card.id ? 'dragging' : '',
                  loreDropTargetId === card.id && draggingLoreCardId !== card.id
                    ? 'drop-target'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                key={card.id}
                style={{
                  width: cardWidth,
                  height: isCollapsed ? undefined : cardHeight,
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  if (draggingLoreCardId && draggingLoreCardId !== card.id) {
                    setLoreDropTargetId(card.id)
                  }
                }}
                onDrop={(event) => handleLoreCardDrop(event, card.id)}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setLoreDropTargetId(null)
                  }
                }}
              >
                <header className="lore-card-header">
                  <button
                    aria-label="로어북 카드 순서 변경"
                    className="lore-drag-handle"
                    draggable
                    type="button"
                    onClick={(event) => event.stopPropagation()}
                    onDragStart={(event) => handleLoreCardDragStart(event, card.id)}
                    onDragEnd={() => {
                      setDraggingLoreCardId(null)
                      setLoreDropTargetId(null)
                    }}
                  >
                    <GripVertical size={15} aria-hidden="true" />
                  </button>
                  <div className="lore-priority-actions" aria-label="로어북 우선순위">
                    <button
                      aria-label="우선순위 올리기"
                      disabled={index === 0}
                      type="button"
                      onClick={() => moveLoreCard(card.id, -1)}
                      title="우선순위 올리기"
                    >
                      <ArrowUp size={13} aria-hidden="true" />
                    </button>
                    <button
                      aria-label="우선순위 내리기"
                      disabled={index === chatbot.lorebook.length - 1}
                      type="button"
                      onClick={() => moveLoreCard(card.id, 1)}
                      title="우선순위 내리기"
                    >
                      <ArrowDown size={13} aria-hidden="true" />
                    </button>
                  </div>
                  <button
                    aria-expanded={!isCollapsed}
                    className="lore-card-toggle"
                    type="button"
                    onClick={() => updateLoreCard(card.id, 'collapsed', !isCollapsed)}
                    title={isCollapsed ? '카드 펼치기' : '카드 접기'}
                  >
                    <ChevronDown size={15} aria-hidden="true" />
                  </button>
                  {isCollapsed ? (
                    <button
                      className="lore-title-preview"
                      type="button"
                      onClick={() => updateLoreCard(card.id, 'collapsed', false)}
                    >
                      <strong>{card.title.trim() || '이름 없는 로어북'}</strong>
                      <span>
                        #{index + 1} / 호출어 {card.keywords.length}개
                      </span>
                    </button>
                  ) : (
                    <input
                      className="lore-title"
                      aria-label="로어북 제목"
                      value={card.title}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        const title = event.currentTarget.value
                        updateLoreCard(card.id, 'title', title)
                      }}
                    />
                  )}
                  <button
                    className="icon-button danger lore-delete"
                    type="button"
                    onClick={() =>
                      updateChatbot((chatbot) => ({
                        ...chatbot,
                        lorebook: chatbot.lorebook.filter(
                          (currentCard) => currentCard.id !== card.id,
                        ),
                      }))
                    }
                    title="로어북 카드 삭제"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </header>

                {!isCollapsed && (
                  <div className="lore-card-body">
                    <textarea
                      aria-label="로어북 내용"
                      value={card.body}
                      onChange={(event) => {
                        const body = event.currentTarget.value
                        updateLoreCard(card.id, 'body', body)
                      }}
                    />
                    <input
                      aria-label="로어북 호출어"
                      placeholder="호출어 최대 5개, 쉼표 구분"
                      value={loreKeywordDrafts[card.id] ?? card.keywords.join(', ')}
                      onFocus={() =>
                        setLoreKeywordDrafts((drafts) =>
                          card.id in drafts
                            ? drafts
                            : { ...drafts, [card.id]: card.keywords.join(', ') },
                        )
                      }
                      onBlur={() => commitLoreKeywordDraft(card.id)}
                      onChange={(event) => {
                        updateLoreKeywordsFromText(card.id, event.currentTarget.value)
                      }}
                    />
                    <div className="keyword-strip">
                      {card.keywords.length > 0 ? (
                        card.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)
                      ) : (
                        <em>호출어 없음</em>
                      )}
                    </div>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </>
    )
  }

  function renderCharacterControlPanel() {
    return (
      <>
        <div className="subsection-heading character-control-heading">
          <Table2 size={16} aria-hidden="true" />
          <h3>캐릭터 관리</h3>
        </div>
        <div
          className={
            hasInvalidActiveCharacterCode || hasInvalidNewCharacterCode
              ? 'character-code-panel invalid'
              : 'character-code-panel'
          }
        >
          <div className="character-code-form">
            <label>
              <span>캐릭터 코드</span>
              <input
                aria-label="캐릭터 코드"
                placeholder="예: alice, heroine_a, villain01"
                value={newCharacterCode}
                onChange={(event) => setNewCharacterCode(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    handleAddCharacterCode()
                  }
                }}
              />
            </label>
            <button className="primary-button" type="button" onClick={handleAddCharacterCode}>
              <Plus size={16} aria-hidden="true" />
              추가
            </button>
          </div>
          {activeCharacter && (
            <div className="character-meta-editor">
              <label>
                <span>표시 이름</span>
                <input
                  aria-label="앱 표시용 캐릭터 이름"
                  placeholder="예: 고하쿠, 주인공, 조력자"
                  value={characterDisplayNameDraft}
                  onChange={(event) =>
                    setCharacterDisplayNameDraft(event.currentTarget.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void handleSaveActiveCharacterMeta()
                    }
                  }}
                />
              </label>
              <label>
                <span>캐릭터 코드</span>
                <input
                  aria-label="선택 캐릭터 코드 수정"
                  value={characterCodeDraft}
                  onChange={(event) => setCharacterCodeDraft(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void handleSaveActiveCharacterMeta()
                    }
                  }}
                />
              </label>
              <button
                className="icon-text-button"
                type="button"
                onClick={() => void handleSaveActiveCharacterMeta()}
                disabled={
                  !activeCharacterCode ||
                  !trimmedCharacterCodeDraft ||
                  hasInvalidCharacterCodeDraft
                }
              >
                <Save size={15} aria-hidden="true" />
                변경 저장
              </button>
            </div>
          )}
          {chatbot.characters.length > 0 ? (
            <div className="character-code-list" aria-label="등록된 캐릭터 코드">
              {chatbot.characters.map((character) => (
                <div
                  className={
                    character.code === activeCharacterCode
                      ? 'character-code-item active'
                      : 'character-code-item'
                  }
                  key={character.code}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectCharacterCode(character.code)}
                  >
                    <strong>{getCharacterDisplayLabel(character)}</strong>
                    <span>
                      {character.code} / {character.profileFields.length}개 시트 항목 / {character.slots.length}개
                      이미지 코드
                      {character.profilePresetId &&
                        ` / ${
                          globalProfilePresets.find(
                            (preset) => preset.id === character.profilePresetId,
                          )?.name ?? '프리셋'
                        }`}
                    </span>
                  </button>
                  <button
                    className="icon-button danger"
                    type="button"
                    onClick={() => handleRemoveCharacterCode(character.code)}
                    title="캐릭터 코드 삭제"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="character-code-empty">
              <strong>등록된 캐릭터 코드가 없습니다.</strong>
              <span>챗봇 안의 각 등장인물마다 캐릭터 코드를 하나씩 추가하세요.</span>
            </div>
          )}
          <p>
            이미지는 프로젝트 폴더 안의 {activeCharacterFolderPath}/상태코드.확장자 형식으로
            저장됩니다.
            {(hasInvalidActiveCharacterCode || hasInvalidNewCharacterCode) &&
              ' 경로 문자(\\ / : * ? " < > |)는 사용할 수 없습니다.'}
          </p>
        </div>
      </>
    )
  }

  function renderProfileTool() {
    return (
      <div className="profile-sheet-content">
        <div className="section-heading">
          <Table2 size={18} aria-hidden="true" />
          <h2 id="profile-heading">챗봇 시트</h2>
          <button
            className="icon-text-button"
            type="button"
            onClick={() => void handleCopyActiveProfileText()}
            disabled={!activeCharacterCode || activeCharacterProfileFields.length === 0}
            title="시트 항목을 하나의 텍스트로 복사"
          >
            <ClipboardList size={15} aria-hidden="true" />
            텍스트 추출
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => {
              if (!activeCharacterCode) {
                setStatus({
                  kind: 'error',
                  message: '먼저 캐릭터 코드를 추가해야 시트 항목을 만들 수 있습니다.',
                })
                return
              }

              updateActiveCharacterProfileFields((profileFields) => [
                ...profileFields,
                { id: createId('profile'), name: '', value: '' },
              ])
            }}
            title="시트 항목 추가"
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>

        {!activeCharacterCode ? (
          <div className="empty-tool-state">
            <Table2 size={24} aria-hidden="true" />
            <strong>캐릭터 코드가 필요합니다.</strong>
            <p>오른쪽 캐릭터 관리에서 코드를 추가한 뒤 해당 캐릭터의 시트 항목을 만드세요.</p>
          </div>
        ) : activeCharacterProfileFields.length === 0 ? (
          <div className="empty-tool-state">
            <Table2 size={24} aria-hidden="true" />
            <strong>아직 시트 항목이 없습니다.</strong>
            <p>{activeCharacterCode} 캐릭터에 필요한 항목을 직접 만드세요.</p>
          </div>
        ) : (
          <div className="profile-table-wrap">
            <table className="profile-table">
              <thead>
                <tr>
                  <th>항목</th>
                  <th>내용</th>
                  <th aria-label="삭제" />
                </tr>
              </thead>
              <tbody>
                {activeCharacterProfileFields.map((field) => (
                  <tr key={field.id}>
                    <td>
                      <input
                        value={field.name}
                        onChange={(event) => {
                          const name = event.currentTarget.value
                          updateProfileField(field.id, 'name', name)
                        }}
                      />
                    </td>
                    <td>
                      <textarea
                        value={field.value}
                        onChange={(event) => {
                          const value = event.currentTarget.value
                          updateProfileField(field.id, 'value', value)
                        }}
                      />
                    </td>
                    <td>
                      <button
                        className="icon-button danger"
                        type="button"
                        onClick={() =>
                          updateActiveCharacterProfileFields((profileFields) =>
                            profileFields.filter((currentField) => currentField.id !== field.id),
                          )
                        }
                        title="시트 항목 삭제"
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  function renderProfilePresetPanel() {
    return (
      <aside className="profile-side-stack" aria-label="챗봇 시트 보조 패널">
        <section className="profile-character-panel" aria-label="캐릭터 관리">
          {renderCharacterControlPanel()}
        </section>

        <section className="profile-preset-panel" aria-label="전역 항목 프리셋">
          <div className="subsection-heading">
            <Table2 size={17} aria-hidden="true" />
            <h3>전역 항목 프리셋</h3>
          </div>

          <div className="preset-assign-row">
            <div className="preset-assign-field">
              <span>할당</span>
              <StyledDropdown
                ariaLabel="항목 프리셋 할당"
                value={activeCharacter?.profilePresetId ?? ''}
                disabled={!activeCharacterCode}
                onChange={applyProfilePresetToCharacter}
                options={[
                  { value: '', label: '프리셋 없음' },
                  ...globalProfilePresets.map((preset) => ({
                    value: preset.id,
                    label: preset.name,
                  })),
                ]}
              />
            </div>
            <span>{activeCharacterPreset?.name ?? '미할당'}</span>
          </div>

          <div className="preset-create-grid">
            <input
              aria-label="프리셋 이름"
              placeholder="프리셋 이름"
              value={newPresetName}
              onChange={(event) => setNewPresetName(event.currentTarget.value)}
            />
            <textarea
              aria-label="프리셋 항목"
              placeholder="이름|나이|외모|말투"
              value={newPresetFieldsText}
              onChange={(event) => setNewPresetFieldsText(event.currentTarget.value)}
            />
            <button className="primary-button" type="button" onClick={handleCreateProfilePreset}>
              <Plus size={16} aria-hidden="true" />
              프리셋 생성
            </button>
          </div>

          {globalProfilePresets.length > 0 && (
            <div className="preset-list">
              {globalProfilePresets.map((preset) => (
                <article className="preset-item" key={preset.id}>
                  <div>
                    <strong>{preset.name}</strong>
                    <span>{preset.fields.join(' | ')}</span>
                  </div>
                  <button
                    className="icon-button danger"
                    type="button"
                    onClick={() => handleDeleteProfilePreset(preset.id)}
                    title="프리셋 삭제"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </aside>
    )
  }

  function renderActiveTool() {
    switch (activeTool) {
      case 'overview':
        return renderOverviewTool()
      case 'guidelines':
        return renderGuidelinesTool()
      case 'images':
        return renderImageTool()
      case 'editor':
        return renderEditorTool()
      case 'lorebook':
        return renderLorebookTool()
      case 'profile':
        return renderProfileTool()
    }
  }

  return (
    <div className="workspace">
      {isDashboardVisible && (
        <section className="startup-dashboard" aria-label="etomo-tool 대시보드">
          <div className="startup-dashboard-image">
            <img src={`${import.meta.env.BASE_URL}Dashboard.png`} alt="etomo-tool dashboard" />
          </div>
          <button
            className="startup-dashboard-close"
            type="button"
            aria-label="대시보드 닫기"
            onClick={() => setIsDashboardVisible(false)}
          >
            닫기
          </button>
        </section>
      )}

      <header className="topbar">
        <div className="brand">
          <PanelTop size={24} aria-hidden="true" />
          <div>
            <strong>etomo-tool</strong>
            <span>AI 채팅 프롬프트 제작</span>
          </div>
        </div>

        <div className="project-strip">
          <button className="primary-button" type="button" onClick={handleSelectProjectFolder}>
            <FolderOpen size={17} aria-hidden="true" />
            프로젝트 열기
          </button>
          <span className="project-path" title={projectPath || '프로젝트 폴더 미지정'}>
            {projectPath || '프로젝트 폴더 미지정'}
          </span>
        </div>

        <div className={`save-state ${autoSaveStatus}`}>
          <Save size={15} aria-hidden="true" />
          {autoSaveStatus === 'saving'
            ? '저장 중'
            : autoSaveStatus === 'saved'
              ? '저장됨'
              : autoSaveStatus === 'error'
                ? '저장 실패'
                : '대기'}
        </div>
      </header>

      <div className={`status-line ${status.kind}`} role="status">
        {status.kind === 'error' || status.kind === 'warning' ? (
          <AlertTriangle size={16} aria-hidden="true" />
        ) : (
          <CheckCircle2 size={16} aria-hidden="true" />
        )}
        <span>{status.message}</span>
      </div>

      <main className="app-layout">
        <aside className="tool-sidebar" aria-label="서브 앱">
          <div className={projectsFolded ? 'sidebar-projects collapsed' : 'sidebar-projects'}>
            <button
              aria-expanded={!projectsFolded}
              className="sidebar-projects-toggle"
              type="button"
              onClick={() => setProjectsFolded((isFolded) => !isFolded)}
            >
              <span>챗봇 프로젝트</span>
              <em>{projects.length}개</em>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {!projectsFolded && (
              <div className="project-tab-list sidebar-project-list">
                {projects.map((project) => {
                  const isActiveProject = project.id === activeProject.id
                  const projectName = getProjectDisplayName(project)

                  return (
                    <div
                      className={isActiveProject ? 'project-tab active' : 'project-tab'}
                      key={project.id}
                    >
                      <button
                        className="project-tab-main"
                        type="button"
                        onClick={() => handleFocusProject(project.id)}
                        title={project.projectPath || projectName}
                      >
                        <strong>{projectName}</strong>
                      </button>
                      {projects.length > 1 && (
                        <button
                          className="project-tab-close"
                          type="button"
                          onClick={() => handleCloseProject(project.id)}
                          title="프로젝트 탭 닫기"
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  )
                })}
                <button
                  className="icon-button project-tab-add"
                  type="button"
                  onClick={handleSelectProjectFolder}
                  title="프로젝트 열기"
                >
                  <Plus size={17} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>

          <div className="tool-sidebar-section">
            <span className="sidebar-label">현재 프로젝트</span>
            <label className="chatbot-title-field">
              <span>챗봇 이름</span>
              <input
                aria-label="챗봇 이름"
                value={getProjectDisplayName(activeProject)}
                readOnly
              />
            </label>
            <small>
              {activeCharacterCode
                ? `선택된 캐릭터: ${activeCharacter ? getCharacterMenuLabel(activeCharacter) : activeCharacterCode}`
                : '캐릭터 코드 미지정'}
            </small>
            <small title={projectPath || '프로젝트 폴더 미지정'}>
              {projectPath || '프로젝트 폴더 미지정'}
            </small>
            <button
              className="icon-text-button sidebar-action-button"
              type="button"
              onClick={handleChangeActiveProjectFolder}
            >
              <FolderOpen size={15} aria-hidden="true" />
              저장 폴더 변경
            </button>
            <div className="sidebar-backup-actions">
              <button
                className="icon-text-button sidebar-action-button"
                type="button"
                onClick={() => void handleExportProjectBackup()}
                disabled={!projectPath}
                title={projectPath ? '현재 프로젝트를 .etomo 파일로 백업' : '프로젝트 폴더가 필요합니다.'}
              >
                <Save size={15} aria-hidden="true" />
                프로젝트 백업
              </button>
              <button
                className="icon-text-button sidebar-action-button"
                type="button"
                onClick={() => void handleExportWorkspaceBackup()}
                title="열려 있는 모든 프로젝트와 전역 프리셋을 백업"
              >
                <Save size={15} aria-hidden="true" />
                전체 백업
              </button>
              <button
                className="icon-text-button sidebar-action-button"
                type="button"
                onClick={() => void handleImportProjectBackup()}
                title="백업을 새 프로젝트 폴더로 가져오기"
              >
                <FolderOpen size={15} aria-hidden="true" />
                백업 가져오기
              </button>
            </div>
          </div>

          <div className="tool-nav" role="list">
            {TOOL_ITEMS.map((tool) => (
              <button
                className={tool.id === activeTool ? 'tool-nav-button active' : 'tool-nav-button'}
                key={tool.id}
                type="button"
                onClick={() => setActiveTool(tool.id)}
              >
                {renderToolIcon(tool.id)}
                <span>
                  <strong>{tool.label}</strong>
                  <small>{tool.description}</small>
                </span>
                <em>{getToolMetric(tool.id, chatbot, currentTextLength)}</em>
              </button>
            ))}
          </div>
        </aside>

        {activeTool === 'profile' ? (
          <div className="profile-workspace">
            <section
              className={`column tool-panel ${activeTool}-panel`}
              aria-labelledby={activeToolHeadingId}
            >
              {renderActiveTool()}
            </section>
            {renderProfilePresetPanel()}
          </div>
        ) : (
          <section
            className={`column tool-panel ${activeTool}-panel`}
            aria-label={activeTool === 'editor' ? activeToolMeta.label : undefined}
            aria-labelledby={activeTool === 'editor' ? undefined : activeToolHeadingId}
          >
            {renderActiveTool()}
          </section>
        )}
      </main>

      {promptCloseTargetTab && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setPromptCloseTargetId(null)
            }
          }}
        >
          <section
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-prompt-tab-title"
          >
            <div>
              <AlertTriangle size={22} aria-hidden="true" />
              <div>
                <h2 id="close-prompt-tab-title">프롬프트 탭을 닫으시겠습니까?</h2>
                <p>
                  {promptCloseTargetTab.title.trim() || '이름 없는 탭'} 탭에{' '}
                  {getTextLength(promptCloseTargetTab.text).toLocaleString()}자 입력되어 있습니다.
                  닫으면 이 탭의 프롬프트가 삭제됩니다.
                </p>
              </div>
            </div>
            <div className="modal-actions">
              <button
                className="icon-text-button"
                type="button"
                onClick={() => setPromptCloseTargetId(null)}
              >
                취소
              </button>
              <button
                className="primary-button danger-button"
                type="button"
                onClick={confirmClosePromptTab}
              >
                <X size={16} aria-hidden="true" />
                닫기
              </button>
            </div>
          </section>
        </div>
      )}

      {deleteTargetSlot && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setDeleteTargetSlotKey(null)
            }
          }}
        >
          <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-image-title">
            <div>
              <AlertTriangle size={22} aria-hidden="true" />
              <div>
                <h2 id="delete-image-title">정말 삭제하시겠습니까?</h2>
                <p>
                  {deleteTargetSlot.label} 슬롯에 등록된 이미지 파일과 연결 정보를 삭제합니다.
                </p>
              </div>
            </div>
            <div className="modal-actions">
              <button
                className="icon-text-button"
                type="button"
                onClick={() => setDeleteTargetSlotKey(null)}
                disabled={deletingSlotId === getSlotKey(deleteTargetSlot)}
              >
                취소
              </button>
              <button
                className="primary-button danger-button"
                type="button"
                onClick={() => void deleteImageFromSlot(deleteTargetSlot)}
                disabled={deletingSlotId === getSlotKey(deleteTargetSlot)}
              >
                <Trash2 size={16} aria-hidden="true" />
                삭제
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

export function App() {
  return (
    <AppErrorBoundary>
      <EtomoToolApp />
    </AppErrorBoundary>
  )
}
