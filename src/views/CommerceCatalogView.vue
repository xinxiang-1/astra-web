<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import ArtFooter from '@/components/ArtFooter.vue'
import { ApiError } from '@/api/http'
import {
  fetchCommerceCapabilities,
  fetchCommerceProducts,
  fetchCommerceProduct,
  type CommerceCapabilities,
  type CommerceProduct,
  type CommerceProductCard,
  type CommerceProductKind,
} from '@/api/commerce'
import { formatPurchasedFileSize } from '@/lib/purchased-assets'

const props = defineProps<{ slug?: string }>()
const kind = ref<CommerceProductKind | ''>('')
const products = ref<CommerceProductCard[]>([])
const product = ref<CommerceProduct | null>(null)
const capabilities = ref<CommerceCapabilities | null>(null)
const selectedId = ref('')
const selected = computed(() => product.value?.skus.find((sku) => sku.id === selectedId.value))
const busy = ref(false)
const loaded = ref(false)
const cursor = ref<string | null>(null)
const error = ref('')
const unavailable = ref(false)
const failedImages = ref(new Set<string>())
let controller: AbortController | undefined
const saleStatus = computed(() => {
  if (!capabilities.value) return '购买状态暂时无法确认，请稍后刷新。'
  if (!capabilities.value.paymentEnabled) return '购买尚未开放，你可以先了解内容与交付说明。'
  if (capabilities.value.mockPayment) return '当前为测试环境，不提供真实付款。'
  return '购买入口准备中，当前仅展示内容与交付说明。'
})
function label(value: string) {
  return value === 'TEMPLATE_PACK'
    ? '模板合集'
    : value === 'CREATION_KIT'
      ? '创作工作流'
      : '内容合集'
}
function money(cents: number, currency: string) {
  return currency === 'CNY' && Number.isSafeInteger(cents) && cents > 0
    ? `¥${(cents / 100).toFixed(2)}`
    : '价格待确认'
}
function imageFailed(url: string) {
  failedImages.value = new Set([...failedImages.value, url])
}
async function load(append = false) {
  if (append && (busy.value || !cursor.value)) return
  controller?.abort()
  const attempt = new AbortController()
  controller = attempt
  busy.value = true
  error.value = ''
  unavailable.value = false
  if (!append) {
    products.value = []
    product.value = null
    capabilities.value = null
    selectedId.value = ''
    cursor.value = null
    loaded.value = false
    failedImages.value = new Set()
  }
  const slug = props.slug
  const requests = await Promise.allSettled([
    slug
      ? fetchCommerceProduct(slug, attempt.signal)
      : fetchCommerceProducts(
          kind.value || undefined,
          append ? (cursor.value ?? undefined) : undefined,
          attempt.signal,
        ),
    append ? Promise.resolve(capabilities.value) : fetchCommerceCapabilities(attempt.signal),
  ])
  if (attempt.signal.aborted || controller !== attempt) return
  const [content, flags] = requests
  capabilities.value = flags.status === 'fulfilled' ? flags.value : null
  if (content.status === 'fulfilled') {
    if (slug) {
      product.value = content.value as CommerceProduct
      selectedId.value = product.value.skus[0]?.id ?? ''
    } else {
      const page = content.value as { items: CommerceProductCard[]; nextCursor?: string | null }
      products.value = append ? [...products.value, ...page.items] : page.items
      cursor.value = page.nextCursor ?? null
    }
    loaded.value = true
  } else {
    const cause = content.reason
    unavailable.value =
      Boolean(slug) && cause instanceof ApiError && (cause.status === 404 || cause.status === 400)
    error.value = unavailable.value
      ? '这个合集不存在或暂时未公开。已购内容请从购买账户中查看。'
      : '内容暂时无法读取，请稍后重试。免费模板仍可使用。'
  }
  busy.value = false
}
watch([() => props.slug, kind], () => void load(), { immediate: true })
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <div class="art-page commerce-catalog">
    <div class="art-wrap catalog-content">
      <nav class="catalog-links" aria-label="内容导航">
        <RouterLink to="/templates">免费入门模板</RouterLink>
        <RouterLink v-if="slug" to="/collections">全部内容合集</RouterLink>
        <RouterLink to="/account/library">我的已购内容 ↗</RouterLink>
      </nav>
      <header class="catalog-heading">
        <span class="art-eyebrow">ASTRA · COLLECTIONS</span>
        <h1>{{ product?.name ?? (slug ? '合集详情' : '为创作，多一点灵感。') }}</h1>
        <p>
          {{ product?.summary ?? '了解内容版本、交付文件与使用许可，再选择适合你的创作起点。' }}
        </p>
      </header>
      <p class="sale-status" role="status">
        {{ busy && !loaded ? '正在读取内容与购买状态…' : saleStatus }}
      </p>
      <section :aria-label="slug ? '合集信息' : '内容合集'" :aria-busy="busy">
        <div v-if="!slug" class="catalog-tools" role="group" aria-label="筛选内容类型">
          <button
            v-for="filter in [
              { value: '', name: '全部' },
              { value: 'TEMPLATE_PACK', name: '模板合集' },
              { value: 'CREATION_KIT', name: '创作工作流' },
            ]"
            :key="filter.value"
            class="art-chip"
            :class="{ active: kind === filter.value }"
            :aria-pressed="kind === filter.value"
            @click="kind = filter.value as CommerceProductKind | ''"
          >
            {{ filter.name }}
          </button>
        </div>
        <div v-if="error" class="catalog-notice" role="alert">
          <p>{{ error }}</p>
          <button
            v-if="!unavailable"
            class="art-button"
            :disabled="busy"
            @click="load(Boolean(cursor && loaded))"
          >
            重新读取
          </button>
          <RouterLink v-else to="/collections" class="art-button">返回内容合集</RouterLink>
        </div>
        <p v-if="loaded && !slug && !error && !products.length" class="catalog-notice">
          这个分类还没有公开内容。先从免费模板开始创作吧。
        </p>
        <ul v-if="!slug && products.length" class="product-grid">
          <li v-for="item in products" :key="item.id" :data-product="item.id">
            <RouterLink :to="`/collections/${item.slug}`" class="product-card">
              <div class="product-preview">
                <img
                  v-if="item.previewUrls[0] && !failedImages.has(item.previewUrls[0])"
                  :src="item.previewUrls[0]"
                  alt=""
                  loading="lazy"
                  referrerpolicy="no-referrer"
                  @error="imageFailed(item.previewUrls[0])"
                />
                <span v-else>{{ label(item.kind) }}<small>预览暂不可用</small></span>
              </div>
              <div class="product-copy">
                <span class="art-eyebrow">{{ label(item.kind) }}</span>
                <h2>{{ item.name }}</h2>
                <p>{{ item.summary }}</p>
                <span class="card-action">查看版本与交付说明 ↗</span>
              </div>
            </RouterLink>
          </li>
        </ul>
        <div
          v-if="product"
          :key="product.id"
          class="product-detail"
          :data-product-detail="product.id"
        >
          <div class="product-body">
            <div class="detail-previews">
              <div v-for="url in product.previewUrls" :key="url" class="product-preview">
                <img
                  v-if="!failedImages.has(url)"
                  :src="url"
                  :alt="`${product.name}公开预览`"
                  loading="lazy"
                  referrerpolicy="no-referrer"
                  @error="imageFailed(url)"
                />
                <span v-else>预览暂不可用<small>交付信息见下方清单</small></span>
              </div>
            </div>
            <label class="version-label"
              >选择内容版本
              <select v-model="selectedId" aria-label="选择内容版本">
                <option v-for="sku in product.skus" :key="sku.id" :value="sku.id">
                  版本 {{ sku.release.version }} · {{ money(sku.amountCent, sku.currency) }}
                </option>
              </select>
            </label>
            <template v-if="selected">
              <section class="delivery-information" aria-labelledby="delivery-heading">
                <h2 id="delivery-heading">这一版本包含什么</h2>
                <ul>
                  <li v-for="content in selected.release.deliveryContents" :key="content">
                    {{ content }}
                  </li>
                </ul>
                <p>
                  引擎 {{ selected.release.engineVersion }} · 作品包格式
                  {{ selected.release.projectSchemaVersion }}
                </p>
                <ul class="delivery-files">
                  <li
                    v-for="file in selected.release.assets"
                    :key="file.id"
                    :data-catalog-asset="file.id"
                  >
                    {{ file.fileName }} <span>{{ formatPurchasedFileSize(file.sizeBytes) }}</span>
                  </li>
                </ul>
                <p class="muted">
                  购买后从账户领取文件；导入作品包会创建新的本地项目。请先确认版本和设备兼容性。
                </p>
              </section>
              <section :key="selected.id" class="purchase-policies" aria-label="购买与使用条款">
                <h2>购买前，请了解这些说明</h2>
                <details
                  v-for="entry in [
                    { name: '使用许可', policy: selected.release.license },
                    { name: '购买条款', policy: selected.purchaseTerms },
                    { name: '退款说明', policy: selected.refundPolicy },
                  ]"
                  :key="entry.name"
                >
                  <summary>{{ entry.name }} · {{ entry.policy.version }}</summary>
                  <p class="policy-copy">{{ entry.policy.content }}</p>
                </details>
              </section>
            </template>
          </div>
          <aside v-if="selected" class="purchase-summary" aria-label="当前版本价格">
            <span class="art-eyebrow">{{ label(product.kind) }}</span>
            <h2>版本 {{ selected.release.version }}</h2>
            <p class="product-price" data-catalog-price>
              {{ money(selected.amountCent, selected.currency) }}
            </p>
            <p>当前版本价格。交付范围以文件清单和购买条款为准。</p>
            <button class="art-button" disabled>
              {{
                !capabilities
                  ? '购买状态待确认'
                  : capabilities.paymentEnabled
                    ? '购买入口准备中'
                    : '购买尚未开放'
              }}
            </button>
            <p>{{ saleStatus }}</p>
            <p v-if="product.kind === 'CREATION_KIT' && !capabilities?.creationKitReady">
              创作工作流尚未开放使用。
            </p>
            <RouterLink to="/templates">先体验免费模板 ↗</RouterLink>
          </aside>
        </div>
        <div class="catalog-bottom">
          <button v-if="cursor && !slug" class="art-button" :disabled="busy" @click="load(true)">
            读取更多
          </button>
          <button v-if="loaded" class="art-button" :disabled="busy" @click="load()">
            刷新内容
          </button>
        </div>
      </section>
      <p class="free-note">
        现有字符创作、PNG、视频、HTML 和本地作品包继续免费。<RouterLink to="/ascii-art"
          >打开免费工作台 ↗</RouterLink
        >
      </p>
    </div>
    <ArtFooter />
  </div>
