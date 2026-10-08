<template>
  <div class="page">
    <div class="page-head">
      <h1 class="page-title">时间线</h1>
      <p class="page-sub">按日回溯你的心迹轨迹</p>
    </div>

    <div class="toolbar">
      <div class="chips">
        <button
          v-for="(label, k) in KIND_PLAIN"
          :key="k"
          class="chip kind"
          :class="[kindClass(k), { on: kind === k }]"
          @click="toggleKind(k)"
        >
          <span class="kind-dot" />{{ label }}
        </button>
        <button
          class="chip kind k-knowledge"
          :class="{ on: onlyKnowledge }"
          title="只看知识库的收录、修改、感受与删除等操作"
          @click="toggleKnowledge"
        >
          <span class="kind-dot" />知识
        </button>
        <button
          class="chip hidden-chip"
          :class="{ on: showHidden }"
          title="查看被隐去的内容并恢复显示，内容一直都在库里"
          @click="toggleHidden"
        >
          <Icon name="shield" :size="13" />已隐藏<em v-if="hiddenCount" class="count">{{ hiddenCount }}</em>
        </button>
      </div>
      <div class="filters">
        <DatePicker v-model="dateFrom" placeholder="开始日期" clearable @update:model-value="reload" />
        <span class="sep">至</span>
        <DatePicker v-model="dateTo" placeholder="结束日期" clearable @update:model-value="reload" />
        <label class="search-box">
          <Icon name="search" :size="15" />
          <input
            v-model="keyword"
            :placeholder="semanticOn ? '混合搜索（关键词+语义，AI 扩展查询）…' : '全文搜索…'"
            @input="onSearch"
          />
        </label>
        <label class="checkbox" title="关键词 + 语义双路融合（RRF），并让 AI 扩展查询变体；需在设置页启用 Embedding">
          <input v-model="semanticOn" type="checkbox" @change="onSearch" />混合
        </label>
      </div>
    </div>

    <div v-if="searching" class="search-note">
      <span class="tag accent">{{ semanticOn ? '混合搜索' : '搜索' }}</span>
      「{{ keyword }}」命中 {{ entries.length }} 条
      <span v-if="expandedQueries.length > 1" class="exp">AI 扩展：{{ expandedQueries.slice(1).join(' / ') }}</span>
      <span v-if="semanticNotice" class="warn">{{ semanticNotice }}</span>
    </div>

    <div v-if="showHidden" class="search-note">
      <span class="tag warn">已隐藏 {{ hiddenCount }}</span>
      这些内容都还完整留在库里，只是按所选范围不出现在时间线、搜索或统计中；点行尾的「恢复显示」即可找回。
      <button class="secondary small" @click="toggleHidden">返回时间线</button>
    </div>

    <div v-else-if="hiddenNotice" class="search-note">
      <span class="tag ok">已隐去</span>
      {{ hiddenNotice }}
      <button class="secondary small" @click="toggleHidden">查看已隐藏</button>
      <button class="ghost small" @click="hiddenNotice = ''">知道了</button>
    </div>

    <!-- 真轴线时间线 -->
    <div v-if="groups.length" class="tl">
      <section v-for="group in groups" :key="group.date" class="day">
        <div class="day-aside">
          <span class="day-node" />
          <div class="day-date">{{ formatDay(group.date) }}</div>
          <div class="day-meta">{{ weekday(group.date) }} · {{ group.recordCount }} 条</div>
        </div>
        <div class="day-main">
          <article
            v-for="item in group.items"
            :key="item.key"
            class="entry"
            :class="{
              'sleep-overview': item.type === 'sleep-day',
              'chat-entry': item.type === 'chat',
              'kb-entry': item.type === 'knowledge'
            }"
            @click="onItemClick(item)"
          >
            <span class="t">{{ itemTimeLabel(item) }}</span>
            <span class="kind-badge" :class="itemBadgeClass(item)">
              <span class="kind-dot" />{{ itemBadgeLabel(item) }}
            </span>
            <span v-if="item.type === 'sleep-day'" class="summary">
              总计 {{ item.totalHours.toFixed(1) }} 小时
              <template v-if="item.sessionCount"> · {{ item.sessionCount }} 段<span v-if="item.longestHours"> · 最长连续 {{ item.longestHours.toFixed(1) }} 小时</span></template>
              <template v-else> · 分段未知</template>
            </span>
            <span v-else-if="item.type === 'chat'" class="summary chat-summary">
              {{ item.title || '未命名对话' }}
              <em class="chat-meta">{{ item.messageCount }} 条<template v-if="item.tokenCount"> · {{ item.tokenCount }} token</template> · 点击回看原文</em>
            </span>
            <span v-else-if="item.type === 'knowledge'" class="summary">
              《{{ item.itemTitle }}》<em class="chat-meta">{{ item.detail ? `${item.detail} · ` : '' }}点击查看内容</em>
            </span>
            <span v-else class="summary">{{ summarize(item.entry) }}</span>
            <span v-if="item.type === 'entry' && semanticOn && item.entry._score != null" class="score">
              {{ item.entry._rerank != null ? `精排 ${Math.round(item.entry._rerank * 100)}%` : `${Math.round(item.entry._score * 100)}%` }}
            </span>
            <button
              v-if="item.type === 'entry' && !showHidden && knowledgeLink(item.entry.id)"
              class="ghost icon-btn kb-link"
              :title="`查看知识资料：${knowledgeLink(item.entry.id)!.title}`"
              @click.stop="previewLinkedKnowledge(item.entry.id)"
            >
              <Icon name="book" :size="14" />
            </button>
            <button
              v-else-if="showHidden"
              class="secondary small restore"
              :title="hiddenScopeTitle(itemHiddenScope(item))"
              @click.stop="restoreItem(item)"
            >
              恢复显示
            </button>
            <div v-if="item.type === 'entry' && semanticOn && item.entry._chunk" class="chunk-hit">匹配片段：{{ item.entry._chunk }}</div>
            <div v-if="item.type === 'sleep-day'" class="sleep-segments">
              <span v-for="segment in item.segments" :key="segment.entry.id">
                {{ sleepEntryLabel(segment.entry) }} · {{ segment.sleep.hours.toFixed(1) }} 小时
              </span>
            </div>
          </article>
        </div>
      </section>

      <div class="tl-foot">
        <button v-if="hasMore && !searching" class="secondary" @click="loadMore">加载更多</button>
        <span v-else class="end-note">— 已到最早的记录 —</span>
      </div>
    </div>

    <div v-else class="empty">
      <template v-if="showHidden">
        <h3>没有被隐去的内容</h3>
        <p>时间线上的记录、知识操作和对话会话都正常显示着。</p>
        <button class="secondary" @click="toggleHidden">返回时间线</button>
      </template>
      <template v-else>
        <h3>还没有留下痕迹</h3>
        <p>去「记录」页写下第一条吧，之后它会按日期出现在这里。</p>
      </template>
    </div>

    <div v-if="sleepDayDetail" class="drawer-mask" @click.self="sleepDayDetail = null">
      <div class="drawer side">
        <div class="drawer-head">
          <span class="kind-badge" :class="kindClass('sleep')"><span class="kind-dot" />睡眠</span>
          <span class="meta">{{ sleepDayDetail.date }} · 总计 {{ sleepDayDetail.totalHours.toFixed(1) }} 小时</span>
          <button class="close" title="关闭" @click="sleepDayDetail = null"><Icon name="close" :size="16" /></button>
        </div>
        <div class="sleep-day-stats">
          <div><b>{{ sleepDayDetail.totalHours.toFixed(1) }}h</b><span>睡眠总计</span></div>
          <div><b>{{ sleepDayDetail.sessionCount || '—' }}</b><span>睡眠段数</span></div>
          <div><b>{{ sleepDayDetail.longestHours ? `${sleepDayDetail.longestHours.toFixed(1)}h` : '—' }}</b><span>最长连续</span></div>
        </div>
        <div class="sleep-detail-list">
          <div v-for="segment in sleepDayDetail.segments" :key="segment.entry.id" class="sleep-detail-row">
            <div><b>{{ sleepEntryLabel(segment.entry) }}</b><span>{{ segment.sleep.hours.toFixed(1) }} 小时<span v-if="segment.sleep.mode !== 'session'"> · 分段未知</span></span></div>
            <button class="secondary small" @click="editSleepSegment(segment.entry)">更正</button>
          </div>
        </div>
        <button class="secondary" @click="addSleepSegment">去记录页新增睡眠</button>
      </div>
    </div>

    <!-- 单条记录详情侧栏 -->
    <div v-if="detail" class="drawer-mask" @click.self="detail = null">
      <div class="drawer side">
        <div class="drawer-head">
          <span class="kind-badge" :class="kindClass(detail.kind)">
            <span class="kind-dot" />{{ kindLabel(detail.kind) }}
          </span>
          <span class="meta">
            发生于 {{ detail.entry_date }}{{ detail.entry_time ? ` ${detail.entry_time}` : '（未标时间）' }}
            · 保存于 {{ detail.created_at }}
            · 置信度 {{ Math.round(detail.confidence * 100) }}%
          </span>
          <button class="close" title="关闭" @click="detail = null">
            <Icon name="close" :size="16" />
          </button>
        </div>

        <div class="field">
          <div class="section-label">录入快照（只读）</div>
          <p class="raw">{{ readableSleepSnapshot(detail.raw_text, detail.entry_date, detail.content) }}</p>
        </div>

        <div v-if="showMomentEditor" class="field">
          <div class="section-label">发生时间</div>
          <div class="moment-row">
            <DatePicker v-model="detailDate" placeholder="发生日期" />
            <TimePicker v-model="detailTime" placeholder="未标时间" />
          </div>
          <p class="hint">改日期会把这条记录挪到新的那天；清空时间表示只记得大概哪天。</p>
        </div>

        <div class="field">
          <div class="section-label">更正记录</div>
          <template v-if="detail.kind === 'sleep' && detailForm.recordType === 'session'">
            <label>睡眠时间段</label>
            <TimeRangePicker v-model="detailSleepRange" />
            <p class="hint">保存后，时间线、生活趋势和后续 AI 分析都会重新计算。</p>
          </template>
          <template v-else-if="detail.kind === 'sleep' && detailForm.recordType === 'daily_total'">
            <label>日期</label><DatePicker v-model="detailForm.date" />
            <label>当天累计睡眠（小时）</label><input v-model.number="detailForm.hours" type="number" min="0.1" max="24" step="0.1" />
            <p class="hint">这是累计值，系统不会据此推断连续睡眠时长。</p>
          </template>
          <template v-else-if="detail.kind === 'sleep'">
            <label>睡眠时长（小时）</label><input v-model.number="detailForm.hours" type="number" min="0.1" max="24" step="0.1" />
            <p class="hint">旧记录没有起止时间，只能更正总时长，连续性仍标记为未知。</p>
          </template>
          <template v-else>
            <label>内容</label><textarea v-model="detailForm.text" rows="5" />
            <label v-if="detail.kind === 'quote'">出处</label><input v-if="detail.kind === 'quote'" v-model="detailForm.from" />
            <label v-if="detail.kind === 'event'" class="checkbox"><input v-model="detailForm.negative" type="checkbox" />负面事件</label>
            <label v-if="detail.kind === 'conversation'">参与者</label><input v-if="detail.kind === 'conversation'" v-model="detailForm.with" />
          </template>
        </div>

        <div class="field">
          <div class="section-label">{{ detail.hidden_scope ? '当前已隐去' : '从时间线隐去' }}</div>
          <p class="hint">隐去只是让这件事不再出现在你选的范围里，原文和内容都完整保留，随时可以恢复。</p>
          <template v-if="!detail.hidden_scope">
            <label v-for="s in HIDE_SCOPES" :key="s" class="checkbox">
              <input v-model="hideScope" type="radio" name="hide-scope" :value="s" />{{ HIDE_SCOPE_LABELS[s] }}
            </label>
            <button class="secondary" @click="hideEntry">隐去这条记录</button>
          </template>
          <button v-else class="secondary" @click="restoreEntry">恢复显示</button>
        </div>

        <div class="row">
          <button v-if="detailKnowledge" class="secondary" @click="openKnowledge">查看知识资料</button>
          <button class="primary" @click="saveContent">保存修改</button>
          <button class="danger" @click="removeEntry">删除这条记录</button>
          <span v-if="saved" class="msg ok inline">已保存</span>
          <span v-if="saveError" class="msg err inline">{{ saveError }}</span>
        </div>
      </div>
    </div>

    <!-- 对话原文回看侧栏 -->
    <div v-if="chatDetail" class="drawer-mask" @click.self="chatDetail = null">
      <div class="drawer side">
        <div class="drawer-head">
          <span class="kind-badge" :class="kindClass('conversation')"><span class="kind-dot" />AI 对话</span>
          <span class="meta">{{ chatDetail.title }} · {{ chatDetail.timeLabel }}</span>
          <button class="close" title="关闭" @click="chatDetail = null"><Icon name="close" :size="16" /></button>
        </div>
        <div class="chat-transcript">
          <div v-for="m in chatDetail.messages" :key="m.id" class="chat-line" :class="m.role">
            <div class="chat-role">{{ m.role === 'user' ? '我' : 'AI' }}</div>
            <div class="chat-text">
              <p v-if="m.error" class="err">⚠️ {{ m.error }}</p>
              <p v-if="m.text">{{ m.text }}</p>
              <ul v-if="m.parsed && m.parsed.length" class="chat-parsed">
                <li v-for="(p, i) in m.parsed" :key="i">{{ kindLabel(p.kind) }}：{{ parsedSummary(p) }}</li>
              </ul>
              <time v-if="m.createdAt" class="chat-time">{{ formatChatTime(m.createdAt) }}</time>
            </div>
          </div>
        </div>
        <div class="row">
          <button class="secondary" @click="hideChatSession">隐去这个会话</button>
          <span class="hint">只让这条会话不再出现在时间线，对话原文与归档都保留。</span>
        </div>
      </div>
    </div>

    <!-- 知识资料只读预览：时间线里只查看，要改去知识库 -->
    <div v-if="knowledgePreview" class="drawer-mask" @click.self="knowledgePreview = null">
      <div class="drawer side">
        <div class="drawer-head">
          <span class="kind-badge k-knowledge"><span class="kind-dot" />{{ knowledgePreview.badgeLabel }}</span>
          <span class="meta">
            <template v-if="knowledgePreview.eventTime">{{ knowledgePreview.eventTime }} 操作 · </template>
            资料更改于 {{ knowledgePreview.item?.updated_at || '时间未知' }}
          </span>
          <button class="close" title="关闭" @click="knowledgePreview = null"><Icon name="close" :size="16" /></button>
        </div>
        <template v-if="knowledgePreview.item">
          <div class="field">
            <div class="section-label">标题</div>
            <p class="raw">{{ knowledgePreview.item.title }}</p>
          </div>
          <div class="field">
            <div class="section-label">内容（只读）</div>
            <p class="raw kb-body">{{ knowledgePreview.item.body }}</p>
          </div>
          <p class="hint">标题、内容与收录原因都在知识库页改，这里只看不改。</p>
        </template>
        <template v-else>
          <div class="field">
            <div class="section-label">当时的操作</div>
            <p class="raw">《{{ knowledgePreview.snapshotTitle }}》{{ knowledgePreview.snapshotDetail }}</p>
          </div>
          <p class="hint">这份资料已不在知识库，只留下这条操作记录。</p>
        </template>
        <div class="row">
          <button v-if="knowledgePreview.item" class="primary" @click="gotoKnowledge(knowledgePreview.itemId!)">到知识库修改</button>
          <button v-if="knowledgePreview.eventId" class="secondary" @click="hidePreviewEvent">隐去这条操作</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { EntryKind, HideScope, HIDE_SCOPES, HIDE_SCOPE_LABELS, KbAction, KB_ACTION_LABELS, TimelineFilter } from '../../electron/types'
