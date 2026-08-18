import { useState, useEffect, useCallback, useRef } from 'react'
import { parseJsonResponse } from './lib/api'
import { ConfigPanel } from './components/ConfigPanel'
import { Step1Setting } from './components/Step1Setting'
import { Step2Directory } from './components/Step2Directory'
import { Step3Chapter } from './components/Step3Chapter'
import { Step4Finalize } from './components/Step4Finalize'
import { Step5Publish } from './components/Step5Publish'
import { ProductionCenter } from './components/ProductionCenter'
import { QualityPanel } from './components/QualityPanel'
import { DeconstructPanel } from './components/DeconstructPanel'
import { ConversationPanel } from './components/ConversationPanel'
import type { ConversationMessage } from './components/ConversationPanel'
import './App.css'

const API = '/api'

export type ChapterInfo = {
  number: number
  title: string
  role: string
  purpose: string
  suspense: string
  summary: string
  rawBlock: string[]
}

export type ProjectState = {
  bookId?: string
  topic?: string
  genre?: string
  wordPerChapter?: number
  setting?: string
  numChapters?: number
  directory?: string
  globalSummary?: string
  characterState?: string
  voiceCard?: string
  directorOutline?: string
  publishConfig?: PublishConfig
  draftedChapters?: Record<number, string>
  publishStates?: Record<number, PublishState>
  lastGeneratedChapter?: number
}

export type ProjectSaveOverrides = Partial<ProjectState>

export type PublishStatus = 'draft' | 'copied' | 'published' | 'approved' | 'needs_fix'

export type PublishState = {
  status: PublishStatus
  publishedAt?: string
  scheduledAt?: string
  note?: string
}

export type PublishConfig = {
  startDate: string
  chaptersPerDay: 1 | 2
  timeSlots: string[]
  startChapter: number
  onlyUnpublished: boolean
}

type BookMeta = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  topic?: string
  numChapters?: number
  lastGeneratedChapter?: number
}

const emptyProject: Required<Omit<ProjectState, 'bookId'>> = {
  topic: '',
  genre: '閮藉競',
  wordPerChapter: 2000,
  setting: '',
  numChapters: 20,
  directory: '',
  globalSummary: '',
  characterState: '',
  draftedChapters: {},
  publishStates: {},
  lastGeneratedChapter: 0,
  voiceCard: '',
  directorOutline: '',
}

const defaultPublishConfig: PublishConfig = {
  startDate: new Date().toISOString().slice(0, 10),
  chaptersPerDay: 2,
  timeSlots: ['12:00', '20:30'],
  startChapter: 1,
  onlyUnpublished: true,
}