</template>

<style scoped>
.catalog-content {
  padding-block: 36px 72px;
  min-height: 70vh;
}
.catalog-links,
.catalog-tools,
.catalog-bottom {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
}
.catalog-links {
  color: var(--text-muted);
  font-size: 13px;
}
.catalog-heading {
  padding-block: 44px 28px;
  max-width: 800px;
}
.catalog-heading h1 {
  font: 500 clamp(32px, 5vw, 52px) var(--font-display);
  margin: 16px 0;
  overflow-wrap: anywhere;
}
.catalog-heading p,
.sale-status,
.free-note {
  line-height: 1.9;
}
.sale-status {
  border-block: 1px solid var(--border);
  padding: 18px 0;
  margin: 0 0 28px;
}
.catalog-tools {
  margin-bottom: 28px;
}
.catalog-notice {
  padding: 24px 0;
}
.product-grid {
  list-style: none;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 28px;
}
.product-card {
  display: block;
  height: 100%;
  text-decoration: none;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}
.product-card:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 4px;
}
.product-preview {
  aspect-ratio: 4/3;
  background: color-mix(in srgb, var(--text) 4%, var(--bg));
  display: grid;
  place-items: center;
  overflow: hidden;
}
.product-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.product-preview span {
  font: 500 24px var(--font-display);
  text-align: center;
  padding: 20px;
}
.product-preview small {
  display: block;
  font: 13px var(--font-body);
  color: var(--text-muted);
  margin-top: 12px;
}
.product-copy {
  padding: 24px;
  overflow-wrap: anywhere;
}
.product-copy h2,
.product-detail h2 {
  font: 500 24px var(--font-display);
  line-height: 1.5;
  margin: 14px 0;
}
.product-copy p {
  line-height: 1.8;
  color: var(--text-muted);
}
.card-action {
  display: inline-block;
  margin-top: 20px;
  font-size: 13px;
}
.product-detail {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 320px);
  gap: 40px;
  align-items: start;
}
.product-body,
.purchase-summary {
  min-width: 0;
  overflow-wrap: anywhere;
}
.detail-previews {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.detail-previews .product-preview:only-child {
  grid-column: 1/-1;
}
.version-label {
  display: block;
  margin-top: 28px;
}
.version-label select {
  display: block;
  width: 100%;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  margin-top: 10px;
}
.delivery-information {
  padding-block: 20px;
  line-height: 1.9;
}
.delivery-files {
  list-style: none;
  padding: 0;
  border-block: 1px solid var(--border);
}
.delivery-files li {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
}
.delivery-files span {
  white-space: nowrap;
}
.muted,
.free-note {
  color: var(--text-muted);
  font-size: 13px;
}
.purchase-policies details {
  border-bottom: 1px solid var(--border);
  padding: 18px 0;
}
.purchase-policies summary {
  cursor: pointer;
}
.policy-copy {
  white-space: pre-wrap;
  line-height: 1.9;
}
.purchase-summary {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 28px;
  position: sticky;
  top: 24px;
}
.purchase-summary p {
  line-height: 1.8;
  font-size: 13px;
}
.purchase-summary .product-price {
  font: 500 40px var(--font-display);
  margin-block: 16px;
}
.purchase-summary button {
  width: 100%;
  margin-block: 16px 4px;
}
.catalog-bottom {
  margin-top: 36px;
}
.free-note {
  margin-top: 48px;
  padding-top: 24px;
  border-top: 1px solid var(--border);
}
@media (max-width: 900px) {
  .product-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .product-detail {
    grid-template-columns: minmax(0, 1fr);
  }
  .purchase-summary {
    position: static;
  }
}
@media (max-width: 540px) {
  .product-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .detail-previews {
    grid-template-columns: minmax(0, 1fr);
  }
  .delivery-files li {
    flex-wrap: wrap;
  }
  .catalog-heading {
    padding-top: 32px;
  }
}
</style>
