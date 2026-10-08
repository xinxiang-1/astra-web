<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ApiError, getAccessToken } from '@/api/http'
import type { CommerceCapabilities, CommerceOrder, CommerceSku } from '@/api/commerce'
import {
  orderRequest,
  readOrderCommand,
  submitOrderCommand,
  releaseClosedOrderCommand,
  type OrderCommand,
} from '@/lib/order-command'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{
  slug: string
  sku?: CommerceSku
  productName?: string
  productKind?: string
  capabilities: CommerceCapabilities | null
}>()
const auth = useAuthStore()
const token = ref<string | null>(null)
const command = ref<OrderCommand | null>(null)
const order = ref<CommerceOrder | null>(null)
const reviewing = ref(false)
const accepted = ref(false)
const busy = ref(false)
const error = ref('')
const needsLogin = ref(false)
let controller: AbortController | undefined
const canCreate = computed(
  () =>
    props.capabilities?.orderCreationEnabled === true &&
    props.sku &&
    (props.productKind !== 'CREATION_KIT' || props.capabilities.creationKitReady),
)
const loginTarget = computed(() => ({
  path: '/login',
  query: { returnTo: `/collections/${props.slug}` },
}))
const price = computed(() =>
  props.sku?.currency === 'CNY' &&
  Number.isSafeInteger(props.sku.amountCent) &&
  props.sku.amountCent > 0
    ? `¥${(props.sku.amountCent / 100).toFixed(2)}`
    : '金额待确认',
)
async function sync() {
  controller?.abort()
  const attempt = new AbortController()
  controller = attempt
  token.value = getAccessToken()
  needsLogin.value = !token.value
  command.value = null
  order.value = null
  reviewing.value = false
  accepted.value = false
  error.value = ''
  busy.value = true
  const identity = token.value
  try {
    if (identity) {
      const saved = await readOrderCommand(props.slug, identity, attempt.signal)
      if (!attempt.signal.aborted && getAccessToken() === identity) command.value = saved
    }
  } catch (cause) {
    if (!attempt.signal.aborted && getAccessToken() === identity)
      error.value = cause instanceof Error ? cause.message : '订单恢复记录暂不可用。'
  } finally {
    if (controller === attempt) busy.value = false
  }
}
async function submit(recover: boolean) {
  if (busy.value) return
  const identity = token.value
  if (!identity || getAccessToken() !== identity) {
    await sync()
    return
  }
  if (
    !recover &&
    (!canCreate.value ||
      !props.sku ||
      !reviewing.value ||
      !accepted.value ||
      command.value ||
      error.value)
  )
    return
  const attempt = new AbortController()
  controller?.abort()
  controller = attempt
  busy.value = true
  error.value = ''
  try {
    const result = await submitOrderCommand(
      props.slug,
      identity,
      attempt.signal,
      recover ? undefined : orderRequest(props.sku!),
    )
    if (attempt.signal.aborted || getAccessToken() !== identity) return
    order.value = result
    command.value = await readOrderCommand(props.slug, identity, attempt.signal)
    reviewing.value = false
    accepted.value = false
  } catch (cause) {
    if (attempt.signal.aborted || getAccessToken() !== identity) return
    if (cause instanceof ApiError && cause.status === 401) {
      needsLogin.value = true
      order.value = null
      command.value = null
    } else {
      error.value =
        cause instanceof ApiError && cause.code === 43002
          ? '商品或条款已更新，本次请求未创建订单。请刷新内容，重新阅读并确认。'
          : cause instanceof ApiError && [43003, 43004, 43001].includes(cause.code)
            ? '该版本已有订单、权益或未完成的请求。请从我的订单或已购内容核对。'
            : '订单结果暂时无法确认。请恢复原请求或从我的订单核对，避免重复下单。'
      try {
        command.value = await readOrderCommand(props.slug, identity, attempt.signal)
      } catch (storageCause) {
        error.value = storageCause instanceof Error ? storageCause.message : error.value
      }
      accepted.value = false
    }
  } finally {
    if (controller === attempt) busy.value = false
  }
}
function review() {
  if (getAccessToken() !== token.value) {
    void sync()
    return
  }
  accepted.value = false
  reviewing.value = true
}
function leaveReview() {
  reviewing.value = false
  accepted.value = false
}
async function restartClosed() {
  if (busy.value || !token.value || getAccessToken() !== token.value) return
  const identity = token.value
  const attempt = new AbortController()
  controller?.abort()
  controller = attempt
  busy.value = true
  error.value = ''
  try {
    await releaseClosedOrderCommand(props.slug, identity, attempt.signal)
    if (!attempt.signal.aborted && getAccessToken() === identity) await sync()
  } catch (cause) {
    if (!attempt.signal.aborted && getAccessToken() === identity)
      error.value = cause instanceof Error ? cause.message : '原订单状态暂时无法核对。'
  } finally { if (controller === attempt) busy.value = false }
}
function storage(event: StorageEvent) {
  if (event.key === 'astra_access_token' || event.key === null) void sync()
}
watch([() => props.slug, () => auth.user?.id], () => void sync(), { immediate: true })
watch(
  () => props.sku,
  () => {
    reviewing.value = false
    accepted.value = false
  },
)
onMounted(() => window.addEventListener('storage', storage))
onBeforeUnmount(() => {
  controller?.abort()
  window.removeEventListener('storage', storage)
})
</script>

