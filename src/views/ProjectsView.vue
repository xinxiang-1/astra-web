<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ArtIcon from '@/components/ui/ArtIcon.vue'
import ArtFooter from '@/components/ArtFooter.vue'
import {
  listCreativeProjects,
  deleteCreativeProject,
  getArtProject,
  getSignatureProject,
  saveSignatureProject,
  saveArtProject,
  importCreativeWorkflow,
  type CreativeProjectSummary,
} from '@/lib/art-projects'
import {
  readSignatureProject,
  signatureProjectFilename,
  SIGNATURE_PROJECT_ACCEPT,
  SIGNATURE_PROJECT_ENGINE,
} from '@/lib/signature-portrait/project'
import { exportSignaturePng } from '@/lib/signature-portrait/png-export'
import { signatureProjectThumbnail } from '@/lib/signature-project-thumbnail'
import {
  CREATIVE_WORKFLOW_ACCEPT,
  createCreativeWorkflowPackage,
  creativeWorkflowFilename,
  readCreativeWorkflowPackage,
} from '@/lib/creative-workflow-package'
import {
  ART_PROJECT_PACKAGE_ACCEPT,
  artProjectPackageFilename,
  createArtProjectPackage,
  readArtProjectPackage,
} from '@/lib/art-project-package'
import { triggerDownload } from '@/lib/ascii'
const projects = ref<CreativeProjectSummary[]>([])
let disposed = false
let refreshGeneration = 0
let transferController: AbortController | null = null
const loading = ref(true)
const error = ref('')
const filter = ref('全部')
const search = ref('')
const removing = ref('')
const busy = ref(false)
const packageInput = ref<HTMLInputElement | null>(null)
const transferring = ref('')
const transferStatus = ref('')
const shown = computed(() =>
  projects.value.filter(
    (p) =>
      (filter.value === '全部' ||
        p.kind ===
          ({ 图片: 'image', 视频: 'video', 签名: 'signature' } as Record<string, string>)[
            filter.value
          ]) &&
      p.name.includes(search.value.trim()),
  ),
)
async function refresh() {
  const generation = ++refreshGeneration
  error.value = ''
  try {
    const list = await listCreativeProjects()
    if (!disposed && generation === refreshGeneration) projects.value = list
  } catch (cause) {
    if (!disposed && generation === refreshGeneration)
      error.value =
        cause instanceof Error ? cause.message : '无法读取本地项目，请检查浏览器存储权限后重试。'
  } finally {
    if (!disposed && generation === refreshGeneration) loading.value = false
  }
}
async function downloadPackage(project: CreativeProjectSummary, workflow = false) {
  if (transferring.value) return
  transferring.value = workflow ? `workflow:${project.id}` : project.id
  error.value = ''
  transferStatus.value = '正在打包原始素材…'
  const controller = new AbortController()
  transferController = controller
  try {
    const source =
      project.kind === 'signature'
        ? await getSignatureProject(project.id, controller.signal)
        : await getArtProject(project.id)
    if (!source) throw new Error('此作品已移除，请刷新项目列表。')
    let blob: Blob
    if (workflow) {
      if ('file' in source || !source.origin) throw new Error('此作品没有可打包的签名原作。')
      const original = await getSignatureProject(source.origin.projectId, controller.signal)
      if (!original || original.signatureHash !== source.origin.sha256)
        throw new Error('签名原作已移除或版本不匹配，请先从备份恢复原作。')
      transferStatus.value = '正在打包签名原作与字符派生…'
      blob = await createCreativeWorkflowPackage(original, source, controller.signal)
    } else blob = 'file' in source ? source.file : await createArtProjectPackage(source)
    if (disposed || controller.signal.aborted) return
    triggerDownload(
      blob,
      workflow
        ? creativeWorkflowFilename(project.name)
        : project.kind === 'signature'
          ? signatureProjectFilename(project.name)
          : artProjectPackageFilename(project.name),
    )
    transferStatus.value = workflow
      ? '工作流包已下载，包含签名原作与字符派生，可在另一浏览器一起导入。'
      : '作品包已生成。请保留下载文件，用于备份或换设备继续创作。'
  } catch (cause) {
    if (disposed || controller.signal.aborted) return
    transferStatus.value = ''
    error.value = cause instanceof Error ? cause.message : '作品包下载失败，请重试。'
  } finally {
    if (transferController === controller) {
      transferController = null
      transferring.value = ''
    }
  }
}
async function importPackage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || transferring.value) return
  transferring.value = 'import'
  error.value = ''
  transferStatus.value = '正在校验作品包与原始素材…'
  const controller = new AbortController()
  transferController = controller
  try {
    let notice: string
    if (file.name.toLowerCase().endsWith(CREATIVE_WORKFLOW_ACCEPT)) {
      transferStatus.value = '正在校验签名原作与字符派生…'
      const restored = await readCreativeWorkflowPackage(file, controller.signal)
      try {
        const thumbnail = await signatureProjectThumbnail(
          await exportSignaturePng(restored.signature, {
            longEdge: 420,
            signal: {
              get cancelled() {
                return controller.signal.aborted
              },
            },
          }),
          controller.signal,
        )
        if (disposed || controller.signal.aborted) return
        const saved = await importCreativeWorkflow(
          {
            file: restored.signatureFile,
            name: restored.project.origin!.name,
            thumbnail,
            engineVersion: SIGNATURE_PROJECT_ENGINE,
          },
          restored.project,
          restored.workflowKey,
          controller.signal,
        )
        notice = saved.reused
          ? '此工作流版本已导入，签名原作与字符派生保持完整。'
          : '工作流已导入，签名原作与字符派生已一起保存；本地已有改动会保留。字符字体可能随设备变化。'
      } finally {
        restored.dispose()
      }
    } else if (file.name.toLowerCase().endsWith(SIGNATURE_PROJECT_ACCEPT)) {
      const restored = await readSignatureProject(file, { signal: controller.signal })
      try {
        const scene = restored.project
        const thumbnail = await signatureProjectThumbnail(
          await exportSignaturePng(scene, {
            longEdge: 420,
            signal: {
              get cancelled() {
                return controller.signal.aborted
              },
            },
          }),
          controller.signal,
        )
        if (disposed) return
        await saveSignatureProject(
          { file, name: scene.portraitName, thumbnail, engineVersion: SIGNATURE_PROJECT_ENGINE },
          controller.signal,
        )
        notice = '签名原作已保存到我的项目，可继续编辑。相同版本不会重复添加。'
      } finally {
        restored.dispose()
      }
    } else {
      const imported = await readArtProjectPackage(file)
      if (disposed || controller.signal.aborted) return
      await saveArtProject(imported.project, controller.signal)
      notice = imported.notice
    }
    if (disposed || controller.signal.aborted || transferController !== controller) return
    filter.value = '全部'
    search.value = ''
    await refresh()
    if (!disposed && !controller.signal.aborted && transferController === controller)
      transferStatus.value = notice
  } catch (cause) {
    if (disposed || controller.signal.aborted) return
    transferStatus.value = ''
    error.value = cause instanceof Error ? cause.message : '无法导入作品包，请重试。'
  } finally {
    if (transferController === controller) {
      transferController = null
      transferring.value = ''
    }
  }
}
function cancelTransfer() {
  transferController?.abort()
  transferController = null
  transferring.value = ''
  transferStatus.value = '已取消文件操作，已保存的项目会保留。'
}
async function remove(id: string) {
  busy.value = true
  try {
    await deleteCreativeProject(id)
    removing.value = ''
    await refresh()
  } catch {
    error.value = '删除未完成，请重试。'
  } finally {
    busy.value = false
  }
}
onMounted(refresh)
onBeforeUnmount(() => {
  disposed = true
  transferController?.abort()
})
function availableOrigin(project: CreativeProjectSummary) {
  const origin = project.origin
  return (
    origin &&
    projects.value.some(
      (p) =>
        p.kind === 'signature' && p.id === origin.projectId && p.signatureHash === origin.sha256,
    )
  )
}
</script>
<template>
  <div class="art-page">
    <div class="art-wrap projects-main">
      <header class="projects-heading">
        <div>
          <span class="art-eyebrow">YOUR PERSONAL STUDIO</span>
          <h1>
            我的项目<span> / {{ String(projects.length).padStart(2, '0') }}</span>
          </h1>
          <p>每一次灵感，都值得继续。</p>
        </div>
        <div class="project-heading-actions">
          <button
            class="art-button"
            :disabled="!!transferring || busy"
            @click="packageInput?.click()"
          >
            <ArtIcon name="upload" :size="18" />
            {{ transferring === 'import' ? '导入中…' : '导入作品包' }}
          </button>
          <input
            ref="packageInput"
            type="file"
            class="package-file-input"
            hidden
            :accept="`${ART_PROJECT_PACKAGE_ACCEPT},${SIGNATURE_PROJECT_ACCEPT},${CREATIVE_WORKFLOW_ACCEPT}`"
            aria-label="导入 Astra 作品包"
            @change="importPackage"
          />
          <RouterLink to="/ascii-art" class="art-button primary"
            ><ArtIcon name="plus" :size="18" /> 新建作品</RouterLink
          >
          <RouterLink to="/signature-portrait" class="art-button">签名画像</RouterLink>
        </div>
      </header>
      <div class="local-notice">
        <ArtIcon name="shield" :size="18" /><span>保存在此浏览器 · 源文件不上传</span
        ><small>下载作品包备份素材与参数，换设备后可导入继续创作。</small>
      </div>
      <p v-if="transferStatus" class="package-status" role="status" aria-live="polite">
        {{ transferStatus }}
        <button v-if="transferring" class="package-cancel" @click="cancelTransfer">
          取消文件操作
        </button>
      </p>
      <div class="projects-tools">
        <div>
          <button
            v-for="item in ['全部', '图片', '视频', '签名']"
            :key="item"
            class="art-chip"
            :class="{ active: filter === item }"
            :aria-pressed="filter === item"
            @click="filter = item"
          >
            {{ item }}
          </button>
        </div>
        <label
          ><ArtIcon name="search" :size="17" /><input
            v-model="search"
            aria-label="搜索项目"
            placeholder="搜索我的作品"
        /></label>
      </div>
      <p v-if="error" class="art-error" role="alert">
        {{ error }} <button @click="refresh">重试</button>
      </p>
      <p v-if="loading" class="art-loading-state">正在打开你的工作室…</p>
      <div v-else class="projects-grid">
        <RouterLink to="/ascii-art" class="new-project"
          ><ArtIcon name="plus" :size="38" />
          <h2>从照片开始</h2>
          <p>将你的照片与文字<br />变成独特的艺术作品。</p>
          <span class="art-eyebrow">CREATE SOMETHING YOURS</span></RouterLink
        >
        <article v-for="project in shown" :key="project.id" class="art-card project-card">
          <RouterLink
            :to="
              project.kind === 'signature'
                ? { name: 'signature-portrait', query: { signature: project.id } }
                : { name: 'ascii-art', query: { project: project.id } }
            "
            class="project-open"
            ><img :src="project.thumbnail" :alt="project.name" />
            <div class="art-card-info">
              <div>
                <h3>{{ project.name }}</h3>
                <p>
                  {{
                    project.kind === 'signature'
                      ? '签名原作'
                      : project.kind === 'image'
                        ? '图片'
                        : '视频'
                  }}
                  ·
                  {{
                    new Date(project.updatedAt).toLocaleString('zh-CN', {
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  }}
                </p>
              </div>
              <ArtIcon :size="16" /></div
          ></RouterLink>
          <p v-if="project.origin" class="project-origin">
            <RouterLink
              v-if="availableOrigin(project)"
              :to="{ name: 'signature-portrait', query: { signature: project.origin.projectId } }"
              >打开签名原作 · {{ project.origin.name }}</RouterLink
            >
            <span v-else>签名来源 · {{ project.origin.name }}（原作未保存在此浏览器）</span>
          </p>
          <div v-if="availableOrigin(project)" class="workflow-actions">
            <button :disabled="!!transferring || busy" @click="downloadPackage(project, true)">
              {{ transferring === `workflow:${project.id}` ? '工作流打包中…' : '下载完整工作流' }}
            </button>
            <small>包含签名原作与字符派生</small>
          </div>
          <div class="project-actions">
            <template v-if="removing === project.id"
              ><span>{{
                project.kind === 'signature' ? '删除原作？已有派生作品保留。' : '删除本地项目？'
              }}</span>
              ><button :disabled="busy" @click="remove(project.id)">确认删除</button
              ><button :disabled="busy" @click="removing = ''">取消</button></template
            ><template v-else
              ><span>保存在此设备</span
              ><button :disabled="!!transferring || busy" @click="downloadPackage(project)">
                {{ transferring === project.id ? '打包中…' : '下载作品包' }}</button
              ><button :disabled="!!transferring || busy" @click="removing = project.id">
                删除
              </button></template
            >
          </div>
        </article>
      </div>
      <div v-if="!loading && !shown.length" class="projects-empty">
        <h2>{{ projects.length ? '没有匹配的项目' : '你的作品，会在这里慢慢积累。' }}</h2>
        <p>在字符编辑器中保存项目，或在签名页点击“保存到我的项目”，即可随时回来继续创作。</p>
        <RouterLink to="/gallery" class="art-link"
          >去作品库找一点灵感 <ArtIcon :size="17"
        /></RouterLink>
      </div>
    </div>
    <ArtFooter />
  </div>
</template>
<style scoped>
.workflow-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  padding: 0 14px 12px;
}
.workflow-actions button,
.package-cancel {
  min-height: 44px;
  border: 0;
  background: none;
  padding: 8px 0;
  font: 12px var(--font-body);
  color: var(--accent);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.workflow-actions button:disabled {
  cursor: wait;
  opacity: 0.5;
}
.workflow-actions small {
  font-size: 11px;
  color: var(--text-muted);
}
.package-cancel {
  margin-left: 12px;
}
.project-origin {
  margin: 0;
  padding: 0 14px 12px;
  font-size: 12px;
  overflow-wrap: anywhere;
  color: var(--text-muted);
}
.project-origin a {
  color: var(--accent);
}
.projects-main {
  padding-top: 60px;
  padding-bottom: 70px;
  min-height: calc(100dvh - 190px);
}
.projects-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
}
.project-heading-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.project-heading-actions .art-button {
  gap: 12px;
}
.package-file-input {
  display: none;
}
.package-status {
  color: var(--accent);
  font-size: 12px;
  line-height: 1.8;
  padding: 12px 0;
}
.projects-heading h1 {
  font-size: 60px;
  margin: 14px 0;
}
.projects-heading h1 span {
  font:
    13px Consolas,
    monospace;
  color: var(--text-muted);
  vertical-align: middle;
  margin-left: 15px;
}
.projects-heading p {
  color: var(--art-muted);
  font-size: 14px;
}
.local-notice {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text-muted);
  font-size: 12px;
  border-top: 1px solid var(--art-line);
  border-bottom: 1px solid var(--art-line);
  padding: 15px 0;
  margin-top: 30px;
}
.local-notice small {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-muted);
}
.projects-tools {
  display: flex;
  justify-content: space-between;
  margin: 30px 0;
}
.projects-tools > div {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.projects-tools label {
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--art-line);
}
.projects-tools input {
  background: none;
  border: none;
  font: 12px var(--font-body);
  color: var(--art-ink);
  padding: 10px;
  width: 150px;
}
.projects-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 22px;
}
.new-project {
  min-height: 330px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  border: 1px dashed var(--border);
  text-align: center;
  text-decoration: none;
  transition: background 0.2s;
}
.new-project:hover {
  background: var(--bg-elevated);
}
.new-project h2 {
  font-size: 23px;
  margin: 22px 0 10px;
}
.new-project p {
  color: var(--art-muted);
  font-size: 12px;
  line-height: 1.9;
}
.new-project .art-eyebrow {
  font-size: 8px;
  color: var(--text-muted);
  margin-top: 22px;
}
.project-open {
  display: block;
  text-decoration: none;
}
.project-open img {
  height: 245px;
  width: 100%;
  object-fit: cover;
  display: block;
  background: #141a15;
}
.project-actions {
  border-top: 1px solid var(--art-line);
  display: flex;
  align-items: center;
  padding: 10px 14px;
  font-size: 10px;
  gap: 10px;
}
.project-actions > span {
  margin-right: auto;
  color: var(--text-muted);
}
.project-actions button {
  min-height: 44px;
  background: none;
  border: 0;
  color: var(--text-muted);
  font: 11px var(--font-body);
  cursor: pointer;
  padding: 8px;
}
.project-actions button:hover {
  color: var(--danger);
}
.project-actions button:disabled {
  opacity: 0.5;
  cursor: wait;
}
.projects-empty {
  margin-top: 38px;
  border-top: 1px solid var(--art-line);
  padding: 25px 0;
}
.projects-empty h2 {
  font-size: 25px;
}
.projects-empty p {
  font-size: 12px;
  color: var(--art-muted);
  line-height: 1.9;
}
.projects-empty .art-link {
  margin-top: 12px;
  color: var(--accent);
}
@media (max-width: 1100px) {
  .projects-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
@media (max-width: 800px) {
  .projects-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .local-notice {
    flex-wrap: wrap;
  }
  .local-notice small {
    width: 100%;
    margin: 0;
  }
  .projects-heading h1 {
    font-size: 45px;
  }
}
@media (max-width: 550px) {
  .projects-main {
    padding-top: 30px;
  }
  .projects-heading {
    align-items: start;
    flex-direction: column;
  }
  .projects-heading h1 {
    font-size: 39px;
  }
  .projects-heading .art-button {
    width: 100%;
  }
  .project-heading-actions {
    width: 100%;
  }
  .projects-tools {
    flex-direction: column;
    gap: 15px;
  }
  .projects-grid {
    grid-template-columns: 1fr;
  }
  .new-project {
    min-height: 260px;
  }
  .project-open img {
    height: 320px;
  }
  .projects-tools input {
    width: 100%;
  }
}
</style>
