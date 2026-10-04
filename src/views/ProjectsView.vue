<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import ArtIcon from '@/components/ui/ArtIcon.vue'
import ArtFooter from '@/components/ArtFooter.vue'
import {
  listArtProjects,
  deleteArtProject,
  saveArtProject,
  type ArtProject,
} from '@/lib/art-projects'
import {
  ART_PROJECT_PACKAGE_ACCEPT,
  artProjectPackageFilename,
  createArtProjectPackage,
  readArtProjectPackage,
} from '@/lib/art-project-package'
import { triggerDownload } from '@/lib/ascii'
const projects = ref<ArtProject[]>([])
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
      (filter.value === '全部' || p.kind === (filter.value === '图片' ? 'image' : 'video')) &&
      p.name.includes(search.value.trim()),
  ),
)
async function refresh() {
  error.value = ''
  try {
    projects.value = await listArtProjects()
  } catch {
    error.value = '无法读取本地项目，请检查浏览器存储权限后重试。'
  } finally {
    loading.value = false
  }
}
async function downloadPackage(project: ArtProject) {
  if (transferring.value) return
  transferring.value = project.id
  error.value = ''
  transferStatus.value = '正在打包原始素材…'
  try {
    const blob = await createArtProjectPackage(project)
    triggerDownload(blob, artProjectPackageFilename(project.name))
    transferStatus.value = '作品包已生成。请保留下载文件，用于备份或换设备继续创作。'
  } catch (cause) {
    transferStatus.value = ''
    error.value = cause instanceof Error ? cause.message : '作品包下载失败，请重试。'
  } finally {
    transferring.value = ''
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
  try {
    const { project, notice } = await readArtProjectPackage(file)
    try {
      await saveArtProject(project)
    } catch {
      throw new Error('浏览器未能保存作品包，存储空间可能不足。请保留备份文件后重试。')
    }
    filter.value = '全部'
    search.value = ''
    await refresh()
    transferStatus.value = notice
  } catch (cause) {
    transferStatus.value = ''
    error.value = cause instanceof Error ? cause.message : '无法导入作品包，请重试。'
  } finally {
    transferring.value = ''
  }
}
async function remove(id: string) {
  busy.value = true
  try {
    await deleteArtProject(id)
    removing.value = ''
    await refresh()
  } catch {
    error.value = '删除未完成，请重试。'
  } finally {
    busy.value = false
  }
}
onMounted(refresh)
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
            :accept="ART_PROJECT_PACKAGE_ACCEPT"
            aria-label="导入 Astra 作品包"
            @change="importPackage"
          />
          <RouterLink to="/ascii-art" class="art-button primary"
            ><ArtIcon name="plus" :size="18" /> 新建作品</RouterLink
          >
        </div>
      </header>
      <div class="local-notice">
        <ArtIcon name="shield" :size="18" /><span>保存在此浏览器 · 源文件不上传</span
        ><small>下载作品包备份素材与参数，换设备后可导入继续创作。</small>
      </div>
      <p v-if="transferStatus" class="package-status" role="status" aria-live="polite">
        {{ transferStatus }}
      </p>
      <div class="projects-tools">
        <div>
          <button
            v-for="item in ['全部', '图片', '视频']"
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
          <RouterLink :to="`/ascii-art?project=${project.id}`" class="project-open"
            ><img :src="project.thumbnail" :alt="project.name" />
            <div class="art-card-info">
              <div>
                <h3>{{ project.name }}</h3>
                <p>
                  {{ project.kind === 'image' ? '图片' : '视频' }} ·
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
          <div class="project-actions">
            <template v-if="removing === project.id"
              ><span>删除本地项目？</span
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
        <p>在编辑器中点击“保存项目”，即可保留素材和全部调整，随时回来继续创作。</p>
        <RouterLink to="/gallery" class="art-link"
          >去作品库找一点灵感 <ArtIcon :size="17"
        /></RouterLink>
      </div>
    </div>
    <ArtFooter />
  </div>
</template>
<style scoped>
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