export default function App() {
  const [configOpen, setConfigOpen] = useState(false)
  const [step, setStep] = useState(1)
  const [books, setBooks] = useState<BookMeta[]>([])
  const [currentBookId, setCurrentBookId] = useState('')
  const [bookLoading, setBookLoading] = useState(false)
  const [topic, setTopic] = useState(emptyProject.topic)
  const [genre, setGenre] = useState(emptyProject.genre)
  const [wordPerChapter, setWordPerChapter] = useState(emptyProject.wordPerChapter)
  const [setting, setSetting] = useState(emptyProject.setting)
  const [numChapters, setNumChapters] = useState(emptyProject.numChapters)
  const [directory, setDirectory] = useState(emptyProject.directory)
  const [parsedChapters, setParsedChapters] = useState<ChapterInfo[]>([])
  const [lastGeneratedChapter, setLastGeneratedChapter] = useState(emptyProject.lastGeneratedChapter)
  const [globalSummary, setGlobalSummary] = useState(emptyProject.globalSummary)
  const [characterState, setCharacterState] = useState(emptyProject.characterState)
  const [voiceCard, setVoiceCard] = useState(emptyProject.voiceCard)
  const [directorOutline, setDirectorOutline] = useState(emptyProject.directorOutline)
  const [draftedChapters, setDraftedChapters] = useState<Record<number, string>>(emptyProject.draftedChapters)
  const [publishStates, setPublishStates] = useState<Record<number, PublishState>>(emptyProject.publishStates)
  const [publishConfig, setPublishConfig] = useState<PublishConfig>(defaultPublishConfig)
  const [chapterToFinalize, setChapterToFinalize] = useState(1)
  const [consistencyResult, setConsistencyResult] = useState('')
  const [saveStatus, setSaveStatus] = useState('')
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([])
  const [conversationOpen, setConversationOpen] = useState(false)
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null)
  const [projectLoadError, setProjectLoadError] = useState(false)

  const currentBook = books.find((book) => book.id === currentBookId)

  const appendConversation = useCallback((messages: ConversationMessage[]) => {
    if (messages && messages.length) setConversationMessages((prev) => [...prev, ...messages])
  }, [])

  const clearConversation = useCallback(() => setConversationMessages([]), [])

  const applyProject = useCallback((p: ProjectState) => {
    setTopic(p.topic ?? emptyProject.topic)
    setGenre(p.genre ?? emptyProject.genre)
    setWordPerChapter(p.wordPerChapter ?? emptyProject.wordPerChapter)
    setSetting(p.setting ?? emptyProject.setting)
    setNumChapters(p.numChapters ?? emptyProject.numChapters)
    setDirectory(p.directory ?? emptyProject.directory)
    setGlobalSummary(p.globalSummary ?? emptyProject.globalSummary)
    setCharacterState(p.characterState ?? emptyProject.characterState)
    setVoiceCard(p.voiceCard ?? emptyProject.voiceCard)
    setDirectorOutline(p.directorOutline ?? emptyProject.directorOutline)
    setDraftedChapters(p.draftedChapters ?? {})
    setPublishStates(p.publishStates ?? {})
    setPublishConfig({ ...defaultPublishConfig, ...(p.publishConfig as PublishConfig | undefined) })
    setLastGeneratedChapter(p.lastGeneratedChapter ?? 0)
    setParsedChapters([])
    setChapterToFinalize(1)
    setConsistencyResult('')
    setConversationMessages([])
  }, [])

  const refreshBooks = useCallback(async () => {
    const res = await fetch(`${API}/project/books`)
    const data = await parseJsonResponse<{ books: BookMeta[]; currentBookId: string }>(res)
    setBooks(data.books || [])
    setCurrentBookId(data.currentBookId || data.books?.[0]?.id || '')
    return data
  }, [])

  const parseDirectoryText = useCallback(async (rawDirectory: string) => {
    if (!rawDirectory.trim()) {
      setParsedChapters([])
      return
    }
    const res = await fetch(`${API}/directory/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawDirectory }),
    })
    const data = await parseJsonResponse<{ ok: boolean; chapters?: ChapterInfo[] }>(res)
    if (data.ok && Array.isArray(data.chapters)) {
      setParsedChapters(data.chapters)
      const max = Math.max(0, ...data.chapters.map((c) => c.number))
      setLastGeneratedChapter((prev) => (max > prev ? max : prev))
    }
  }, [])

  const loadProject = useCallback(async (bookId?: string) => {
    setProjectLoadError(false)
    setBookLoading(true)
    try {
      const query = bookId ? `?bookId=${encodeURIComponent(bookId)}` : ''
      const res = await fetch(`${API}/project${query}`)
      const project = await parseJsonResponse<ProjectState>(res)
      if (project.bookId) setCurrentBookId(project.bookId)
      applyProject(project)
      await parseDirectoryText(project.directory || '')
    } catch {
      setProjectLoadError(true)
    } finally {
      setBookLoading(false)
    }
  }, [applyProject, parseDirectoryText])

  const saveProject = useCallback(async (overrides: ProjectSaveOverrides | unknown = {}) => {
    try {
      const projectOverrides =
        overrides && typeof overrides === 'object' && !('nativeEvent' in overrides)
          ? (overrides as ProjectSaveOverrides)
          : {}
      const project: ProjectState = {
        topic,
        genre,
        wordPerChapter,
        setting,
        numChapters,
        directory,
        globalSummary,
        characterState,
        voiceCard,
        directorOutline,
        draftedChapters,
        publishStates,
        publishConfig,
        lastGeneratedChapter,
        ...projectOverrides,
      }
      const query = currentBookId ? `?bookId=${encodeURIComponent(currentBookId)}` : ''
      const res = await fetch(`${API}/project${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      })
      const data = await parseJsonResponse<{ ok: boolean; bookId?: string; book?: BookMeta }>(res)
      if (data.ok) {
        if (data.bookId) setCurrentBookId(data.bookId)
        if (data.book) {
          setBooks((prev) => {
            const exists = prev.some((book) => book.id === data.book?.id)
            return exists
              ? prev.map((book) => (book.id === data.book?.id ? data.book : book))
              : [data.book as BookMeta, ...prev]
          })
        }
        setSaveStatus('已保存')
        setTimeout(() => setSaveStatus(''), 2000)
      }
    } catch {
      setSaveStatus('保存失败')
    }
  }, [topic, genre, wordPerChapter, setting, numChapters, directory, globalSummary, characterState, voiceCard, draftedChapters, publishStates, publishConfig, lastGeneratedChapter, currentBookId])

  // ===== 自动保存：项目状态变化 2 秒防抖自动落盘（必须在 saveProject 定义之后） =====
  const loadedRef = useRef(false)
  useEffect(() => { loadedRef.current = true }, []) // 首轮渲染后标记已加载
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!loadedRef.current) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      saveProject()
    }, 2000)
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    }
  }, [
    topic, genre, wordPerChapter, setting, numChapters, directory,
    globalSummary, characterState, voiceCard, directorOutline,
    draftedChapters, publishStates, publishConfig, lastGeneratedChapter,
    saveProject,
  ])

  const createBook = useCallback(async () => {
    const title = window.prompt('新书名称', '新书')
    if (title === null) return
    await saveProject()
    setBookLoading(true)
    try {
      const res = await fetch(`${API}/project/books`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim() || '新书', numChapters: 620 }),
      })
      const data = await parseJsonResponse<{ ok: boolean; book: BookMeta; currentBookId: string; project: ProjectState }>(res)
      if (data.ok) {
        setBooks((prev) => [data.book, ...prev])
        setCurrentBookId(data.currentBookId)
        applyProject(data.project)
        setStep(1)
        setSaveStatus('已创建新书')
        setTimeout(() => setSaveStatus(''), 2000)
      }
    } catch {
      setSaveStatus('创建失败')
    } finally {
      setBookLoading(false)
    }
  }, [applyProject, saveProject])

  const switchBook = useCallback(async (bookId: string) => {
    if (!bookId || bookId === currentBookId) return
    await saveProject()
    setBookLoading(true)
    try {
      await fetch(`${API}/project/current`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId }),
      })
      await loadProject(bookId)
      setStep(1)
    } finally {
      setBookLoading(false)
    }
  }, [currentBookId, loadProject, saveProject])

  const deleteCurrentBook = useCallback(async () => {
    if (!currentBookId) return
    const title = currentBook?.title || '当前作品'
    const ok = window.confirm(`确定删除《${title}》吗？\n\n删除后会移除这本书的设定、目录、正文、定稿状态和发布状态。`)
    if (!ok) return

    setBookLoading(true)
    try {
      const res = await fetch(`${API}/project/books/${encodeURIComponent(currentBookId)}`, {
        method: 'DELETE',
      })
      const data = await parseJsonResponse<{ ok: boolean; books: BookMeta[]; currentBookId: string; error?: string }>(res)
      if (!data.ok) throw new Error(data.error || '删除失败')
      setBooks(data.books || [])
      setCurrentBookId(data.currentBookId)
      await loadProject(data.currentBookId)
      setStep(1)
      setSaveStatus('已删除')
      setTimeout(() => setSaveStatus(''), 2000)
    } catch {
      setSaveStatus('删除失败')
    } finally {
      setBookLoading(false)
    }
  }, [currentBook?.title, currentBookId, loadProject])

  useEffect(() => {
    fetch(`${API}/health`)
      .then((r) => r.ok)
      .then(setBackendConnected)
      .catch(() => setBackendConnected(false))
  }, [])

  useEffect(() => {
    refreshBooks()
      .then((data) => loadProject(data.currentBookId || data.books?.[0]?.id))
      .catch(() => setProjectLoadError(true))
  }, [loadProject, refreshBooks])

  const exportBookTxt = useCallback(() => {
    const keys = Object.keys(draftedChapters)
      .map(Number)
      .sort((a, b) => a - b)
    if (keys.length === 0) return
    const chapterTitles = new Map(parsedChapters.map((c) => [c.number, c.title]))
    const lines = keys.map((n) => {
      const title = chapterTitles.get(n) || `第${n}章`
      return `${title}\n\n${(draftedChapters[n] || '').trim()}\n\n`
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${currentBook?.title || '小说'}_${keys[0]}-${keys[keys.length - 1]}章.txt`
    a.click()
    URL.revokeObjectURL(url)
  }, [currentBook?.title, draftedChapters, parsedChapters])

  const parseDirectory = useCallback(async () => {
    await parseDirectoryText(directory)
  }, [directory, parseDirectoryText])

  return (
    <div className="app">
      <header className="header">
        <h1 className="logo">执笔 NovelAgent 多书创作工作台</h1>
        <p className="tagline">每本书独立保存：Step1 设定 → Step2 目录 → Step3 写章 → Step4 定稿 → Step5 发布</p>

        <div className="header-actions">
          {backendConnected === false && <span className="error" title="后端未连接">未连接</span>}
          {backendConnected === true && <span className="success" title="后端已连接">已连接</span>}
          <button
            type="button"
            className="conversation-toggle"
            onClick={() => setConversationOpen((o) => !o)}
            title="AI 对话记录"
          >
            话
          </button>
          {Object.keys(draftedChapters).length > 0 && (
            <button type="button" className="btn" onClick={exportBookTxt} title="按章节顺序导出为 TXT">
              导出全书
            </button>
          )}
          <button type="button" className="btn primary" onClick={saveProject}>
            保存项目
          </button>
          {saveStatus && <span className={saveStatus.includes('失败') ? 'error' : 'success'}>{saveStatus}</span>}
          <button type="button" className="btn" onClick={() => setConfigOpen((o) => !o)}>
            {configOpen ? '收起配置' : '配置'}
          </button>
        </div>

        <div className="book-switcher">
          <div className="book-current">
            <span className="label-inline">当前作品</span>
            <strong>{currentBook?.title || '未命名作品'}</strong>
            <span className="muted-inline">
              已生成 {currentBook?.lastGeneratedChapter || lastGeneratedChapter || 0} / {currentBook?.numChapters || numChapters} 章
            </span>
          </div>
          <select
            className="input book-select"
            value={currentBookId}
            onChange={(e) => switchBook(e.target.value)}
            disabled={bookLoading}
          >
            {books.map((book) => (
              <option key={book.id} value={book.id}>
                {book.title}
              </option>
            ))}
          </select>
          <button type="button" className="btn primary" onClick={createBook} disabled={bookLoading}>
            新建书
          </button>
          <button type="button" className="btn danger" onClick={deleteCurrentBook} disabled={bookLoading || !currentBookId}>
            删除
          </button>
        </div>
      </header>

      {projectLoadError && (
        <p className="error" style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          项目加载失败，请确认后端已启动。
          <button type="button" className="btn" onClick={() => loadProject(currentBookId)}>重试</button>
        </p>
      )}

      <ConversationPanel
        open={conversationOpen}
        onClose={() => setConversationOpen(false)}
        messages={conversationMessages}
        onClear={clearConversation}
      />

      {configOpen && (
        <section className="section">
          <ConfigPanel />
        </section>
      )}

      <main className="main" aria-busy={bookLoading}>
        <div className="workspace">
          <nav className="sidebar">
            {[
              [1, '📕', '设定'],
              [2, '🗺', '蓝图'],
              [3, '✍️', '正文'],
              [4, '📝', '定稿'],
              [5, '📤', '发行'],
              [6, '🔍', '品控'],
            ].map(([s, icon, label]) => (
              <button
                key={s as number}
                type="button"
                className={step === s ? 'sidebar-btn active' : 'sidebar-btn'}
                onClick={() => setStep(s as number)}
                title={label as string}
              >
                <span className="sidebar-icon">{icon as string}</span>
                <span className="sidebar-label">{label as string}</span>
              </button>
            ))}
          </nav>

          <div className="workspace-content">
            {(step === 3 || step === 6) && currentBookId && (
              <ProductionCenter
                bookId={currentBookId}
                totalChapters={numChapters}
                lastGeneratedChapter={lastGeneratedChapter}
                onProgress={(current) => {
                  if (current > lastGeneratedChapter) setLastGeneratedChapter(current)
                }}
              />
            )}

            {step === 1 && (
          <Step1Setting
            topic={topic}
            setTopic={setTopic}
            genre={genre}
            setGenre={setGenre}
            wordPerChapter={wordPerChapter}
            setWordPerChapter={setWordPerChapter}
            setting={setting}
            setSetting={setSetting}
            voiceCard={voiceCard}
            setVoiceCard={setVoiceCard}
            numChapters={numChapters}
            setNumChapters={setNumChapters}
            onGenerated={() => { setStep(2); saveProject() }}
            onSave={saveProject}
            onConversation={appendConversation}
          />
        )}
        {step === 2 && (
          <Step2Directory
            setting={setting}
            numChapters={numChapters}
            directory={directory}
            setDirectory={setDirectory}
            parsedChapters={parsedChapters}
            setParsedChapters={setParsedChapters}
            lastGeneratedChapter={lastGeneratedChapter}
            setLastGeneratedChapter={setLastGeneratedChapter}
            directorOutline={directorOutline}
            setDirectorOutline={setDirectorOutline}
            onParse={parseDirectory}
            onGenerated={() => setStep(3)}
            onSave={saveProject}
            onConversation={appendConversation}
          />
        )}
        {step === 3 && (
          <Step3Chapter
            currentBookId={currentBookId}
            topic={topic}
            voiceCard={voiceCard}
            setting={setting}
            directory={directory}
            parsedChapters={parsedChapters}
            wordPerChapter={wordPerChapter}
            globalSummary={globalSummary}
            setGlobalSummary={setGlobalSummary}
            characterState={characterState}
            setCharacterState={setCharacterState}
            draftedChapters={draftedChapters}
            setDraftedChapters={setDraftedChapters}
            setLastGeneratedChapter={setLastGeneratedChapter}
            consistencyResult={consistencyResult}
            setConsistencyResult={setConsistencyResult}
            directorOutline={directorOutline}
            onFinalize={(chapterNumber) => {
              if (chapterNumber) setChapterToFinalize(chapterNumber)
              setStep(4)
            }}
            onSave={saveProject}
            onConversation={appendConversation}
          />
        )}
        {step === 4 && (
          <Step4Finalize
            draftedChapters={draftedChapters}
            globalSummary={globalSummary}
            setGlobalSummary={setGlobalSummary}
            characterState={characterState}
            setCharacterState={setCharacterState}
            setting={setting}
            selectedChapter={chapterToFinalize}
            setSelectedChapter={setChapterToFinalize}
            onSave={saveProject}
          />
        )}
        {step === 5 && (
          <Step5Publish
            bookId={currentBookId}
            bookTitle={currentBook?.title || '小说'}
            parsedChapters={parsedChapters}
            draftedChapters={draftedChapters}
            publishStates={publishStates}
            setPublishStates={setPublishStates}
            publishConfig={publishConfig}
            setPublishConfig={setPublishConfig}
            onSave={saveProject}
          />
        )}
        {step === 6 && (
          <>
            <DeconstructPanel />
            <div style={{ height: '1rem' }} />
            <QualityPanel bookId={currentBookId} />
          </>
        )}
          </div>
        </div>
      </main>
    </div>
  )
}