import Icon from '../components/Icon.vue'
import DatePicker from '../components/DatePicker.vue'
import TimePicker from '../components/TimePicker.vue'
import TimeRangePicker, { TimeRangeValue } from '../components/TimeRangePicker.vue'
import { KIND_PLAIN, kindClass, kindLabel } from '../utils/kinds'
import { localDateString } from '../utils/datetime'
import { parseSleepContent, readableSleepSnapshot, sessionLabel, shortDate, SleepDisplay } from '../utils/sleep'

interface EntryRow {
  id: number
  raw_text: string
  kind: string
  content: string
  confidence: number
  created_at: string
  entry_date: string
  entry_time: string | null
  hidden_scope?: string | null
  _score?: number
  _rerank?: number
  _chunk?: string
}

/** 主进程 timeline:list 返回的合并行：记录条目或知识库操作流水 */
interface TimelineRowDto {
  record_type: 'entry' | 'knowledge'
  id: number
  event_date: string
  event_time: string | null
  created_at: string
  hidden_scope: string | null
  raw_text: string | null
  kind: string | null
  content: string | null
  confidence: number | null
  source: string | null
  item_id: number | null
  folder_id: number | null
  action: string | null
  item_title: string | null
  detail: string | null
}

interface KnowledgeRow {
  id: number
  itemId: number | null
  action: KbAction
  itemTitle: string
  detail: string
  eventDate: string
  eventTime: string | null
  hiddenScope: string | null
}

