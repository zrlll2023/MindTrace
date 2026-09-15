<template>
  <div class="capture">
    <div class="messages" ref="listEl">
      <div v-if="!store.messages.length" class="empty">
        <h2>今天怎么样？</h2>
        <p>随手倒进来：睡眠、琐事、对话、喜欢的句子、突然的想法……<br />AI 会帮你拆解归档。</p>
        <p class="eg">例如：「睡了6.5小时，被导师骂了一顿，看到一句话：纸上得来终觉浅，突然想到RAG评估好像有新方法」</p>
      </div>

      <div v-for="(m, i) in store.messages" :key="i" class="msg" :class="m.role">
        <div class="bubble">
          <template v-if="m.role === 'user'">{{ m.text }}</template>
          <template v-else>
            <p v-if="m.error" class="err">⚠️ {{ m.error }}</p>
            <p v-if="m.text">{{ m.text }}</p>
            <template v-if="m.parsed && !m.committed">
              <EntryCard
                v-for="(p, j) in m.parsed"
                :key="j"
                :entry="p"
                @remove="m.parsed!.splice(j, 1)"
              />
              <button class="primary" :disabled="!m.parsed?.length" @click="confirm(m)">
                确认归档（{{ m.parsed?.length }} 条）
              </button>
            </template>
          </template>
        </div>
      </div>

      <div v-if="store.busy" class="msg assistant">
        <div class="bubble typing">AI 正在解析…</div>
      </div>
    </div>

    <div class="composer">
      <textarea
        v-model="store.input"
        rows="3"
        placeholder="随手记录…（Enter 发送，Ctrl+Enter 换行）"
        @keydown.enter.exact.prevent="submit"
        @keydown.ctrl.enter.stop
      />
      <button :disabled="store.busy" @click="submit">{{ store.busy ? '解析中…' : '发送' }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'
import { useCaptureStore, ChatMessageItem } from '../stores/capture'
import EntryCard from '../components/EntryCard.vue'

const store = useCaptureStore()
const listEl = ref<HTMLElement>()

function submit(): void {
  void store.send(store.input)
}

async function confirm(m: ChatMessageItem): Promise<void> {
  if (m.parsed) await store.commit(m, m.parsed)
}

watch(
  () => store.messages.length,
  async () => {
    await nextTick()
    listEl.value?.scrollTo({ top: listEl.value.scrollHeight, behavior: 'smooth' })
  }
)
</script>

<style scoped>
.capture { display: flex; flex-direction: column; height: calc(100vh - 48px); }
.messages { flex: 1; overflow-y: auto; padding: 4px 8px; }
.empty { text-align: center; margin-top: 14vh; color: #666; }
.empty h2 { font-size: 22px; margin-bottom: 8px; }
.eg { font-size: 12px; color: #999; max-width: 560px; margin: 12px auto 0; }
.msg { display: flex; margin: 10px 0; }
.msg.user { justify-content: flex-end; }
.msg.assistant { justify-content: flex-start; }
.bubble {
  max-width: 640px; padding: 10px 14px; border-radius: 14px; font-size: 14px;
  background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.06);
}
.msg.user .bubble { background: #4f7cff; color: #fff; }
.msg.assistant .bubble { min-width: 320px; }
.typing { color: #888; }
.err { color: #d33; font-size: 13px; }
.primary {
  margin-top: 8px; padding: 7px 16px; border: none; border-radius: 8px;
  background: #0a8f4d; color: #fff; font-size: 13px; cursor: pointer;
}
.primary:disabled { opacity: .4; cursor: not-allowed; }
.composer { display: flex; gap: 10px; padding: 12px 8px 4px; align-items: flex-end; }
.composer textarea {
  flex: 1; resize: none; border: 1px solid #d0d3d8; border-radius: 12px;
  padding: 10px 14px; font-size: 14px; font-family: inherit; background: #fff;
}
.composer textarea:focus { outline: 2px solid #4f7cff33; border-color: #4f7cff; }
.composer button {
  padding: 10px 22px; border: none; border-radius: 12px; background: #4f7cff;
  color: #fff; font-size: 14px; cursor: pointer;
}
.composer button:disabled { opacity: .5; cursor: not-allowed; }
</style>