<template>
  <section
    id="confirm-order"
    class="purchase-confirmation"
    aria-label="确认与恢复订单"
    :aria-busy="busy"
    data-order-confirmation
  >
    <h2>确认订单</h2>
    <p v-if="capabilities?.environment !== 'production'" class="environment-note">
      当前为测试环境。此处仅确认或恢复订单，不涉及真实付款，也不会发放内容权益。
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="busy" role="status">正在核对订单记录…</p>
    <div v-if="order" data-confirmed-order>
      <h3>{{ order.item.productName }} · {{ order.item.releaseVersion }}</h3>
      <p>订单号 {{ order.orderNo }}</p>
      <p>
        后台订单金额 ¥{{ (order.totalAmountCent / 100).toFixed(2) }} ·
        {{
          order.state === 'PENDING_PAYMENT'
            ? '待付款'
            : order.state === 'PAID'
              ? '已付款'
              : '已关闭'
        }}
      </p>
      <p>以订单详情中的原交付清单、条款和后台付款状态为准。</p>
      <RouterLink :to="`/account/orders/${order.id}`" class="art-button">查看订单详情 ↗</RouterLink>
      <button v-if="order.state === 'CLOSED'" class="art-button" :disabled="busy" @click="restartClosed">
        重新核对新订单
      </button>
    </div>
    <template v-else-if="needsLogin">
      <p>登录后，订单会归属你的购买账户。</p>
      <RouterLink :to="loginTarget" class="art-button">登录后继续 ↗</RouterLink>
    </template>
    <template v-else-if="command">
      <p>本标签页保存了一次订单请求。请先核对这次请求的结果。</p>
      <p class="command-copy">
        原商品编号 {{ command.request.skuId }} · 报价版本 {{ command.request.offerVersion }}
      </p>
      <p class="command-copy">
        购买条款 {{ command.request.termsVersion }} · 退款说明
        {{ command.request.refundPolicyVersion }} · 使用许可 {{ command.request.licenseVersion }}
      </p>
      <button class="art-button" :disabled="busy" @click="submit(true)">
        {{ command.orderId ? '读取原订单' : '恢复原订单请求' }}
      </button>
    </template>
    <template v-else-if="canCreate && !error">
      <button v-if="!reviewing" class="art-button" :disabled="busy" @click="review">
        核对版本与条款
      </button>
      <form v-else-if="sku" @submit.prevent="submit(false)">
        <h3>{{ productName }} · 版本 {{ sku.release.version }}</h3>
        <p>一份 · {{ price }} · 报价版本 {{ sku.offerVersion }}</p>
        <p>交付文件在付款经后台确认后，从购买账户领取。现有免费创作和导出继续免费。</p>
        <details
          v-for="entry in [
            { name: '使用许可', policy: sku.release.license },
            { name: '购买条款', policy: sku.purchaseTerms },
            { name: '退款说明', policy: sku.refundPolicy },
          ]"
          :key="entry.name"
          open
        >
          <summary>{{ entry.name }} · {{ entry.policy.version }}</summary>
          <p class="policy-copy">{{ entry.policy.content }}</p>
        </details>
        <label class="consent"
          ><input v-model="accepted" type="checkbox" :disabled="busy" />
          我已阅读以上使用许可、购买条款和退款说明，并确认所选版本与交付范围。</label
        >
        <button class="art-button" type="submit" :disabled="busy || !accepted">
          确认并创建订单
        </button>
        <button
          class="art-button"
          type="button"
          :disabled="busy"
          @click="leaveReview"
        >
          返回核对
        </button>
      </form>
    </template>
    <p v-else-if="!error">新订单尚未开放，你可以先体验免费模板。</p>
    <div class="account-links">
      <RouterLink to="/account/orders">我的订单 ↗</RouterLink>
      <RouterLink to="/account/library">我的已购内容 ↗</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.purchase-confirmation {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: clamp(18px, 4vw, 32px);
  margin-top: 32px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
h2,
h3 {
  font-family: var(--font-display);
  font-weight: 500;
}
.environment-note {
  color: var(--text-muted);
}
.policy-copy {
  white-space: pre-wrap;
}
details {
  border-block-start: 1px solid var(--border);
  padding: 16px 0;
}
summary {
  cursor: pointer;
}
.consent {
  display: flex;
  gap: 12px;
  align-items: start;
  margin: 24px 0;
}
input {
  margin-top: 7px;
  flex-shrink: 0;
}
.art-button {
  margin: 0 12px 12px 0;
}
.account-links {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  margin-top: 20px;
}
.command-copy {
  font-size: 13px;
  color: var(--text-muted);
}
</style>