interface SleepSegment { entry: EntryRow; sleep: SleepDisplay }
interface SleepDayItem {
  type: 'sleep-day'
  key: string
  date: string
  segments: SleepSegment[]
  totalHours: number
  sessionCount: number
  longestHours: number | null
  sortTime: string
}
interface EntryItem { type: 'entry'; key: string; entry: EntryRow; sortTime: string }
interface KnowledgeItem { type: 'knowledge'; key: string; eventId: number; itemId: number | null; action: KbAction; itemTitle: string; detail: string; sortTime: string; hiddenScope: string | null }
interface ChatItem { type: 'chat'; key: string; sessionId: string; title: string; sortTime: string; messageCount: number; tokenCount: number; status: string; hiddenScope: string | null }
type TimelineItem = SleepDayItem | EntryItem | KnowledgeItem | ChatItem

interface ChatSessionRow {
  id: string
  title: string
  status: 'active' | 'archived'
  createdAt: string
  lastMessageAt: string | null
  messageCount: number
  tokenCount: number
  hiddenScope: string | null
}
interface TranscriptMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  error?: string
  createdAt?: string
  parsed?: { kind: string; content: Record<string, unknown> }[]
}

const entries = ref<EntryRow[]>([])
const kbEvents = ref<KnowledgeRow[]>([])
const kind = ref<EntryKind | null>(null)
const onlyKnowledge = ref(false)
/** 打开后时间线只列已隐去的行，可逐行恢复显示 */
const showHidden = ref(false)
const hideScope = ref<HideScope>('all')
const hiddenCount = ref(0)
/** 隐去之后留在页面上的线索，告诉用户去哪里恢复 */
const hiddenNotice = ref('')
const dateFrom = ref('')
const dateTo = ref('')
const keyword = ref('')
const searching = ref(false)
const semanticOn = ref(true)
const semanticNotice = ref('')
const expandedQueries = ref<string[]>([])
const PAGE = 50
const offset = ref(0)
const hasMore = ref(false)
const detail = ref<EntryRow | null>(null)
const detailForm = reactive<Record<string, any>>({})
const detailDate = ref('')
const detailTime = ref('')
const knowledgeByEntry = ref(new Map<number, { itemId: number; title: string }>())
const sleepDayDetail = ref<SleepDayItem | null>(null)
const chatSessions = ref<ChatSessionRow[]>([])
const chatDetail = ref<{ sessionId: string; title: string; timeLabel: string; messages: TranscriptMessage[] } | null>(null)
const saved = ref(false)
const saveError = ref('')
const router = useRouter()
const detailKnowledge = computed(() => detail.value ? knowledgeByEntry.value.get(detail.value.id) ?? null : null)
/** 睡眠分段与当天累计的发生时间由内容里的起止/日期推导，其余类型才出日期时间选择器 */
const showMomentEditor = computed(() => {
  if (!detail.value) return false
  if (detail.value.kind !== 'sleep') return true
  return detailForm.recordType !== 'session' && detailForm.recordType !== 'daily_total'
})
function gotoKnowledge(itemId: number): void { void router.push({ path: '/knowledge', query: { itemId: String(itemId) } }) }

interface KbItemView {
  id: number
  title: string
  body: string
  reason: string
  reflection: string
  ai_summary: string
  created_at: string
  updated_at: string
}
interface KnowledgePreview {
  /** 打开预览的时间线操作行 id；从记录行跳转打开时为 null */
  eventId: number | null
  itemId: number | null
  badgeLabel: string
  eventTime: string
  snapshotTitle: string
  snapshotDetail: string
  item: KbItemView | null
}
/** 时间线里知识资料只读：想看内容留在这里，想改再点按钮进知识库 */
const knowledgePreview = ref<KnowledgePreview | null>(null)
async function previewKnowledge(preview: Omit<KnowledgePreview, 'item'>): Promise<void> {
  const item = preview.itemId ? ((await window.api.kb.getItem(preview.itemId)) as KbItemView | null) : null
  knowledgePreview.value = { ...preview, item }
}
function previewLinkedKnowledge(entryId: number): void {
  const link = knowledgeByEntry.value.get(entryId)
  if (!link) return
  void previewKnowledge({
    eventId: null,
    itemId: link.itemId,
    badgeLabel: '知识资料',
    eventTime: '',
    snapshotTitle: link.title,
    snapshotDetail: ''
  })
}
function openKnowledge(): void { previewLinkedKnowledge(detail.value?.id ?? 0) }

/** 已隐藏视图：时间线变成回收站，逐行恢复显示 */
function toggleHidden(): void {
  showHidden.value = !showHidden.value
  hiddenNotice.value = ''
  void load()
}
function noteHidden(): void {
  hiddenNotice.value = `已从时间线隐去，内容仍完整保留。共 ${hiddenCount.value} 项被隐去`
}
function itemHiddenScope(item: TimelineItem): string | null {
  if (item.type === 'entry') return item.entry.hidden_scope ?? null
  if (item.type === 'knowledge') return item.hiddenScope
  if (item.type === 'chat') return item.hiddenScope
  return null
}
const HIDE_SCOPE_SHORT: Record<HideScope, string> = {
  all: '时间线、搜索、报告与趋势',
  listing: '时间线与搜索',
  timeline: '仅时间线列表'
}
function hiddenScopeTitle(scope: string | null): string {
  const label = scope && scope in HIDE_SCOPE_SHORT ? HIDE_SCOPE_SHORT[scope as HideScope] : '时间线'
  return `当前已从${label}隐去；内容未被删除，恢复后回到时间线`
}
/** 只在时间线上隐去这件事，内容一律原样保留 */
async function hideEntry(): Promise<void> {
  if (!detail.value) return
  await window.api.timeline.setHidden('entry', detail.value.id, hideScope.value)
  detail.value = null
  await load()
  noteHidden()
}
async function restoreEntry(): Promise<void> {
  if (!detail.value) return
  await window.api.timeline.setHidden('entry', detail.value.id, null)
  detail.value = null
  hiddenNotice.value = ''
  await load()
}
async function hidePreviewEvent(): Promise<void> {
  const eventId = knowledgePreview.value?.eventId
  if (eventId == null) return
  await window.api.timeline.setHidden('knowledge', eventId, 'timeline')
  knowledgePreview.value = null
  await load()
  noteHidden()
}
async function hideChatSession(): Promise<void> {
  const sessionId = chatDetail.value?.sessionId
  if (!sessionId) return
  await window.api.timeline.setHidden('session', sessionId, 'timeline')
  chatDetail.value = null
  await load()
  noteHidden()
}
async function restoreItem(item: TimelineItem): Promise<void> {
  if (item.type === 'entry') await window.api.timeline.setHidden('entry', item.entry.id, null)
  else if (item.type === 'knowledge') await window.api.timeline.setHidden('knowledge', item.eventId, null)
  else if (item.type === 'chat') await window.api.timeline.setHidden('session', item.sessionId, null)
  else return
  hiddenNotice.value = ''
  await load()
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function todayStr(): string {
  return localDateString()
}

/** 2026-09-15 → 09月15日 / 今天 / 昨天 */
function formatDay(d: string): string {
  const t = todayStr()
  if (d === t) return '今天'
  const y = new Date()
  y.setDate(y.getDate() - 1)
  if (d === localDateString(y)) return '昨天'
  const [, m, day] = d.split('-')
  return `${m}月${Number(day)}日`
}

function weekday(d: string): string {
  const dt = new Date(`${d}T00:00:00`)
  return Number.isNaN(dt.getTime()) ? '' : WEEKDAYS[dt.getDay()]
}

function chatDisplayDate(s: ChatSessionRow): string {
  return (s.lastMessageAt || s.createdAt || '').slice(0, 10)
}

const groups = computed(() => {
  const map = new Map<string, EntryRow[]>()
  for (const e of entries.value) {
    const arr = map.get(e.entry_date) ?? []
    arr.push(e)
    map.set(e.entry_date, arr)
  }
  // 流水与对话都不参与全文/语义检索；按记录类型筛选时两者都隐藏
  const showEvents = !searching.value && !kind.value
  const mergeChats = showEvents && !onlyKnowledge.value
  const eventMap = new Map<string, KnowledgeRow[]>()
  if (showEvents) {
    for (const event of kbEvents.value) {
      const arr = eventMap.get(event.eventDate) ?? []
      arr.push(event)
      eventMap.set(event.eventDate, arr)
    }
  }
  const chatMap = new Map<string, ChatSessionRow[]>()
  if (mergeChats) {
    for (const s of chatSessions.value) {
      // 会话不上主查询游标，隐去状态在这里对齐当前视图
      if ((s.hiddenScope != null) !== showHidden.value) continue
      const date = chatDisplayDate(s)
      if (!date) continue
      if (dateFrom.value && date < dateFrom.value) continue
      if (dateTo.value && date > dateTo.value) continue
      const arr = chatMap.get(date) ?? []
      arr.push(s)
      chatMap.set(date, arr)
    }
  }
  // 回收视图逐条列出睡眠记录，否则它们会合成当天卡片而没法单条恢复
  const aggregateSleep = !showHidden.value
  const dates = [...new Set([...map.keys(), ...eventMap.keys(), ...chatMap.keys()])]
  return dates
    .sort((a, b) => (a < b ? 1 : -1))
    .map(date => {
      const records = map.get(date) ?? []
      const events = eventMap.get(date) ?? []
      const items: TimelineItem[] = records
        .filter(entry => !aggregateSleep || entry.kind !== 'sleep')
        .map(entry => ({ type: 'entry', key: `entry-${entry.id}`, entry, sortTime: entry.entry_time ?? '' }))
      const segments = aggregateSleep
        ? records
          .filter(entry => entry.kind === 'sleep')
          .map(entry => ({ entry, sleep: parseSleepContent(entry.content) }))
          .filter((value): value is SleepSegment => value.sleep !== null)
        : []
      if (segments.length) items.push(makeSleepDay(date, segments))
      for (const event of events) {
        items.push({
          type: 'knowledge',
          key: `kb-${event.id}`,
          eventId: event.id,
          itemId: event.itemId,
          action: event.action,
          itemTitle: event.itemTitle,
          detail: event.detail,
          sortTime: event.eventTime ?? '',
          hiddenScope: event.hiddenScope
        })
      }
      for (const s of chatMap.get(date) ?? []) {
        const ts = s.lastMessageAt || s.createdAt || ''
        items.push({ type: 'chat', key: `chat-${s.id}`, sessionId: s.id, title: s.title, sortTime: ts.slice(11, 16), messageCount: s.messageCount, tokenCount: s.tokenCount, status: s.status, hiddenScope: s.hiddenScope })
      }
      items.sort((a, b) => b.sortTime.localeCompare(a.sortTime) || b.key.localeCompare(a.key))
      return { date, items, recordCount: records.length + events.length + (chatMap.get(date)?.length ?? 0) }
    })
})

function makeSleepDay(date: string, segments: SleepSegment[]): SleepDayItem {
  const dailyTotal = segments.find(segment => segment.sleep.mode === 'daily_total')
  const totalHours = dailyTotal?.sleep.hours ?? segments.reduce((sum, segment) => sum + segment.sleep.hours, 0)
  const sessions = segments.filter(segment => segment.sleep.mode === 'session')
  return {
    type: 'sleep-day',
    key: `sleep-${date}`,
    date,
    segments,
    totalHours: Math.round(totalHours * 10) / 10,
    sessionCount: sessions.length,
    longestHours: sessions.length ? Math.max(...sessions.map(segment => segment.sleep.hours)) : null,
    sortTime: segments.map(segment => segment.entry.entry_time ?? '').sort().at(-1) ?? ''
  }
}

function sleepEntryLabel(entry: EntryRow): string {
  const sleep = parseSleepContent(entry.content)
  if (!sleep) return '睡眠记录'
  if (sleep.mode === 'session') return sessionLabel(sleep.startAt, sleep.endAt)
  if (sleep.mode === 'daily_total') return `${shortDate(sleep.date)} 当天累计`
  return '仅记录时长'
}

function summarize(e: EntryRow): string {
  try {
    const c = JSON.parse(e.content) as Record<string, unknown>
    const text = (c.text as string) ?? (c.hours != null ? `睡眠 ${c.hours} 小时` : '')
    return text.length > 80 ? text.slice(0, 80) + '…' : text || e.raw_text.slice(0, 80)
  } catch {
    return e.raw_text.slice(0, 80)
  }
}

function toEntryRow(row: TimelineRowDto): EntryRow {
  return {
    id: row.id,
    raw_text: row.raw_text ?? '',
    kind: row.kind ?? 'other',
    content: row.content ?? '{}',
    confidence: row.confidence ?? 0,
    created_at: row.created_at,
    entry_date: row.event_date,
    entry_time: row.event_time,
    hidden_scope: row.hidden_scope
  }
}

function toKnowledgeRow(row: TimelineRowDto): KnowledgeRow {
  return {
    id: row.id,
    itemId: row.item_id,
    action: (row.action ?? 'collect') as KbAction,
    itemTitle: row.item_title ?? '',
    detail: row.detail ?? '',
    eventDate: row.event_date,
    eventTime: row.event_time,
    hiddenScope: row.hidden_scope
  }
}

async function refreshKnowledgeLinks(entryIds: number[]): Promise<void> {
  if (!entryIds.length) return
  const found = await window.api.kb.findItemsForEntries(entryIds)
  const next = new Map(knowledgeByEntry.value)
  for (const link of found) {
    // 数据层按资料 id 倒序返回，首次写入即最新的一份资料
    if (!next.has(link.entryId)) next.set(link.entryId, { itemId: link.itemId, title: link.title })
  }
  knowledgeByEntry.value = next
}

function knowledgeLink(entryId: number): { itemId: number; title: string } | undefined {
  return knowledgeByEntry.value.get(entryId)
}

async function load(reset = true): Promise<void> {
  if (reset) {
    offset.value = 0
    hasMore.value = false
    knowledgeByEntry.value = new Map()
  }
  const filter: TimelineFilter = { limit: PAGE, offset: offset.value }
  if (showHidden.value) filter.showHidden = true
  if (onlyKnowledge.value) filter.record = 'knowledge'
  else if (kind.value) filter.kind = kind.value
  if (dateFrom.value) filter.dateFrom = dateFrom.value
  if (dateTo.value) filter.dateTo = dateTo.value
  const page = (await window.api.timeline.list(filter)) as TimelineRowDto[]
  const pageEntries = page.filter(row => row.record_type === 'entry').map(toEntryRow)
  const pageEvents = page.filter(row => row.record_type === 'knowledge').map(toKnowledgeRow)
  entries.value = reset ? pageEntries : [...entries.value, ...pageEntries]
  kbEvents.value = reset ? pageEvents : [...kbEvents.value, ...pageEvents]
  // 记录与流水共用一条游标：offset 按合并行数推进，各自累加会漏行或重行
  offset.value += page.length
  hasMore.value = page.length === PAGE
  await refreshKnowledgeLinks(pageEntries.map(entry => entry.id))
  hiddenCount.value = await window.api.timeline.hiddenCount()
  if (reset) {
    // 打开/重载时间线时才查询会话历史；按类型筛选或只看知识流水时不混入对话条目
    chatSessions.value = kind.value || onlyKnowledge.value ? [] : await window.api.capture.sessions()
  }
}

function loadMore(): void {
  void load(false)
}

function reload(): void {
  searching.value = false
  void load()
}

function toggleKind(k: string): void {
  kind.value = kind.value === k ? null : (k as EntryKind)
  if (kind.value) onlyKnowledge.value = false
  void load()
}

function toggleKnowledge(): void {
  onlyKnowledge.value = !onlyKnowledge.value
  if (onlyKnowledge.value) kind.value = null
  void load()
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
function onSearch(): void {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(async () => {
    if (!keyword.value.trim()) {
      searching.value = false
      semanticNotice.value = ''
      expandedQueries.value = []
      await load()
      return
    }
    searching.value = true
    showHidden.value = false
    kbEvents.value = []
    expandedQueries.value = []
    if (semanticOn.value) {
      const r = await window.api.hybrid.search(keyword.value.trim(), 30, true)
      if (r.ok) {
        semanticNotice.value = ''
        expandedQueries.value = r.queries
        entries.value = r.hits.map((h: { score: number; chunk_text?: string; rerank_score?: number } & Record<string, unknown>) => ({
          ...h,
          _score: h.score,
          _chunk: h.chunk_text,
          _rerank: h.rerank_score
        })) as never
      } else {
        semanticNotice.value = `搜索失败：${r.error}`
        entries.value = await window.api.timeline.search(keyword.value.trim())
      }
    } else {
      semanticNotice.value = ''
      entries.value = await window.api.timeline.search(keyword.value.trim())
    }
    await refreshKnowledgeLinks(entries.value.map(entry => entry.id))
  }, 250)
}

function openDetail(e: EntryRow): void {
  detail.value = e
  for (const key of Object.keys(detailForm)) delete detailForm[key]
  Object.assign(detailForm, JSON.parse(e.content) as Record<string, unknown>)
  detailDate.value = e.entry_date
  detailTime.value = e.entry_time ?? ''
  saved.value = false
  saveError.value = ''
}

function itemTimeLabel(item: TimelineItem): string {
  if (item.type === 'sleep-day') return '全天'
  if (item.type === 'chat') return item.sortTime || '对话'
  if (item.type === 'knowledge') return item.sortTime || '当天'
  return item.entry.entry_time || '未标时间'
}
function itemBadgeClass(item: TimelineItem): string {
  if (item.type === 'sleep-day') return kindClass('sleep')
  if (item.type === 'chat') return kindClass('conversation')
  if (item.type === 'knowledge') return 'k-knowledge'
  return kindClass(item.entry.kind)
}
function itemBadgeLabel(item: TimelineItem): string {
  if (item.type === 'sleep-day') return kindLabel('sleep')
  if (item.type === 'chat') return 'AI 对话'
  if (item.type === 'knowledge') return KB_ACTION_LABELS[item.action] ?? '知识库'
  return kindLabel(item.entry.kind)
}
/** 分流点击：知识流水行的 id 属于 kb_events，误走记录接口会改删同号记录 */
function onItemClick(item: TimelineItem): void {
  if (item.type === 'sleep-day') { openSleepDay(item); return }
  if (item.type === 'chat') { void openChat(item); return }
  if (item.type === 'knowledge') {
    void previewKnowledge({
      eventId: item.eventId,
      itemId: item.itemId,
      badgeLabel: KB_ACTION_LABELS[item.action] ?? '知识库',
      eventTime: item.sortTime,
      snapshotTitle: item.itemTitle,
      snapshotDetail: item.detail
    })
    return
  }
  openDetail(item.entry)
}
function parsedSummary(p: { kind: string; content: Record<string, unknown> }): string {
  const c = p.content || {}
  if (typeof c.text === 'string') return c.text
  if (c.hours != null) return `${c.hours} 小时`
  return JSON.stringify(c)
}
function formatChatTime(value: string): string {
  const normalized = value.trim().replace('T', ' ')
  return normalized.length >= 16 ? normalized.slice(0, 16) : normalized
}
async function openChat(item: ChatItem): Promise<void> {
  const messages = (await window.api.capture.list(item.sessionId)) as TranscriptMessage[]
  chatDetail.value = {
    sessionId: item.sessionId,
    title: item.title || '未命名对话',
    timeLabel: itemTimeLabel(item),
    messages
  }
}

function openSleepDay(item: SleepDayItem): void { sleepDayDetail.value = item }
function editSleepSegment(entry: EntryRow): void { sleepDayDetail.value = null; openDetail(entry) }
function addSleepSegment(): void { void router.push({ path: '/capture', query: { kind: 'sleep' } }) }

const detailSleepRange = computed<TimeRangeValue | null>({
  get: () => detailForm.recordType === 'session' && detailForm.startAt && detailForm.endAt
    ? { start: String(detailForm.startAt), end: String(detailForm.endAt) }
    : null,
  set: value => {
    detailForm.startAt = value?.start ?? ''
    detailForm.endAt = value?.end ?? ''
  }
})

async function saveContent(): Promise<void> {
  if (!detail.value) return
  saveError.value = ''
  if (showMomentEditor.value && !detailDate.value) {
    saveError.value = '请先选择发生日期'
    return
  }
  try {
    const moment = showMomentEditor.value
      ? { entryDate: detailDate.value, entryTime: detailTime.value || null }
      : null
    const result = await window.api.timeline.updateContent(detail.value.id, { ...detailForm }, moment)
    if (!result.ok) {
      saveError.value = result.error ?? '保存失败'
      return
    }
    detail.value.content = JSON.stringify(result.content)
    detail.value.entry_date = result.entryDate
    detail.value.entry_time = result.entryTime
    detailDate.value = result.entryDate
    detailTime.value = result.entryTime ?? ''
    saved.value = true
    await load()
    setTimeout(() => (saved.value = false), 2000)
  } catch (error) {
    saveError.value = (error as Error).message || '保存失败'
  }
}

async function removeEntry(): Promise<void> {
  if (!detail.value) return
  if (!confirm('确定删除这条记录吗？此操作不可恢复。')) return
  await window.api.entries.remove(detail.value.id)
  detail.value = null
  await load()
}

onMounted(() => void load())
</script>

<style scoped>
.toolbar {
  display: flex; justify-content: space-between; align-items: center;
  gap: 12px; flex-wrap: wrap; margin-bottom: 16px;
}
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip.kind.on { background: var(--kc-weak); border-color: var(--kc); color: var(--kc); }
.chip.hidden-chip { border-style: dashed; color: var(--text-2); gap: 5px; }
.chip.hidden-chip.on { background: var(--warn-weak); border-color: var(--warn); color: var(--warn); border-style: solid; }
.chip.hidden-chip .count { font-style: normal; font-weight: 700; color: var(--warn); }
.chip.hidden-chip.on .count { color: inherit; }
.search-note button { margin-left: 6px; }
.restore { white-space: nowrap; }
.field > .checkbox { margin: 5px 0; font-size: 12.5px; }

.filters { display: flex; gap: 10px; align-items: center; font-size: 13px; flex-wrap: wrap; }
.filters .sep { color: var(--text-3); font-size: 12px; }
.filters :deep(.dp--main) { width: 150px; }

.search-note {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: 12.5px; color: var(--text-2); margin-bottom: 14px;
}
.search-note .exp { color: var(--accent-text); font-size: 11.5px; }
.search-note .warn { color: var(--warn); }

/* ---- 轴线时间线 ---- */
.tl { position: relative; }
.tl::before {
  content: '';
  position: absolute; left: 76px; top: 10px; bottom: 0;
  width: 1px; background: var(--border);
}
.day { display: flex; gap: 20px; }
.day-aside {
  position: relative;
  width: 76px; flex: 0 0 76px;
  text-align: right; padding: 10px 16px 0 0;
}
.day-node {
  position: absolute; right: -5px; top: 16px;
  width: 10px; height: 10px; border-radius: 50%;
  background: var(--surface);
  border: 2px solid var(--accent);
}
.day-date { font-size: 13.5px; font-weight: 600; color: var(--text); line-height: 1.4; }
.day-meta { font-size: 11px; color: var(--text-3); }

.day-main { flex: 1; min-width: 0; padding: 8px 0 14px; }

.entry {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto auto;
  align-items: center; gap: 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 9px 14px; margin-bottom: 6px;
  cursor: pointer; box-shadow: var(--shadow);
  transition: border-color 0.15s var(--ease), box-shadow 0.15s var(--ease), transform 0.15s var(--ease);
}
.entry:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-md);
  transform: translateX(2px);
}
.entry .kb-link {
  width: 24px; height: 24px; padding: 3px;
  color: var(--text-3); opacity: 0;
  transition: opacity 0.15s var(--ease), color 0.15s var(--ease);
}
.entry:hover .kb-link { opacity: 1; }
.entry .kb-link:hover { color: var(--accent-text); background: var(--accent-weak); }
.kb-entry .summary { color: var(--text-2); }
.kb-body { white-space: pre-wrap; word-break: break-word; max-height: 52vh; overflow-y: auto; }
.entry .t { font-size: 11.5px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.entry .summary {
  font-size: 13.5px; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.entry .score {
  font-size: 11px; color: var(--accent-text);
  background: var(--accent-weak); border-radius: var(--r-sm); padding: 1px 7px;
  font-variant-numeric: tabular-nums;
}
.entry .chunk-hit {
  grid-column: 1 / -1;
  font-size: 11px; color: var(--text-3);
  background: var(--surface-2); border-radius: var(--r-sm);
  padding: 4px 9px; margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sleep-overview { align-items: start; }
.sleep-segments {
  grid-column: 3 / -1;
  display: grid; gap: 3px;
  font-size: 11.5px; color: var(--text-3);
}

.tl-foot { display: flex; justify-content: center; padding: 12px 0 4px; }
.end-note { font-size: 11.5px; color: var(--text-3); letter-spacing: 0.08em; }

/* ---- 详情侧栏 ---- */
.meta { font-size: 11.5px; color: var(--text-3); flex: 1; }
.raw {
  background: var(--surface-2); border-radius: var(--r);
  padding: 10px 12px; font-size: 13px; color: var(--text-2); margin: 0;
}

/* ---- 对话条目与回看原文 ---- */
.chat-summary { display: flex; flex-direction: column; gap: 2px; white-space: normal; overflow: visible; }
.chat-meta { font-style: normal; font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.chat-transcript { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; padding: 4px 2px; }
.chat-line { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 8px; align-items: start; }
.chat-role { font-size: 11px; color: var(--text-3); text-align: right; padding-top: 7px; }
.chat-line.user .chat-role { color: var(--accent-text); }
.chat-text { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--r); padding: 8px 11px; font-size: 13px; color: var(--text); }
.chat-line.user .chat-text { background: var(--accent-weak); border-color: color-mix(in srgb, var(--accent) 30%, var(--border)); }
.chat-text p { margin: 0 0 4px; white-space: pre-wrap; word-break: break-word; }
.chat-text p:last-child { margin-bottom: 0; }
.chat-text .err { color: var(--danger); font-size: 12.5px; }
.chat-parsed { margin: 6px 0 0; padding-left: 18px; display: grid; gap: 2px; font-size: 12px; color: var(--text-2); }
.chat-time { display: block; margin-top: 6px; font-size: 10.5px; color: var(--text-3); font-variant-numeric: tabular-nums; }
textarea.mono { font-family: var(--font-mono); font-size: 12px; line-height: 1.6; }
.sleep-day-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 14px; }
.sleep-day-stats div { display: flex; flex-direction: column; padding: 12px; background: var(--surface-2); border-radius: var(--r); }
.sleep-day-stats b { font-size: 20px; }
.sleep-day-stats span { font-size: 11px; color: var(--text-3); }
.sleep-detail-list { display: grid; gap: 8px; margin-bottom: 14px; }
.sleep-detail-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--r); }
.sleep-detail-row > div { display: grid; gap: 3px; min-width: 0; }
.sleep-detail-row b { font-size: 13px; font-weight: 600; }
.sleep-detail-row span { font-size: 11.5px; color: var(--text-3); }
.drawer .field > label:not(.checkbox) { display: block; margin: 10px 0 5px; }
.moment-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.moment-row :deep(.dp--main) { width: 150px; }

@media (max-width: 760px) {
  .tl::before { display: none; }
  .day { flex-direction: column; gap: 4px; }
  .day-aside { width: auto; flex: none; text-align: left; padding: 12px 0 4px; }
  .day-node { display: none; }
  .day-date { display: inline-block; }
  .day-meta { display: inline-block; margin-left: 8px; }
  .sleep-segments { grid-column: 1 / -1; }
  .sleep-day-stats { grid-template-columns: 1fr; }
}
</style>
